use crate::lint::{DiagnosticLevel, WorkspaceLintReport};
use serde::Serialize;
use serde_json::{json, Map, Value};
use settled_core::{CommandResult, Platform, RunStatus, WorkspaceItem, WorkspaceSnapshot};
use std::collections::HashMap;

const MAX_FAILURE_TAIL_LINES: usize = 120;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListPayload {
    workspace: String,
    host_platform: Platform,
    items: Vec<Value>,
}

/// Prints the workspace items as structured JSON: each item carries `id`, `path`, `applicable`, and its `meta.json` fields.
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

    println!(
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

/// Prints workspace lint diagnostics grouped by item and returns whether errors occurred.
pub fn print_lint_report(report: &WorkspaceLintReport) {
    for item in &report.results {
        println!("{}", item.item_id);
        for d in &item.diagnostics {
            let tag = match d.level {
                DiagnosticLevel::Error => "ERROR",
                DiagnosticLevel::Warning => "WARN ",
            };
            println!("  [{tag}] {}", d.message);
        }
    }

    if !report.results.is_empty() {
        println!();
    }
    println!(
        "Linted {} item(s): {} error(s), {} warning(s)",
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
        println!("== {title} ==");
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
                    "PASS  {} :: {} (step {}, {}ms)",
                    item_id, r.command_name, r.command_index, r.duration_ms
                );
            } else {
                let max_ms = item_results.iter().map(|r| r.duration_ms).max().unwrap_or(0);
                println!(
                    "PASS  {} ({}/{} passed, {}ms)",
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
                "PASS  {} ({}/{} passed)",
                item_id,
                passing.len(),
                item_results.len()
            );
        } else {
            for r in passing {
                print_detailed_command(r, item_dir, verbose || always_show_pass_output, true);
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
        println!("\nSummary: {passed} passed, {failed} failed, {canceled} canceled");
    }
}

fn print_detailed_command(
    res: &CommandResult,
    item_dir: &str,
    show_logs: bool,
    full_logs: bool,
) {
    let badge = match res.status {
        RunStatus::Pass => "PASS",
        RunStatus::Fail => "FAIL",
        RunStatus::Canceled => "CANC",
        RunStatus::Running => "RUN ",
        RunStatus::Idle => "IDLE",
    };
    let code = res
        .exit_code
        .map(|c| c.to_string())
        .unwrap_or_else(|| "-".to_string());

    println!(
        "{badge}  {} :: {} (step {}, exit={code}, {}ms)",
        res.item_id, res.command_name, res.command_index, res.duration_ms
    );

    if res.status != RunStatus::Pass || full_logs {
        if !item_dir.is_empty() {
            println!("  dir: {item_dir}");
        }
        println!("  cmd: {}", res.resolved_run);
    }

    if let Some(err) = &res.error {
        println!("  err: {err}");
    }

    if show_logs && !res.logs.is_empty() {
        let total = res.logs.len();
        let start = if !full_logs && total > MAX_FAILURE_TAIL_LINES {
            total - MAX_FAILURE_TAIL_LINES
        } else {
            0
        };
        println!("  --- output ---");
        if start > 0 {
            println!("  ... ({start} earlier line(s) omitted; pass -v to view full output)");
        }
        for line in &res.logs[start..] {
            println!("  {}", line.text);
        }
    }
}
