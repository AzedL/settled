use crate::model::{
    CommandExecutionTarget, CommandResult, LogStream, OutputLine, Platform, RunEvent, RunStatus,
};
use encoding_rs::Encoding;
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex, Notify, Semaphore};
use tokio::task::JoinSet;

const MAX_RETAINED_LINES: usize = 5000;
const LINE_BUFFER_LIMIT_BYTES: usize = 32 * 1024;
pub const DEFAULT_CONCURRENCY: usize = 6;

/// Tracks active runs and child PIDs so callers can cancel a single command or a whole run batch.
#[derive(Debug, Default, Clone)]
pub struct RunRegistry {
    inner: Arc<Mutex<RegistryState>>,
}

#[derive(Debug, Default)]
struct RegistryState {
    commands: HashMap<(String, String), ActiveCommandHandle>,
    canceled_runs: HashSet<String>,
}

#[derive(Debug, Clone)]
struct ActiveCommandHandle {
    pid: Option<u32>,
    canceled: bool,
    notify: Arc<Notify>,
}

async fn terminate_targets(targets: Vec<(Option<u32>, Arc<Notify>)>) -> usize {
    let count = targets.len();
    let mut kill_set = JoinSet::new();
    for (pid, notify) in targets {
        notify.notify_waiters();
        if let Some(pid) = pid {
            kill_set.spawn(terminate_process_tree(pid));
        }
    }
    while kill_set.join_next().await.is_some() {}
    count
}

impl RunRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    async fn register(&self, run_id: &str, command_id: &str) -> Arc<Notify> {
        let notify = Arc::new(Notify::new());
        let mut guard = self.inner.lock().await;
        let canceled = guard.canceled_runs.contains(run_id);
        guard.commands.insert(
            (run_id.to_string(), command_id.to_string()),
            ActiveCommandHandle {
                pid: None,
                canceled,
                notify: notify.clone(),
            },
        );
        notify
    }

    async fn attach_pid(&self, run_id: &str, command_id: &str, pid: u32) -> bool {
        let mut guard = self.inner.lock().await;
        if let Some(handle) = guard
            .commands
            .get_mut(&(run_id.to_string(), command_id.to_string()))
        {
            handle.pid = Some(pid);
            handle.canceled
        } else {
            false
        }
    }

    async fn is_canceled(&self, run_id: &str, command_id: &str) -> bool {
        let guard = self.inner.lock().await;
        guard
            .commands
            .get(&(run_id.to_string(), command_id.to_string()))
            .is_some_and(|h| h.canceled)
    }

    async fn unregister(&self, run_id: &str, command_id: &str) {
        let mut guard = self.inner.lock().await;
        guard
            .commands
            .remove(&(run_id.to_string(), command_id.to_string()));
    }

    async fn clear_canceled_run(&self, run_id: &str) {
        let mut guard = self.inner.lock().await;
        guard.canceled_runs.remove(run_id);
    }

    /// Cancels any active runs of a single command by `command_id` and terminates their process trees.
    pub async fn cancel_command(&self, command_id: &str) -> bool {
        let targets: Vec<(Option<u32>, Arc<Notify>)> = {
            let mut guard = self.inner.lock().await;
            guard
                .commands
                .iter_mut()
                .filter(|((_, cid), _)| cid == command_id)
                .map(|(_, handle)| {
                    handle.canceled = true;
                    (handle.pid, handle.notify.clone())
                })
                .collect()
        };

        terminate_targets(targets).await > 0
    }

    /// Cancels every running command associated with `run_id`, plus any queued tasks for that batch.
    pub async fn cancel_run(&self, run_id: &str) -> usize {
        let targets: Vec<(Option<u32>, Arc<Notify>)> = {
            let mut guard = self.inner.lock().await;
            guard.canceled_runs.insert(run_id.to_string());
            guard
                .commands
                .iter_mut()
                .filter(|((rid, _), _)| rid == run_id)
                .map(|(_, handle)| {
                    handle.canceled = true;
                    (handle.pid, handle.notify.clone())
                })
                .collect()
        };

        terminate_targets(targets).await
    }

    /// Cancels all currently running commands across all runs.
    pub async fn cancel_all(&self) -> usize {
        let targets: Vec<(Option<u32>, Arc<Notify>)> = {
            let mut guard = self.inner.lock().await;
            let active_run_ids: Vec<String> = guard
                .commands
                .keys()
                .map(|(rid, _)| rid.clone())
                .collect();
            for run_id in active_run_ids {
                guard.canceled_runs.insert(run_id);
            }
            guard
                .commands
                .values_mut()
                .map(|handle| {
                    handle.canceled = true;
                    (handle.pid, handle.notify.clone())
                })
                .collect()
        };

        terminate_targets(targets).await
    }
}

/// Executes a batch of independent commands concurrently up to `max_concurrency`.
///
/// Sibling commands never abort when one command fails.
pub async fn run_commands_parallel<F>(
    run_id: String,
    targets: Vec<CommandExecutionTarget>,
    max_concurrency: usize,
    registry: RunRegistry,
    on_event: F,
) -> Vec<CommandResult>
where
    F: Fn(RunEvent) + Send + Sync + 'static,
{
    let concurrency = max_concurrency.max(1);
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let on_event = Arc::new(on_event);
    let mut join_set = JoinSet::new();

    for (order, target) in targets.into_iter().enumerate() {
        let permit_pool = semaphore.clone();
        let reg = registry.clone();
        let cb = on_event.clone();
        let rid = run_id.clone();

        join_set.spawn(async move {
            let _permit = permit_pool.acquire_owned().await.ok();
            let result = execute_single_command(&rid, &target, &reg, cb.as_ref()).await;
            (order, result)
        });
    }

    let mut ordered = Vec::new();
    while let Some(joined) = join_set.join_next().await {
        if let Ok(item) = joined {
            ordered.push(item);
        }
    }
    registry.clear_canceled_run(&run_id).await;
    ordered.sort_by_key(|(order, _)| *order);
    ordered.into_iter().map(|(_, res)| res).collect()
}

/// Executes one resolved command with live line streaming, encoding decoding, and cancellation support.
pub async fn execute_single_command<F>(
    run_id: &str,
    target: &CommandExecutionTarget,
    registry: &RunRegistry,
    on_event: &F,
) -> CommandResult
where
    F: Fn(RunEvent) + Send + Sync,
{
    let start = Instant::now();
    let cancel_notify = registry.register(run_id, &target.command_id).await;

    on_event(RunEvent::Started {
        run_id: run_id.to_string(),
        command_id: target.command_id.clone(),
        item_id: target.item_id.clone(),
        group_key: target.group_key.clone(),
        command_index: target.command_index,
    });

    if registry.is_canceled(run_id, &target.command_id).await {
        registry.unregister(run_id, &target.command_id).await;
        return finish_canceled(
            run_id,
            target,
            start.elapsed().as_millis() as u64,
            Vec::new(),
            on_event,
        );
    }

    let mut cmd = build_shell_command(target);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            registry.unregister(run_id, &target.command_id).await;
            let msg = format!("Failed to spawn '{}': {err}", target.shell);
            let duration_ms = start.elapsed().as_millis() as u64;
            on_event(RunEvent::Output {
                run_id: run_id.to_string(),
                command_id: target.command_id.clone(),
                stream: LogStream::System,
                text: msg.clone(),
            });
            on_event(RunEvent::Finished {
                run_id: run_id.to_string(),
                command_id: target.command_id.clone(),
                item_id: target.item_id.clone(),
                group_key: target.group_key.clone(),
                command_index: target.command_index,
                status: RunStatus::Fail,
                exit_code: None,
                duration_ms,
                error: Some(msg.clone()),
            });
            return CommandResult {
                run_id: run_id.to_string(),
                command_id: target.command_id.clone(),
                item_id: target.item_id.clone(),
                group_key: target.group_key.clone(),
                command_index: target.command_index,
                command_name: target.command_name.clone(),
                resolved_run: target.resolved_run.clone(),
                status: RunStatus::Fail,
                exit_code: None,
                duration_ms,
                logs: vec![OutputLine {
                    stream: LogStream::System,
                    text: msg.clone(),
                }],
                error: Some(msg),
            };
        }
    };

    if let Some(pid) = child.id() {
        let already_canceled = registry.attach_pid(run_id, &target.command_id, pid).await;
        if already_canceled {
            terminate_process_tree(pid).await;
        }
    }

    let encoding = resolve_encoding(&target.encoding);
    let (line_tx, mut line_rx) = mpsc::unbounded_channel::<OutputLine>();

    let stdout_task = child
        .stdout
        .take()
        .map(|stdout| tokio::spawn(pump_stream(stdout, LogStream::Stdout, encoding, line_tx.clone())));
    let stderr_task = child
        .stderr
        .take()
        .map(|stderr| tokio::spawn(pump_stream(stderr, LogStream::Stderr, encoding, line_tx.clone())));
    drop(line_tx);

    let mut collected_logs = Vec::new();
    let mut truncated = false;
    while let Some(line) = line_rx.recv().await {
        if collected_logs.len() < MAX_RETAINED_LINES {
            collected_logs.push(line.clone());
        } else if !truncated {
            truncated = true;
            let notice = OutputLine {
                stream: LogStream::System,
                text: format!("[output truncated after {MAX_RETAINED_LINES} lines]"),
            };
            collected_logs.push(notice.clone());
            on_event(RunEvent::Output {
                run_id: run_id.to_string(),
                command_id: target.command_id.clone(),
                stream: notice.stream,
                text: notice.text,
            });
            continue;
        }

        if !truncated {
            on_event(RunEvent::Output {
                run_id: run_id.to_string(),
                command_id: target.command_id.clone(),
                stream: line.stream,
                text: line.text,
            });
        }
    }

    if let Some(fut) = stdout_task {
        let _ = fut.await;
    }
    if let Some(fut) = stderr_task {
        let _ = fut.await;
    }

    let wait_outcome = wait_with_cancel(&mut child, &cancel_notify).await;
    let was_canceled = registry.is_canceled(run_id, &target.command_id).await;
    registry.unregister(run_id, &target.command_id).await;

    let duration_ms = start.elapsed().as_millis() as u64;
    if was_canceled {
        return finish_canceled(run_id, target, duration_ms, collected_logs, on_event);
    }

    let (status, exit_code, error) = match wait_outcome {
        Ok(exit) => {
            let code = exit.code();
            let status = if exit.success() {
                RunStatus::Pass
            } else {
                RunStatus::Fail
            };
            (status, code, None)
        }
        Err(err) => (
            RunStatus::Fail,
            None,
            Some(format!("Process wait error: {err}")),
        ),
    };

    on_event(RunEvent::Finished {
        run_id: run_id.to_string(),
        command_id: target.command_id.clone(),
        item_id: target.item_id.clone(),
        group_key: target.group_key.clone(),
        command_index: target.command_index,
        status,
        exit_code,
        duration_ms,
        error: error.clone(),
    });

    CommandResult {
        run_id: run_id.to_string(),
        command_id: target.command_id.clone(),
        item_id: target.item_id.clone(),
        group_key: target.group_key.clone(),
        command_index: target.command_index,
        command_name: target.command_name.clone(),
        resolved_run: target.resolved_run.clone(),
        status,
        exit_code,
        duration_ms,
        logs: collected_logs,
        error,
    }
}

async fn wait_with_cancel(
    child: &mut Child,
    cancel_notify: &Notify,
) -> std::io::Result<std::process::ExitStatus> {
    tokio::select! {
        status = child.wait() => status,
        _ = cancel_notify.notified() => {
            if let Some(pid) = child.id() {
                terminate_process_tree(pid).await;
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "Canceled"))
        }
    }
}

fn finish_canceled<F>(
    run_id: &str,
    target: &CommandExecutionTarget,
    duration_ms: u64,
    logs: Vec<OutputLine>,
    on_event: &F,
) -> CommandResult
where
    F: Fn(RunEvent) + Send + Sync,
{
    on_event(RunEvent::Finished {
        run_id: run_id.to_string(),
        command_id: target.command_id.clone(),
        item_id: target.item_id.clone(),
        group_key: target.group_key.clone(),
        command_index: target.command_index,
        status: RunStatus::Canceled,
        exit_code: None,
        duration_ms,
        error: None,
    });

    CommandResult {
        run_id: run_id.to_string(),
        command_id: target.command_id.clone(),
        item_id: target.item_id.clone(),
        group_key: target.group_key.clone(),
        command_index: target.command_index,
        command_name: target.command_name.clone(),
        resolved_run: target.resolved_run.clone(),
        status: RunStatus::Canceled,
        exit_code: None,
        duration_ms,
        logs,
        error: None,
    }
}

async fn pump_stream<R>(
    mut reader: R,
    stream: LogStream,
    encoding: &'static Encoding,
    tx: mpsc::UnboundedSender<OutputLine>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    let mut buf = [0u8; 4096];
    let mut pending: Vec<u8> = Vec::new();

    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                drain_lines(&mut pending, stream, encoding, &tx, false);
                if pending.len() >= LINE_BUFFER_LIMIT_BYTES {
                    drain_lines(&mut pending, stream, encoding, &tx, true);
                }
            }
            Err(_) => break,
        }
    }

    drain_lines(&mut pending, stream, encoding, &tx, true);
}

fn drain_lines(
    pending: &mut Vec<u8>,
    stream: LogStream,
    encoding: &'static Encoding,
    tx: &mpsc::UnboundedSender<OutputLine>,
    flush_remainder: bool,
) {
    while let Some(pos) = pending.iter().position(|&b| b == b'\n') {
        let mut line_bytes: Vec<u8> = pending.drain(..=pos).collect();
        if line_bytes.ends_with(b"\n") {
            line_bytes.pop();
        }
        if line_bytes.ends_with(b"\r") {
            line_bytes.pop();
        }
        let (decoded, _, _) = encoding.decode(&line_bytes);
        let _ = tx.send(OutputLine {
            stream,
            text: decoded.into_owned(),
        });
    }

    if flush_remainder && !pending.is_empty() {
        let mut rem = std::mem::take(pending);
        if rem.ends_with(b"\r") {
            rem.pop();
        }
        let (decoded, _, _) = encoding.decode(&rem);
        let _ = tx.send(OutputLine {
            stream,
            text: decoded.into_owned(),
        });
    }
}

/// Resolves an encoding label (e.g. `utf-8`, `gbk`) with `UTF-8` as the safe fallback.
pub fn resolve_encoding(label: &str) -> &'static Encoding {
    Encoding::for_label(label.trim().as_bytes()).unwrap_or(encoding_rs::UTF_8)
}

fn is_utf8_label(label: &str) -> bool {
    let lower = label.trim().to_ascii_lowercase();
    lower == "utf-8" || lower == "utf8" || lower.is_empty()
}

fn build_shell_command(target: &CommandExecutionTarget) -> Command {
    let shell_lower = target
        .shell
        .trim()
        .trim_end_matches(".exe")
        .to_ascii_lowercase();
    let use_utf8 = is_utf8_label(&target.encoding);

    let mut cmd = match shell_lower.as_str() {
        "pwsh" | "powershell" => {
            let mut c = Command::new(target.shell.trim());
            let script = if use_utf8 {
                format!(
                    "[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n{}",
                    target.resolved_run
                )
            } else {
                target.resolved_run.clone()
            };
            c.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
            c
        }
        "cmd" => {
            let mut c = Command::new("cmd");
            let script = if use_utf8 {
                format!("chcp 65001 >nul & {}", target.resolved_run)
            } else {
                target.resolved_run.clone()
            };
            c.args(["/D", "/S", "/C", &script]);
            c
        }
        other => {
            let exe = if other.is_empty() {
                "sh"
            } else {
                target.shell.trim()
            };
            let mut c = Command::new(exe);
            c.args(["-c", &target.resolved_run]);
            c
        }
    };

    cmd.current_dir(&target.item_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("SETTLED_ITEM_ID", &target.item_id)
        .env("SETTLED_ITEM_DIR", &target.item_dir)
        .env("SETTLED_PLATFORM", Platform::current().as_str());

    if use_utf8 {
        cmd.env("PYTHONIOENCODING", "utf-8");
    }

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(unix)]
    {
        cmd.process_group(0);
    }

    cmd
}

async fn terminate_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .await;
    }

    #[cfg(unix)]
    {
        let pgid_arg = format!("-{pid}");
        let _ = Command::new("kill")
            .args(["-TERM", &pgid_arg])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::detect_default_shell;
    use tempfile::TempDir;

    fn make_target(dir: &std::path::Path, id: &str, run: &str) -> CommandExecutionTarget {
        CommandExecutionTarget {
            item_id: "test-item".to_string(),
            item_dir: dir.to_string_lossy().into_owned(),
            group_key: "check".to_string(),
            command_index: 0,
            command_id: id.to_string(),
            command_name: id.to_string(),
            resolved_run: run.to_string(),
            shell: detect_default_shell(),
            encoding: "utf-8".to_string(),
        }
    }

    #[tokio::test]
    async fn executes_parallel_commands_independently_without_halting_on_failure() {
        let tmp = TempDir::new().unwrap();
        let t_pass = make_target(tmp.path(), "c1", "echo hello_settled");
        let t_fail = make_target(tmp.path(), "c2", "exit 3");
        let t_after = make_target(tmp.path(), "c3", "echo still_runs");

        let registry = RunRegistry::new();
        let results = run_commands_parallel(
            "run-1".to_string(),
            vec![t_pass, t_fail, t_after],
            DEFAULT_CONCURRENCY,
            registry,
            |_ev| {},
        )
        .await;

        assert_eq!(results.len(), 3);
        assert_eq!(results[0].status, RunStatus::Pass);
        assert_eq!(results[0].exit_code, Some(0));
        assert!(results[0].logs.iter().any(|l| l.text.contains("hello_settled")));

        assert_eq!(results[1].status, RunStatus::Fail);
        assert_eq!(results[1].exit_code, Some(3));

        assert_eq!(results[2].status, RunStatus::Pass);
        assert!(results[2].logs.iter().any(|l| l.text.contains("still_runs")));
    }

    #[tokio::test]
    async fn cancels_long_running_command_cleanly() {
        let tmp = TempDir::new().unwrap();
        let sleep_cmd = match Platform::current() {
            Platform::Windows => "Start-Sleep -Seconds 30",
            Platform::Macos | Platform::Linux => "sleep 30",
        };
        let target = make_target(tmp.path(), "slow-cmd", sleep_cmd);
        let registry = RunRegistry::new();
        let reg_clone = registry.clone();

        let handle = tokio::spawn(async move {
            run_commands_parallel(
                "run-cancel".to_string(),
                vec![target],
                1,
                reg_clone,
                |_ev| {},
            )
            .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        assert!(registry.cancel_command("slow-cmd").await);

        let results = handle.await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, RunStatus::Canceled);
    }

    #[tokio::test]
    async fn cancels_both_running_and_queued_commands_in_run_batch() {
        let tmp = TempDir::new().unwrap();
        let sleep_cmd = match Platform::current() {
            Platform::Windows => "Start-Sleep -Seconds 30",
            Platform::Macos | Platform::Linux => "sleep 30",
        };
        let first = make_target(tmp.path(), "batch-1", sleep_cmd);
        let second = make_target(tmp.path(), "batch-2", "echo should_not_pass");
        let registry = RunRegistry::new();
        let reg_clone = registry.clone();

        let handle = tokio::spawn(async move {
            run_commands_parallel(
                "run-batch-cancel".to_string(),
                vec![first, second],
                1,
                reg_clone,
                |_ev| {},
            )
            .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        assert_eq!(registry.cancel_run("run-batch-cancel").await, 1);

        let results = handle.await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].status, RunStatus::Canceled);
        assert_eq!(results[1].status, RunStatus::Canceled);
    }

    #[tokio::test]
    async fn canceling_previous_run_does_not_affect_overlapping_rerun() {
        let tmp = TempDir::new().unwrap();
        let sleep_cmd = match Platform::current() {
            Platform::Windows => "Start-Sleep -Seconds 30",
            Platform::Macos | Platform::Linux => "sleep 30",
        };
        let old_target = make_target(tmp.path(), "shared-cmd", sleep_cmd);
        let new_target = make_target(tmp.path(), "shared-cmd", "echo rerun_ok");

        let registry = RunRegistry::new();
        let reg1 = registry.clone();
        let reg2 = registry.clone();

        let old_handle = tokio::spawn(async move {
            run_commands_parallel(
                "run-old".to_string(),
                vec![old_target],
                1,
                reg1,
                |_ev| {},
            )
            .await
        });

        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        assert_eq!(registry.cancel_run("run-old").await, 1);

        let new_results = run_commands_parallel(
            "run-new".to_string(),
            vec![new_target],
            1,
            reg2,
            |_ev| {},
        )
        .await;
        let old_results = old_handle.await.unwrap();

        assert_eq!(old_results[0].status, RunStatus::Canceled);
        assert_eq!(new_results[0].status, RunStatus::Pass);
        assert!(new_results[0].logs.iter().any(|l| l.text.contains("rerun_ok")));
    }
}
