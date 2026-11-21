use crate::lint::{DiagnosticLevel, WorkspaceLintReport};
use anstream::{eprintln, println};
use anstyle::{AnsiColor, Color, Style};
use serde::Serialize;
use serde_json::{json, Map, Value};
use settled_core::{CommandResult, Platform, RunStatus, WorkspaceItem, WorkspaceSnapshot};
use std::collections::HashMap;

const MAX_FAILURE_TAIL_LINES: usize = 120;

const ERROR_STYLE: Style = Style::new()
    .bold()
    .fg_color(Some(Color::Ansi(AnsiColor::Red)));
const WARN_STYLE: Style = Style::new()
    .bold()
    .fg_color(Some(Color::Ansi(AnsiColor::Yellow)));
const PASS_STYLE: Style = Style::new()
    .bold()
    .fg_color(Some(Color::Ansi(AnsiColor::Green)));
const HEADER_STYLE: Style = Style::new()
    .bold()
    .fg_color(Some(Color::Ansi(AnsiColor::Cyan)));
const BOLD_STYLE: Style = Style::new().bold();
const DIM_STYLE: Style = Style::new().dimmed();

pub fn print_cli_error(msg: &str) {
    eprintln!("{ERROR_STYLE}error:{ERROR_STYLE:#} {msg}");
}

pub fn print_cli_warning(msg: &str) {
    eprintln!("{WARN_STYLE}warning:{WARN_STYLE:#} {msg}");
}

pub fn print_workspace_use(path: &str, initialized: bool) {
    let label = if initialized {
        "Initialized and using workspace:"
    } else {
        "Using workspace:"
    };
    println!("{PASS_STYLE}{label}{PASS_STYLE:#} {path}");
}

pub fn print_workspace_remove(path: &str, was_current: bool) {
    let label = if was_current {
        "Removed active workspace:"
    } else {
        "Removed workspace:"
    };
    println!("{PASS_STYLE}{label}{PASS_STYLE:#} {path}");
}

pub fn print_workspace_list_empty() {
    println!(
        "{DIM_STYLE}(no workspaces registered; run 'settled workspace use <path>' to add one){DIM_STYLE:#}"
    );
}

pub fn print_workspace_list_entry(path: &str, is_current: bool, exists: bool) {
    let missing_badge = if exists {
        String::new()
    } else {
        format!(" {WARN_STYLE}[missing]{WARN_STYLE:#}")
    };
    if is_current {
        println!("{PASS_STYLE}* {path}{PASS_STYLE:#}{missing_badge}");
    } else {
        println!("  {path}{missing_badge}");
    }
}

pub fn print_created_item(item_id: &str, item_dir: &str, meta_path: &str, readme_path: &str) {
    println!("{PASS_STYLE}Created item '{item_id}'{PASS_STYLE:#}");
    println!("  {DIM_STYLE}dir:{DIM_STYLE:#}  {item_dir}");
    println!("  {DIM_STYLE}meta:{DIM_STYLE:#} {meta_path}");
    println!("  {DIM_STYLE}doc:{DIM_STYLE:#}  {readme_path}");
}

pub fn print_no_checks_found() {
    println!("{DIM_STYLE}No applicable check commands found.{DIM_STYLE:#}");
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPayload {
    workspace: String,
    host_platform: Platform,
    items: Vec<Value>,
}

/// Prints the workspace items as plain structured JSON: each item carries `id`, `path`, `applicable`, and its `meta.json` fields.
pub fn print_list_report(snapshot: &WorkspaceSnapshot, all_platforms: bool) {
    let items: Vec<Value> = snapshot
        .items
        .iter()
        .filter(|item| all_platforms || item.applicable)
        .map(item_to_list_value)
        .collect();

    let payload = ListPayload {
        workspace: snapshot.root_path.clone(),
        host_platform: snapshot.host_platform,
        items,
    };

    std::println!(
        "{}",
        serde_json::to_string_pretty(&payload).unwrap_or_default()
    );
}

fn item_to_list_value(item: &WorkspaceItem) -> Value {
    let mut out = Map::new();
    out.insert("id".to_string(), json!(item.id));
    out.insert("path".to_string(), json!(item.path));
    out.insert("applicable".to_string(), json!(item.applicable));

    if let Ok(Value::Object(raw_obj)) = serde_json::from_str::<Value>(&item.raw_meta) {
        for (k, v) in raw_obj {
            if !matches!(k.as_str(), "id" | "path" | "applicable") {
                out.insert(k, v);
            }
        }
    } else {
        out.insert("name".to_string(), json!(item.name));
    }

    Value::Object(out)
}

/// Prints workspace lint diagnostics grouped by item using `[ERROR]` / `[WARN]` tags.
pub fn print_lint_report(report: &WorkspaceLintReport) {
    for item in &report.results {
        println!("{BOLD_STYLE}{}{BOLD_STYLE:#}", item.item_id);
        for d in &item.diagnostics {
            match d.level {
                DiagnosticLevel::Error => {
                    println!("  {ERROR_STYLE}[ERROR]{ERROR_STYLE:#} {}", d.message);
                }
                DiagnosticLevel::Warning => {
                    println!("  {WARN_STYLE}[WARN]{WARN_STYLE:#} {}", d.message);
                }
            }
        }
    }

    if !report.results.is_empty() {
        println!();
    }

    let err_style = if report.error_count > 0 {
        ERROR_STYLE
    } else {
        PASS_STYLE
    };
    let warn_style = if report.warning_count > 0 {
        WARN_STYLE
    } else {
        DIM_STYLE
    };
    println!(
        "Linted {} item(s): {err_style}{} error(s){err_style:#}, {warn_style}{} warning(s){warn_style:#}",
        report.items_checked, report.error_count, report.warning_count
    );
}

/// Renders command execution results grouped cleanly by item.
///
/// - When `always_show_pass_output` is `false` (default for `check`/`verify`): passing commands collapse to one concise line per item unless `verbose` is `true`.
/// - Failures and cancellations always expand item `dir`, resolved `cmd`, exit code, and unescaped output.
/// - When `always_show_pass_output` is `true` (`run`), passing command output is also printed.
pub fn print_execution_report(
    heading: Option<&str>,
    results: &[CommandResult],
    snapshot: &WorkspaceSnapshot,
    verbose: bool,
    always_show_pass_output: bool,
    print_summary: bool,
) {
    if let Some(title) = heading {
        println!("{HEADER_STYLE}== {title} =={HEADER_STYLE:#}");
    }

    let path_by_id: HashMap<&str, &str> = snapshot
        .items
        .iter()
        .map(|i| (i.id.as_str(), i.path.as_str()))
        .collect();

    let mut groups: Vec<(&str, Vec<&CommandResult>)> = Vec::new();
    for res in results {
        if let Some((_, list)) = groups.iter_mut().find(|(id, _)| *id == res.item_id) {
            list.push(res);
        } else {
            groups.push((res.item_id.as_str(), vec![res]));
        }
    }

    for (item_id, item_results) in groups {
        let item_dir = path_by_id.get(item_id).copied().unwrap_or("");
        let any_non_pass = item_results.iter().any(|r| r.status != RunStatus::Pass);

        if !any_non_pass && !verbose && !always_show_pass_output {
            if item_results.len() == 1 {
                let r = item_results[0];
                println!(
                    "{PASS_STYLE}PASS{PASS_STYLE:#}  {BOLD_STYLE}{}{BOLD_STYLE:#} :: {} {DIM_STYLE}(step {}, {}ms){DIM_STYLE:#}",
                    item_id, r.command_name, r.command_index, r.duration_ms
                );
            } else {
                let max_ms = item_results.iter().map(|r| r.duration_ms).max().unwrap_or(0);
                println!(
                    "{PASS_STYLE}PASS{PASS_STYLE:#}  {BOLD_STYLE}{}{BOLD_STYLE:#} {DIM_STYLE}({}/{} passed, {}ms){DIM_STYLE:#}",
                    item_id,
                    item_results.len(),
                    item_results.len(),
                    max_ms
                );
            }
            continue;
        }

        let passing: Vec<&&CommandResult> = item_results
            .iter()
            .filter(|r| r.status == RunStatus::Pass)
            .collect();
        let non_passing: Vec<&&CommandResult> = item_results
            .iter()
            .filter(|r| r.status != RunStatus::Pass)
            .collect();

        if !passing.is_empty() && !verbose && !always_show_pass_output {
            println!(
                "{PASS_STYLE}PASS{PASS_STYLE:#}  {BOLD_STYLE}{}{BOLD_STYLE:#} {DIM_STYLE}({}/{} passed){DIM_STYLE:#}",
                item_id,
                passing.len(),
                item_results.len()
            );
        } else {
            for r in passing {
                print_detailed_command(r, item_dir, verbose || always_show_pass_output, verbose);
            }
        }

        for r in non_passing {
            print_detailed_command(r, item_dir, true, verbose);
        }
    }

    if print_summary {
        let passed = results.iter().filter(|r| r.status == RunStatus::Pass).count();
        let failed = results.iter().filter(|r| r.status == RunStatus::Fail).count();
        let canceled = results
            .iter()
            .filter(|r| r.status == RunStatus::Canceled)
            .count();

        let pass_part = if passed > 0 {
            format!("{PASS_STYLE}{passed} passed{PASS_STYLE:#}")
        } else {
            format!("{DIM_STYLE}{passed} passed{DIM_STYLE:#}")
        };
        let fail_part = if failed > 0 {
            format!("{ERROR_STYLE}{failed} failed{ERROR_STYLE:#}")
        } else {
            format!("{DIM_STYLE}{failed} failed{DIM_STYLE:#}")
        };
        let cancel_part = if canceled > 0 {
            format!("{WARN_STYLE}{canceled} canceled{WARN_STYLE:#}")
        } else {
            format!("{DIM_STYLE}{canceled} canceled{DIM_STYLE:#}")
        };
        println!("\n{BOLD_STYLE}Summary:{BOLD_STYLE:#} {pass_part}, {fail_part}, {cancel_part}");
    }
}

fn print_detailed_command(
    res: &CommandResult,
    item_dir: &str,
    show_logs: bool,
    full_logs: bool,
) {
    let (badge, badge_style) = match res.status {
        RunStatus::Pass => ("PASS", PASS_STYLE),
        RunStatus::Fail => ("FAIL", ERROR_STYLE),
        RunStatus::Canceled => ("CANC", WARN_STYLE),
        RunStatus::Running => ("RUN ", HEADER_STYLE),
        RunStatus::Idle => ("IDLE", DIM_STYLE),
    };
    let code = res
        .exit_code
        .map(|c| c.to_string())
        .unwrap_or_else(|| "-".to_string());

    println!(
        "{badge_style}{badge}{badge_style:#}  {BOLD_STYLE}{}{BOLD_STYLE:#} :: {} {DIM_STYLE}(step {}, exit={code}, {}ms){DIM_STYLE:#}",
        res.item_id, res.command_name, res.command_index, res.duration_ms
    );

    if res.status != RunStatus::Pass || full_logs {
        if !item_dir.is_empty() {
            println!("  {DIM_STYLE}dir:{DIM_STYLE:#} {item_dir}");
        }
        println!("  {DIM_STYLE}cmd:{DIM_STYLE:#} {}", res.resolved_run);
    }

    if let Some(err) = &res.error {
        println!("  {ERROR_STYLE}err:{ERROR_STYLE:#} {err}");
    }

    if show_logs && !res.logs.is_empty() {
        let total = res.logs.len();
        let start = if !full_logs && total > MAX_FAILURE_TAIL_LINES {
            total - MAX_FAILURE_TAIL_LINES
        } else {
            0
        };
        println!("  {DIM_STYLE}--- output ---{DIM_STYLE:#}");
        if start > 0 {
            println!(
                "  {DIM_STYLE}... ({start} earlier line(s) omitted; pass -v to view full output){DIM_STYLE:#}"
            );
        }
        for line in &res.logs[start..] {
            println!("  {}", line.text);
        }
    }
}
