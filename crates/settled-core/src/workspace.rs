use crate::model::{
    CommandInput, ItemMetaRaw, Platform, ResolvedCommand, ScriptGroup, ScriptRole, SettledError,
    WorkspaceItem, WorkspaceSnapshot,
};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Detects the default shell for the current operating system.
///
/// On Windows, prefers `pwsh` when available on `PATH` and falls back to built-in `powershell`.
/// On macOS and Linux, prefers `bash` and falls back to `sh`.
pub fn detect_default_shell() -> String {
    match Platform::current() {
        Platform::Windows => {
            if which::which("pwsh").is_ok() {
                "pwsh".to_string()
            } else {
                "powershell".to_string()
            }
        }
        Platform::Macos | Platform::Linux => {
            if which::which("bash").is_ok() {
                "bash".to_string()
            } else {
                "sh".to_string()
            }
        }
    }
}

/// Builds a canonical `command_id` for a command inside an item's script group.
pub fn make_command_id(item_id: &str, group_key: &str, index: usize) -> String {
    format!("{item_id}::{group_key}::{index}")
}

/// Expands `@script/` and standalone `@script` tokens into `./scripts/` (or `.\scripts\` for `cmd`).
///
/// Uses token-boundary checks so identifiers such as `@scripted/foo` or `@scope/pkg` remain intact.
pub fn resolve_script_tokens(raw: &str, shell: &str) -> String {
    let is_cmd = matches!(
        shell.trim().to_ascii_lowercase().as_str(),
        "cmd" | "cmd.exe"
    );
    let prefix_slash = if is_cmd { ".\\scripts\\" } else { "./scripts/" };
    let bare_scripts = if is_cmd { ".\\scripts" } else { "./scripts" };

    let mut out = String::with_capacity(raw.len() + 8);
    let bytes = raw.as_bytes();
    let token = b"@script";
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i..].starts_with(token) && is_valid_prefix_boundary(bytes, i) {
            let after = i + token.len();
            if after < bytes.len() && (bytes[after] == b'/' || bytes[after] == b'\\') {
                out.push_str(prefix_slash);
                i = after + 1;
                continue;
            }
            if is_valid_suffix_boundary(bytes, after) {
                out.push_str(bare_scripts);
                i = after;
                continue;
            }
        }

        // Advance one valid UTF-8 char at a time so non-ASCII text is preserved intact.
        let ch = raw[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

fn is_valid_prefix_boundary(bytes: &[u8], idx: usize) -> bool {
    if idx == 0 {
        return true;
    }
    matches!(bytes[idx - 1], b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'' | b'=' | b'(')
}

fn is_valid_suffix_boundary(bytes: &[u8], after: usize) -> bool {
    if after >= bytes.len() {
        return true;
    }
    matches!(bytes[after], b' ' | b'\t' | b'\n' | b'\r' | b'"' | b'\'' | b')' | b';' | b'&' | b'|')
}

/// Scans `<workspace>/items/*/` and returns a deterministic snapshot for the host platform.
pub fn load_workspace(root: &Path) -> Result<WorkspaceSnapshot, SettledError> {
    if !root.is_dir() {
        return Err(SettledError::InvalidWorkspace(
            root.to_string_lossy().into_owned(),
        ));
    }

    let host_platform = Platform::current();
    let default_shell = detect_default_shell();
    let items_dir = root.join("items");
    let items_dir_exists = items_dir.is_dir();

    let mut items = Vec::new();
    let mut scan_warnings = Vec::new();
    let mut tag_set = BTreeSet::new();

    if items_dir_exists {
        let mut dir_entries: Vec<PathBuf> = fs::read_dir(&items_dir)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_dir() && !is_hidden_dir(path))
            .collect();
        dir_entries.sort();

        for item_dir in dir_entries {
            let meta_path = item_dir.join("meta.json");
            let id = item_dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();

            if !meta_path.is_file() {
                scan_warnings.push(format!("Skipped '{id}': missing meta.json"));
                continue;
            }

            let item = load_single_item(&item_dir, &id, host_platform, &default_shell);
            for tag in &item.tags {
                tag_set.insert(tag.clone());
            }
            items.push(item);
        }
    }

    Ok(WorkspaceSnapshot {
        root_path: root.to_string_lossy().into_owned(),
        items_dir: items_dir.to_string_lossy().into_owned(),
        items_dir_exists,
        host_platform,
        default_shell,
        items,
        all_tags: tag_set.into_iter().collect(),
        scan_warnings,
    })
}

fn is_hidden_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn find_readme_path(item_dir: &Path) -> Option<PathBuf> {
    let lower = item_dir.join("readme.md");
    if lower.is_file() {
        return Some(lower);
    }
    let upper = item_dir.join("README.md");
    if upper.is_file() {
        return Some(upper);
    }
    None
}

fn load_single_item(
    item_dir: &Path,
    id: &str,
    host_platform: Platform,
    default_shell: &str,
) -> WorkspaceItem {
    let meta_path = item_dir.join("meta.json");
    let readme_path = find_readme_path(item_dir);
    let readme = readme_path
        .as_ref()
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default();

    let raw_meta = match fs::read_to_string(&meta_path) {
        Ok(content) => content,
        Err(err) => {
            return malformed_item(
                id,
                item_dir,
                &meta_path,
                readme_path.as_ref(),
                readme,
                String::new(),
                format!("Failed to read meta.json: {err}"),
            );
        }
    };

    let parsed: ItemMetaRaw = match serde_json::from_str(&raw_meta) {
        Ok(meta) => meta,
        Err(err) => {
            return malformed_item(
                id,
                item_dir,
                &meta_path,
                readme_path.as_ref(),
                readme,
                raw_meta,
                format!("Invalid meta.json: {err}"),
            );
        }
    };

    let item_applicable =
        parsed.platforms.is_empty() || parsed.platforms.contains(&host_platform);
    let script_groups =
        build_script_groups(id, parsed.scripts, item_applicable, host_platform, default_shell);

    WorkspaceItem {
        id: id.to_string(),
        path: item_dir.to_string_lossy().into_owned(),
        meta_path: meta_path.to_string_lossy().into_owned(),
        readme_path: readme_path.map(|p| p.to_string_lossy().into_owned()),
        readme,
        raw_meta,
        name: parsed.name,
        description: parsed.description,
        create_at: parsed.create_at,
        tags: parsed.tags,
        platforms: parsed.platforms,
        applicable: item_applicable,
        script_groups,
        parse_error: None,
    }
}

fn malformed_item(
    id: &str,
    item_dir: &Path,
    meta_path: &Path,
    readme_path: Option<&PathBuf>,
    readme: String,
    raw_meta: String,
    error: String,
) -> WorkspaceItem {
    WorkspaceItem {
        id: id.to_string(),
        path: item_dir.to_string_lossy().into_owned(),
        meta_path: meta_path.to_string_lossy().into_owned(),
        readme_path: readme_path.map(|p| p.to_string_lossy().into_owned()),
        readme,
        raw_meta,
        name: id.to_string(),
        description: String::new(),
        create_at: None,
        tags: Vec::new(),
        platforms: Vec::new(),
        applicable: true,
        script_groups: Vec::new(),
        parse_error: Some(error),
    }
}

fn build_script_groups(
    item_id: &str,
    mut raw_scripts: std::collections::BTreeMap<String, crate::model::ScriptInput>,
    item_applicable: bool,
    host_platform: Platform,
    default_shell: &str,
) -> Vec<ScriptGroup> {
    let mut ordered_keys: Vec<String> = Vec::new();
    for priority_key in ["check", "fix"] {
        if raw_scripts.contains_key(priority_key) {
            ordered_keys.push(priority_key.to_string());
        }
    }
    for key in raw_scripts.keys() {
        if key != "check" && key != "fix" {
            ordered_keys.push(key.clone());
        }
    }

    let mut groups = Vec::with_capacity(ordered_keys.len());
    for key in ordered_keys {
        if let Some(spec) = raw_scripts.remove(&key) {
            let role = ScriptRole::from_key(&key);
            let raw_cmds = spec.into_commands();
            let mut commands = Vec::with_capacity(raw_cmds.len());

            for (index, input) in raw_cmds.into_iter().enumerate() {
                commands.push(resolve_command(
                    item_id,
                    &key,
                    index,
                    input,
                    item_applicable,
                    host_platform,
                    default_shell,
                ));
            }

            groups.push(ScriptGroup {
                key,
                role,
                commands,
            });
        }
    }
    groups
}

fn resolve_command(
    item_id: &str,
    key: &str,
    index: usize,
    input: CommandInput,
    item_applicable: bool,
    host_platform: Platform,
    default_shell: &str,
) -> ResolvedCommand {
    let (name, description, raw_run, platforms, shell, encoding) = match input {
        CommandInput::Shorthand(run) => (run.clone(), None, run, Vec::new(), None, None),
        CommandInput::Step(step) => {
            let label = step
                .name
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| step.run.clone());
            (
                label,
                step.description.filter(|s| !s.trim().is_empty()),
                step.run,
                step.platforms.unwrap_or_default(),
                step.shell.filter(|s| !s.trim().is_empty()),
                step.encoding.filter(|s| !s.trim().is_empty()),
            )
        }
    };

    let effective_shell = shell.clone().unwrap_or_else(|| default_shell.to_string());
    let resolved_run = resolve_script_tokens(&raw_run, &effective_shell);
    let step_applicable = platforms.is_empty() || platforms.contains(&host_platform);

    ResolvedCommand {
        index,
        key: key.to_string(),
        command_id: make_command_id(item_id, key, index),
        name,
        description,
        raw_run,
        resolved_run,
        platforms,
        applicable: item_applicable && step_applicable,
        shell,
        effective_shell,
        encoding: encoding.unwrap_or_else(|| "utf-8".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn resolves_script_tokens_without_touching_unrelated_at_identifiers() {
        assert_eq!(
            resolve_script_tokens("node @script/check.mjs --flag", "pwsh"),
            "node ./scripts/check.mjs --flag"
        );
        assert_eq!(
            resolve_script_tokens("node \"@script/my script.mjs\"", "bash"),
            "node \"./scripts/my script.mjs\""
        );
        assert_eq!(
            resolve_script_tokens("call @script/win.bat && type @script", "cmd"),
            "call .\\scripts\\win.bat && type .\\scripts"
        );
        assert_eq!(
            resolve_script_tokens("npx @scope/pkg @scripted/other @script/ok.sh", "bash"),
            "npx @scope/pkg @scripted/other ./scripts/ok.sh"
        );
    }

    #[test]
    fn loads_workspace_items_with_mixed_script_shapes_and_graceful_errors() {
        let tmp = TempDir::new().unwrap();
        let items = tmp.path().join("items");
        fs::create_dir_all(items.join(".hidden")).unwrap();
        fs::create_dir_all(items.join("no-meta")).unwrap();

        let git_dir = items.join("git-core");
        fs::create_dir_all(git_dir.join("scripts")).unwrap();
        fs::write(
            git_dir.join("meta.json"),
            r#"{
                "name": "Git Core",
                "description": "Verify git basics",
                "createAt": 1794596400,
                "tags": ["git", "init"],
                "scripts": {
                    "sync": { "run": "echo sync" },
                    "fix": "echo fix",
                    "check": [
                        "git --version",
                        {
                            "name": "Check custom script",
                            "description": "Runs bundled script",
                            "run": "node @script/check.mjs",
                            "platforms": ["windows", "macos", "linux"],
                            "shell": "bash",
                            "encoding": "utf-8"
                        }
                    ]
                }
            }"#,
        )
        .unwrap();
        fs::write(git_dir.join("readme.md"), "# Git Core\nDetails here.").unwrap();

        let broken_dir = items.join("broken-item");
        fs::create_dir_all(&broken_dir).unwrap();
        fs::write(broken_dir.join("meta.json"), "{ not json").unwrap();

        let snapshot = load_workspace(tmp.path()).unwrap();
        assert!(snapshot.items_dir_exists);
        assert_eq!(snapshot.items.len(), 2);
        assert_eq!(snapshot.scan_warnings.len(), 1);
        assert_eq!(snapshot.all_tags, vec!["git", "init"]);

        let broken = &snapshot.items[0];
        assert_eq!(broken.id, "broken-item");
        assert!(broken.parse_error.is_some());

        let git = &snapshot.items[1];
        assert_eq!(git.id, "git-core");
        assert!(git.parse_error.is_none());
        assert_eq!(git.create_at, Some(1794596400));
        assert_eq!(git.readme, "# Git Core\nDetails here.");
        assert_eq!(git.script_groups.len(), 3);
        assert_eq!(git.script_groups[0].key, "check");
        assert_eq!(git.script_groups[1].key, "fix");
        assert_eq!(git.script_groups[2].key, "sync");

        let check_cmds = &git.script_groups[0].commands;
        assert_eq!(check_cmds.len(), 2);
        assert_eq!(check_cmds[0].name, "git --version");
        assert_eq!(check_cmds[1].name, "Check custom script");
        assert_eq!(check_cmds[1].description.as_deref(), Some("Runs bundled script"));
        assert_eq!(check_cmds[1].resolved_run, "node ./scripts/check.mjs");
        assert_eq!(check_cmds[1].effective_shell, "bash");
    }

    #[test]
    fn filters_platform_applicability_cleanly() {
        let tmp = TempDir::new().unwrap();
        let item_dir = tmp.path().join("items").join("other-os");
        fs::create_dir_all(&item_dir).unwrap();
        let non_host = match Platform::current() {
            Platform::Windows => "macos",
            Platform::Macos => "windows",
            Platform::Linux => "windows",
        };
        fs::write(
            item_dir.join("meta.json"),
            format!(
                r#"{{
                    "name": "Other OS",
                    "description": "Not for host",
                    "createAt": 1794596400,
                    "platforms": ["{non_host}"],
                    "scripts": {{ "check": "echo hi" }}
                }}"#
            ),
        )
        .unwrap();

        let snapshot = load_workspace(tmp.path()).unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert!(!snapshot.items[0].applicable);
        assert!(!snapshot.items[0].script_groups[0].commands[0].applicable);
    }

    #[test]
    fn parses_create_at_unix_seconds_millis_and_legacy_iso_strings() {
        let sec: ItemMetaRaw =
            serde_json::from_str(r#"{"name":"A","createAt":1794596400}"#).unwrap();
        assert_eq!(sec.create_at, Some(1794596400));

        let ms: ItemMetaRaw =
            serde_json::from_str(r#"{"name":"B","createAt":1794596400000}"#).unwrap();
        assert_eq!(ms.create_at, Some(1794596400));

        let iso: ItemMetaRaw = serde_json::from_str(
            r#"{"name":"C","createAt":"2026-11-14T03:00:00+08:00"}"#,
        )
        .unwrap();
        assert_eq!(iso.create_at, Some(1794596400));

        let omitted: ItemMetaRaw = serde_json::from_str(r#"{"name":"D"}"#).unwrap();
        assert_eq!(omitted.create_at, None);

        let invalid = serde_json::from_str::<ItemMetaRaw>(
            r#"{"name":"E","createAt":"not-a-timestamp"}"#,
        );
        assert!(invalid.is_err());
    }
}
