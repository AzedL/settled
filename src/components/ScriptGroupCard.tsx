import { Play, ShieldCheck, Wrench, TerminalSquare } from "lucide-react";
import { lang } from "../lang";
import type {
  CommandRuntimeState,
  ResolvedCommand,
  ScopeMode,
  ScriptGroup,
} from "../types";
import { getCommandRuntime } from "../utils/itemStatus";
import { CommandRow } from "./CommandRow";

interface ScriptGroupCardProps {
  group: ScriptGroup;
  itemApplicable: boolean;
  scope: ScopeMode;
  runtimeMap: Record<string, CommandRuntimeState>;
  hasFailingCheck: boolean;
  isVerifyingFix: boolean;
  onRunGroup: (group: ScriptGroup) => void;
  onRunCommand: (group: ScriptGroup, cmd: ResolvedCommand) => void;
  onStopCommand: (commandId: string) => void;
}

export function ScriptGroupCard({
  group,
  itemApplicable,
  scope,
  runtimeMap,
  hasFailingCheck,
  isVerifyingFix,
  onRunGroup,
  onRunCommand,
  onStopCommand,
}: ScriptGroupCardProps) {
  const applicableCommands = group.commands.filter((c) => c.applicable);
  const visibleCommands =
    scope === "current" ? applicableCommands : group.commands;
  const hiddenCount = group.commands.length - applicableCommands.length;

  const isHighlightedFix =
    group.role === "fix" && hasFailingCheck && applicableCommands.length > 0;

  const title =
    group.role === "check"
      ? lang.scripts.groupTitleCheck
      : group.role === "fix"
        ? lang.scripts.groupTitleFix
        : lang.scripts.groupTitleCustom(group.key);

  const subtitle =
    group.role === "check"
      ? lang.scripts.groupSubtitleCheck
      : group.role === "fix"
        ? lang.scripts.groupSubtitleFix
        : lang.scripts.groupSubtitleCustom;

  const runGroupLabel =
    group.role === "check"
      ? lang.scripts.runGroupCheck
      : group.role === "fix"
        ? lang.scripts.runGroupFix
        : lang.scripts.runGroupCustom(group.key);

  const GroupIcon =
    group.role === "check"
      ? ShieldCheck
      : group.role === "fix"
        ? Wrench
        : TerminalSquare;

  const anyRunning = applicableCommands.some(
    (c) => getCommandRuntime(runtimeMap, c.commandId).status === "running"
  );

  const canRunGroup =
    itemApplicable && applicableCommands.length > 0 && !anyRunning;

  return (
    <section
      className="rounded-[var(--st-radius-lg)] border-2 p-[var(--st-space-16)] flex flex-col gap-[var(--st-space-12)]"
      style={{
        backgroundColor: "var(--st-bg-panel)",
        borderColor: isHighlightedFix
          ? "var(--st-border-warn)"
          : "var(--st-border-default)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-[var(--st-space-12)]">
        <div className="flex items-start gap-[var(--st-space-10)] min-w-0">
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
          <div className="flex flex-col gap-[var(--st-space-2)] min-w-0">
            <h3 className="m-0 text-[length:var(--st-text-base)] leading-[var(--st-leading-base)] font-semibold text-[color:var(--st-text-primary)]">
              {title}
            </h3>
            <p className="m-0 text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
              {subtitle}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={!canRunGroup}
          onClick={() => onRunGroup(group)}
          className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-14)] py-[var(--st-space-8)] rounded-[var(--st-radius-md)] border-2 text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold transition-colors disabled:cursor-not-allowed cursor-pointer shrink-0"
          style={{
            backgroundColor: !canRunGroup
              ? "var(--st-bg-disabled)"
              : group.role === "fix"
                ? "var(--st-status-canceled-soft)"
                : "var(--st-accent)",
            borderColor: !canRunGroup
              ? "var(--st-border-subtle)"
              : group.role === "fix"
                ? "var(--st-border-warn)"
                : "var(--st-accent)",
            color: !canRunGroup
              ? "var(--st-text-disabled)"
              : group.role === "fix"
                ? "var(--st-status-canceled-text)"
                : "var(--st-accent-contrast)",
          }}
        >
          <Play className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
          <span>{runGroupLabel}</span>
        </button>
      </div>

      {group.role === "fix" && isVerifyingFix && (
        <div
          className="rounded-[var(--st-radius-md)] border-2 px-[var(--st-space-12)] py-[var(--st-space-8)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium animate-pulse"
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
          className="rounded-[var(--st-radius-md)] border-2 px-[var(--st-space-12)] py-[var(--st-space-12)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
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
              onRun={() => onRunCommand(group, cmd)}
              onStop={() => onStopCommand(cmd.commandId)}
            />
          ))}
        </div>
      )}

      {scope === "current" && hiddenCount > 0 && (
        <p className="m-0 text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
          {lang.scripts.hiddenPlatformCount(hiddenCount)}
        </p>
      )}
    </section>
  );
}
