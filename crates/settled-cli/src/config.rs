use settled_core::{ITEMS_DIR_NAME, WorkspaceStateStore, normalize_against};
pub use settled_core::{canonicalize_if_possible, paths_equal};
use std::fs;
use std::path::{Path, PathBuf};

/// Store managing the shared desktop + CLI workspace registry.
pub type CliConfigStore = WorkspaceStateStore;

/// Outcome of `settled workspace use`.
#[derive(Debug, Clone)]
pub struct UseWorkspaceOutcome {
    pub path: String,
    pub initialized: bool,
}

/// Outcome of `settled workspace remove`.
#[derive(Debug, Clone)]
pub struct RemoveWorkspaceOutcome {
    pub path: String,
    pub was_current: bool,
}

/// Registers (if needed), promotes, and activates a workspace in the shared state store.
pub fn use_workspace(
    store: &CliConfigStore,
    raw_path: &Path,
    cwd: &Path,
    init: bool,
) -> Result<UseWorkspaceOutcome, String> {
    let abs = normalize_against(raw_path, cwd);

    if abs.exists() && !abs.is_dir() {
        return Err(format!(
            "Path '{}' exists and is not a directory",
            abs.display()
        ));
    }

    let items_dir = abs.join(ITEMS_DIR_NAME);
    let mut initialized = false;
    if !abs.is_dir() || !items_dir.is_dir() {
        if init {
            fs::create_dir_all(&items_dir).map_err(|e| {
                format!(
                    "Failed to initialize workspace directory '{}': {e}",
                    items_dir.display()
                )
            })?;
            initialized = true;
        } else if !abs.is_dir() {
            return Err(format!(
                "Workspace directory '{}' does not exist (pass '--init' to create it with '{ITEMS_DIR_NAME}/')",
                abs.display()
            ));
        } else {
            return Err(format!(
                "Directory '{}' does not contain '{ITEMS_DIR_NAME}/' (pass '--init' to initialize it)",
                abs.display()
            ));
        }
    }

    let canonical = canonicalize_if_possible(&abs);
    let canonical_str = canonical.to_string_lossy().into_owned();
    store.record_active_workspace(&canonical_str)?;

    Ok(UseWorkspaceOutcome {
        path: canonical_str,
        initialized,
    })
}

/// Removes a registered workspace from the shared state store inside an exclusive lock transaction.
pub fn remove_workspace(
    store: &CliConfigStore,
    raw_path: &Path,
    cwd: &Path,
) -> Result<RemoveWorkspaceOutcome, String> {
    let raw_str = raw_path.to_string_lossy().into_owned();
    let abs_path = normalize_against(raw_path, cwd);
    let abs_str = abs_path.to_string_lossy().into_owned();
    let canon_str = canonicalize_if_possible(&abs_path)
        .to_string_lossy()
        .into_owned();

    let matches_target = |candidate: &str| {
        paths_equal(candidate, &raw_str)
            || paths_equal(candidate, &abs_str)
            || paths_equal(candidate, &canon_str)
    };

    store.update(|config| {
        let Some(idx) = config.workspaces.iter().position(|w| matches_target(w)) else {
            return Err(format!(
                "Workspace '{}' is not registered in CLI list",
                raw_path.display()
            ));
        };

        let removed = config.workspaces.remove(idx);
        let was_current = config
            .current_workspace
            .as_deref()
            .is_some_and(matches_target);
        if was_current {
            config.current_workspace = None;
        }

        Ok((
            RemoveWorkspaceOutcome {
                path: removed,
                was_current,
            },
            true,
        ))
    })
}

/// Resolves the target workspace path along with any non-fatal CLI warnings:
/// 1. Explicit `-w/--workspace` or `SETTLED_WORKSPACE`
/// 2. Shared `current_workspace` from `workspaces.json` (warns if missing on disk and falls through)
/// 3. Current working directory `cwd` itself if it contains `settled-items/` (never walks parents)
pub fn resolve_workspace_with_warnings(
    explicit: Option<PathBuf>,
    store: &CliConfigStore,
    cwd: &Path,
) -> Result<(PathBuf, Vec<String>), String> {
    let mut warnings = Vec::new();

    if let Some(p) = explicit {
        let resolved = canonicalize_if_possible(&normalize_against(&p, cwd));
        if !resolved.is_dir() {
            return Err(format!(
                "Workspace path does not exist or is not a directory: {}",
                resolved.display()
            ));
        }
        return Ok((resolved, warnings));
    }

    let config = store.load()?;
    if let Some(current) = config.current_workspace {
        let current_path = PathBuf::from(&current);
        if current_path.is_dir() {
            return Ok((current_path, warnings));
        }
        warnings.push(format!(
            "configured workspace directory does not exist: {current}"
        ));
    }

    if cwd.join(ITEMS_DIR_NAME).is_dir() {
        return Ok((
            canonicalize_if_possible(&normalize_against(cwd, cwd)),
            warnings,
        ));
    }

    Err(format!(
        "No active workspace found. Pass -w <path>, run inside a directory containing '{ITEMS_DIR_NAME}/', or run 'settled workspace use <path>'."
    ))
}
