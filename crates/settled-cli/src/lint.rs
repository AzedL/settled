use serde_json::Value;
use settled_core::{
    extract_script_references, find_readme_path, CommandInput, ItemMetaRaw, Platform,
    ITEMS_DIR_NAME,
};
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
        if item_id.is_empty()
            || item_id == "."
            || item_id == ".."
            || item_id.contains(['/', '\\'])
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

fn lint_parsed_meta(parsed: &ItemMetaRaw, item_dir: &Path, diags: &mut Vec<LintDiagnostic>) {
    if parsed.name.trim().is_empty() {
        diags.push(warn("meta.json 'name' is empty"));
    }

    for (group_key, spec) in &parsed.scripts {
        let cmds = spec.clone().into_commands();
        for (idx, cmd) in cmds.into_iter().enumerate() {
            let (raw_run, step_platforms): (String, Vec<Platform>) = match cmd {
                CommandInput::Shorthand(run) => (run, Vec::new()),
                CommandInput::Step(step) => (step.run, step.platforms.unwrap_or_default()),
            };

            if raw_run.trim().is_empty() {
                diags.push(warn(format!("scripts.{group_key}[{idx}] has an empty 'run'")));
            }

            if !parsed.platforms.is_empty()
                && !step_platforms.is_empty()
                && !step_platforms
                    .iter()
                    .any(|p| parsed.platforms.contains(p))
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
