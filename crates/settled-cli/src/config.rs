use serde::{Deserialize, Serialize};
use settled_core::ITEMS_DIR_NAME;
use std::fs;
use std::path::{Component, Path, PathBuf};

const APP_DIR_NAME: &str = "dev.settled.app";
const CLI_CONFIG_FILE_NAME: &str = "cli.json";

/// Persisted CLI workspace state stored alongside desktop prefs in OS app data, kept strictly separate.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliConfig {
    pub current_workspace: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<String>,
}

/// Manages reading and writing CLI workspace registration state (`cli.json`).
#[derive(Debug, Clone)]
pub struct CliConfigStore {
    path: PathBuf,
}

impl CliConfigStore {
    /// Returns the default CLI config store path inside `<data_dir>/dev.settled.app/cli.json`.
    pub fn default_store() -> Result<Self, String> {
        if let Some(override_path) = std::env::var_os("SETTLED_CLI_CONFIG")
            && !override_path.is_empty()
        {
            return Ok(Self {
                path: PathBuf::from(override_path),
            });
        }
        let base = dirs::data_dir()
            .ok_or_else(|| "Failed to resolve OS application data directory".to_string())?;
        Ok(Self {
            path: base.join(APP_DIR_NAME).join(CLI_CONFIG_FILE_NAME),
        })
    }

    #[cfg(test)]
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<CliConfig, String> {
        if !self.path.exists() {
            return Ok(CliConfig::default());
        }
        let raw = fs::read_to_string(&self.path)
            .map_err(|e| format!("Failed to read CLI config '{}': {e}", self.path.display()))?;
        serde_json::from_str::<CliConfig>(&raw)
            .map_err(|e| format!("Failed to parse CLI config '{}': {e}", self.path.display()))
    }

    pub fn save(&self, config: &CliConfig) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create CLI config directory '{}': {e}", parent.display())
            })?;
        }
        let content = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize CLI config: {e}"))?;
        fs::write(&self.path, content)
            .map_err(|e| format!("Failed to write CLI config '{}': {e}", self.path.display()))
    }
}

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

/// Registers (if needed) and activates a workspace in `cli.json`.
pub fn use_workspace(
    store: &CliConfigStore,
    raw_path: &Path,
    cwd: &Path,
    init: bool,
) -> Result<UseWorkspaceOutcome, String> {
    let abs = normalize_against(raw_path, cwd);

    if abs.exists() && !abs.is_dir() {
        return Err(format!("Path '{}' exists and is not a directory", abs.display()));
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

    let mut config = store.load()?;
    if !config
        .workspaces
        .iter()
        .any(|existing| paths_equal(existing, &canonical_str))
    {
        config.workspaces.push(canonical_str.clone());
    }
    config.current_workspace = Some(canonical_str.clone());
    store.save(&config)?;

    Ok(UseWorkspaceOutcome {
        path: canonical_str,
        initialized,
    })
}

/// Removes a registered workspace from `cli.json` (clearing `current_workspace` if matched).
pub fn remove_workspace(
    store: &CliConfigStore,
    raw_path: &Path,
    cwd: &Path,
) -> Result<RemoveWorkspaceOutcome, String> {
    let mut config = store.load()?;
    let raw_str = raw_path.to_string_lossy();
    let abs_str = normalize_against(raw_path, cwd)
        .to_string_lossy()
        .into_owned();
    let canon_str = canonicalize_if_possible(&normalize_against(raw_path, cwd))
        .to_string_lossy()
        .into_owned();

    let matches_target = |candidate: &str| {
        paths_equal(candidate, &raw_str)
            || paths_equal(candidate, &abs_str)
            || paths_equal(candidate, &canon_str)
    };

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

    store.save(&config)?;

    Ok(RemoveWorkspaceOutcome {
        path: removed,
        was_current,
    })
}

/// Resolves the target workspace path along with any non-fatal CLI warnings:
/// 1. Explicit `-w/--workspace` or `SETTLED_WORKSPACE`
/// 2. Global `current_workspace` from `cli.json` (warns if missing on disk and falls through)
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
        return Ok((canonicalize_if_possible(&normalize_against(cwd, cwd)), warnings));
    }

    Err(format!(
        "No active workspace found. Pass -w <path>, run inside a directory containing '{ITEMS_DIR_NAME}/', or run 'settled workspace use <path>'."
    ))
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

fn canonicalize_if_possible(path: &Path) -> PathBuf {
    match fs::canonicalize(path) {
        Ok(canon) => strip_windows_verbatim(canon),
        Err(_) => path.to_path_buf(),
    }
}

fn strip_windows_verbatim(path: PathBuf) -> PathBuf {
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
