import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  AppPrefs,
  CliRegistrationInfo,
  CommandResult,
  CommandSelector,
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

export async function getWorkspacePrefs(): Promise<AppPrefs> {
  return invoke<AppPrefs>("get_workspace_prefs");
}

export async function getCliStatus(): Promise<CliRegistrationInfo> {
  return invoke<CliRegistrationInfo>("get_cli_status");
}

export async function registerCli(): Promise<CliRegistrationInfo> {
  return invoke<CliRegistrationInfo>("register_cli");
}

export async function openWorkspace(path: string): Promise<WorkspaceSnapshot> {
  return invoke<WorkspaceSnapshot>("open_workspace", { path });
}

export async function reloadWorkspace(
  expectedGeneration?: number
): Promise<WorkspaceSnapshot | null> {
  return expectedGeneration === undefined
    ? invoke<WorkspaceSnapshot | null>("reload_workspace")
    : invoke<WorkspaceSnapshot | null>("reload_workspace", {
        expectedGeneration,
      });
}

export async function runCommands(
  runId: string,
  selectors: CommandSelector[]
): Promise<RunBatchResponse> {
  return invoke<RunBatchResponse>("run_commands", { runId, selectors });
}

export async function cancelRun(runId: string): Promise<number> {
  return invoke<number>("cancel_run", { runId });
}

export async function buildAiContext(itemId: string): Promise<string> {
  return invoke<string>("build_ai_context", { itemId });
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

export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url);
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
