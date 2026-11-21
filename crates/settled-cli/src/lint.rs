use serde_json::Value;
use settled_core::{
    CommandInput, ITEMS_DIR_NAME, ItemMetaRaw, Platform, ScriptInput, extract_script_references,
    find_readme_path, resolve_script_tokens,
    runner::{is_valid_encoding_label, resolve_encoding},
};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const ALLOWED_META_KEYS: &[&str] = &[
    "name",
    "description",
    "createAt",
    "tags",
    "platforms",
    "scripts",
];

const ALLOWED_STEP_KEYS: &[&str] = &[
    "name",
    "description",
    "run",
    "platforms",
    "shell",
    "encoding",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticLevel {
    Error,
    Warning,
}

#[derive(Debug, Clone)]
pub struct LintDiagnostic {
    pub level: DiagnosticLevel,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ItemLintResult {
    pub item_id: String,
    pub diagnostics: Vec<LintDiagnostic>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceLintReport {
    pub items_checked: usize,
    pub results: Vec<ItemLintResult>,
    pub error_count: usize,
    pub warning_count: usize,
}

/// Validates either a single `<item>` or every item directory inside `<workspace>/settled-items/`.
pub fn lint_workspace(
    workspace_root: &Path,
    single_item: Option<&str>,
) -> Result<WorkspaceLintReport, String> {
    let items_dir = workspace_root.join(ITEMS_DIR_NAME);
    if !items_dir.is_dir() {
        return Err(format!(
            "No '{ITEMS_DIR_NAME}/' directory found under {}",
            workspace_root.display()
        ));
    }

    let targets: Vec<(String, PathBuf)> = if let Some(item_id) = single_item {
        if item_id.is_empty() || item_id == "." || item_id == ".." || item_id.contains(['/', '\\'])
        {
            return Err(format!("Invalid item ID '{item_id}'"));
        }
        let item_dir = items_dir.join(item_id);
        if !item_dir.is_dir() {
            return Err(format!(
                "Item directory '{item_id}' was not found under {}",
                items_dir.display()
            ));
        }
        vec![(item_id.to_string(), item_dir)]
    } else {
        let mut dirs: Vec<(String, PathBuf)> = fs::read_dir(&items_dir)
            .map_err(|e| format!("Failed to read '{}': {e}", items_dir.display()))?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.is_dir()
                    && !p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|name| name.starts_with('.'))
            })
            .filter_map(|p| {
                let name = p.file_name()?.to_string_lossy().into_owned();
                Some((name, p))
            })
            .collect();
        dirs.sort_by(|a, b| a.0.cmp(&b.0));
        dirs
    };

    let items_checked = targets.len();
    let mut results = Vec::with_capacity(items_checked);
    let mut error_count = 0;
    let mut warning_count = 0;

    for (item_id, item_dir) in targets {
        let diagnostics = lint_single_item(&item_dir);
        for d in &diagnostics {
            match d.level {
                DiagnosticLevel::Error => error_count += 1,
                DiagnosticLevel::Warning => warning_count += 1,
            }
        }
        if !diagnostics.is_empty() {
            results.push(ItemLintResult {
                item_id,
                diagnostics,
            });
        }
    }

    Ok(WorkspaceLintReport {
        items_checked,
        results,
        error_count,
        warning_count,
    })
}

fn lint_single_item(item_dir: &Path) -> Vec<LintDiagnostic> {
    let mut diags = Vec::new();
    let meta_path = item_dir.join("meta.json");

    if !meta_path.is_file() {
        diags.push(err("meta.json is missing (item will be ignored)"));
    } else {
        match fs::read_to_string(&meta_path) {
            Err(e) => {
                diags.push(err(format!(
                    "failed to read meta.json: {e} (item will be ignored)"
                )));
            }
            Ok(raw_meta) => {
                if let Ok(Value::Object(root_obj)) = serde_json::from_str::<Value>(&raw_meta) {
                    collect_unknown_field_warnings(&root_obj, &mut diags);
                }
                match serde_json::from_str::<ItemMetaRaw>(&raw_meta) {
                    Err(e) => {
                        diags.push(err(format!(
                            "invalid meta.json: {e} (item will be ignored)"
                        )));
                    }
                    Ok(parsed) => {
                        lint_parsed_meta(&parsed, item_dir, &mut diags);
                    }
                }
            }
        }
    }

    match find_readme_path(item_dir) {
        None => diags.push(warn("README.md does not exist")),
        Some(readme_path) => match fs::read_to_string(&readme_path) {
            Err(e) => diags.push(warn(format!("failed to read README.md: {e}"))),
            Ok(content) if content.trim().is_empty() => diags.push(warn("README.md is empty")),
            Ok(_) => {}
        },
    }

    diags
}

fn collect_unknown_field_warnings(
    root_obj: &serde_json::Map<String, Value>,
    diags: &mut Vec<LintDiagnostic>,
) {
    for key in root_obj.keys() {
        if !ALLOWED_META_KEYS.contains(&key.as_str()) {
            diags.push(warn(format!("unexpected field '{key}' in meta.json")));
        }
    }

    let Some(Value::Object(scripts_obj)) = root_obj.get("scripts") else {
        return;
    };

    for (group_key, group_val) in scripts_obj {
        match group_val {
            Value::Object(step_obj) => {
                check_step_unknown_keys(group_key, 0, step_obj, diags);
            }
            Value::Array(items) => {
                for (idx, elem) in items.iter().enumerate() {
                    if let Value::Object(step_obj) = elem {
                        check_step_unknown_keys(group_key, idx, step_obj, diags);
                    }
                }
            }
            _ => {}
        }
    }
}

fn check_step_unknown_keys(
    group_key: &str,
    idx: usize,
    step_obj: &serde_json::Map<String, Value>,
    diags: &mut Vec<LintDiagnostic>,
) {
    for key in step_obj.keys() {
        if !ALLOWED_STEP_KEYS.contains(&key.as_str()) {
            diags.push(warn(format!(
                "unexpected field '{key}' in scripts.{group_key}[{idx}]"
            )));
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandSignature {
    resolved_run: String,
    shell: Option<String>,
    encoding: &'static str,
}

struct SeenCommand<'a> {
    group_key: &'a str,
    index: usize,
    effective_platforms: BTreeSet<Platform>,
    signature: CommandSignature,
}

fn ordered_script_groups(parsed: &ItemMetaRaw) -> Vec<(&str, &ScriptInput)> {
    let mut ordered = Vec::with_capacity(parsed.scripts.len());
    for priority_key in ["check", "fix"] {
        if let Some((key, spec)) = parsed.scripts.get_key_value(priority_key) {
            ordered.push((key.as_str(), spec));
        }
    }
    for (key, spec) in &parsed.scripts {
        if key != "check" && key != "fix" {
            ordered.push((key.as_str(), spec));
        }
    }
    ordered
}

fn normalize_shell(shell: Option<&str>) -> Option<String> {
    shell.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        let lower = trimmed.to_ascii_lowercase();
        let stripped = lower.strip_suffix(".exe").unwrap_or(&lower);
        Some(stripped.to_string())
    })
}

fn normalize_run(raw_run: &str, shell: Option<&str>) -> String {
    let normalized = raw_run.trim().replace("\r\n", "\n");
    resolve_script_tokens(&normalized, shell.unwrap_or(""))
}

fn resolve_effective_platforms(
    item_platforms: &[Platform],
    step_platforms: &[Platform],
) -> BTreeSet<Platform> {
    const ALL_PLATFORMS: [Platform; 3] = [Platform::Windows, Platform::Macos, Platform::Linux];
    let item_set: BTreeSet<Platform> = if item_platforms.is_empty() {
        ALL_PLATFORMS.into_iter().collect()
    } else {
        item_platforms.iter().copied().collect()
    };
    if step_platforms.is_empty() {
        item_set
    } else {
        step_platforms
            .iter()
            .copied()
            .filter(|platform| item_set.contains(platform))
            .collect()
    }
}

fn has_platform_overlap(a: &BTreeSet<Platform>, b: &BTreeSet<Platform>) -> bool {
    a.iter().any(|platform| b.contains(platform))
}

fn extract_command_fields(
    cmd: CommandInput,
) -> (String, Vec<Platform>, Option<String>, Option<String>) {
    match cmd {
        CommandInput::Shorthand(run) => (run, Vec::new(), None, None),
        CommandInput::Step(step) => (
            step.run,
            step.platforms.unwrap_or_default(),
            step.shell,
            step.encoding,
        ),
    }
}

fn find_duplicate_command<'a>(
    seen: &'a [SeenCommand<'a>],
    group_key: &str,
    signature: &CommandSignature,
    effective_platforms: &BTreeSet<Platform>,
) -> Option<&'a SeenCommand<'a>> {
    if effective_platforms.is_empty() {
        return None;
    }
    let conflicts = |prev: &&SeenCommand<'a>| {
        prev.signature == *signature
            && has_platform_overlap(&prev.effective_platforms, effective_platforms)
    };
    seen.iter()
        .find(|prev| prev.group_key == group_key && conflicts(prev))
        .or_else(|| seen.iter().find(conflicts))
}

fn lint_parsed_meta(parsed: &ItemMetaRaw, item_dir: &Path, diags: &mut Vec<LintDiagnostic>) {
    if parsed.name.trim().is_empty() {
        diags.push(warn("meta.json 'name' is empty"));
    }

    let mut seen_commands: Vec<SeenCommand<'_>> = Vec::new();

    for (group_key, spec) in ordered_script_groups(parsed) {
        let cmds = spec.clone().into_commands();
        for (idx, cmd) in cmds.into_iter().enumerate() {
            let (raw_run, step_platforms, step_shell, step_encoding) = extract_command_fields(cmd);

            if let Some(raw_enc) = step_encoding.as_deref()
                && !is_valid_encoding_label(raw_enc)
            {
                let trimmed = raw_enc.trim();
                diags.push(warn(format!(
                    "scripts.{group_key}[{idx}] uses unrecognized encoding '{trimmed}' (will fall back to utf-8)"
                )));
            }

            if raw_run.trim().is_empty() {
                diags.push(warn(format!(
                    "scripts.{group_key}[{idx}] has an empty 'run'"
                )));
            } else {
                let norm_shell = normalize_shell(step_shell.as_deref());
                let signature = CommandSignature {
                    resolved_run: normalize_run(&raw_run, norm_shell.as_deref()),
                    shell: norm_shell,
                    encoding: resolve_encoding(step_encoding.as_deref().unwrap_or("utf-8")).name(),
                };
                let eff_platforms = resolve_effective_platforms(&parsed.platforms, &step_platforms);

                if let Some(prev) =
                    find_duplicate_command(&seen_commands, group_key, &signature, &eff_platforms)
                {
                    diags.push(warn(format!(
                        "scripts.{group_key}[{idx}] duplicates command in scripts.{}[{}]",
                        prev.group_key, prev.index
                    )));
                }

                seen_commands.push(SeenCommand {
                    group_key,
                    index: idx,
                    effective_platforms: eff_platforms,
                    signature,
                });
            }

            if !parsed.platforms.is_empty()
                && !step_platforms.is_empty()
                && !step_platforms.iter().any(|p| parsed.platforms.contains(p))
            {
                diags.push(warn(format!(
                    "scripts.{group_key}[{idx}] step platforms never overlap item platforms"
                )));
            }

            for subpath in extract_script_references(&raw_run) {
                let script_path = item_dir.join("scripts").join(&subpath);
                if !script_path.is_file() {
                    diags.push(warn(format!(
                        "scripts.{group_key}[{idx}] references missing script 'scripts/{subpath}'"
                    )));
                }
            }
        }
    }
}

fn err(msg: impl Into<String>) -> LintDiagnostic {
    LintDiagnostic {
        level: DiagnosticLevel::Error,
        message: msg.into(),
    }
}

fn warn(msg: impl Into<String>) -> LintDiagnostic {
    LintDiagnostic {
        level: DiagnosticLevel::Warning,
        message: msg.into(),
    }
}
