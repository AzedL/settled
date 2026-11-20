import type {
  CommandExecutionTarget,
  CommandResult,
  CommandRuntimeState,
  ResolvedCommand,
  ScopeMode,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "../types";

export const DEFAULT_COMMAND_RUNTIME: CommandRuntimeState = {
  status: "idle",
  exitCode: null,
  durationMs: null,
  logs: [],
  error: null,
  lastRunId: null,
};

/**
 * Returns the execution target descriptor for a resolved command on a workspace item.
 */
export function toExecutionTarget(
  item: WorkspaceItem,
  command: ResolvedCommand
): CommandExecutionTarget {
  return {
    itemId: item.id,
    itemDir: item.path,
    groupKey: command.key,
    commandIndex: command.index,
    commandId: command.commandId,
    commandName: command.name,
    resolvedRun: command.resolvedRun,
    shell: command.effectiveShell,
    encoding: command.encoding,
  };
}

/**
 * Returns all `check` commands on an item that apply to the current host platform.
 */
export function getApplicableCheckCommands(item: WorkspaceItem): ResolvedCommand[] {
  if (!item.applicable) {
    return [];
  }
  const checkGroup = item.scriptGroups.find((group) => group.role === "check");
  if (!checkGroup) {
    return [];
  }
  return checkGroup.commands.filter((cmd) => cmd.applicable);
}

/**
 * Looks up a command's current runtime state or returns the default `idle` state.
 */
export function getCommandRuntime(
  runtimeMap: Record<string, CommandRuntimeState>,
  commandId: string
): CommandRuntimeState {
  return runtimeMap[commandId] ?? DEFAULT_COMMAND_RUNTIME;
}

/**
 * Evaluates whether an item matches the selected scope, tags, and search query.
 */
export function matchesItemFilters(
  item: WorkspaceItem,
  options: {
    scope: ScopeMode;
    search: string;
    selectedTags: string[];
  }
): boolean {
  if (options.scope === "current" && !item.applicable) {
    return false;
  }

  if (
    options.selectedTags.length > 0 &&
    !options.selectedTags.some((tag) => item.tags.includes(tag))
  ) {
    return false;
  }

  const query = options.search.trim().toLowerCase();
  if (query.length > 0) {
    const haystack = [item.name, item.description ?? ""]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) {
      return false;
    }
  }

  return true;
}

/**
 * Collects latest runtime results for an item so they can be bundled into AI context output.
 */
export function collectItemCommandResults(
  item: WorkspaceItem,
  runtimeMap: Record<string, CommandRuntimeState>
): CommandResult[] {
  const results: CommandResult[] = [];
  for (const group of item.scriptGroups) {
    for (const cmd of group.commands) {
      const state = runtimeMap[cmd.commandId];
      if (!state || state.status === "idle") {
        continue;
      }
      results.push({
        runId: state.lastRunId ?? "local",
        commandId: cmd.commandId,
        itemId: item.id,
        groupKey: cmd.key,
        commandIndex: cmd.index,
        commandName: cmd.name,
        resolvedRun: cmd.resolvedRun,
        status: state.status,
        exitCode: state.exitCode,
        durationMs: state.durationMs ?? 0,
        logs: state.logs,
        error: state.error,
      });
    }
  }
  return results;
}

function getCommandFingerprint(cmd: ResolvedCommand): string {
  return JSON.stringify([
    cmd.name,
    cmd.rawRun,
    cmd.resolvedRun,
    cmd.effectiveShell,
    cmd.encoding,
    cmd.applicable,
  ]);
}

/**
 * Reconciles command runtime states across same-workspace reloads by aligning unchanged commands
 * via LCS on their execution fingerprints within each `(item.id, group.key)`.
 *
 * Newly inserted or modified commands drop stale states and start cleanly in `idle`, while
 * shifted/reordered unchanged commands retain their existing status and logs at their new index.
 */
export function reconcileRuntimeWithSnapshot(
  prevMap: Record<string, CommandRuntimeState>,
  prevSnapshot: WorkspaceSnapshot,
  nextSnapshot: WorkspaceSnapshot
): Record<string, CommandRuntimeState> {
  const prevGroups = new Map<string, ResolvedCommand[]>();
  for (const item of prevSnapshot.items) {
    for (const group of item.scriptGroups) {
      prevGroups.set(`${item.id}::${group.key}`, group.commands);
    }
  }

  const nextMap: Record<string, CommandRuntimeState> = {};

  for (const item of nextSnapshot.items) {
    for (const group of item.scriptGroups) {
      const oldCmds = prevGroups.get(`${item.id}::${group.key}`);
      const newCmds = group.commands;
      if (!oldCmds || oldCmds.length === 0 || newCmds.length === 0) {
        continue;
      }

      const oldFps = oldCmds.map(getCommandFingerprint);
      const newFps = newCmds.map(getCommandFingerprint);
      const m = oldFps.length;
      const n = newFps.length;

      const dp: number[][] = Array.from({ length: m + 1 }, () =>
        new Array<number>(n + 1).fill(0)
      );
      for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
          dp[i][j] =
            oldFps[i] === newFps[j]
              ? dp[i + 1][j + 1] + 1
              : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }

      let i = 0;
      let j = 0;
      while (i < m && j < n) {
        if (oldFps[i] === newFps[j]) {
          const prevState = prevMap[oldCmds[i].commandId];
          if (prevState) {
            nextMap[newCmds[j].commandId] = prevState;
          }
          i += 1;
          j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
          i += 1;
        } else {
          j += 1;
        }
      }
    }
  }

  return nextMap;
}
