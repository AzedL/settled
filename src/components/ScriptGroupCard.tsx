import { Play, ShieldCheck, Square, Wrench, TerminalSquare } from "lucide-react";
import { lang } from "../lang";
import type {
  ActiveRunAction,
  CommandRuntimeState,
  ResolvedCommand,
  ScopeMode,
  ScriptGroup,
} from "../types";
import { formatScriptGroupTitle } from "../utils/format";
import { getCommandRuntime } from "../utils/itemStatus";
import { CommandRow } from "./CommandRow";

interface ScriptGroupCardProps {
  itemId: string;
  group: ScriptGroup;
  itemApplicable: boolean;
  scope: ScopeMode;
  runtimeMap: Record<string, CommandRuntimeState>;
  activeAction: ActiveRunAction | null;
  hasFailingCheck: boolean;
  isVerifyingFix: boolean;
  onRunGroup: (group: ScriptGroup) => void;
  onRunCommand: (group: ScriptGroup, cmd: ResolvedCommand) => void;
  onStopActiveRun: () => void;
}

export function ScriptGroupCard({
  itemId,
  group,
  itemApplicable,
  scope,
  runtimeMap,
  activeAction,
  hasFailingCheck,
  isVerifyingFix,
  onRunGroup,
  onRunCommand,
  onStopActiveRun,
}: ScriptGroupCardProps) {
  const applicableCommands = group.commands.filter((c) => c.applicable);
  const visibleCommands =
    scope === "current" ? applicableCommands : group.commands;

  const isHighlightedFix =
    group.role === "fix" && hasFailingCheck && applicableCommands.length > 0;

  const title = formatScriptGroupTitle(group.key);
  const runGroupLabel = lang.scripts.runGroup(title);
  const stopGroupLabel = lang.scripts.stopGroup(title);
  const isGroupActiveStop =
    activeAction?.kind === "group" &&
    activeAction.itemId === itemId &&
    activeAction.groupKey === group.key;

  const GroupIcon =
    group.role === "check"
      ? ShieldCheck
      : group.role === "fix"
        ? Wrench
        : TerminalSquare;

  const canRunGroup = itemApplicable && applicableCommands.length > 0;

  return (
    <section
      className="rounded-[var(--st-radius-lg)] border p-[var(--st-space-16)] flex flex-col gap-[var(--st-space-12)]"
      style={{
        backgroundColor: "var(--st-bg-panel)",
        borderColor: isHighlightedFix
          ? "var(--st-border-warn)"
          : "var(--st-border-default)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-[var(--st-space-12)]">
        <div className="flex items-center gap-[var(--st-space-10)] min-w-0">
          <div
            className="w-[var(--st-space-32)] h-[var(--st-space-32)] rounded-[var(--st-radius-md)] flex items-center justify-center shrink-0"
            style={{
              backgroundColor:
                group.role === "check"
                  ? "var(--st-accent-soft)"
                  : group.role === "fix"
                    ? "var(--st-status-canceled-soft)"
                    : "var(--st-status-idle-soft)",
              color:
                group.role === "check"
                  ? "var(--st-accent-text)"
                  : group.role === "fix"
                    ? "var(--st-status-canceled-text)"
                    : "var(--st-text-secondary)",
            }}
          >
            <GroupIcon className="w-[var(--st-icon-md)] h-[var(--st-icon-md)]" />
          </div>
          <h3 className="m-0 text-[length:var(--st-text-base)] leading-[var(--st-leading-base)] font-semibold text-[color:var(--st-text-primary)] truncate">
            {title}
          </h3>
        </div>

        {canRunGroup && (
          <button
            type="button"
            onClick={isGroupActiveStop ? onStopActiveRun : () => onRunGroup(group)}
            className={`inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-14)] py-[var(--st-space-8)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold cursor-pointer shrink-0 st-control ${
              isGroupActiveStop || group.role === "fix"
                ? "st-btn-warn-soft"
                : "st-btn-primary"
            }`}
          >
            {isGroupActiveStop ? (
              <Square className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            ) : (
              <Play className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            )}
            <span>{isGroupActiveStop ? stopGroupLabel : runGroupLabel}</span>
          </button>
        )}
      </div>

      {group.role === "fix" && isVerifyingFix && (
        <div
          className="rounded-[var(--st-radius-md)] border px-[var(--st-space-12)] py-[var(--st-space-8)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium animate-pulse"
          style={{
            backgroundColor: "var(--st-status-running-soft)",
            borderColor: "var(--st-border-running)",
            color: "var(--st-status-running-text)",
          }}
        >
          {lang.scripts.autoVerifyingFix}
        </div>
      )}

      {visibleCommands.length === 0 ? (
        <div
          className="rounded-[var(--st-radius-md)] border px-[var(--st-space-12)] py-[var(--st-space-12)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
          style={{
            backgroundColor: "var(--st-bg-disabled)",
            borderColor: "var(--st-border-subtle)",
            color: "var(--st-text-muted)",
          }}
        >
          {lang.scripts.noApplicableInGroup}
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--st-space-8)]">
          {visibleCommands.map((cmd) => (
            <CommandRow
              key={cmd.commandId}
              command={cmd}
              runtime={getCommandRuntime(runtimeMap, cmd.commandId)}
              isActiveStop={
                activeAction?.kind === "command" &&
                activeAction.commandId === cmd.commandId
              }
              onRun={() => onRunCommand(group, cmd)}
              onStop={onStopActiveRun}
            />
          ))}
        </div>
      )}
    </section>
  );
}
