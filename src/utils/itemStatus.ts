import type {
  CommandExecutionTarget,
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
 * Reconciles command runtime states across same-workspace reloads by matching commands via
 * per-`(item.id, group.key)` fingerprint queues.
 *
 * Newly inserted or modified commands drop stale states and start cleanly in `idle`, while
 * shifted or reordered unchanged commands retain their existing status and logs at their new index.
 */
export function reconcileRuntimeWithSnapshot(
  prevMap: Record<string, CommandRuntimeState>,
  prevSnapshot: WorkspaceSnapshot,
  nextSnapshot: WorkspaceSnapshot
): Record<string, CommandRuntimeState> {
  const prevQueues = new Map<string, (CommandRuntimeState | undefined)[]>();

  for (const item of prevSnapshot.items) {
    for (const group of item.scriptGroups) {
      const groupPrefix = `${item.id}::${group.key}`;
      for (const cmd of group.commands) {
        const key = `${groupPrefix}::${getCommandFingerprint(cmd)}`;
        const queue = prevQueues.get(key);
        const state = prevMap[cmd.commandId];
        if (queue) {
          queue.push(state);
        } else {
          prevQueues.set(key, [state]);
        }
      }
    }
  }

  const nextMap: Record<string, CommandRuntimeState> = {};

  for (const item of nextSnapshot.items) {
    for (const group of item.scriptGroups) {
      const groupPrefix = `${item.id}::${group.key}`;
      for (const cmd of group.commands) {
        const key = `${groupPrefix}::${getCommandFingerprint(cmd)}`;
        const state = prevQueues.get(key)?.shift();
        if (state) {
          nextMap[cmd.commandId] = state;
        }
      }
    }
  }

  return nextMap;
}
