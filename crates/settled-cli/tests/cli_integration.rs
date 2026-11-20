use serde_json::Value;
use settled_core::ITEMS_DIR_NAME;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::TempDir;

fn cli_bin() -> &'static str {
    env!("CARGO_BIN_EXE_settled")
}

fn example_workspace_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("examples")
        .join("workspace")
}

fn run_cli(
    args: &[&str],
    cwd: &Path,
    config_file: &Path,
    extra_env: &[(&str, &Path)],
) -> Output {
    let mut cmd = Command::new(cli_bin());
    cmd.args(args)
        .current_dir(cwd)
        .env("SETTLED_CLI_CONFIG", config_file)
        .env_remove("SETTLED_WORKSPACE");
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    cmd.output().expect("failed to execute settled CLI binary")
}

fn stdout_str(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr_str(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn help_and_version_work() {
    let tmp = TempDir::new().unwrap();
    let cfg = tmp.path().join("cli.json");

    let help = run_cli(&["--help"], tmp.path(), &cfg, &[]);
    assert_eq!(help.status.code(), Some(0));
    let help_out = stdout_str(&help);
    assert!(help_out.contains("workspace"));
    assert!(help_out.contains("lint"));
    assert!(!help_out.contains("--json"));

    let ver = run_cli(&["--version"], tmp.path(), &cfg, &[]);
    assert_eq!(ver.status.code(), Some(0));
    assert!(stdout_str(&ver).contains("settled"));
}

#[test]
fn workspace_subcommands_handle_init_missing_warning_and_resolution_order() {
    let tmp = TempDir::new().unwrap();
    let cfg = tmp.path().join("cli.json");
    let blank_dir = tmp.path().join("blank-ws");
    fs::create_dir_all(&blank_dir).unwrap();
    let example_ws = example_workspace_path();

    // Empty workspace list initially
    let empty_ls = run_cli(&["workspace", "list"], tmp.path(), &cfg, &[]);
    assert_eq!(empty_ls.status.code(), Some(0));
    assert!(stdout_str(&empty_ls).contains("no workspaces registered"));

    // No active workspace -> exit 2
    let no_ws = run_cli(&["workspace", "current"], tmp.path(), &cfg, &[]);
    assert_eq!(no_ws.status.code(), Some(2));
    assert!(stderr_str(&no_ws).contains("error:"));

    // `workspace use` without --init rejects folder without settled-items/
    let fail_use = run_cli(
        &["workspace", "use", blank_dir.to_str().unwrap()],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(fail_use.status.code(), Some(2));
    assert!(stderr_str(&fail_use).contains("--init"));

    // `workspace use --init` creates settled-items/ and registers active
    let init_use = run_cli(
        &["workspace", "use", blank_dir.to_str().unwrap(), "--init"],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(init_use.status.code(), Some(0));
    assert!(blank_dir.join(ITEMS_DIR_NAME).is_dir());

    // Register example workspace too and verify `*` switches properly
    let ex_use = run_cli(
        &["workspace", "use", example_ws.to_str().unwrap()],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(ex_use.status.code(), Some(0));

    let ls = run_cli(&["workspace", "list"], tmp.path(), &cfg, &[]);
    assert_eq!(ls.status.code(), Some(0));
    let ls_out = stdout_str(&ls);
    assert!(ls_out.lines().any(|l| l.starts_with("  ") && l.contains("blank-ws")));
    assert!(ls_out.lines().any(|l| l.starts_with("* ") && l.contains("workspace")));

    // Switch back to blank_dir then delete it from disk to test warning + cwd fallback
    assert_eq!(
        run_cli(
            &["workspace", "use", blank_dir.to_str().unwrap()],
            tmp.path(),
            &cfg,
            &[],
        )
        .status
        .code(),
        Some(0)
    );
    fs::remove_dir_all(&blank_dir).unwrap();

    // `workspace list` emits warning and [missing] tag
    let ls_missing = run_cli(&["workspace", "list"], tmp.path(), &cfg, &[]);
    assert_eq!(ls_missing.status.code(), Some(0));
    assert!(stderr_str(&ls_missing).contains("warning:"));
    assert!(stdout_str(&ls_missing).contains("[missing]"));

    // Global missing dir warns on stderr and falls back to `cwd` if `cwd` has settled-items/
    let cur_fallback = run_cli(&["workspace", "current"], &example_ws, &cfg, &[]);
    assert_eq!(cur_fallback.status.code(), Some(0));
    assert!(stderr_str(&cur_fallback).contains("warning:"));
    assert!(stdout_str(&cur_fallback).to_lowercase().contains("workspace"));

    // Global missing dir warns and errors exit 2 when cwd has no settled-items/
    let cur_fail = run_cli(&["workspace", "current"], tmp.path(), &cfg, &[]);
    assert_eq!(cur_fail.status.code(), Some(2));
    assert!(stderr_str(&cur_fail).contains("warning:"));
    assert!(stderr_str(&cur_fail).contains("error:"));

    // Remove registered workspaces
    let rm_blank = run_cli(
        &["workspace", "remove", blank_dir.to_str().unwrap()],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(rm_blank.status.code(), Some(0));
    assert!(stdout_str(&rm_blank).contains("Removed active workspace"));

    let rm_missing = run_cli(
        &["workspace", "remove", "nonexistent-ws"],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(rm_missing.status.code(), Some(2));
}

#[test]
fn examples_workspace_list_lint_check_fix_and_run_cover_end_to_end_flows() {
    let tmp = TempDir::new().unwrap();
    let cfg = tmp.path().join("cli.json");
    let demo_dir = tmp.path().join("demo-markers");
    fs::create_dir_all(&demo_dir).unwrap();
    let example_ws = example_workspace_path();
    let ws_str = example_ws.to_str().unwrap();

    // 1. Lint redesigned dogfooding workspace -> 0 errors, 1 deliberate empty-README warning on ui-empty-and-defaults
    let lint = run_cli(&["lint", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(lint.status.code(), Some(0));
    let lint_out = stdout_str(&lint);
    assert!(lint_out.contains("Linted 9 item(s): 0 error(s), 1 warning(s)"));
    assert!(lint_out.contains("ui-empty-and-defaults"));

    // 2. List omits cross-OS items by default, includes them with --all-platforms,
    // and keeps structured meta + id + path + applicable without readme/rawMeta/metaPath/readmePath
    let list_cur = run_cli(&["list", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(list_cur.status.code(), Some(0));
    let cur_json: Value = serde_json::from_str(&stdout_str(&list_cur)).unwrap();
    let cur_items = cur_json["items"].as_array().unwrap();
    assert!(!cur_items.is_empty());
    let first = cur_items[0].as_object().unwrap();
    assert!(first.contains_key("id"));
    assert!(first.contains_key("path"));
    assert!(first.contains_key("applicable"));
    assert!(!first.contains_key("metaPath"));
    assert!(!first.contains_key("readmePath"));
    assert!(!first.contains_key("readme"));
    assert!(!first.contains_key("rawMeta"));

    let list_all = run_cli(
        &["list", "--all-platforms", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(list_all.status.code(), Some(0));
    let all_json: Value = serde_json::from_str(&stdout_str(&list_all)).unwrap();
    let all_items = all_json["items"].as_array().unwrap();
    assert_eq!(all_items.len(), 9);
    assert!(all_items.iter().any(|it| it["applicable"] == false));

    // 3. `check ui-check-fix-workflow` has 1 passing baseline + 2 failing markers in isolated demo_dir
    let check_fail = run_cli(
        &["check", "ui-check-fix-workflow", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(check_fail.status.code(), Some(1));
    let fail_out = stdout_str(&check_fail);
    assert!(fail_out.contains("PASS  ui-check-fix-workflow (1/3 passed)"));
    assert!(fail_out.contains("FAIL  ui-check-fix-workflow"));
    assert!(fail_out.contains("dir:"));
    assert!(fail_out.contains("cmd:"));
    assert!(fail_out.contains("[缺失]"));

    // 4. `run ui-check-fix-workflow fix --step 0` executes fix step 0 WITHOUT auto-verify
    let run_fix_step0 = run_cli(
        &["run", "ui-check-fix-workflow", "fix", "--step", "0", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(run_fix_step0.status.code(), Some(0));
    let run_fix_out = stdout_str(&run_fix_step0);
    assert!(run_fix_out.contains("[已修复] alpha"));
    assert!(!run_fix_out.contains("== Verify =="));

    // Partial check now reports 2 passing and 1 failing on ui-check-fix-workflow
    let partial_check = run_cli(
        &["check", "ui-check-fix-workflow", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(partial_check.status.code(), Some(1));
    assert!(stdout_str(&partial_check).contains("PASS  ui-check-fix-workflow (2/3 passed)"));

    // 5. `fix ui-check-fix-workflow` fixes all and auto-verifies with check -> exit 0
    let fix_all = run_cli(
        &["fix", "ui-check-fix-workflow", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(fix_all.status.code(), Some(0));
    let fix_out = stdout_str(&fix_all);
    assert!(fix_out.contains("== Fix =="));
    assert!(fix_out.contains("== Verify =="));
    assert!(fix_out.contains("Summary: 3 passed, 0 failed, 0 canceled"));

    // 6. `check ui-check-fix-workflow -v` expands passing logs; without `-v` collapses to 1 line
    let check_pass_quiet = run_cli(
        &["check", "ui-check-fix-workflow", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(check_pass_quiet.status.code(), Some(0));
    assert!(stdout_str(&check_pass_quiet).contains("PASS  ui-check-fix-workflow (3/3 passed"));
    assert!(!stdout_str(&check_pass_quiet).contains("[基线通过]"));

    let check_pass_verbose = run_cli(
        &["check", "ui-check-fix-workflow", "-v", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(check_pass_verbose.status.code(), Some(0));
    assert!(stdout_str(&check_pass_verbose).contains("[基线通过]"));

    // 7. `check --step` without item fails clap parsing (exit 2); with item works cleanly
    let bad_step_flag = run_cli(
        &["check", "--step", "0", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(bad_step_flag.status.code(), Some(2));

    let single_step = run_cli(
        &["check", "ui-check-fix-workflow", "--step", "0", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(single_step.status.code(), Some(0));
    assert!(stdout_str(&single_step).contains("PASS  ui-check-fix-workflow ::"));

    // 8. `run ui-check-fix-workflow inspect-and-env` & `always-fail` & `check ui-empty-and-defaults`
    let inspect = run_cli(
        &["run", "ui-check-fix-workflow", "inspect-and-env", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(inspect.status.code(), Some(0));
    assert!(stdout_str(&inspect).contains("baseDir="));

    let fail_sample = run_cli(
        &["run", "ui-check-fix-workflow", "always-fail", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_DEMO_DIR", &demo_dir)],
    );
    assert_eq!(fail_sample.status.code(), Some(1));
    assert!(stdout_str(&fail_sample).contains("[模拟失败]"));

    let manual_check = run_cli(
        &["check", "ui-empty-and-defaults", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(manual_check.status.code(), Some(2));

    // 9. Execute the two dogfooding CLI self-test items directly against the compiled binary
    let bin_path = Path::new(cli_bin());
    let self_lint = run_cli(
        &["check", "self-cli-workspace-and-lint", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_BIN", bin_path)],
    );
    assert_eq!(self_lint.status.code(), Some(0), "self-cli-workspace-and-lint output:\n{}", stdout_str(&self_lint));

    let self_exec = run_cli(
        &["check", "self-cli-execution-matrix", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[("SETTLED_BIN", bin_path)],
    );
    assert_eq!(self_exec.status.code(), Some(0), "self-cli-execution-matrix output:\n{}", stdout_str(&self_exec));
}

#[test]
fn new_lint_and_output_truncation_work_via_cli_binary() {
    let tmp = TempDir::new().unwrap();
    let cfg = tmp.path().join("cli.json");
    let ws = tmp.path().join("ws");
    fs::create_dir_all(ws.join(ITEMS_DIR_NAME)).unwrap();
    let ws_str = ws.to_str().unwrap();

    // Workspace with 0 checks exits 0 cleanly
    let empty_check = run_cli(&["check", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(empty_check.status.code(), Some(0));
    assert!(stdout_str(&empty_check).contains("No applicable check commands found"));

    // `new` scaffolds starter files
    let created = run_cli(&["new", "probe-item", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(created.status.code(), Some(0));
    assert!(stdout_str(&created).contains("Created item 'probe-item'"));

    // Duplicate `new` fails exit 2
    let dup = run_cli(&["new", "probe-item", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(dup.status.code(), Some(2));

    // `lint` reports warning for empty README, exits 0 (using `[WARN]` without extra trailing space)
    let lint_new = run_cli(&["lint", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(lint_new.status.code(), Some(0));
    assert!(stdout_str(&lint_new).contains("[WARN] README.md is empty"));

    // Verify `CLICOLOR_FORCE=1` emits ANSI styles while normal piped runs stay plain
    let mut colored_cmd = Command::new(cli_bin());
    colored_cmd
        .args(["lint", "-w", ws_str])
        .current_dir(tmp.path())
        .env("SETTLED_CLI_CONFIG", &cfg)
        .env("CLICOLOR_FORCE", "1")
        .env_remove("NO_COLOR");
    let colored_out = colored_cmd.output().unwrap();
    assert_eq!(colored_out.status.code(), Some(0));
    assert!(stdout_str(&colored_out).contains("\x1b["));

    // Long failing output (> 120 lines) truncates earlier lines cleanly unless `-v` is passed
    let item_dir = ws.join(ITEMS_DIR_NAME).join("probe-item");
    fs::write(item_dir.join("README.md"), "# Probe\nDoc.").unwrap();
    fs::write(
        item_dir.join("meta.json"),
        r#"{
            "name": "Probe Item",
            "scripts": {
                "check": "node -e \"for (let i = 0; i < 140; i++) console.log('errline-' + i); process.exit(1)\""
            }
        }"#,
    )
    .unwrap();

    let trunc = run_cli(&["check", "probe-item", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(trunc.status.code(), Some(1));
    assert!(stdout_str(&trunc).contains("earlier line(s) omitted; pass -v to view full output"));

    let full = run_cli(
        &["check", "probe-item", "-v", "-w", ws_str],
        tmp.path(),
        &cfg,
        &[],
    );
    assert_eq!(full.status.code(), Some(1));
    assert!(stdout_str(&full).contains("errline-0"));
    assert!(stdout_str(&full).contains("errline-139"));

    // Corrupt meta.json -> lint exits 1 with [ERROR]
    fs::write(item_dir.join("meta.json"), r#"{"name": "Broken", "tags": "not-array"}"#).unwrap();
    let lint_err = run_cli(&["lint", "probe-item", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(lint_err.status.code(), Some(1));
    assert!(stdout_str(&lint_err).contains("[ERROR] invalid meta.json"));

    // Checking an unloadable item prints lint hint and exits 2
    let check_broken = run_cli(&["check", "probe-item", "-w", ws_str], tmp.path(), &cfg, &[]);
    assert_eq!(check_broken.status.code(), Some(2));
    assert!(stderr_str(&check_broken).contains("settled lint probe-item"));
}
