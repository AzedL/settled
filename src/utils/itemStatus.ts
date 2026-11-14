import type {
  CommandExecutionTarget,
  CommandResult,
  CommandRuntimeState,
  ResolvedCommand,
  ScopeMode,
  WorkspaceItem,
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
  if (!item.applicable || item.parseError) {
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
    !options.selectedTags.every((tag) => item.tags.includes(tag))
  ) {
    return false;
  }

  const query = options.search.trim().replace(/^#+/, "").toLowerCase();
  if (query.length > 0) {
    const haystack = [item.name, item.description ?? "", ...item.tags]
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
