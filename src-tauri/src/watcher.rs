use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use settled_core::ITEMS_DIR_NAME;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const WORKSPACE_CHANGED_EVENT: &str = "settled://workspace-changed";

/// Precision two-layer watcher for a Settled workspace:
/// - `<root>` watched non-recursively so large trees (`node_modules`, `.git`, `target`) are never traversed;
/// - `<root>/settled-items` watched recursively when present, scoped to item directories, `meta.json`, and `README.md`.
pub struct WorkspaceWatcher {
    debouncer: Debouncer<notify::RecommendedWatcher>,
    items_dir: PathBuf,
    items_watched: bool,
    resync_items_dir: Arc<AtomicBool>,
}

impl WorkspaceWatcher {
    pub fn start(app: AppHandle, workspace_root: PathBuf) -> Result<Self, String> {
        Self::start_with_callback(workspace_root, move |root_str| {
            let _ = app.emit(WORKSPACE_CHANGED_EVENT, root_str);
        })
    }

    pub fn start_with_callback<F>(workspace_root: PathBuf, on_change: F) -> Result<Self, String>
    where
        F: Fn(String) + Send + 'static,
    {
        let items_dir = workspace_root.join(ITEMS_DIR_NAME);
        let root_str = workspace_root.to_string_lossy().into_owned();
        let resync_items_dir = Arc::new(AtomicBool::new(false));

        let cb_root = workspace_root.clone();
        let cb_items_dir = items_dir.clone();
        let cb_resync = Arc::clone(&resync_items_dir);

        let mut debouncer = new_debouncer(
            Duration::from_millis(280),
            move |res: DebounceEventResult| {
                let Ok(events) = res else {
                    return;
                };
                if events.iter().any(|ev| ev.path == cb_items_dir) {
                    cb_resync.store(true, Ordering::Release);
                }
                let relevant = events
                    .iter()
                    .any(|ev| is_relevant_path(&ev.path, &cb_root, &cb_items_dir));
                if relevant {
                    on_change(root_str.clone());
                }
            },
        )
        .map_err(|e| format!("Failed to initialize file watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(&workspace_root, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Failed to watch workspace directory: {e}"))?;

        let items_watched = if items_dir.is_dir() {
            debouncer
                .watcher()
                .watch(&items_dir, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch {ITEMS_DIR_NAME} directory: {e}"))?;
            true
        } else {
            false
        };

        Ok(Self {
            debouncer,
            items_dir,
            items_watched,
            resync_items_dir,
        })
    }

    /// Synchronizes the recursive watch on `<root>/settled-items` when created, removed, or replaced.
    pub fn sync_items_watch(&mut self) {
        let dir_exists = self.items_dir.is_dir();
        let force_resync = self.resync_items_dir.swap(false, Ordering::AcqRel);
        if !force_resync && self.items_watched == dir_exists {
            return;
        }

        if self.items_watched {
            let _ = self.debouncer.watcher().unwatch(&self.items_dir);
            self.items_watched = false;
        }

        if dir_exists
            && self
                .debouncer
                .watcher()
                .watch(&self.items_dir, RecursiveMode::Recursive)
                .is_ok()
        {
            self.items_watched = true;
        }
    }
}

fn is_relevant_path(changed: &Path, root: &Path, items_dir: &Path) -> bool {
    if changed == root || changed == items_dir {
        return true;
    }

    let Ok(rel) = changed.strip_prefix(items_dir) else {
        return false;
    };

    let parts: Vec<&std::ffi::OsStr> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(os) => Some(os),
            _ => None,
        })
        .collect();

    if parts.is_empty() {
        return true;
    }

    if parts
        .iter()
        .any(|os| os.to_str().is_some_and(|s| s.starts_with('.')) || *os == "node_modules")
    {
        return false;
    }

    match parts.as_slice() {
        [_item_id] => !changed.is_file(),
        [_item_id, file_name] => file_name
            .to_str()
            .is_some_and(|name| name == "meta.json" || name.eq_ignore_ascii_case("readme.md")),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_relevant_path;
    use settled_core::ITEMS_DIR_NAME;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn filters_root_noise_and_scopes_to_settled_items_entries() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let items_dir = root.join(ITEMS_DIR_NAME);
        let item_dir = items_dir.join("git-core");
        fs::create_dir_all(item_dir.join("scripts")).unwrap();
        fs::write(item_dir.join("meta.json"), "{}").unwrap();
        fs::write(item_dir.join("README.md"), "# Git").unwrap();
        fs::write(items_dir.join("stray.txt"), "ignore me").unwrap();

        assert!(is_relevant_path(root, root, &items_dir));
        assert!(is_relevant_path(&items_dir, root, &items_dir));
        assert!(is_relevant_path(&item_dir, root, &items_dir));
        assert!(is_relevant_path(&item_dir.join("meta.json"), root, &items_dir));
        assert!(is_relevant_path(&item_dir.join("README.md"), root, &items_dir));
        assert!(is_relevant_path(&item_dir.join("readme.md"), root, &items_dir));
        // Removed item directory no longer exists on disk and should still trigger reload.
        assert!(is_relevant_path(&items_dir.join("deleted-item"), root, &items_dir));

        // Root-level project files, node_modules, target, and .git must be ignored.
        assert!(!is_relevant_path(&root.join("package.json"), root, &items_dir));
        assert!(!is_relevant_path(&root.join(".git").join("index"), root, &items_dir));
        assert!(!is_relevant_path(&root.join("node_modules").join("pkg"), root, &items_dir));

        // Loose files directly under settled-items/, hidden folders, scripts, and runtime logs are ignored.
        assert!(!is_relevant_path(&items_dir.join("stray.txt"), root, &items_dir));
        assert!(!is_relevant_path(&items_dir.join(".hidden").join("meta.json"), root, &items_dir));
        assert!(!is_relevant_path(&item_dir.join("scripts").join("check.sh"), root, &items_dir));
        assert!(!is_relevant_path(&item_dir.join("output.log"), root, &items_dir));
    }

    #[test]
    fn syncs_settled_items_watch_dynamically_and_ignores_unrelated_root_files() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        use std::time::Duration;

        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_path_buf();
        let hits = Arc::new(AtomicUsize::new(0));
        let hits_cb = Arc::clone(&hits);

        // Start watching root before settled-items/ exists
        let mut watcher = super::WorkspaceWatcher::start_with_callback(root.clone(), move |_| {
            hits_cb.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        assert!(!watcher.items_watched);

        // Unrelated file change at root should not emit events
        fs::write(root.join("unrelated.txt"), "hi").unwrap();
        std::thread::sleep(Duration::from_millis(450));
        assert_eq!(hits.load(Ordering::SeqCst), 0);

        // Creating settled-items/ notifies and allows sync_items_watch() to attach recursive watch
        let item_dir = root.join(ITEMS_DIR_NAME).join("demo");
        fs::create_dir_all(&item_dir).unwrap();
        std::thread::sleep(Duration::from_millis(450));
        assert!(hits.load(Ordering::SeqCst) >= 1);

        watcher.sync_items_watch();
        assert!(watcher.items_watched);

        // Subsequent meta.json write inside settled-items/demo/ notifies via layer 2 watch
        let before = hits.load(Ordering::SeqCst);
        fs::write(item_dir.join("meta.json"), r#"{"name":"Demo"}"#).unwrap();
        std::thread::sleep(Duration::from_millis(450));
        assert!(hits.load(Ordering::SeqCst) > before);

        // Deleting settled-items/ detaches layer 2 cleanly on next sync
        fs::remove_dir_all(root.join(ITEMS_DIR_NAME)).unwrap();
        std::thread::sleep(Duration::from_millis(450));
        watcher.sync_items_watch();
        assert!(!watcher.items_watched);
    }
}
