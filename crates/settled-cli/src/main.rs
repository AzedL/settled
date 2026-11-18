use clap::{Args, Parser, Subcommand};
use serde::Serialize;
use settled_core::{
    format_item_context, load_workspace, run_commands_parallel, CommandExecutionTarget,
    CommandResult, Platform, RunEvent, RunRegistry, RunStatus, ScriptRole, WorkspaceItem,
    WorkspaceSnapshot, DEFAULT_CONCURRENCY,
};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Debug, Parser)]
#[command(name = "settled", version, about = "Cross-device environment cockpit CLI")]
struct Cli {
    /// Path to a Settled workspace directory (defaults to SETTLED_WORKSPACE or nearest ancestor with items/)
    #[arg(long, short = 'w', global = true, env = "SETTLED_WORKSPACE")]
    workspace: Option<PathBuf>,

    /// Emit machine-readable JSON output
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// List workspace items and their registered script counts
    List(ListArgs),
    /// Run independent `check` commands across items or tags
    Check(CheckArgs),
    /// Run `fix` commands for an item and automatically re-verify with `check`
    Fix(FixArgs),
    /// Run any registered script group (or single step) on an item
    Run(RunArgs),
    /// Print structured Markdown/JSON context for an item (for external AI agents)
    Context(ContextArgs),
}

#[derive(Debug, Args)]
struct ListArgs {
    #[arg(long = "tag", short = 't')]
    tags: Vec<String>,
    #[arg(long)]
    all_platforms: bool,
}

#[derive(Debug, Args)]
struct CheckArgs {
    /// Optional item IDs to check (defaults to all applicable items)
    items: Vec<String>,
    #[arg(long = "tag", short = 't')]
    tags: Vec<String>,
    /// Optional single command index (requires a single item ID)
    #[arg(long)]
    step: Option<usize>,
}

#[derive(Debug, Args)]
struct FixArgs {
    item: String,
    #[arg(long)]
    step: Option<usize>,
    /// Skip automatic post-fix `check` verification
    #[arg(long)]
    no_verify: bool,
}

#[derive(Debug, Args)]
struct RunArgs {
    item: String,
    script_key: String,
    #[arg(long)]
    step: Option<usize>,
}

#[derive(Debug, Args)]
struct ContextArgs {
    item: String,
    /// Execute applicable `check` commands before generating context
    #[arg(long)]
    run_check: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckJsonReport {
    host_platform: Platform,
    passed: usize,
    failed: usize,
    canceled: usize,
    results: Vec<CommandResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FixJsonReport {
    host_platform: Platform,
    fix_results: Vec<CommandResult>,
    verify_results: Vec<CommandResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextJsonReport {
    item_id: String,
    host_platform: Platform,
    markdown: String,
    check_results: Vec<CommandResult>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let workspace_path = match resolve_workspace_path(cli.workspace) {
        Ok(p) => p,
        Err(msg) => {
            eprintln!("error: {msg}");
            return ExitCode::from(2);
        }
    };

    let snapshot = match load_workspace(&workspace_path) {
        Ok(s) => s,
        Err(err) => {
            eprintln!("error: {err}");
            return ExitCode::from(2);
        }
    };

    match cli.command {
        Commands::List(args) => handle_list(&snapshot, &args, cli.json),
        Commands::Check(args) => handle_check(&snapshot, &args, cli.json).await,
        Commands::Fix(args) => handle_fix(&snapshot, &args, cli.json).await,
        Commands::Run(args) => handle_run(&snapshot, &args, cli.json).await,
        Commands::Context(args) => handle_context(&snapshot, &args, cli.json).await,
    }
}

fn resolve_workspace_path(explicit: Option<PathBuf>) -> Result<PathBuf, String> {
    if let Some(p) = explicit {
        return Ok(p);
    }

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {e}"))?;
    let mut cursor: Option<&Path> = Some(cwd.as_path());
    while let Some(dir) = cursor {
        if dir.join("items").is_dir() {
            return Ok(dir.to_path_buf());
        }
        cursor = dir.parent();
    }

    Err("No workspace specified. Pass --workspace <path> or set SETTLED_WORKSPACE.".to_string())
}

fn handle_list(snapshot: &WorkspaceSnapshot, args: &ListArgs, as_json: bool) -> ExitCode {
    let filtered_items: Vec<&WorkspaceItem> = snapshot
        .items
        .iter()
        .filter(|item| args.all_platforms || item.applicable)
        .filter(|item| {
            args.tags.is_empty() || args.tags.iter().any(|t| item.tags.contains(t))
        })
        .collect();

    if as_json {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ListJson<'a> {
            root_path: &'a str,
            host_platform: Platform,
            items: Vec<&'a WorkspaceItem>,
        }
        let payload = ListJson {
            root_path: &snapshot.root_path,
            host_platform: snapshot.host_platform,
            items: filtered_items,
        };
        println!("{}", serde_json::to_string_pretty(&payload).unwrap_or_default());
        return ExitCode::SUCCESS;
    }

    println!(
        "Settled Workspace: {} (host: {})",
        snapshot.root_path, snapshot.host_platform
    );
    if filtered_items.is_empty() {
        println!("No matching items found.");
        return ExitCode::SUCCESS;
    }

    for item in filtered_items {
        let applicable_checks = item
            .script_groups
            .iter()
            .find(|g| g.role == ScriptRole::Check)
            .map(|g| g.commands.iter().filter(|c| c.applicable).count())
            .unwrap_or(0);
        let status_label = if !item.applicable {
            "disabled-os"
        } else if applicable_checks == 0 {
            "manual/no-check"
        } else {
            "checkable"
        };
        let tags = if item.tags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", item.tags.join(", "))
        };
        println!(
            "- {:<24} {:<16} checks={}  {}{}",
            item.id, status_label, applicable_checks, item.name, tags
        );
    }

    ExitCode::SUCCESS
}

async fn handle_check(snapshot: &WorkspaceSnapshot, args: &CheckArgs, as_json: bool) -> ExitCode {
    if args.step.is_some() && args.items.len() != 1 {
        eprintln!("error: --step requires specifying exactly one item ID");
        return ExitCode::from(2);
    }

    let targets = match collect_targets(
        snapshot,
        &args.items,
        &args.tags,
        "check",
        args.step,
    ) {
        Ok(t) => t,
        Err(msg) => {
            eprintln!("error: {msg}");
            return ExitCode::from(2);
        }
    };

    if targets.is_empty() {
        if as_json {
            let empty = CheckJsonReport {
                host_platform: snapshot.host_platform,
                passed: 0,
                failed: 0,
                canceled: 0,
                results: Vec::new(),
            };
            println!("{}", serde_json::to_string_pretty(&empty).unwrap_or_default());
        } else {
            println!("No applicable check commands matched.");
        }
        return ExitCode::SUCCESS;
    }

    let results = run_batch("cli-check", targets, !as_json).await;
    print_check_summary(snapshot.host_platform, results, as_json)
}

async fn handle_fix(snapshot: &WorkspaceSnapshot, args: &FixArgs, as_json: bool) -> ExitCode {
    let item_slice = [args.item.clone()];
    let fix_targets = match collect_targets(snapshot, &item_slice, &[], "fix", args.step) {
        Ok(t) => t,
        Err(msg) => {
            eprintln!("error: {msg}");
            return ExitCode::from(2);
        }
    };

    if fix_targets.is_empty() {
        eprintln!("error: no applicable 'fix' commands found on '{}'", args.item);
        return ExitCode::from(2);
    }

    let fix_results = run_batch("cli-fix", fix_targets, !as_json).await;

    let verify_results = if args.no_verify {
        Vec::new()
    } else {
        let check_targets =
            collect_targets(snapshot, &item_slice, &[], "check", None).unwrap_or_default();
        if check_targets.is_empty() {
            Vec::new()
        } else {
            if !as_json {
                println!("\nRe-running check commands for '{}'...", args.item);
            }
            run_batch("cli-verify", check_targets, !as_json).await
        }
    };

    if as_json {
        let report = FixJsonReport {
            host_platform: snapshot.host_platform,
            fix_results: fix_results.clone(),
            verify_results: verify_results.clone(),
        };
        println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    } else {
        for r in &fix_results {
            print_result_line(r);
        }
        for r in &verify_results {
            print_result_line(r);
        }
    }

    let any_fix_failed = fix_results.iter().any(|r| r.status != RunStatus::Pass);
    let any_verify_failed = verify_results.iter().any(|r| r.status != RunStatus::Pass);
    if any_fix_failed || any_verify_failed {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

async fn handle_run(snapshot: &WorkspaceSnapshot, args: &RunArgs, as_json: bool) -> ExitCode {
    let item_slice = [args.item.clone()];
    let targets = match collect_targets(
        snapshot,
        &item_slice,
        &[],
        &args.script_key,
        args.step,
    ) {
        Ok(t) => t,
        Err(msg) => {
            eprintln!("error: {msg}");
            return ExitCode::from(2);
        }
    };

    if targets.is_empty() {
        eprintln!(
            "error: no applicable commands for script '{}' on '{}'",
            args.script_key, args.item
        );
        return ExitCode::from(2);
    }

    let results = run_batch("cli-run", targets, !as_json).await;
    print_check_summary(snapshot.host_platform, results, as_json)
}

async fn handle_context(snapshot: &WorkspaceSnapshot, args: &ContextArgs, as_json: bool) -> ExitCode {
    let Some(item) = snapshot.items.iter().find(|i| i.id == args.item) else {
        eprintln!("error: item '{}' not found", args.item);
        return ExitCode::from(2);
    };

    let check_results = if args.run_check {
        let targets = collect_targets(
            snapshot,
            std::slice::from_ref(&args.item),
            &[],
            "check",
            None,
        )
        .unwrap_or_default();
        if targets.is_empty() {
            Vec::new()
        } else {
            run_batch("cli-context-check", targets, false).await
        }
    } else {
        Vec::new()
    };

    let markdown = format_item_context(
        item,
        if check_results.is_empty() {
            None
        } else {
            Some(&check_results)
        },
        snapshot.host_platform,
    );

    if as_json {
        let report = ContextJsonReport {
            item_id: item.id.clone(),
            host_platform: snapshot.host_platform,
            markdown,
            check_results,
        };
        println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    } else {
        print!("{markdown}");
    }

    ExitCode::SUCCESS
}

fn collect_targets(
    snapshot: &WorkspaceSnapshot,
    item_ids: &[String],
    tags: &[String],
    script_key: &str,
    step_index: Option<usize>,
) -> Result<Vec<CommandExecutionTarget>, String> {
    for id in item_ids {
        if !snapshot.items.iter().any(|i| &i.id == id) {
            return Err(format!("Item '{id}' was not found in workspace"));
        }
    }

    let mut targets = Vec::new();
    for item in &snapshot.items {
        if !item_ids.is_empty() && !item_ids.contains(&item.id) {
            continue;
        }
        if !tags.is_empty() && !tags.iter().any(|t| item.tags.contains(t)) {
            continue;
        }
        if !item.applicable {
            continue;
        }

        if let Some(group) = item.script_groups.iter().find(|g| g.key == script_key) {
            if let Some(idx) = step_index {
                let Some(cmd) = group.commands.get(idx) else {
                    return Err(format!(
                        "Step index {idx} out of range for '{}.{script_key}'",
                        item.id
                    ));
                };
                if !cmd.applicable {
                    return Err(format!(
                        "Step {idx} on '{}.{script_key}' is not applicable on {}",
                        item.id, snapshot.host_platform
                    ));
                }
                targets.push(CommandExecutionTarget::from_resolved(item, cmd));
            } else {
                for cmd in &group.commands {
                    if cmd.applicable {
                        targets.push(CommandExecutionTarget::from_resolved(item, cmd));
                    }
                }
            }
        }
    }

    Ok(targets)
}

async fn run_batch(
    run_id: &str,
    targets: Vec<CommandExecutionTarget>,
    print_live: bool,
) -> Vec<CommandResult> {
    let registry = RunRegistry::new();
    run_commands_parallel(
        run_id.to_string(),
        targets,
        DEFAULT_CONCURRENCY,
        registry,
        move |event| {
            if print_live && let RunEvent::Output { command_id, text, .. } = event {
                println!("  [{command_id}] {text}");
            }
        },
    )
    .await
}

fn print_check_summary(
    host_platform: Platform,
    results: Vec<CommandResult>,
    as_json: bool,
) -> ExitCode {
    let passed = results.iter().filter(|r| r.status == RunStatus::Pass).count();
    let failed = results.iter().filter(|r| r.status == RunStatus::Fail).count();
    let canceled = results.iter().filter(|r| r.status == RunStatus::Canceled).count();

    if as_json {
        let report = CheckJsonReport {
            host_platform,
            passed,
            failed,
            canceled,
            results,
        };
        println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
    } else {
        println!();
        for res in &results {
            print_result_line(res);
        }
        println!("\nSummary: {passed} passed, {failed} failed, {canceled} canceled");
    }

    if failed > 0 || canceled > 0 {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn print_result_line(res: &CommandResult) {
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
        "[{badge}] {} :: {} ({}) [exit={code}, {}ms]",
        res.item_id, res.command_name, res.group_key, res.duration_ms
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn collects_targets_filtered_by_tags_and_step_index() {
        let tmp = TempDir::new().unwrap();
        let a_dir = tmp.path().join("items").join("alpha");
        let b_dir = tmp.path().join("items").join("beta");
        fs::create_dir_all(&a_dir).unwrap();
        fs::create_dir_all(&b_dir).unwrap();

        fs::write(
            a_dir.join("meta.json"),
            r#"{"name":"Alpha","tags":["git"],"scripts":{"check":["echo a1","echo a2"]}}"#,
        )
        .unwrap();
        fs::write(
            b_dir.join("meta.json"),
            r#"{"name":"Beta","tags":["node"],"scripts":{"check":"echo b1"}}"#,
        )
        .unwrap();

        let snap = load_workspace(tmp.path()).unwrap();
        let git_targets =
            collect_targets(&snap, &[], &["git".to_string()], "check", None).unwrap();
        assert_eq!(git_targets.len(), 2);

        let single =
            collect_targets(&snap, &["alpha".to_string()], &[], "check", Some(1)).unwrap();
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].command_id, "alpha::check::1");
    }
}
