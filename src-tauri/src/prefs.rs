use serde::{Deserialize, Serialize};
use settled_core::{
    WORKSPACES_STATE_FILE_NAME, WorkspaceState, WorkspaceStateStore, strip_windows_verbatim,
};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

const MAX_RECENT_WORKSPACES: usize = 8;

/// Desktop view over the shared workspace state persisted in OS app data (`workspaces.json`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefs {
    pub last_workspace: Option<String>,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
}

impl From<WorkspaceState> for AppPrefs {
    fn from(state: WorkspaceState) -> Self {
        Self {
            last_workspace: state.current_workspace,
            recent_workspaces: state
                .workspaces
                .into_iter()
                .take(MAX_RECENT_WORKSPACES)
                .collect(),
        }
    }
}

fn state_store(app: &AppHandle) -> Result<WorkspaceStateStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(WorkspaceStateStore::at(
        dir.join(WORKSPACES_STATE_FILE_NAME),
    ))
}

/// Loads shared workspace preferences, migrating legacy files and returning defaults on error.
pub fn load_prefs(app: &AppHandle) -> AppPrefs {
    let Ok(store) = state_store(app) else {
        return AppPrefs::default();
    };
    AppPrefs::from(store.load_lenient())
}

/// Records an opened workspace path into the shared desktop + CLI state store.
pub fn record_workspace(app: &AppHandle, workspace_path: &str) -> Result<AppPrefs, String> {
    let store = state_store(app)?;
    record_workspace_at_path(store.path(), workspace_path)
}

#[cfg(test)]
pub fn load_prefs_from_path(path: &Path) -> AppPrefs {
    AppPrefs::from(WorkspaceStateStore::at(path.to_path_buf()).load_lenient())
}

pub fn record_workspace_at_path(path: &Path, workspace_path: &str) -> Result<AppPrefs, String> {
    let normalized = fs::canonicalize(workspace_path)
        .map(strip_windows_verbatim)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| workspace_path.to_string());
    let store = WorkspaceStateStore::at(path.to_path_buf());
    let state = store.record_active_workspace_lenient(&normalized)?;
    Ok(AppPrefs::from(state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn loads_defaults_on_missing_or_corrupt_prefs_and_caps_recent_workspaces() {
        let tmp = TempDir::new().unwrap();
        let state_file = tmp.path().join(WORKSPACES_STATE_FILE_NAME);

        // Missing file -> empty defaults
        let initial = load_prefs_from_path(&state_file);
        assert_eq!(initial.last_workspace, None);
        assert!(initial.recent_workspaces.is_empty());

        // Malformed file -> falls back cleanly to defaults
        fs::write(&state_file, "{ bad json").unwrap();
        assert_eq!(load_prefs_from_path(&state_file).last_workspace, None);

        // Recording workspaces deduplicates, moves active to front, and caps desktop view at 8
        // while keeping the full shared list intact for CLI.
        for i in 0..10 {
            let ws = format!("/ws/project-{i}");
            record_workspace_at_path(&state_file, &ws).unwrap();
        }
        let reloaded = load_prefs_from_path(&state_file);
        assert_eq!(reloaded.last_workspace.as_deref(), Some("/ws/project-9"));
        assert_eq!(reloaded.recent_workspaces.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(reloaded.recent_workspaces[0], "/ws/project-9");
        assert_eq!(reloaded.recent_workspaces[7], "/ws/project-2");

        let full_shared = WorkspaceStateStore::at(state_file.clone()).load().unwrap();
        assert_eq!(full_shared.workspaces.len(), 10);

        // Re-opening an older entry promotes it without duplicating
        let promoted = record_workspace_at_path(&state_file, "/ws/project-4").unwrap();
        assert_eq!(promoted.last_workspace.as_deref(), Some("/ws/project-4"));
        assert_eq!(promoted.recent_workspaces.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(promoted.recent_workspaces[0], "/ws/project-4");
        assert_eq!(promoted.recent_workspaces[1], "/ws/project-9");

        // Trailing slashes (and case differences on Windows) deduplicate cleanly
        let trailing = record_workspace_at_path(&state_file, "/ws/project-4/").unwrap();
        assert_eq!(trailing.recent_workspaces.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(trailing.recent_workspaces[0], "/ws/project-4/");
        assert_eq!(trailing.recent_workspaces[1], "/ws/project-9");
    }
}
