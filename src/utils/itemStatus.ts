import type {
  CommandRuntimeState,
  CommandSelector,
  ResolvedCommand,
  ScopeMode,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "../types";

export const MAX_RETAINED_LOG_LINES = 5000;

export const DEFAULT_COMMAND_RUNTIME: CommandRuntimeState = {
  status: "idle",
  exitCode: null,
  durationMs: null,
  logs: [],
  error: null,
  lastRunId: null,
};

/**
 * Returns the UI selection descriptor sent to Rust to resolve and execute a command.
 */
export function toCommandSelector(
  item: WorkspaceItem,
  command: ResolvedCommand
): CommandSelector {
  return {
    itemId: item.id,
    groupKey: command.key,
    commandIndex: command.index,
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
 * Computes a deterministic `oldCommandId -> newCommandId` remapping across same-workspace reloads
 * using per-`(item.id, group.key)` fingerprint queues provided by the Rust backend.
 */
export function buildCommandIdRemap(
  prevSnapshot: WorkspaceSnapshot,
  nextSnapshot: WorkspaceSnapshot
): Map<string, string> {
  const prevQueues = new Map<string, string[]>();

  for (const item of prevSnapshot.items) {
    for (const group of item.scriptGroups) {
      const groupPrefix = `${item.id}::${group.key}`;
      for (const cmd of group.commands) {
        const key = `${groupPrefix}::${cmd.fingerprint}`;
        const queue = prevQueues.get(key);
        if (queue) {
          queue.push(cmd.commandId);
        } else {
          prevQueues.set(key, [cmd.commandId]);
        }
      }
    }
  }

  const idRemap = new Map<string, string>();
  for (const item of nextSnapshot.items) {
    for (const group of item.scriptGroups) {
      const groupPrefix = `${item.id}::${group.key}`;
      for (const cmd of group.commands) {
        const key = `${groupPrefix}::${cmd.fingerprint}`;
        const prevCommandId = prevQueues.get(key)?.shift();
        if (prevCommandId) {
          idRemap.set(prevCommandId, cmd.commandId);
        }
      }
    }
  }

  return idRemap;
}

/**
 * Reconciles command runtime states across same-workspace reloads using fingerprint queues.
 *
 * Newly inserted or modified commands drop stale states and start cleanly in `idle`, while
 * shifted or reordered unchanged commands retain their existing status and logs at their new index.
 */
export function reconcileRuntimeWithSnapshot(
  prevMap: Record<string, CommandRuntimeState>,
  prevSnapshot: WorkspaceSnapshot,
  nextSnapshot: WorkspaceSnapshot,
  precomputedRemap?: Map<string, string>
): Record<string, CommandRuntimeState> {
  const idRemap =
    precomputedRemap ?? buildCommandIdRemap(prevSnapshot, nextSnapshot);
  const nextMap: Record<string, CommandRuntimeState> = {};

  for (const [prevId, nextId] of idRemap.entries()) {
    const state = prevMap[prevId];
    if (state) {
      nextMap[nextId] = state;
    }
  }

  return nextMap;
}
