use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const PREFS_FILE_NAME: &str = "prefs.json";
const MAX_RECENT_WORKSPACES: usize = 8;

/// Persisted desktop application preferences (stored strictly in OS app data, never inside workspace).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefs {
    pub last_workspace: Option<String>,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(dir.join(PREFS_FILE_NAME))
}

/// Loads desktop preferences, returning defaults when no file exists yet.
pub fn load_prefs(app: &AppHandle) -> AppPrefs {
    let Ok(path) = prefs_path(app) else {
        return AppPrefs::default();
    };
    load_prefs_from_path(&path)
}

pub fn load_prefs_from_path(path: &PathBuf) -> AppPrefs {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppPrefs>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_prefs_to_path(path: &PathBuf, prefs: &AppPrefs) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    }
    let content =
        serde_json::to_string_pretty(prefs).map_err(|e| format!("Failed to serialize prefs: {e}"))?;
    fs::write(path, content).map_err(|e| format!("Failed to write prefs: {e}"))
}

/// Records an opened workspace path as `last_workspace` and pushes it to the top of `recent_workspaces`.
pub fn record_workspace(app: &AppHandle, workspace_path: &str) -> Result<AppPrefs, String> {
    let path = prefs_path(app)?;
    record_workspace_at_path(&path, workspace_path)
}

pub fn record_workspace_at_path(path: &PathBuf, workspace_path: &str) -> Result<AppPrefs, String> {
    let mut prefs = load_prefs_from_path(path);
    prefs.last_workspace = Some(workspace_path.to_string());
    prefs
        .recent_workspaces
        .retain(|existing| existing != workspace_path);
    prefs.recent_workspaces.insert(0, workspace_path.to_string());
    prefs.recent_workspaces.truncate(MAX_RECENT_WORKSPACES);
    save_prefs_to_path(path, &prefs)?;
    Ok(prefs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn loads_defaults_on_missing_or_corrupt_prefs_and_caps_recent_workspaces() {
        let tmp = TempDir::new().unwrap();
        let prefs_file = tmp.path().join(PREFS_FILE_NAME);

        // Missing file -> empty defaults
        let initial = load_prefs_from_path(&prefs_file);
        assert_eq!(initial.last_workspace, None);
        assert!(initial.recent_workspaces.is_empty());

        // Malformed file -> falls back cleanly to defaults
        fs::write(&prefs_file, "{ bad json").unwrap();
        assert_eq!(load_prefs_from_path(&prefs_file).last_workspace, None);

        // Recording workspaces deduplicates, moves active to front, and caps at 8
        for i in 0..10 {
            let ws = format!("/ws/project-{i}");
            record_workspace_at_path(&prefs_file, &ws).unwrap();
        }
        let reloaded = load_prefs_from_path(&prefs_file);
        assert_eq!(reloaded.last_workspace.as_deref(), Some("/ws/project-9"));
        assert_eq!(reloaded.recent_workspaces.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(reloaded.recent_workspaces[0], "/ws/project-9");
        assert_eq!(reloaded.recent_workspaces[7], "/ws/project-2");

        // Re-opening an older entry promotes it without duplicating
        let promoted = record_workspace_at_path(&prefs_file, "/ws/project-4").unwrap();
        assert_eq!(promoted.last_workspace.as_deref(), Some("/ws/project-4"));
        assert_eq!(promoted.recent_workspaces.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(promoted.recent_workspaces[0], "/ws/project-4");
        assert_eq!(promoted.recent_workspaces[1], "/ws/project-9");
    }
}
