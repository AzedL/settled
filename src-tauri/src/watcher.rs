use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const WORKSPACE_CHANGED_EVENT: &str = "settled://workspace-changed";

/// Watches a Settled workspace for file changes under `items/` and notifies the frontend.
pub struct WorkspaceWatcher {
    _debouncer: Debouncer<notify::RecommendedWatcher>,
}

impl WorkspaceWatcher {
    pub fn start(app: AppHandle, workspace_root: PathBuf) -> Result<Self, String> {
        let items_dir = workspace_root.join("items");
        let root_str = workspace_root.to_string_lossy().into_owned();
        let watch_target = workspace_root.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(280),
            move |res: DebounceEventResult| {
                let Ok(events) = res else {
                    return;
                };
                let touches_items = events.iter().any(|ev| {
                    is_relevant_path(&ev.path, &workspace_root, &items_dir)
                });
                if touches_items {
                    let _ = app.emit(WORKSPACE_CHANGED_EVENT, root_str.clone());
                }
            },
        )
        .map_err(|e| format!("Failed to initialize file watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(&watch_target, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch workspace directory: {e}"))?;

        Ok(Self {
            _debouncer: debouncer,
        })
    }
}

fn is_relevant_path(changed: &Path, root: &Path, items_dir: &Path) -> bool {
    if changed == items_dir || changed.starts_with(items_dir) {
        return !changed
            .components()
            .any(|c| c.as_os_str() == ".git" || c.as_os_str() == "node_modules");
    }
    changed == root
}
