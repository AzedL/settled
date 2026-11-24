mod prefs;
mod watcher;

use prefs::{AppPrefs, load_prefs, record_workspace};
use serde::{Deserialize, Serialize};
use settled_core::{
    CommandExecutionTarget, CommandResult, DEFAULT_CONCURRENCY, OutputLine, Platform,
    ResolvedCommand, RunRegistry, RunStatus, ScriptGroup, ScriptRole, WorkspaceItem,
    WorkspaceSnapshot, format_item_context, load_workspace, run_commands_parallel,
};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, window::Color};
use tokio::sync::Mutex;
use watcher::WorkspaceWatcher;

const RUN_EVENT_NAME: &str = "settled://run-event";
const FALLBACK_WINDOW_SHOW_SECS: u64 = 10;

struct ActiveWorkspace {
    generation: u64,
    root_path: PathBuf,
    snapshot: WorkspaceSnapshot,
    watcher: Option<WorkspaceWatcher>,
}

/// Shared runtime state managed by the Tauri application.
#[derive(Default)]
pub struct AppState {
    registry: RunRegistry,
    workspace: Mutex<Option<ActiveWorkspace>>,
    open_seq: AtomicU64,
    snapshot_seq: AtomicU64,
    main_window_shown: Arc<AtomicBool>,
}

fn theme_background_color(resolved_theme: &str) -> Color {
    if resolved_theme == "dark" {
        Color(24, 25, 27, 255)
    } else {
        Color(243, 245, 242, 255)
    }
}

async fn load_workspace_blocking(path: PathBuf) -> Result<WorkspaceSnapshot, String> {
    tokio::task::spawn_blocking(move || load_workspace(&path))
        .await
        .map_err(|e| format!("Failed to join workspace loader task: {e}"))?
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialAppState {
    pub prefs: AppPrefs,
    pub host_platform: Platform,
}

/// Display-only command descriptor sent to the desktop frontend (runtime shell/encoding/resolved command stay in Rust).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCommand {
    pub index: usize,
    pub key: String,
    pub command_id: String,
    pub name: String,
    pub description: Option<String>,
    pub raw_run: String,
    pub platforms: Vec<Platform>,
    pub applicable: bool,
    pub fingerprint: String,
}

impl From<&ResolvedCommand> for DesktopCommand {
    fn from(cmd: &ResolvedCommand) -> Self {
        Self {
            index: cmd.index,
            key: cmd.key.clone(),
            command_id: cmd.command_id.clone(),
            name: cmd.name.clone(),
            description: cmd.description.clone(),
            raw_run: cmd.raw_run.clone(),
            platforms: cmd.platforms.clone(),
            applicable: cmd.applicable,
            fingerprint: cmd.fingerprint.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopScriptGroup {
    pub key: String,
    pub role: ScriptRole,
    pub commands: Vec<DesktopCommand>,
}

impl From<&ScriptGroup> for DesktopScriptGroup {
    fn from(group: &ScriptGroup) -> Self {
        Self {
            key: group.key.clone(),
            role: group.role,
            commands: group.commands.iter().map(DesktopCommand::from).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorkspaceItem {
    pub id: String,
    pub path: String,
    pub meta_path: String,
    pub readme_path: Option<String>,
    pub readme: String,
    pub raw_meta: String,
    pub name: String,
    pub description: Option<String>,
    pub create_at: Option<i64>,
    pub tags: Vec<String>,
    pub platforms: Vec<Platform>,
    pub applicable: bool,
    pub script_groups: Vec<DesktopScriptGroup>,
}

impl From<&WorkspaceItem> for DesktopWorkspaceItem {
    fn from(item: &WorkspaceItem) -> Self {
        Self {
            id: item.id.clone(),
            path: item.path.clone(),
            meta_path: item.meta_path.clone(),
            readme_path: item.readme_path.clone(),
            readme: item.readme.clone(),
            raw_meta: item.raw_meta.clone(),
            name: item.name.clone(),
            description: item.description.clone(),
            create_at: item.create_at,
            tags: item.tags.clone(),
            platforms: item.platforms.clone(),
            applicable: item.applicable,
            script_groups: item
                .script_groups
                .iter()
                .map(DesktopScriptGroup::from)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWorkspaceSnapshot {
    pub workspace_generation: u64,
    pub root_path: String,
    pub items_dir: String,
    pub items_dir_exists: bool,
    pub host_platform: Platform,
    pub items: Vec<DesktopWorkspaceItem>,
    pub all_tags: Vec<String>,
    pub scan_warnings: Vec<String>,
}

impl DesktopWorkspaceSnapshot {
    fn from_snapshot(snap: &WorkspaceSnapshot, workspace_generation: u64) -> Self {
        Self {
            workspace_generation,
            root_path: snap.root_path.clone(),
            items_dir: snap.items_dir.clone(),
            items_dir_exists: snap.items_dir_exists,
            host_platform: snap.host_platform,
            items: snap.items.iter().map(DesktopWorkspaceItem::from).collect(),
            all_tags: snap.all_tags.clone(),
            scan_warnings: snap.scan_warnings.clone(),
        }
    }
}

/// Frontend command selection intent resolved to concrete execution targets inside Rust.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSelector {
    pub workspace_root: String,
    pub workspace_generation: u64,
    pub item_id: String,
    pub group_key: String,
    pub command_index: usize,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCommandResult {
    pub run_id: String,
    pub command_id: String,
    pub item_id: String,
    pub group_key: String,
    pub command_index: usize,
    pub command_name: String,
    pub status: RunStatus,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub logs: Vec<OutputLine>,
    pub error: Option<String>,
}

impl From<CommandResult> for DesktopCommandResult {
    fn from(res: CommandResult) -> Self {
        Self {
            run_id: res.run_id,
            command_id: res.command_id,
            item_id: res.item_id,
            group_key: res.group_key,
            command_index: res.command_index,
            command_name: res.command_name,
            status: res.status,
            exit_code: res.exit_code,
            duration_ms: res.duration_ms,
            logs: res.logs,
            error: res.error,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBatchResponse {
    pub run_id: String,
    pub results: Vec<DesktopCommandResult>,
}

#[tauri::command]
fn get_initial_state(app: AppHandle) -> InitialAppState {
    InitialAppState {
        prefs: load_prefs(&app),
        host_platform: Platform::current(),
    }
}

#[tauri::command]
fn show_main_window(resolved_theme: String, app: AppHandle, state: State<'_, AppState>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_background_color(Some(theme_background_color(&resolved_theme)));
        if !state.main_window_shown.swap(true, Ordering::AcqRel) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn sync_window_theme(resolved_theme: String, app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_background_color(Some(theme_background_color(&resolved_theme)));
    }
}

#[tauri::command]
async fn open_workspace(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DesktopWorkspaceSnapshot, String> {
    let watcher_app = app.clone();
    let (dto, committed) = state
        .open_workspace_with_watcher(PathBuf::from(&path), move |watcher_path| {
            WorkspaceWatcher::start(watcher_app, watcher_path).ok()
        })
        .await?;

    if committed {
        let _ = record_workspace(&app, &dto.root_path);
    }
    Ok(dto)
}

#[tauri::command]
async fn reload_workspace(
    expected_generation: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Option<DesktopWorkspaceSnapshot>, String> {
    state.reload_active(expected_generation).await
}

#[tauri::command]
async fn run_commands(
    run_id: String,
    selectors: Vec<CommandSelector>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RunBatchResponse, String> {
    let targets = state.resolve_execution_targets(&selectors).await?;
    let registry = state.registry.clone();
    let app_handle = app.clone();
    let results = run_commands_parallel(
        run_id.clone(),
        targets,
        DEFAULT_CONCURRENCY,
        registry,
        move |event| {
            let _ = app_handle.emit(RUN_EVENT_NAME, &event);
        },
    )
    .await;

    Ok(RunBatchResponse {
        run_id,
        results: results
            .into_iter()
            .map(DesktopCommandResult::from)
            .collect(),
    })
}

#[tauri::command]
async fn cancel_run(run_id: String, state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.cancel_active_run(&run_id).await)
}

#[tauri::command]
async fn build_ai_context(item_id: String, state: State<'_, AppState>) -> Result<String, String> {
    state.build_context(&item_id).await
}

impl AppState {
    async fn open_workspace_with_watcher<F>(
        &self,
        workspace_path: PathBuf,
        start_watcher: F,
    ) -> Result<(DesktopWorkspaceSnapshot, bool), String>
    where
        F: FnOnce(PathBuf) -> Option<WorkspaceWatcher> + Send + 'static,
    {
        let my_open_seq = self.open_seq.fetch_add(1, Ordering::AcqRel) + 1;
        self.snapshot_seq.fetch_add(1, Ordering::AcqRel);
        let snapshot = load_workspace_blocking(workspace_path.clone()).await?;
        let dto = DesktopWorkspaceSnapshot::from_snapshot(&snapshot, my_open_seq);

        if self.open_seq.load(Ordering::Acquire) != my_open_seq {
            return Ok((dto, false));
        }

        let watcher_path = workspace_path.clone();
        let new_watcher = tokio::task::spawn_blocking(move || start_watcher(watcher_path))
            .await
            .ok()
            .flatten();

        let committed = {
            let mut guard = self.workspace.lock().await;
            if self.open_seq.load(Ordering::Acquire) == my_open_seq {
                self.snapshot_seq.fetch_add(1, Ordering::AcqRel);
                *guard = Some(ActiveWorkspace {
                    generation: my_open_seq,
                    root_path: workspace_path,
                    snapshot,
                    watcher: new_watcher,
                });
                true
            } else {
                false
            }
        };

        Ok((dto, committed))
    }

    async fn reload_active(
        &self,
        expected_generation: Option<u64>,
    ) -> Result<Option<DesktopWorkspaceSnapshot>, String> {
        let (my_open_seq, my_snap_seq, root_path, generation) = {
            let mut guard = self.workspace.lock().await;
            let Some(active) = guard.as_mut() else {
                return Ok(None);
            };
            if let Some(expected_gen) = expected_generation
                && active.generation != expected_gen
            {
                return Ok(None);
            }
            if let Some(watcher) = active.watcher.as_mut() {
                watcher.sync_items_watch();
            }
            (
                self.open_seq.load(Ordering::Acquire),
                self.snapshot_seq.fetch_add(1, Ordering::AcqRel) + 1,
                active.root_path.clone(),
                active.generation,
            )
        };

        let snapshot = load_workspace_blocking(root_path.clone()).await?;
        let dto = DesktopWorkspaceSnapshot::from_snapshot(&snapshot, generation);

        let mut guard = self.workspace.lock().await;
        if self.open_seq.load(Ordering::Acquire) != my_open_seq
            || self.snapshot_seq.load(Ordering::Acquire) != my_snap_seq
        {
            return Ok(None);
        }
        if let Some(active) = guard.as_mut()
            && active.generation == generation
            && active.root_path == root_path
        {
            active.snapshot = snapshot;
            return Ok(Some(dto));
        }
        Ok(None)
    }

    async fn resolve_execution_targets(
        &self,
        selectors: &[CommandSelector],
    ) -> Result<Vec<CommandExecutionTarget>, String> {
        let guard = self.workspace.lock().await;
        let active = guard
            .as_ref()
            .ok_or_else(|| "No active workspace is open".to_string())?;

        let mut targets = Vec::with_capacity(selectors.len());
        for sel in selectors {
            if sel.workspace_generation != active.generation
                || sel.workspace_root != active.snapshot.root_path
            {
                return Err(
                    "Workspace changed since selection; command execution was rejected".to_string(),
                );
            }
            let item = active
                .snapshot
                .items
                .iter()
                .find(|i| i.id == sel.item_id)
                .ok_or_else(|| format!("Item '{}' not found in active workspace", sel.item_id))?;
            if !item.applicable {
                return Err(format!(
                    "Item '{}' is not applicable on {}",
                    sel.item_id, active.snapshot.host_platform
                ));
            }
            let group = item
                .script_groups
                .iter()
                .find(|g| g.key == sel.group_key)
                .ok_or_else(|| {
                    format!(
                        "Script group '{}' not found on item '{}'",
                        sel.group_key, sel.item_id
                    )
                })?;
            let cmd = group.commands.get(sel.command_index).ok_or_else(|| {
                format!(
                    "Command index {} out of range for '{}.{}'",
                    sel.command_index, sel.item_id, sel.group_key
                )
            })?;
            if cmd.fingerprint != sel.fingerprint {
                return Err(format!(
                    "Command '{}.{}[{}]' changed since selection; please re-confirm",
                    sel.item_id, sel.group_key, sel.command_index
                ));
            }
            if !cmd.applicable {
                return Err(format!(
                    "Command '{}.{}[{}]' is not applicable on {}",
                    sel.item_id, sel.group_key, sel.command_index, active.snapshot.host_platform
                ));
            }
            targets.push(CommandExecutionTarget::from_resolved(item, cmd));
        }

        Ok(targets)
    }

    async fn cancel_active_run(&self, run_id: &str) -> usize {
        self.registry.cancel_run(run_id).await
    }

    async fn build_context(&self, item_id: &str) -> Result<String, String> {
        let guard = self.workspace.lock().await;
        let active = guard
            .as_ref()
            .ok_or_else(|| "No active workspace is open".to_string())?;
        let item = active
            .snapshot
            .items
            .iter()
            .find(|i| i.id == item_id)
            .ok_or_else(|| format!("Item '{item_id}' not found"))?;

        Ok(format_item_context(
            item,
            &active.snapshot.root_path,
            active.snapshot.host_platform,
        ))
    }
}

#[cfg(windows)]
fn resolve_vscode_windows_executable() -> Result<PathBuf, String> {
    let found = which::which("code")
        .or_else(|_| which::which("code.cmd"))
        .map_err(|_| "VS Code CLI ('code') was not found on PATH".to_string())?;

    // Standard VS Code installs expose `.../bin/code.cmd` alongside `../Code.exe`.
    // Spawning `Code.exe` directly avoids `cmd.exe` metacharacter parsing on paths containing `&` etc.
    let is_batch = found
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"));
    if is_batch
        && let Some(bin_dir) = found.parent()
        && let Some(install_root) = bin_dir.parent()
    {
        let code_exe = install_root.join("Code.exe");
        if code_exe.is_file() {
            return Ok(code_exe);
        }
    }

    Ok(found)
}

#[tauri::command]
fn open_in_vscode(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let exe = resolve_vscode_windows_executable()?;
        Command::new(&exe)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch VS Code ('{}'): {e}", exe.display()))
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(code_bin) = which::which("code")
            && Command::new(&code_bin)
                .arg(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .is_ok()
        {
            return Ok(());
        }
        Command::new("open")
            .args(["-a", "Visual Studio Code", &path])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open VS Code: {e}"))
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let code_bin = which::which("code")
            .map_err(|_| "VS Code CLI ('code') was not found on PATH".to_string())?;
        Command::new(&code_bin)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch VS Code ('{}'): {e}", code_bin.display()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let shown_flag = Arc::clone(&app.state::<AppState>().main_window_shown);
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(FALLBACK_WINDOW_SHOW_SECS)).await;
                if !shown_flag.swap(true, Ordering::AcqRel)
                    && let Some(window) = app_handle.get_webview_window("main")
                {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            show_main_window,
            sync_window_theme,
            open_workspace,
            reload_workspace,
            run_commands,
            cancel_run,
            build_ai_context,
            open_in_vscode,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let registry = app_handle.state::<AppState>().registry.clone();
            tauri::async_runtime::block_on(registry.cancel_all());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use settled_core::ITEMS_DIR_NAME;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn resolves_theme_background_colors_consistently() {
        assert_eq!(theme_background_color("dark"), Color(24, 25, 27, 255));
        assert_eq!(theme_background_color("light"), Color(243, 245, 242, 255));
    }

    #[tokio::test]
    async fn load_workspace_blocking_reads_valid_workspace_and_rejects_missing_dir() {
        let tmp = TempDir::new().unwrap();
        let item_dir = tmp.path().join(ITEMS_DIR_NAME).join("git-config");
        fs::create_dir_all(&item_dir).unwrap();
        fs::write(item_dir.join("meta.json"), r#"{"name":"Git"}"#).unwrap();

        let snap = load_workspace_blocking(tmp.path().to_path_buf())
            .await
            .unwrap();
        assert_eq!(snap.items.len(), 1);
        assert_eq!(snap.items[0].id, "git-config");

        let missing = tmp.path().join("missing-ws");
        assert!(load_workspace_blocking(missing).await.is_err());
    }

    #[tokio::test]
    async fn app_state_reloads_resolves_selectors_builds_context_and_cancels_cleanly() {
        let state = AppState::default();
        assert!(state.reload_active(None).await.unwrap().is_none());
        assert!(state.build_context("git-config").await.is_err());
        assert!(state.resolve_execution_targets(&[]).await.is_err());
        assert_eq!(state.cancel_active_run("none").await, 0);

        let tmp = TempDir::new().unwrap();
        let other_os = match Platform::current() {
            Platform::Windows => "macos",
            Platform::Macos | Platform::Linux => "windows",
        };
        let item_dir = tmp.path().join(ITEMS_DIR_NAME).join("git-config");
        fs::create_dir_all(&item_dir).unwrap();
        fs::write(
            item_dir.join("meta.json"),
            format!(
                r#"{{
                    "name": "Git Config",
                    "scripts": {{
                        "check": [
                            "git --version",
                            {{ "name": "Other OS only", "run": "echo other", "platforms": ["{other_os}"] }}
                        ]
                    }}
                }}"#
            ),
        )
        .unwrap();

        let (opened, committed) = state
            .open_workspace_with_watcher(tmp.path().to_path_buf(), |p| {
                watcher::WorkspaceWatcher::start_with_callback(p, |_| {}).ok()
            })
            .await
            .unwrap();
        assert!(committed);
        assert_eq!(opened.workspace_generation, 1);

        // Reload with mismatched expected generation is ignored cleanly
        assert!(
            state
                .reload_active(Some(opened.workspace_generation + 1))
                .await
                .unwrap()
                .is_none()
        );

        let reloaded = state
            .reload_active(Some(opened.workspace_generation))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reloaded.workspace_generation, opened.workspace_generation);
        assert_eq!(reloaded.items.len(), 1);
        let cmd0_fp = reloaded.items[0].script_groups[0].commands[0]
            .fingerprint
            .clone();
        let cmd1_fp = reloaded.items[0].script_groups[0].commands[1]
            .fingerprint
            .clone();
        assert!(!cmd0_fp.is_empty());

        // Valid applicable selector with matching workspace identity and fingerprint resolves cleanly inside Rust
        let resolved = state
            .resolve_execution_targets(&[CommandSelector {
                workspace_root: reloaded.root_path.clone(),
                workspace_generation: reloaded.workspace_generation,
                item_id: "git-config".to_string(),
                group_key: "check".to_string(),
                command_index: 0,
                fingerprint: cmd0_fp,
            }])
            .await
            .unwrap();
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].command_id, "git-config::check::0");
        assert_eq!(resolved[0].resolved_run, "git --version");

        // Stale/mismatched fingerprint is rejected to prevent TOCTOU execution of another command
        assert!(
            state
                .resolve_execution_targets(&[CommandSelector {
                    workspace_root: reloaded.root_path.clone(),
                    workspace_generation: reloaded.workspace_generation,
                    item_id: "git-config".to_string(),
                    group_key: "check".to_string(),
                    command_index: 0,
                    fingerprint: "stale-fingerprint".to_string(),
                }])
                .await
                .is_err()
        );

        // Inapplicable platform command and out-of-range index are rejected in Rust
        assert!(
            state
                .resolve_execution_targets(&[CommandSelector {
                    workspace_root: reloaded.root_path.clone(),
                    workspace_generation: reloaded.workspace_generation,
                    item_id: "git-config".to_string(),
                    group_key: "check".to_string(),
                    command_index: 1,
                    fingerprint: cmd1_fp,
                }])
                .await
                .is_err()
        );
        assert!(
            state
                .resolve_execution_targets(&[CommandSelector {
                    workspace_root: reloaded.root_path.clone(),
                    workspace_generation: reloaded.workspace_generation,
                    item_id: "git-config".to_string(),
                    group_key: "check".to_string(),
                    command_index: 99,
                    fingerprint: "unused".to_string(),
                }])
                .await
                .is_err()
        );

        let md = state.build_context("git-config").await.unwrap();
        assert!(md.contains("Git Config (`git-config`)"));
        assert!(md.contains("- **Workspace**:"));
        assert!(md.contains("- **Scripts**: `check`"));
        assert!(state.build_context("missing").await.is_err());
    }

    #[tokio::test]
    async fn rejects_cross_workspace_and_superseded_selectors_even_with_identical_fingerprint() {
        let state = AppState::default();
        let ws_a = TempDir::new().unwrap();
        let ws_b = TempDir::new().unwrap();

        let shared_meta = r#"{
            "name": "Demo Item",
            "scripts": {
                "fix": "node @script/fix.mjs"
            }
        }"#;

        for (ws, marker) in [(&ws_a, "WORKSPACE_A"), (&ws_b, "WORKSPACE_B")] {
            let item_dir = ws.path().join(ITEMS_DIR_NAME).join("demo");
            fs::create_dir_all(item_dir.join("scripts")).unwrap();
            fs::write(item_dir.join("meta.json"), shared_meta).unwrap();
            fs::write(
                item_dir.join("scripts").join("fix.mjs"),
                format!("console.log('{marker}');\n"),
            )
            .unwrap();
        }

        let (snap_a, committed_a) = state
            .open_workspace_with_watcher(ws_a.path().to_path_buf(), |_| None)
            .await
            .unwrap();
        assert!(committed_a);

        let cmd_a = &snap_a.items[0].script_groups[0].commands[0];
        let selector_a = CommandSelector {
            workspace_root: snap_a.root_path.clone(),
            workspace_generation: snap_a.workspace_generation,
            item_id: "demo".to_string(),
            group_key: "fix".to_string(),
            command_index: 0,
            fingerprint: cmd_a.fingerprint.clone(),
        };

        // Switch active workspace from A to B
        let (snap_b, committed_b) = state
            .open_workspace_with_watcher(ws_b.path().to_path_buf(), |_| None)
            .await
            .unwrap();
        assert!(committed_b);
        assert_ne!(snap_a.workspace_generation, snap_b.workspace_generation);

        let cmd_b = &snap_b.items[0].script_groups[0].commands[0];
        // Precondition: both workspaces produce identical command fingerprints despite different @script contents
        assert_eq!(cmd_a.fingerprint, cmd_b.fingerprint);

        // Stale selector from A MUST be rejected while B is active
        let err = state
            .resolve_execution_targets(std::slice::from_ref(&selector_a))
            .await
            .unwrap_err();
        assert!(err.contains("Workspace changed"));

        // Mismatched workspace_root with B's generation is also rejected
        assert!(
            state
                .resolve_execution_targets(&[CommandSelector {
                    workspace_root: snap_a.root_path.clone(),
                    workspace_generation: snap_b.workspace_generation,
                    item_id: "demo".to_string(),
                    group_key: "fix".to_string(),
                    command_index: 0,
                    fingerprint: cmd_b.fingerprint.clone(),
                }])
                .await
                .is_err()
        );

        // Selector created for B resolves exclusively to B's item directory and script
        let resolved_b = state
            .resolve_execution_targets(&[CommandSelector {
                workspace_root: snap_b.root_path.clone(),
                workspace_generation: snap_b.workspace_generation,
                item_id: "demo".to_string(),
                group_key: "fix".to_string(),
                command_index: 0,
                fingerprint: cmd_b.fingerprint.clone(),
            }])
            .await
            .unwrap();
        assert_eq!(resolved_b.len(), 1);
        let script_body =
            fs::read_to_string(PathBuf::from(&resolved_b[0].item_dir).join("scripts/fix.mjs"))
                .unwrap();
        assert!(script_body.contains("WORKSPACE_B"));
        assert!(!script_body.contains("WORKSPACE_A"));

        // Same-workspace hot-reload preserves workspace_generation and supports command reordering
        let b_item_dir = ws_b.path().join(ITEMS_DIR_NAME).join("demo");
        fs::write(
            b_item_dir.join("meta.json"),
            r#"{
                "name": "Demo Item",
                "scripts": {
                    "fix": ["echo prep", "node @script/fix.mjs"]
                }
            }"#,
        )
        .unwrap();

        let reloaded_b = state
            .reload_active(Some(snap_b.workspace_generation))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reloaded_b.workspace_generation, snap_b.workspace_generation);

        // Old index 0 with original fingerprint is rejected; shifted index 1 with same generation succeeds
        assert!(
            state
                .resolve_execution_targets(&[CommandSelector {
                    workspace_root: snap_b.root_path.clone(),
                    workspace_generation: snap_b.workspace_generation,
                    item_id: "demo".to_string(),
                    group_key: "fix".to_string(),
                    command_index: 0,
                    fingerprint: cmd_b.fingerprint.clone(),
                }])
                .await
                .is_err()
        );
        let shifted_b = state
            .resolve_execution_targets(&[CommandSelector {
                workspace_root: snap_b.root_path.clone(),
                workspace_generation: snap_b.workspace_generation,
                item_id: "demo".to_string(),
                group_key: "fix".to_string(),
                command_index: 1,
                fingerprint: cmd_b.fingerprint.clone(),
            }])
            .await
            .unwrap();
        assert_eq!(shifted_b[0].command_id, "demo::fix::1");

        // Re-opening A creates a new generation; the old selector from A's previous session remains rejected
        let (reopened_a, committed_a2) = state
            .open_workspace_with_watcher(ws_a.path().to_path_buf(), |_| None)
            .await
            .unwrap();
        assert!(committed_a2);
        assert!(reopened_a.workspace_generation > snap_b.workspace_generation);
        assert!(
            state
                .resolve_execution_targets(&[selector_a])
                .await
                .is_err()
        );
    }
}
