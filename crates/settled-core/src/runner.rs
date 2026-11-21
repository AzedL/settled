use crate::model::{
    CommandExecutionTarget, CommandResult, LogStream, OutputLine, Platform, RunEvent, RunStatus,
};
use encoding_rs::Encoding;
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::sync::{mpsc, watch, Mutex, Semaphore};
use tokio::task::JoinSet;

pub const MAX_RETAINED_LINES: usize = 5000;
const LINE_BUFFER_LIMIT_BYTES: usize = 32 * 1024;
pub const DEFAULT_CONCURRENCY: usize = 6;
const POST_EXIT_PIPE_IDLE_TIMEOUT: Duration = Duration::from_millis(250);
const POST_EXIT_PIPE_MAX_TIMEOUT: Duration = Duration::from_secs(2);
const CANCEL_WAIT_TIMEOUT: Duration = Duration::from_millis(500);

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
    cancel_tx: watch::Sender<bool>,
}

async fn terminate_targets(targets: Vec<(Option<u32>, watch::Sender<bool>)>) -> usize {
    let count = targets.len();
    let mut kill_set = JoinSet::new();
    for (pid, cancel_tx) in targets {
        let _ = cancel_tx.send(true);
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

    async fn register(&self, run_id: &str, command_id: &str) -> watch::Receiver<bool> {
        let mut guard = self.inner.lock().await;
        let canceled = guard.canceled_runs.contains(run_id);
        let (cancel_tx, cancel_rx) = watch::channel(canceled);
        guard.commands.insert(
            (run_id.to_string(), command_id.to_string()),
            ActiveCommandHandle {
                pid: None,
                canceled,
                cancel_tx,
            },
        );
        cancel_rx
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
        let targets: Vec<(Option<u32>, watch::Sender<bool>)> = {
            let mut guard = self.inner.lock().await;
            guard
                .commands
                .iter_mut()
                .filter(|((_, cid), _)| cid == command_id)
                .map(|(_, handle)| {
                    handle.canceled = true;
                    (handle.pid, handle.cancel_tx.clone())
                })
                .collect()
        };

        terminate_targets(targets).await > 0
    }

    /// Cancels every running command associated with `run_id`, plus any queued tasks for that batch.
    pub async fn cancel_run(&self, run_id: &str) -> usize {
        let targets: Vec<(Option<u32>, watch::Sender<bool>)> = {
            let mut guard = self.inner.lock().await;
            guard.canceled_runs.insert(run_id.to_string());
            guard
                .commands
                .iter_mut()
                .filter(|((rid, _), _)| rid == run_id)
                .map(|(_, handle)| {
                    handle.canceled = true;
                    (handle.pid, handle.cancel_tx.clone())
                })
                .collect()
        };

        terminate_targets(targets).await
    }

    /// Cancels all currently running commands across all runs.
    pub async fn cancel_all(&self) -> usize {
        let targets: Vec<(Option<u32>, watch::Sender<bool>)> = {
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
                    (handle.pid, handle.cancel_tx.clone())
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
    let mut cancel_rx = registry.register(run_id, &target.command_id).await;

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

    let (canceled_during_wait, wait_outcome) = {
        let mut wait_fut = std::pin::pin!(child.wait());
        let mut pipes_open = true;
        let mut canceled_hit = false;
        let mut outcome: Option<std::io::Result<std::process::ExitStatus>> = None;

        loop {
            tokio::select! {
                biased;
                _ = wait_for_cancel(&mut cancel_rx) => {
                    canceled_hit = true;
                    break;
                }
                status = &mut wait_fut => {
                    outcome = Some(status);
                    break;
                }
                maybe_line = line_rx.recv(), if pipes_open => {
                    match maybe_line {
                        Some(line) => push_output_line(
                            line,
                            &mut collected_logs,
                            &mut truncated,
                            run_id,
                            &target.command_id,
                            on_event,
                        ),
                        None => pipes_open = false,
                    }
                }
            }
        }
        (canceled_hit, outcome)
    };

    if canceled_during_wait {
        if let Some(pid) = child.id() {
            terminate_process_tree(pid).await;
        }
        let _ = child.kill().await;
        let _ = tokio::time::timeout(CANCEL_WAIT_TIMEOUT, child.wait()).await;
    }

    drain_remaining_lines(
        &mut line_rx,
        if canceled_during_wait {
            Duration::from_millis(80)
        } else {
            POST_EXIT_PIPE_IDLE_TIMEOUT
        },
        POST_EXIT_PIPE_MAX_TIMEOUT,
        |line| {
            push_output_line(
                line,
                &mut collected_logs,
                &mut truncated,
                run_id,
                &target.command_id,
                on_event,
            );
        },
    )
    .await;

    if let Some(fut) = stdout_task {
        fut.abort();
    }
    if let Some(fut) = stderr_task {
        fut.abort();
    }

    let was_canceled = canceled_during_wait || registry.is_canceled(run_id, &target.command_id).await;
    registry.unregister(run_id, &target.command_id).await;

    let duration_ms = start.elapsed().as_millis() as u64;
    if was_canceled {
        return finish_canceled(run_id, target, duration_ms, collected_logs, on_event);
    }

    let (status, exit_code, error) = match wait_outcome {
        Some(Ok(exit)) => {
            let code = exit.code();
            let status = if exit.success() {
                RunStatus::Pass
            } else {
                RunStatus::Fail
            };
            (status, code, None)
        }
        Some(Err(err)) => (
            RunStatus::Fail,
            None,
            Some(format!("Process wait error: {err}")),
        ),
        None => (
            RunStatus::Fail,
            None,
            Some("Process wait terminated unexpectedly".to_string()),
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

async fn wait_for_cancel(rx: &mut watch::Receiver<bool>) {
    if *rx.borrow_and_update() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow_and_update() {
            return;
        }
    }
    std::future::pending::<()>().await;
}

fn push_output_line<F>(
    line: OutputLine,
    collected_logs: &mut Vec<OutputLine>,
    truncated: &mut bool,
    run_id: &str,
    command_id: &str,
    on_event: &F,
) where
    F: Fn(RunEvent) + Send + Sync,
{
    if collected_logs.len() < MAX_RETAINED_LINES {
        collected_logs.push(line.clone());
    } else if !*truncated {
        *truncated = true;
        let notice = OutputLine {
            stream: LogStream::System,
            text: format!("[output truncated after {MAX_RETAINED_LINES} lines]"),
        };
        collected_logs.push(notice.clone());
        on_event(RunEvent::Output {
            run_id: run_id.to_string(),
            command_id: command_id.to_string(),
            stream: notice.stream,
            text: notice.text,
        });
        return;
    }

    if !*truncated {
        on_event(RunEvent::Output {
            run_id: run_id.to_string(),
            command_id: command_id.to_string(),
            stream: line.stream,
            text: line.text,
        });
    }
}

async fn drain_remaining_lines<F>(
    line_rx: &mut mpsc::UnboundedReceiver<OutputLine>,
    idle_timeout: Duration,
    max_total: Duration,
    mut on_line: F,
) where
    F: FnMut(OutputLine),
{
    let deadline = tokio::time::Instant::now() + max_total;
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        let step = idle_timeout.min(deadline - now);
        match tokio::time::timeout(step, line_rx.recv()).await {
            Ok(Some(line)) => on_line(line),
            Ok(None) | Err(_) => break,
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
                    "try {{ [Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) }} catch {{}}; $OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n{}",
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

        let deadline = tokio::time::Instant::now() + Duration::from_millis(400);
        while tokio::time::Instant::now() < deadline {
            let alive = Command::new("kill")
                .args(["-0", &pgid_arg])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .is_ok_and(|s| s.success());
            if !alive {
                return;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }

        let _ = Command::new("kill")
            .args(["-KILL", &pgid_arg])
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

    #[tokio::test]
    async fn handles_spawn_errors_gbk_decoding_cmd_shell_and_truncation() {
        let tmp = TempDir::new().unwrap();

        // 1. Unknown encoding falls back cleanly to UTF-8
        assert_eq!(resolve_encoding("gbk"), encoding_rs::GBK);
        assert_eq!(resolve_encoding("unknown-codec-xyz"), encoding_rs::UTF_8);

        // 2. Missing custom shell produces Fail + System error log without panicking
        let mut missing_shell = make_target(tmp.path(), "bad-shell", "echo hi");
        missing_shell.shell = "settled-nonexistent-shell-binary-xyz".to_string();

        // 3. Explicit cmd shell (Windows) or sh (Unix) executes cleanly
        let mut explicit_shell = make_target(tmp.path(), "explicit-shell", "echo shell_ok");
        explicit_shell.shell = if cfg!(windows) {
            "cmd".to_string()
        } else {
            "sh".to_string()
        };

        // 4. Non-UTF8 GBK output without trailing newline flushes cleanly via drain_lines
        let mut gbk_target = make_target(
            tmp.path(),
            "gbk-out",
            r#"node -e "process.stdout.write(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))""#,
        );
        gbk_target.encoding = "gbk".to_string();

        let registry = RunRegistry::new();
        let results = run_commands_parallel(
            "run-edge".to_string(),
            vec![missing_shell, explicit_shell, gbk_target],
            3,
            registry,
            |_| {},
        )
        .await;

        assert_eq!(results[0].status, RunStatus::Fail);
        assert_eq!(results[0].exit_code, None);
        assert!(results[0].error.is_some());
        assert_eq!(results[0].logs[0].stream, LogStream::System);

        assert_eq!(results[1].status, RunStatus::Pass);
        assert!(results[1].logs.iter().any(|l| l.text.contains("shell_ok")));

        assert_eq!(results[2].status, RunStatus::Pass);
        assert_eq!(results[2].logs[0].text, "中文");

        // 5. Log retention cap truncates cleanly at MAX_RETAINED_LINES (5000)
        let flood = make_target(
            tmp.path(),
            "flood",
            r#"node -e "for (let i = 0; i < 5010; i++) console.log('line-' + i)""#,
        );
        let flood_results = run_commands_parallel(
            "run-flood".to_string(),
            vec![flood],
            1,
            RunRegistry::new(),
            |_| {},
        )
        .await;
        assert_eq!(flood_results[0].status, RunStatus::Pass);
        assert_eq!(flood_results[0].logs.len(), MAX_RETAINED_LINES + 1);
        assert!(flood_results[0]
            .logs
            .last()
            .unwrap()
            .text
            .contains("output truncated after 5000 lines"));
    }

    #[tokio::test]
    async fn does_not_hang_when_background_grandchild_inherits_stdio() {
        let tmp = TempDir::new().unwrap();
        let target = make_target(
            tmp.path(),
            "grandchild-pipe",
            r#"node -e "const { spawn } = require('child_process'); console.log('parent_done'); const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { detached: true, stdio: 'inherit' }); child.unref();""#,
        );

        let started = Instant::now();
        let results = run_commands_parallel(
            "run-grandchild".to_string(),
            vec![target],
            1,
            RunRegistry::new(),
            |_| {},
        )
        .await;
        let elapsed = started.elapsed();

        assert_eq!(results[0].status, RunStatus::Pass);
        assert!(results[0].logs.iter().any(|l| l.text.contains("parent_done")));
        assert!(
            elapsed < Duration::from_millis(2200),
            "runner hung waiting on grandchild pipe ({elapsed:?})"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn escalates_sigkill_when_process_ignores_sigterm() {
        let tmp = TempDir::new().unwrap();
        let mut target = make_target(tmp.path(), "ignore-term", "trap '' TERM; sleep 30");
        target.shell = "sh".to_string();

        let registry = RunRegistry::new();
        let reg_clone = registry.clone();

        let handle = tokio::spawn(async move {
            run_commands_parallel(
                "run-sigkill".to_string(),
                vec![target],
                1,
                reg_clone,
                |_| {},
            )
            .await
        });

        tokio::time::sleep(Duration::from_millis(250)).await;
        let cancel_start = Instant::now();
        assert_eq!(registry.cancel_run("run-sigkill").await, 1);

        let results = tokio::time::timeout(Duration::from_secs(3), handle)
            .await
            .expect("cancel timed out on SIGTERM-ignoring process")
            .unwrap();
        assert_eq!(results[0].status, RunStatus::Canceled);
        assert!(cancel_start.elapsed() < Duration::from_secs(3));
    }
}
