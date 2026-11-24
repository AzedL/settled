use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Application data subdirectory shared by Settled desktop and CLI.
pub const APP_DATA_DIR_NAME: &str = "dev.settled.app";
/// Unified workspace state file shared between desktop and CLI.
pub const WORKSPACES_STATE_FILE_NAME: &str = "workspaces.json";
const LEGACY_CLI_CONFIG_FILE_NAME: &str = "cli.json";
const LEGACY_DESKTOP_PREFS_FILE_NAME: &str = "prefs.json";

/// Shared workspace state persisted in OS application data (never inside a workspace directory).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub current_workspace: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyDesktopPrefs {
    last_workspace: Option<String>,
    #[serde(default)]
    recent_workspaces: Vec<String>,
}

/// Manages reading and writing the shared `workspaces.json` state store.
#[derive(Debug, Clone)]
pub struct WorkspaceStateStore {
    path: PathBuf,
}

impl WorkspaceStateStore {
    /// Returns the default shared store path inside `<data_dir>/dev.settled.app/workspaces.json`.
    ///
    /// Respects `SETTLED_STATE_PATH` and legacy `SETTLED_CLI_CONFIG` overrides for isolated tests/scripts.
    pub fn default_store() -> Result<Self, String> {
        for env_key in ["SETTLED_STATE_PATH", "SETTLED_CLI_CONFIG"] {
            if let Some(override_path) = std::env::var_os(env_key)
                && !override_path.is_empty()
            {
                return Ok(Self {
                    path: PathBuf::from(override_path),
                });
            }
        }
        let base = dirs::data_dir()
            .ok_or_else(|| "Failed to resolve OS application data directory".to_string())?;
        Ok(Self {
            path: base
                .join(APP_DATA_DIR_NAME)
                .join(WORKSPACES_STATE_FILE_NAME),
        })
    }

    /// Creates a store backed by an explicit file path.
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Loads workspace state strictly, transparently migrating legacy `cli.json` / `prefs.json`
    /// when `workspaces.json` has not been created yet.
    pub fn load(&self) -> Result<WorkspaceState, String> {
        if self.path.exists() {
            let raw = fs::read_to_string(&self.path).map_err(|e| {
                format!(
                    "Failed to read workspace state '{}': {e}",
                    self.path.display()
                )
            })?;
            return serde_json::from_str::<WorkspaceState>(&raw).map_err(|e| {
                format!(
                    "Failed to parse workspace state '{}': {e}",
                    self.path.display()
                )
            });
        }

        if let Some(migrated) = self.load_legacy_migration() {
            return Ok(migrated);
        }

        Ok(WorkspaceState::default())
    }

    /// Loads workspace state leniently, returning defaults on read or parse errors.
    pub fn load_lenient(&self) -> WorkspaceState {
        self.load().unwrap_or_default()
    }

    /// Persists workspace state to disk, creating parent directories as needed.
    pub fn save(&self, state: &WorkspaceState) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create workspace state directory '{}': {e}",
                    parent.display()
                )
            })?;
        }
        let content = serde_json::to_string_pretty(state)
            .map_err(|e| format!("Failed to serialize workspace state: {e}"))?;
        fs::write(&self.path, content).map_err(|e| {
            format!(
                "Failed to write workspace state '{}': {e}",
                self.path.display()
            )
        })
    }

    /// Marks `workspace_path` as active and promotes it to the front of `workspaces` (strict load).
    pub fn record_active_workspace(&self, workspace_path: &str) -> Result<WorkspaceState, String> {
        let mut state = self.load()?;
        promote_workspace(&mut state, workspace_path);
        self.save(&state)?;
        Ok(state)
    }

    /// Marks `workspace_path` as active and promotes it to the front of `workspaces` (lenient load).
    pub fn record_active_workspace_lenient(
        &self,
        workspace_path: &str,
    ) -> Result<WorkspaceState, String> {
        let mut state = self.load_lenient();
        promote_workspace(&mut state, workspace_path);
        self.save(&state)?;
        Ok(state)
    }

    fn load_legacy_migration(&self) -> Option<WorkspaceState> {
        if self.path.file_name() != Some(OsStr::new(WORKSPACES_STATE_FILE_NAME)) {
            return None;
        }
        let parent = self.path.parent()?;
        let legacy_cli_path = parent.join(LEGACY_CLI_CONFIG_FILE_NAME);
        let legacy_prefs_path = parent.join(LEGACY_DESKTOP_PREFS_FILE_NAME);

        let cli = fs::read_to_string(&legacy_cli_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<WorkspaceState>(&raw).ok());
        let prefs = fs::read_to_string(&legacy_prefs_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LegacyDesktopPrefs>(&raw).ok());

        if cli.is_none() && prefs.is_none() {
            return None;
        }

        let current_workspace = cli
            .as_ref()
            .and_then(|c| c.current_workspace.clone())
            .or_else(|| prefs.as_ref().and_then(|p| p.last_workspace.clone()));

        let mut workspaces = Vec::new();
        let mut push_unique = |candidate: String| {
            if !candidate.trim().is_empty()
                && !workspaces
                    .iter()
                    .any(|existing: &String| paths_equal(existing, &candidate))
            {
                workspaces.push(candidate);
            }
        };

        if let Some(cur) = &current_workspace {
            push_unique(cur.clone());
        }
        if let Some(prefs) = prefs {
            if let Some(last) = prefs.last_workspace {
                push_unique(last);
            }
            for recent in prefs.recent_workspaces {
                push_unique(recent);
            }
        }
        if let Some(cli) = cli {
            for ws in cli.workspaces {
                push_unique(ws);
            }
        }

        Some(WorkspaceState {
            current_workspace,
            workspaces,
        })
    }
}

fn promote_workspace(state: &mut WorkspaceState, workspace_path: &str) {
    state.current_workspace = Some(workspace_path.to_string());
    state
        .workspaces
        .retain(|existing| !paths_equal(existing, workspace_path));
    state.workspaces.insert(0, workspace_path.to_string());
}

/// Joins relative paths with `cwd` and resolves `.` / `..` segments cleanly without touching disk.
pub fn normalize_against(path: &Path, cwd: &Path) -> PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };

    let mut out = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            Component::Normal(s) => out.push(s),
        }
    }
    out
}

/// Canonicalizes `path` (or its nearest existing ancestor) and strips Windows `\\?\` verbatim prefixes.
pub fn canonicalize_if_possible(path: &Path) -> PathBuf {
    if let Ok(canon) = fs::canonicalize(path) {
        return strip_windows_verbatim(canon);
    }

    // When `path` itself no longer exists on disk (e.g. `workspace remove` on a deleted folder),
    // canonicalize its nearest existing ancestor so symlinked prefixes (`/var` -> `/private/var`)
    // and Windows 8.3 short paths (`RUNNER~1` -> `runneradmin`) still match registered paths.
    let mut missing_tail = Vec::new();
    let mut cur = path;
    while let Some(parent) = cur.parent() {
        if let Some(name) = cur.file_name() {
            missing_tail.push(name.to_os_string());
        }
        if let Ok(mut base) = fs::canonicalize(parent).map(strip_windows_verbatim) {
            for seg in missing_tail.into_iter().rev() {
                base.push(seg);
            }
            return base;
        }
        cur = parent;
    }

    path.to_path_buf()
}

pub fn strip_windows_verbatim(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{stripped}"));
        }
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

/// Compares two workspace path strings ignoring trailing separators (and ASCII case on Windows).
pub fn paths_equal(a: &str, b: &str) -> bool {
    fn norm(s: &str) -> String {
        #[cfg(windows)]
        {
            let mut win = s.replace('/', "\\");
            while win.len() > 3 && win.ends_with('\\') {
                win.pop();
            }
            win.to_ascii_lowercase()
        }
        #[cfg(not(windows))]
        {
            let mut unix = s.to_string();
            while unix.len() > 1 && unix.ends_with('/') {
                unix.pop();
            }
            unix
        }
    }
    norm(a) == norm(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn migrates_legacy_cli_and_desktop_files_and_promotes_active_workspace() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(LEGACY_DESKTOP_PREFS_FILE_NAME),
            r#"{
                "lastWorkspace": "/ws/desktop-only",
                "recentWorkspaces": ["/ws/desktop-only", "/ws/shared"]
            }"#,
        )
        .unwrap();
        fs::write(
            tmp.path().join(LEGACY_CLI_CONFIG_FILE_NAME),
            r#"{
                "currentWorkspace": "/ws/cli-active",
                "workspaces": ["/ws/shared", "/ws/cli-active"]
            }"#,
        )
        .unwrap();

        let store = WorkspaceStateStore::at(tmp.path().join(WORKSPACES_STATE_FILE_NAME));
        let migrated = store.load().unwrap();
        assert_eq!(
            migrated.current_workspace.as_deref(),
            Some("/ws/cli-active")
        );
        assert_eq!(
            migrated.workspaces,
            vec!["/ws/cli-active", "/ws/desktop-only", "/ws/shared"]
        );

        // Recording a workspace promotes it to front without dropping existing registered entries
        let updated = store.record_active_workspace("/ws/shared").unwrap();
        assert_eq!(updated.current_workspace.as_deref(), Some("/ws/shared"));
        assert_eq!(
            updated.workspaces,
            vec!["/ws/shared", "/ws/cli-active", "/ws/desktop-only"]
        );
        assert!(tmp.path().join(WORKSPACES_STATE_FILE_NAME).is_file());
    }

    #[test]
    fn falls_back_to_legacy_desktop_prefs_when_cli_config_missing() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join(LEGACY_DESKTOP_PREFS_FILE_NAME),
            r#"{
                "lastWorkspace": "/ws/from-desktop",
                "recentWorkspaces": ["/ws/from-desktop", "/ws/second"]
            }"#,
        )
        .unwrap();

        let store = WorkspaceStateStore::at(tmp.path().join(WORKSPACES_STATE_FILE_NAME));
        let migrated = store.load().unwrap();
        assert_eq!(
            migrated.current_workspace.as_deref(),
            Some("/ws/from-desktop")
        );
        assert_eq!(migrated.workspaces, vec!["/ws/from-desktop", "/ws/second"]);
    }
}
