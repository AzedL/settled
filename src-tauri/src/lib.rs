mod prefs;
mod watcher;

use prefs::{find_sample_workspace, load_prefs, record_workspace, save_prefs, AppPrefs};
use serde::Serialize;
use settled_core::{
    format_item_context, load_workspace, run_commands_parallel, CommandExecutionTarget,
    CommandResult, Platform, RunRegistry, WorkspaceSnapshot, DEFAULT_CONCURRENCY,
};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use watcher::WorkspaceWatcher;

const RUN_EVENT_NAME: &str = "settled://run-event";

/// Shared runtime state managed by the Tauri application.
#[derive(Default)]
pub struct AppState {
    registry: RunRegistry,
    active_workspace: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<WorkspaceWatcher>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialAppState {
    pub prefs: AppPrefs,
    pub sample_workspace_path: Option<String>,
    pub host_platform: Platform,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBatchResponse {
    pub run_id: String,
    pub results: Vec<CommandResult>,
}

#[tauri::command]
fn get_initial_state(app: AppHandle) -> InitialAppState {
    InitialAppState {
        prefs: load_prefs(&app),
        sample_workspace_path: find_sample_workspace(&app),
        host_platform: Platform::current(),
    }
}

#[tauri::command]
fn set_confirm_mutating_runs(confirm: bool, app: AppHandle) -> Result<AppPrefs, String> {
    let mut prefs = load_prefs(&app);
    prefs.confirm_mutating_runs = confirm;
    save_prefs(&app, &prefs)?;
    Ok(prefs)
}

#[tauri::command]
async fn open_workspace(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WorkspaceSnapshot, String> {
    let workspace_path = PathBuf::from(&path);
    let snapshot = load_workspace(&workspace_path).map_err(|e| e.to_string())?;

    {
        let mut active = state.active_workspace.lock().await;
        *active = Some(workspace_path.clone());
    }

    let new_watcher = WorkspaceWatcher::start(app.clone(), workspace_path).ok();
    {
        let mut guard = state.watcher.lock().await;
        *guard = new_watcher;
    }

    let _ = record_workspace(&app, &snapshot.root_path);
    Ok(snapshot)
}

#[tauri::command]
async fn reload_workspace(state: State<'_, AppState>) -> Result<Option<WorkspaceSnapshot>, String> {
    let maybe_path = state.active_workspace.lock().await.clone();
    match maybe_path {
        Some(path) => {
            let snapshot = load_workspace(&path).map_err(|e| e.to_string())?;
            Ok(Some(snapshot))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn run_commands(
    run_id: String,
    targets: Vec<CommandExecutionTarget>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RunBatchResponse, String> {
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

    Ok(RunBatchResponse { run_id, results })
}

#[tauri::command]
async fn cancel_command(command_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.registry.cancel_command(&command_id).await)
}

#[tauri::command]
async fn cancel_run(run_id: String, state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.registry.cancel_run(&run_id).await)
}

#[tauri::command]
async fn cancel_all_runs(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.registry.cancel_all().await)
}

#[tauri::command]
async fn build_ai_context(
    item_id: String,
    latest_results: Vec<CommandResult>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let workspace_path = state
        .active_workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "No active workspace is open".to_string())?;
    let snapshot = load_workspace(&workspace_path).map_err(|e| e.to_string())?;
    let item = snapshot
        .items
        .iter()
        .find(|i| i.id == item_id)
        .ok_or_else(|| format!("Item '{item_id}' not found"))?;

    let results_ref = if latest_results.is_empty() {
        None
    } else {
        Some(latest_results.as_slice())
    };
    Ok(format_item_context(item, results_ref, snapshot.host_platform))
}

#[tauri::command]
fn open_in_vscode(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let try_code_cmd = Command::new("cmd")
            .args(["/D", "/C", "code", &path])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();

        return try_code_cmd
            .map(|_| ())
            .map_err(|e| format!("Failed to launch VS Code ('code' CLI): {e}"));
    }

    #[cfg(target_os = "macos")]
    {
        if Command::new("code")
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        return Command::new("open")
            .args(["-a", "Visual Studio Code", &path])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to open VS Code: {e}"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("code")
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch VS Code ('code' CLI): {e}"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            set_confirm_mutating_runs,
            open_workspace,
            reload_workspace,
            run_commands,
            cancel_command,
            cancel_run,
            cancel_all_runs,
            build_ai_context,
            open_in_vscode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
