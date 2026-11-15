import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  AppPrefs,
  CommandExecutionTarget,
  CommandResult,
  InitialAppState,
  RunEvent,
  WorkspaceSnapshot,
} from "../types";

export interface RunBatchResponse {
  runId: string;
  results: CommandResult[];
}

export async function showMainWindow(
  resolvedTheme: "light" | "dark"
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke<void>("show_main_window", { resolvedTheme });
}

export async function syncWindowTheme(
  resolvedTheme: "light" | "dark"
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invoke<void>("sync_window_theme", { resolvedTheme });
}

export async function getInitialState(): Promise<InitialAppState> {
  return invoke<InitialAppState>("get_initial_state");
}

export async function setConfirmMutatingRuns(confirm: boolean): Promise<AppPrefs> {
  return invoke<AppPrefs>("set_confirm_mutating_runs", { confirm });
}

export async function openWorkspace(path: string): Promise<WorkspaceSnapshot> {
  return invoke<WorkspaceSnapshot>("open_workspace", { path });
}

export async function reloadWorkspace(): Promise<WorkspaceSnapshot | null> {
  return invoke<WorkspaceSnapshot | null>("reload_workspace");
}

export async function runCommands(
  runId: string,
  targets: CommandExecutionTarget[]
): Promise<RunBatchResponse> {
  return invoke<RunBatchResponse>("run_commands", { runId, targets });
}

export async function cancelCommand(commandId: string): Promise<boolean> {
  return invoke<boolean>("cancel_command", { commandId });
}

export async function cancelRun(runId: string): Promise<number> {
  return invoke<number>("cancel_run", { runId });
}

export async function cancelAllRuns(): Promise<number> {
  return invoke<number>("cancel_all_runs");
}

export async function buildAiContext(
  itemId: string,
  latestResults: CommandResult[]
): Promise<string> {
  return invoke<string>("build_ai_context", { itemId, latestResults });
}

export async function openInVscode(path: string): Promise<void> {
  return invoke<void>("open_in_vscode", { path });
}

export async function pickWorkspaceFolder(title: string): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === "string" ? selected : null;
}

export async function revealPathInExplorer(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch {
    await openPath(path);
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await writeText(text);
}

export async function subscribeRunEvents(
  handler: (event: RunEvent) => void
): Promise<UnlistenFn> {
  return listen<RunEvent>("settled://run-event", (event) => {
    handler(event.payload);
  });
}

export async function subscribeWorkspaceChanges(
  handler: (rootPath: string) => void
): Promise<UnlistenFn> {
  return listen<string>("settled://workspace-changed", (event) => {
    handler(event.payload);
  });
}
