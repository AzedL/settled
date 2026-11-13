use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const PREFS_FILE_NAME: &str = "prefs.json";
const MAX_RECENT_WORKSPACES: usize = 8;

/// Persisted desktop application preferences (stored strictly in OS app data, never inside workspace).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefs {
    pub last_workspace: Option<String>,
    #[serde(default)]
    pub recent_workspaces: Vec<String>,
    #[serde(default = "default_true")]
    pub confirm_mutating_runs: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppPrefs {
    fn default() -> Self {
        Self {
            last_workspace: None,
            recent_workspaces: Vec::new(),
            confirm_mutating_runs: true,
        }
    }
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
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppPrefs>(&raw).ok())
        .unwrap_or_default()
}

/// Persists desktop preferences to disk.
pub fn save_prefs(app: &AppHandle, prefs: &AppPrefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    let content =
        serde_json::to_string_pretty(prefs).map_err(|e| format!("Failed to serialize prefs: {e}"))?;
    fs::write(path, content).map_err(|e| format!("Failed to write prefs: {e}"))
}

/// Records an opened workspace path as `last_workspace` and pushes it to the top of `recent_workspaces`.
pub fn record_workspace(app: &AppHandle, workspace_path: &str) -> Result<AppPrefs, String> {
    let mut prefs = load_prefs(app);
    prefs.last_workspace = Some(workspace_path.to_string());
    prefs
        .recent_workspaces
        .retain(|existing| existing != workspace_path);
    prefs.recent_workspaces.insert(0, workspace_path.to_string());
    prefs.recent_workspaces.truncate(MAX_RECENT_WORKSPACES);
    save_prefs(app, &prefs)?;
    Ok(prefs)
}

/// Resolves the bundled/development sample workspace path if present on disk.
pub fn find_sample_workspace(app: &AppHandle) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("examples").join("workspace"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("examples").join("workspace"));
        }
    }

    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(res_dir.join("examples").join("workspace"));
    }

    candidates
        .into_iter()
        .find(|p| p.join("items").is_dir())
        .map(|p| p.to_string_lossy().into_owned())
}
