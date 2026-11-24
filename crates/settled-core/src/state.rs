use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Application data subdirectory shared by Settled desktop and CLI.
pub const APP_DATA_DIR_NAME: &str = "dev.settled.app";
/// Unified workspace state file shared between desktop and CLI.
pub const WORKSPACES_STATE_FILE_NAME: &str = "workspaces.json";
const LEGACY_CLI_CONFIG_FILE_NAME: &str = "cli.json";
const LEGACY_DESKTOP_PREFS_FILE_NAME: &str = "prefs.json";

static TEMP_FILE_SEQ: AtomicU64 = AtomicU64::new(0);

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

/// Manages cross-process synchronized reading and writing of the shared `workspaces.json` store.
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

    fn lock_path(&self) -> PathBuf {
        let mut os = self.path.as_os_str().to_os_string();
        os.push(".lock");
        PathBuf::from(os)
    }

    fn acquire_exclusive_lock(&self) -> Result<File, String> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Failed to create workspace state directory '{}': {e}",
                    parent.display()
                )
            })?;
        }
        let lock_file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(self.lock_path())
            .map_err(|e| {
                format!(
                    "Failed to open workspace state lock '{}': {e}",
                    self.lock_path().display()
                )
            })?;
        lock_file.lock().map_err(|e| {
            format!(
                "Failed to acquire exclusive workspace state lock '{}': {e}",
                self.lock_path().display()
            )
        })?;
        Ok(lock_file)
    }

    fn acquire_shared_lock_if_dir_exists(&self) -> Result<Option<File>, String> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
            && !parent.is_dir()
        {
            return Ok(None);
        }
        let lock_file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(self.lock_path())
            .map_err(|e| {
                format!(
                    "Failed to open workspace state lock '{}': {e}",
                    self.lock_path().display()
                )
            })?;
        lock_file.lock_shared().map_err(|e| {
            format!(
                "Failed to acquire shared workspace state lock '{}': {e}",
                self.lock_path().display()
            )
        })?;
        Ok(Some(lock_file))
    }

    fn load_unlocked(&self) -> Result<WorkspaceState, String> {
        match fs::read_to_string(&self.path) {
            Ok(raw) => serde_json::from_str::<WorkspaceState>(&raw).map_err(|e| {
                format!(
                    "Failed to parse workspace state '{}': {e}",
                    self.path.display()
                )
            }),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                Ok(self.load_legacy_migration().unwrap_or_default())
            }
            Err(err) => Err(format!(
                "Failed to read workspace state '{}': {err}",
                self.path.display()
            )),
        }
    }

    fn save_atomic_unlocked(&self, state: &WorkspaceState) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create workspace state directory '{}': {e}",
                parent.display()
            )
        })?;

        let content = serde_json::to_string_pretty(state)
            .map_err(|e| format!("Failed to serialize workspace state: {e}"))?;

        let pid = std::process::id();
        let file_name = self
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(WORKSPACES_STATE_FILE_NAME);

        let mut tmp_path = None;
        let mut tmp_file = None;
        for _ in 0..32 {
            let seq = TEMP_FILE_SEQ.fetch_add(1, Ordering::Relaxed);
            let candidate = parent.join(format!(".{file_name}.{pid}.{seq}.tmp"));
            match OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&candidate)
            {
                Ok(f) => {
                    tmp_path = Some(candidate);
                    tmp_file = Some(f);
                    break;
                }
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(err) => {
                    return Err(format!(
                        "Failed to create temporary workspace state file '{}': {err}",
                        candidate.display()
                    ));
                }
            }
        }

        let (Some(tmp_path), Some(mut tmp_file)) = (tmp_path, tmp_file) else {
            return Err("Failed to allocate unique temporary workspace state file".to_string());
        };

        let write_result = (|| -> std::io::Result<()> {
            tmp_file.write_all(content.as_bytes())?;
            tmp_file.sync_all()?;
            Ok(())
        })();
        drop(tmp_file);

        if let Err(err) = write_result {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "Failed to write temporary workspace state '{}': {err}",
                tmp_path.display()
            ));
        }

        if let Err(err) = replace_file_atomically(&tmp_path, &self.path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "Failed to atomically replace workspace state '{}': {err}",
                self.path.display()
            ));
        }

        Ok(())
    }

    /// Loads workspace state under a shared cross-process lock, migrating legacy `cli.json`/`prefs.json`
    /// only when `workspaces.json` does not exist yet.
    pub fn load(&self) -> Result<WorkspaceState, String> {
        let _guard = self.acquire_shared_lock_if_dir_exists()?;
        self.load_unlocked()
    }

    /// Loads workspace state leniently for read-only UI display, returning defaults on error.
    /// Never writes back or overwrites existing files on disk.
    pub fn load_lenient(&self) -> WorkspaceState {
        self.load().unwrap_or_default()
    }

    /// Executes an atomic read-modify-write transaction under an exclusive cross-process file lock.
    ///
    /// If the existing state file cannot be read or parsed, returns `Err` without overwriting disk.
    /// When the closure returns `Ok((value, true))`, the mutated state is atomically persisted;
    /// when it returns `Ok((value, false))`, disk is left untouched.
    pub fn update<F, R>(&self, mutate: F) -> Result<R, String>
    where
        F: FnOnce(&mut WorkspaceState) -> Result<(R, bool), String>,
    {
        let _guard = self.acquire_exclusive_lock()?;
        let mut state = self.load_unlocked()?;
        let (result, dirty) = mutate(&mut state)?;
        if dirty {
            self.save_atomic_unlocked(&state)?;
        }
        Ok(result)
    }

    /// Atomically persists a full workspace state snapshot under an exclusive cross-process lock.
    pub fn save(&self, state: &WorkspaceState) -> Result<(), String> {
        let _guard = self.acquire_exclusive_lock()?;
        self.save_atomic_unlocked(state)
    }

    /// Marks `workspace_path` as active and promotes it to the front of `workspaces` transactionally.
    ///
    /// Fails cleanly without overwriting if an existing state file is unreadable or corrupt.
    pub fn record_active_workspace(&self, workspace_path: &str) -> Result<WorkspaceState, String> {
        self.update(|state| {
            promote_workspace(state, workspace_path);
            Ok((state.clone(), true))
        })
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

fn replace_file_atomically(src: &Path, dest: &Path) -> std::io::Result<()> {
    #[cfg(not(windows))]
    {
        fs::rename(src, dest)
    }

    #[cfg(windows)]
    {
        // Rust's std::fs::rename on Windows uses MoveFileExW(MOVEFILE_REPLACE_EXISTING).
        // Brief retries tolerate transient sharing conflicts from AV/indexers while the
        // companion lock file serializes Settled desktop and CLI processes.
        let mut last_err = None;
        for attempt in 0..8 {
            match fs::rename(src, dest) {
                Ok(()) => return Ok(()),
                Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied && attempt < 7 => {
                    last_err = Some(err);
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(err) => return Err(err),
            }
        }
        Err(last_err.unwrap_or_else(|| std::io::Error::other("rename retry exhausted")))
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

    #[test]
    fn refuses_to_clobber_corrupt_state_file_on_write() {
        let tmp = TempDir::new().unwrap();
        let state_path = tmp.path().join(WORKSPACES_STATE_FILE_NAME);
        fs::write(&state_path, "{ corrupt json").unwrap();

        let store = WorkspaceStateStore::at(state_path.clone());
        // Read-only lenient load returns empty defaults without mutating disk
        assert_eq!(store.load_lenient(), WorkspaceState::default());
        // Transactional write MUST fail instead of overwriting the corrupt file with an empty list
        assert!(store.record_active_workspace("/ws/new").is_err());
        assert_eq!(fs::read_to_string(&state_path).unwrap(), "{ corrupt json");
    }

    #[test]
    fn serializes_concurrent_writers_without_lost_updates() {
        let tmp = TempDir::new().unwrap();
        let state_path = tmp.path().join(WORKSPACES_STATE_FILE_NAME);

        let workers: Vec<_> = (0..8)
            .map(|i| {
                let path = state_path.clone();
                std::thread::spawn(move || {
                    let store = WorkspaceStateStore::at(path);
                    for round in 0..3 {
                        store
                            .record_active_workspace(&format!("/ws/worker-{i}-{round}"))
                            .unwrap();
                        let _ = store.load().unwrap();
                    }
                })
            })
            .collect();

        for handle in workers {
            handle.join().unwrap();
        }

        let final_state = WorkspaceStateStore::at(state_path).load().unwrap();
        assert_eq!(final_state.workspaces.len(), 24);
        assert!(final_state.current_workspace.is_some());
    }
}
