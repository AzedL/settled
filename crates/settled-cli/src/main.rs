mod config;
mod lint;
mod output;
mod scaffold;

use clap::{Args, Parser, Subcommand};
use config::{
    remove_workspace, resolve_workspace_with_warnings, use_workspace, CliConfigStore,
};
use lint::lint_workspace;
use output::{
    print_cli_error, print_cli_warning, print_created_item, print_execution_report,
    print_lint_report, print_list_report, print_no_checks_found, print_workspace_list_empty,
    print_workspace_list_entry, print_workspace_remove, print_workspace_use,
};
use scaffold::create_item_scaffold;
use settled_core::{
    load_workspace, run_commands_parallel, CommandExecutionTarget, CommandResult, RunRegistry,
    RunStatus, WorkspaceSnapshot, DEFAULT_CONCURRENCY,
};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Debug, Parser)]
#[command(
    name = "settled",
    version,
    about = "Agent-first CLI for Settled cross-device environment workspaces"
)]
struct Cli {
    /// Target workspace directory (overrides global workspace and cwd)
    #[arg(long, short = 'w', global = true, env = "SETTLED_WORKSPACE")]
    workspace: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Manage registered CLI workspaces and active default selection
    Workspace(WorkspaceArgs),
    /// List workspace items as structured metadata (current platform by default)
    List(ListArgs),
    /// Scaffold a new item directory with starter meta.json and empty README.md
    New(NewArgs),
    /// Validate meta.json syntax/schema (errors) and docs/scripts/fields (warnings)
    Lint(LintArgs),
    /// Run read-only `check` commands across the workspace or for a single item
    Check(CheckArgs),
    /// Run `fix` commands for an item and automatically re-verify with `check`
    Fix(FixArgs),
    /// Run any registered script group on an item (including `check` or `fix` directly)
    Run(RunArgs),
}

#[derive(Debug, Args)]
struct WorkspaceArgs {
    #[command(subcommand)]
    action: WorkspaceAction,
}

#[derive(Debug, Subcommand)]
enum WorkspaceAction {
    /// Register and switch the active CLI workspace
    Use {
        path: PathBuf,
        /// Initialize `<path>/settled-items/` if it does not exist yet
        #[arg(long)]
        init: bool,
    },
    /// List registered CLI workspaces (current active marked with '*')
    #[command(alias = "ls")]
    List,
    /// Remove a workspace from the CLI registration list
    #[command(alias = "rm")]
    Remove { path: PathBuf },
    /// Print the active resolved workspace directory path
    Current,
}

#[derive(Debug, Args)]
struct ListArgs {
    /// Include items targeting other platforms (default: current platform only)
    #[arg(long)]
    all_platforms: bool,
}

#[derive(Debug, Args)]
struct NewArgs {
    /// Lowercase item directory identifier (e.g. `git-config`)
    item_id: String,
}

#[derive(Debug, Args)]
struct LintArgs {
    /// Optional single item ID to lint (defaults to all items in workspace)
    item: Option<String>,
}

#[derive(Debug, Args)]
struct CheckArgs {
    /// Optional item ID (omit to run all applicable `check` commands)
    item: Option<String>,
    /// Run only a single 0-based command index within the item's `check` group
    #[arg(long, requires = "item")]
    step: Option<usize>,
    /// Show output from passing commands as well as failures
    #[arg(long, short = 'v')]
    verbose: bool,
}

#[derive(Debug, Args)]
struct FixArgs {
    /// Target item ID
    item: String,
    /// Run only a single 0-based command index within the item's `fix` group
    #[arg(long)]
    step: Option<usize>,
    /// Show output from passing commands as well as failures
    #[arg(long, short = 'v')]
    verbose: bool,
}

#[derive(Debug, Args)]
struct RunArgs {
    /// Target item ID
    item: String,
    /// Script group key in `meta.json` (e.g. `check`, `fix`, or custom key)
    script_key: String,
    /// Run only a single 0-based command index within the script group
    #[arg(long)]
    step: Option<usize>,
    /// Include command metadata (`dir`, `cmd`) and untruncated output
    #[arg(long, short = 'v')]
    verbose: bool,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let store = match CliConfigStore::default_store() {
        Ok(s) => s,
        Err(msg) => {
            print_cli_error(&msg);
            return ExitCode::from(2);
        }
    };
    let cwd = match std::env::current_dir() {
        Ok(dir) => dir,
        Err(e) => {
            print_cli_error(&format!("failed to determine current directory: {e}"));
            return ExitCode::from(2);
        }
    };

    if let Commands::Workspace(args) = cli.command {
        return handle_workspace(args, cli.workspace, &store, &cwd);
    }

    let workspace_path = match resolve_active_workspace(cli.workspace, &store, &cwd) {
        Ok(path) => path,
        Err(code) => return code,
    };

    match cli.command {
        Commands::Workspace(_) => unreachable!(),
        Commands::New(args) => handle_new(&workspace_path, &args),
        Commands::Lint(args) => handle_lint(&workspace_path, &args),
        Commands::List(_) | Commands::Check(_) | Commands::Fix(_) | Commands::Run(_) => {
            let snapshot = match load_workspace(&workspace_path) {
                Ok(s) => s,
                Err(err) => {
                    print_cli_error(&err.to_string());
                    return ExitCode::from(2);
                }
            };

            match cli.command {
                Commands::List(args) => {
                    print_list_report(&snapshot, args.all_platforms);
                    ExitCode::SUCCESS
                }
                Commands::Check(args) => handle_check(&snapshot, &args).await,
                Commands::Fix(args) => handle_fix(&snapshot, &args).await,
                Commands::Run(args) => handle_run(&snapshot, &args).await,
                Commands::Workspace(_) | Commands::New(_) | Commands::Lint(_) => unreachable!(),
            }
        }
    }
}

fn resolve_active_workspace(
    explicit: Option<PathBuf>,
    store: &CliConfigStore,
    cwd: &Path,
) -> Result<PathBuf, ExitCode> {
    match resolve_workspace_with_warnings(explicit, store, cwd) {
        Ok((path, warnings)) => {
            for w in warnings {
                print_cli_warning(&w);
            }
            Ok(path)
        }
        Err(err) => {
            if let Ok(cfg) = store.load()
                && let Some(current) = cfg.current_workspace
                && !Path::new(&current).is_dir()
            {
                print_cli_warning(&format!(
                    "configured workspace directory does not exist: {current}"
                ));
            }
            print_cli_error(&err);
            Err(ExitCode::from(2))
        }
    }
}

fn handle_workspace(
    args: WorkspaceArgs,
    explicit: Option<PathBuf>,
    store: &CliConfigStore,
    cwd: &Path,
) -> ExitCode {
    match args.action {
        WorkspaceAction::Use { path, init } => match use_workspace(store, &path, cwd, init) {
            Ok(outcome) => {
                print_workspace_use(&outcome.path, outcome.initialized);
                ExitCode::SUCCESS
            }
            Err(msg) => {
                print_cli_error(&msg);
                ExitCode::from(2)
            }
        },
        WorkspaceAction::List => {
            let cfg = match store.load() {
                Ok(c) => c,
                Err(msg) => {
                    print_cli_error(&msg);
                    return ExitCode::from(2);
                }
            };
            if let Some(current) = &cfg.current_workspace
                && !Path::new(current).is_dir()
            {
                print_cli_warning(&format!(
                    "configured workspace directory does not exist: {current}"
                ));
            }
            if cfg.workspaces.is_empty() {
                print_workspace_list_empty();
                return ExitCode::SUCCESS;
            }
            for ws in &cfg.workspaces {
                let is_current = cfg
                    .current_workspace
                    .as_deref()
                    .is_some_and(|c| config::paths_equal(c, ws));
                print_workspace_list_entry(ws, is_current, Path::new(ws).is_dir());
            }
            ExitCode::SUCCESS
        }
        WorkspaceAction::Remove { path } => match remove_workspace(store, &path, cwd) {
            Ok(outcome) => {
                print_workspace_remove(&outcome.path, outcome.was_current);
                ExitCode::SUCCESS
            }
            Err(msg) => {
                print_cli_error(&msg);
                ExitCode::from(2)
            }
        },
        WorkspaceAction::Current => match resolve_active_workspace(explicit, store, cwd) {
            Ok(path) => {
                println!("{}", path.display());
                ExitCode::SUCCESS
            }
            Err(code) => code,
        },
    }
}

fn handle_new(workspace_root: &Path, args: &NewArgs) -> ExitCode {
    match create_item_scaffold(workspace_root, &args.item_id) {
        Ok(created) => {
            print_created_item(
                &created.item_id,
                &created.item_dir.display().to_string(),
                &created.meta_path.display().to_string(),
                &created.readme_path.display().to_string(),
            );
            ExitCode::SUCCESS
        }
        Err(msg) => {
            print_cli_error(&msg);
            ExitCode::from(2)
        }
    }
}

fn handle_lint(workspace_root: &Path, args: &LintArgs) -> ExitCode {
    match lint_workspace(workspace_root, args.item.as_deref()) {
        Ok(report) => {
            print_lint_report(&report);
            if report.error_count > 0 {
                ExitCode::from(1)
            } else {
                ExitCode::SUCCESS
            }
        }
        Err(msg) => {
            print_cli_error(&msg);
            ExitCode::from(2)
        }
    }
}

async fn handle_check(snapshot: &WorkspaceSnapshot, args: &CheckArgs) -> ExitCode {
    let targets = match collect_targets(snapshot, args.item.as_deref(), "check", args.step) {
        Ok(t) => t,
        Err(msg) => {
            print_cli_error(&msg);
            return ExitCode::from(2);
        }
    };

    if targets.is_empty() {
        if let Some(item_id) = &args.item {
            print_cli_error(&format!("no applicable 'check' commands on '{item_id}'"));
            return ExitCode::from(2);
        }
        print_no_checks_found();
        return ExitCode::SUCCESS;
    }

    let results = run_batch("cli-check", targets).await;
    print_execution_report(None, &results, snapshot, args.verbose, false, true);
    exit_code_for_results(&results)
}

async fn handle_fix(snapshot: &WorkspaceSnapshot, args: &FixArgs) -> ExitCode {
    let fix_targets = match collect_targets(snapshot, Some(&args.item), "fix", args.step) {
        Ok(t) => t,
        Err(msg) => {
            print_cli_error(&msg);
            return ExitCode::from(2);
        }
    };

    if fix_targets.is_empty() {
        print_cli_error(&format!("no applicable 'fix' commands on '{}'", args.item));
        return ExitCode::from(2);
    }

    let fix_results = run_batch("cli-fix", fix_targets).await;
    let check_targets =
        collect_targets(snapshot, Some(&args.item), "check", None).unwrap_or_default();

    print_execution_report(
        Some("Fix"),
        &fix_results,
        snapshot,
        args.verbose,
        false,
        check_targets.is_empty(),
    );

    let verify_results = if check_targets.is_empty() {
        Vec::new()
    } else {
        println!();
        let results = run_batch("cli-verify", check_targets).await;
        print_execution_report(Some("Verify"), &results, snapshot, args.verbose, false, true);
        results
    };

    let all_pass = fix_results.iter().all(|r| r.status == RunStatus::Pass)
        && verify_results.iter().all(|r| r.status == RunStatus::Pass);
    if all_pass {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

async fn handle_run(snapshot: &WorkspaceSnapshot, args: &RunArgs) -> ExitCode {
    let targets =
        match collect_targets(snapshot, Some(&args.item), &args.script_key, args.step) {
            Ok(t) => t,
            Err(msg) => {
                print_cli_error(&msg);
                return ExitCode::from(2);
            }
        };

    if targets.is_empty() {
        print_cli_error(&format!(
            "no applicable commands for script '{}' on '{}'",
            args.script_key, args.item
        ));
        return ExitCode::from(2);
    }

    let results = run_batch("cli-run", targets).await;
    print_execution_report(None, &results, snapshot, args.verbose, true, true);
    exit_code_for_results(&results)
}

fn exit_code_for_results(results: &[CommandResult]) -> ExitCode {
    let any_non_pass = results.iter().any(|r| r.status != RunStatus::Pass);
    if any_non_pass {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn collect_targets(
    snapshot: &WorkspaceSnapshot,
    item_id: Option<&str>,
    script_key: &str,
    step_index: Option<usize>,
) -> Result<Vec<CommandExecutionTarget>, String> {
    if let Some(id) = item_id {
        let Some(item) = snapshot.items.iter().find(|i| i.id == id) else {
            let item_dir = Path::new(&snapshot.items_dir).join(id);
            if item_dir.is_dir() {
                return Err(format!(
                    "Item '{id}' could not be loaded (run 'settled lint {id}' to inspect meta.json errors)"
                ));
            }
            return Err(format!("Item '{id}' was not found in workspace"));
        };

        if !item.applicable {
            return Err(format!(
                "Item '{id}' is not applicable on {}",
                snapshot.host_platform
            ));
        }

        let Some(group) = item.script_groups.iter().find(|g| g.key == script_key) else {
            return Ok(Vec::new());
        };

        if let Some(idx) = step_index {
            let Some(cmd) = group.commands.get(idx) else {
                return Err(format!(
                    "Step index {idx} out of range for '{id}.{script_key}'"
                ));
            };
            if !cmd.applicable {
                return Err(format!(
                    "Step {idx} on '{id}.{script_key}' is not applicable on {}",
                    snapshot.host_platform
                ));
            }
            return Ok(vec![CommandExecutionTarget::from_resolved(item, cmd)]);
        }

        return Ok(group
            .commands
            .iter()
            .filter(|cmd| cmd.applicable)
            .map(|cmd| CommandExecutionTarget::from_resolved(item, cmd))
            .collect());
    }

    let mut targets = Vec::new();
    for item in &snapshot.items {
        if !item.applicable {
            continue;
        }
        if let Some(group) = item.script_groups.iter().find(|g| g.key == script_key) {
            for cmd in &group.commands {
                if cmd.applicable {
                    targets.push(CommandExecutionTarget::from_resolved(item, cmd));
                }
            }
        }
    }
    Ok(targets)
}

async fn run_batch(run_id: &str, targets: Vec<CommandExecutionTarget>) -> Vec<CommandResult> {
    let registry = RunRegistry::new();
    run_commands_parallel(
        run_id.to_string(),
        targets,
        DEFAULT_CONCURRENCY,
        registry,
        |_| {},
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use settled_core::{Platform, ITEMS_DIR_NAME};
    use std::fs;
    use tempfile::TempDir;

    fn make_valid_ws(root: &Path) {
        fs::create_dir_all(root.join(ITEMS_DIR_NAME)).unwrap();
    }

    #[test]
    fn workspace_use_remove_and_resolution_priority_work_as_specified() {
        let tmp = TempDir::new().unwrap();
        let store = CliConfigStore::at(tmp.path().join("cli.json"));
        let ws_global = tmp.path().join("ws-global");
        let ws_cwd = tmp.path().join("ws-cwd");
        let nested = ws_cwd.join(ITEMS_DIR_NAME).join("alpha");
        let stray_dir = tmp.path().join("no-items-dir");
        fs::create_dir_all(&stray_dir).unwrap();
        fs::create_dir_all(&nested).unwrap();

        // use fails without --init when settled-items/ is missing
        let err = use_workspace(&store, &ws_global, tmp.path(), false).unwrap_err();
        assert!(err.contains("--init"));

        // use --init creates settled-items/ and marks active
        let used = use_workspace(&store, &ws_global, tmp.path(), true).unwrap();
        assert!(used.initialized);
        assert!(ws_global.join(ITEMS_DIR_NAME).is_dir());

        // explicit -w overrides global
        let ws_explicit = tmp.path().join("ws-explicit");
        make_valid_ws(&ws_explicit);
        let (res_exp, warn_exp) =
            resolve_workspace_with_warnings(Some(ws_explicit.clone()), &store, &ws_cwd).unwrap();
        assert!(warn_exp.is_empty());
        assert!(config::paths_equal(
            &res_exp.to_string_lossy(),
            &ws_explicit.to_string_lossy()
        ));

        // global wins over valid cwd
        let (res_global, warn_global) =
            resolve_workspace_with_warnings(None, &store, &ws_cwd).unwrap();
        assert!(warn_global.is_empty());
        assert!(config::paths_equal(
            &res_global.to_string_lossy(),
            &ws_global.to_string_lossy()
        ));

        // missing global directory emits warning and falls back to cwd if cwd has settled-items/
        fs::remove_dir_all(&ws_global).unwrap();
        let (res_fallback, warn_fallback) =
            resolve_workspace_with_warnings(None, &store, &ws_cwd).unwrap();
        assert_eq!(warn_fallback.len(), 1);
        assert!(config::paths_equal(
            &res_fallback.to_string_lossy(),
            &ws_cwd.to_string_lossy()
        ));

        // nested subdirectory does NOT walk upward to ws_cwd
        let nested_err = resolve_workspace_with_warnings(None, &store, &nested).unwrap_err();
        assert!(nested_err.contains("No active workspace"));

        // removing missing workspace succeeds and clears current_workspace
        let removed = remove_workspace(&store, &ws_global, tmp.path()).unwrap();
        assert!(removed.was_current);
        let cfg = store.load().unwrap();
        assert!(cfg.workspaces.is_empty());
        assert!(cfg.current_workspace.is_none());
    }

    #[test]
    fn new_validates_id_and_creates_expected_template() {
        let tmp = TempDir::new().unwrap();
        make_valid_ws(tmp.path());

        assert!(create_item_scaffold(tmp.path(), ".hidden").is_err());
        assert!(create_item_scaffold(tmp.path(), "BadCase").is_err());
        assert!(create_item_scaffold(tmp.path(), "../escape").is_err());

        let created = create_item_scaffold(tmp.path(), "git-core").unwrap();
        assert!(created.meta_path.is_file());
        assert!(created.readme_path.is_file());
        assert_eq!(fs::read_to_string(&created.readme_path).unwrap(), "");

        // Duplicate item ID is rejected
        assert!(create_item_scaffold(tmp.path(), "git-core").is_err());

        // Generated item passes load_workspace and has expected keys
        let snap = load_workspace(tmp.path()).unwrap();
        assert_eq!(snap.items.len(), 1);
        let item = &snap.items[0];
        assert_eq!(item.id, "git-core");
        assert_eq!(item.name, "Git Core");
        assert!(item.create_at.is_some());
        assert_eq!(item.script_groups.len(), 1);
        assert_eq!(item.script_groups[0].key, "check");
    }

    #[test]
    fn lint_separates_ignored_meta_errors_from_warnings() {
        let tmp = TempDir::new().unwrap();
        let items = tmp.path().join(ITEMS_DIR_NAME);
        fs::create_dir_all(&items).unwrap();

        // 1. Broken meta (tags as string + unknown field + missing README) -> Error + Warning
        let broken = items.join("broken-item");
        fs::create_dir_all(&broken).unwrap();
        fs::write(
            broken.join("meta.json"),
            r#"{"name":"Broken","tags":"git","extraField":123}"#,
        )
        .unwrap();

        // 2. Valid meta, empty README, unknown step field, missing @script, platform conflict -> Warnings only
        let warn_only = items.join("warn-only");
        fs::create_dir_all(&warn_only).unwrap();
        fs::write(warn_only.join("README.md"), "   \n").unwrap();
        fs::write(
            warn_only.join("meta.json"),
            r#"{
                "name": "Warn Only",
                "platforms": ["windows"],
                "platform": ["windows"],
                "scripts": {
                    "check": [
                        {
                            "name": "Missing script and conflict",
                            "run": "node @script/missing.mjs",
                            "platforms": ["macos"],
                            "extraStepKey": true
                        }
                    ]
                }
            }"#,
        )
        .unwrap();

        // 3. Valid item with existing first-level script (never recurses into script body)
        let ok_item = items.join("ok-item");
        fs::create_dir_all(ok_item.join("scripts")).unwrap();
        fs::write(ok_item.join("README.md"), "# OK\nDetails.").unwrap();
        fs::write(
            ok_item.join("scripts").join("probe.sh"),
            "source ./nonexistent-nested.sh\n",
        )
        .unwrap();
        fs::write(
            ok_item.join("meta.json"),
            r#"{"name":"OK","scripts":{"check":"bash @script/probe.sh"}}"#,
        )
        .unwrap();

        let report = lint_workspace(tmp.path(), None).unwrap();
        assert_eq!(report.items_checked, 3);
        assert_eq!(report.error_count, 1);
        assert!(report.warning_count >= 5);

        let single_warn = lint_workspace(tmp.path(), Some("warn-only")).unwrap();
        assert_eq!(single_warn.items_checked, 1);
        assert_eq!(single_warn.error_count, 0);
        assert_eq!(single_warn.warning_count, 5);

        let single_ok = lint_workspace(tmp.path(), Some("ok-item")).unwrap();
        assert_eq!(single_ok.error_count, 0);
        assert_eq!(single_ok.warning_count, 0);
    }

    #[test]
    fn collect_targets_handles_check_fix_and_unrestricted_run() {
        let tmp = TempDir::new().unwrap();
        let a_dir = tmp.path().join(ITEMS_DIR_NAME).join("alpha");
        let b_dir = tmp.path().join(ITEMS_DIR_NAME).join("other-os");
        fs::create_dir_all(&a_dir).unwrap();
        fs::create_dir_all(&b_dir).unwrap();

        let other_os = match Platform::current() {
            Platform::Windows => "macos",
            Platform::Macos | Platform::Linux => "windows",
        };

        fs::write(
            a_dir.join("meta.json"),
            r#"{"name":"Alpha","scripts":{"check":["echo a1","echo a2"],"fix":"echo fix","custom":"echo c"}}"#,
        )
        .unwrap();
        fs::write(
            b_dir.join("meta.json"),
            format!(r#"{{"name":"Other","platforms":["{other_os}"],"scripts":{{"check":"echo b"}}}}"#),
        )
        .unwrap();

        let snap = load_workspace(tmp.path()).unwrap();

        let all_checks = collect_targets(&snap, None, "check", None).unwrap();
        assert_eq!(all_checks.len(), 2);

        let step_one = collect_targets(&snap, Some("alpha"), "check", Some(1)).unwrap();
        assert_eq!(step_one.len(), 1);
        assert_eq!(step_one[0].command_id, "alpha::check::1");

        // `run` is allowed to invoke `check` or `fix` without restrictions
        let run_check = collect_targets(&snap, Some("alpha"), "check", None).unwrap();
        assert_eq!(run_check.len(), 2);
        let run_fix = collect_targets(&snap, Some("alpha"), "fix", None).unwrap();
        assert_eq!(run_fix.len(), 1);
        let run_custom = collect_targets(&snap, Some("alpha"), "custom", None).unwrap();
        assert_eq!(run_custom.len(), 1);

        // Targeting non-applicable item errors clearly
        assert!(collect_targets(&snap, Some("other-os"), "check", None).is_err());
    }

    #[test]
    fn lint_warns_on_duplicate_commands_within_and_across_script_groups() {
        let tmp = TempDir::new().unwrap();
        let items = tmp.path().join(ITEMS_DIR_NAME);
        fs::create_dir_all(&items).unwrap();

        let dup_item = items.join("dup-commands");
        fs::create_dir_all(dup_item.join("scripts")).unwrap();
        fs::write(dup_item.join("README.md"), "# Duplicate Checks\n").unwrap();
        fs::write(dup_item.join("scripts").join("probe.sh"), "echo ok\n").unwrap();
        fs::write(dup_item.join("scripts").join("win.bat"), "@echo off\n").unwrap();
        fs::write(
            dup_item.join("meta.json"),
            r#"{
                "name": "Duplicate Commands",
                "scripts": {
                    "check": [
                        "  bash @script/probe.sh  ",
                        {
                            "name": "Duplicate normalized script + utf8",
                            "run": "bash ./scripts/probe.sh",
                            "encoding": "utf8"
                        },
                        {
                            "name": "Different encoding does not warn",
                            "run": "bash ./scripts/probe.sh",
                            "encoding": "gbk"
                        },
                        {
                            "name": "Different shell does not warn",
                            "run": "bash ./scripts/probe.sh",
                            "shell": "bash"
                        },
                        {
                            "name": "Windows variant",
                            "run": "call @script/win.bat",
                            "shell": "cmd",
                            "platforms": ["windows"]
                        },
                        {
                            "name": "macOS variant disjoint",
                            "run": "call @script/win.bat",
                            "shell": "cmd",
                            "platforms": ["macos"]
                        },
                        {
                            "name": "Windows cmd.exe alias duplicate",
                            "run": "call .\\scripts\\win.bat",
                            "shell": "cmd.exe",
                            "platforms": ["windows"]
                        }
                    ],
                    "custom": {
                        "name": "Cross-group duplicate of check[0]",
                        "run": "bash ./scripts/probe.sh"
                    }
                }
            }"#,
        )
        .unwrap();

        let clean_item = items.join("clean-item");
        fs::create_dir_all(clean_item.join("scripts")).unwrap();
        fs::write(clean_item.join("README.md"), "# Clean\n").unwrap();
        fs::write(clean_item.join("scripts").join("probe.sh"), "echo ok\n").unwrap();
        // Identical command in a different item must NOT trigger a duplicate warning, and
        // narrowed disjoint effective platforms inside the same item must NOT warn either.
        fs::write(
            clean_item.join("meta.json"),
            r#"{
                "name": "Clean Cross-Item",
                "platforms": ["windows", "linux"],
                "scripts": {
                    "check": [
                        { "run": "bash ./scripts/probe.sh", "platforms": ["windows"] },
                        { "run": "bash ./scripts/probe.sh", "platforms": ["macos", "linux"] }
                    ]
                }
            }"#,
        )
        .unwrap();

        let report = lint_workspace(tmp.path(), None).unwrap();
        assert_eq!(report.error_count, 0);

        let dup_res = report
            .results
            .iter()
            .find(|r| r.item_id == "dup-commands")
            .expect("dup-commands should emit warnings");
        let msgs: Vec<&str> = dup_res
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect();
        assert_eq!(
            msgs,
            vec![
                "scripts.check[1] duplicates command in scripts.check[0]",
                "scripts.check[6] duplicates command in scripts.check[4]",
                "scripts.custom[0] duplicates command in scripts.check[0]",
            ]
        );

        assert!(
            report.results.iter().all(|r| r.item_id != "clean-item"),
            "cross-item and disjoint effective platforms should not produce warnings, got: {:?}",
            report.results
        );
    }
}
