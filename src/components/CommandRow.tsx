import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Info, Play, Square, Terminal } from "lucide-react";
import { lang } from "../lang";
import type { CommandRuntimeState, ResolvedCommand } from "../types";
import { TrafficLed } from "./TrafficLed";

interface CommandRowProps {
  command: ResolvedCommand;
  runtime: CommandRuntimeState;
  onRun: () => void;
  onStop: () => void;
}

export function CommandRow({ command, runtime, onRun, onStop }: CommandRowProps) {
  const isRunning = runtime.status === "running";
  const hasLogs = runtime.logs.length > 0 || runtime.error !== null;
  const [logOpen, setLogOpen] = useState(false);

  // Automatically expand logs when a command fails so diagnostics are immediately visible.
  useEffect(() => {
    if (runtime.status === "fail") {
      setLogOpen(true);
    }
  }, [runtime.status]);

  const statusPillStyle: React.CSSProperties = !command.applicable
    ? {
        backgroundColor: "var(--st-status-disabled-soft)",
        color: "var(--st-status-disabled-text)",
      }
    : runtime.status === "pass"
      ? {
          backgroundColor: "var(--st-status-pass-soft)",
          color: "var(--st-status-pass-text)",
        }
      : runtime.status === "fail"
        ? {
            backgroundColor: "var(--st-status-fail-soft)",
            color: "var(--st-status-fail-text)",
          }
        : runtime.status === "running"
          ? {
              backgroundColor: "var(--st-status-running-soft)",
              color: "var(--st-status-running-text)",
            }
          : runtime.status === "canceled"
            ? {
                backgroundColor: "var(--st-status-canceled-soft)",
                color: "var(--st-status-canceled-text)",
              }
            : {
                backgroundColor: "var(--st-status-idle-soft)",
                color: "var(--st-status-idle-text)",
              };

  return (
    <div
      className="rounded-[var(--st-radius-md)] border transition-colors"
      style={{
        backgroundColor: command.applicable
          ? "var(--st-bg-surface)"
          : "var(--st-bg-disabled)",
        borderColor: !command.applicable
          ? "var(--st-border-subtle)"
          : runtime.status === "fail"
            ? "var(--st-border-danger)"
            : runtime.status === "running"
              ? "var(--st-border-running)"
              : "var(--st-border-subtle)",
        opacity: command.applicable ? 1 : 0.65,
      }}
    >
      <div className="p-[var(--st-space-12)] flex items-start justify-between gap-[var(--st-space-12)]">
        <div className="flex items-start gap-[var(--st-space-12)] min-w-0 flex-1">
          <div className="pt-[var(--st-space-4)]">
            <TrafficLed
              status={command.applicable ? runtime.status : "disabled"}
              size="md"
            />
          </div>

          <div className="flex flex-col gap-[var(--st-space-6)] min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[var(--st-space-8)]">
              <div className="inline-flex items-center gap-[var(--st-space-6)] min-w-0">
                <span
                  className="text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-medium break-words"
                  style={{
                    color: command.applicable
                      ? "var(--st-text-primary)"
                      : "var(--st-text-disabled)",
                  }}
                >
                  {command.name}
                </span>
                {command.description && (
                  <div className="relative group/info inline-flex items-center">
                    <button
                      type="button"
                      aria-label={command.description}
                      className="inline-flex items-center justify-center rounded-[var(--st-radius-sm)] st-info-trigger cursor-help"
                    >
                      <Info className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
                    </button>
                    <div
                      className="pointer-events-none hidden group-hover/info:block group-focus-within/info:block absolute left-0 top-full mt-[var(--st-space-6)] z-30 w-[320px] rounded-[var(--st-radius-md)] border p-[var(--st-space-10)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                      style={{
                        backgroundColor: "var(--st-bg-panel)",
                        borderColor: "var(--st-border-strong)",
                        color: "var(--st-text-secondary)",
                        boxShadow: "var(--st-shadow-card)",
                      }}
                    >
                      {command.description}
                    </div>
                  </div>
                )}
              </div>

              <span
                className="px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-pill)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium"
                style={statusPillStyle}
              >
                {command.applicable
                  ? lang.status.label(runtime.status)
                  : lang.scripts.disabledCommandBadge}
              </span>

              {command.platforms.length > 0 && (
                <span
                  className="px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-sm)] font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                  style={{
                    backgroundColor: "var(--st-bg-panel)",
                    color: "var(--st-text-muted)",
                  }}
                >
                  {command.platforms.map(lang.app.platformLabel).join(" / ")}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-[var(--st-space-8)]">
              <code
                className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-sm)] break-all"
                style={{
                  backgroundColor: "var(--st-bg-terminal)",
                  color: command.applicable
                    ? "var(--st-text-secondary)"
                    : "var(--st-text-disabled)",
                }}
                title={`${lang.scripts.commandPreviewLabel}: ${command.resolvedRun}`}
              >
                {command.resolvedRun}
              </code>
              <span
                className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                style={{ color: "var(--st-text-muted)" }}
              >
                {lang.scripts.shellBadge(command.effectiveShell, command.encoding)}
              </span>
              {runtime.exitCode !== null && (
                <span
                  className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                  style={{
                    color:
                      runtime.exitCode === 0
                        ? "var(--st-status-pass-text)"
                        : "var(--st-status-fail-text)",
                  }}
                >
                  {lang.scripts.exitCodeLabel(runtime.exitCode)}
                </span>
              )}
              {runtime.durationMs !== null && (
                <span
                  className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                  style={{ color: "var(--st-text-muted)" }}
                >
                  {lang.scripts.durationLabel(runtime.durationMs)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-[var(--st-space-8)] shrink-0">
          <button
            type="button"
            onClick={() => setLogOpen((prev) => !prev)}
            aria-expanded={logOpen}
            className={`inline-flex items-center gap-[var(--st-space-4)] px-[var(--st-space-10)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer st-control st-btn-panel ${
              logOpen
                ? "st-btn-panel--active"
                : hasLogs
                  ? "st-btn-panel--ready"
                  : ""
            }`}
          >
            <Terminal className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            <span>{logOpen ? lang.scripts.logsHide : lang.scripts.logsShow}</span>
            {logOpen ? (
              <ChevronDown className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            ) : (
              <ChevronRight className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            )}
          </button>

          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold cursor-pointer st-control st-btn-danger-soft"
            >
              <Square className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
              <span>{lang.scripts.stopSingle}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!command.applicable}
              onClick={onRun}
              className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold disabled:cursor-not-allowed cursor-pointer st-control st-btn-accent-soft"
            >
              <Play className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
              <span>{lang.scripts.runSingle}</span>
            </button>
          )}
        </div>
      </div>

      {logOpen && (
        <div
          className="border-t p-[var(--st-space-12)] font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] max-h-[var(--st-log-max-h)] overflow-y-auto"
          style={{
            backgroundColor: "var(--st-bg-terminal)",
            borderColor: "var(--st-border-subtle)",
          }}
        >
          {runtime.error && (
            <div
              className="mb-[var(--st-space-6)]"
              style={{ color: "var(--st-status-fail-text)" }}
            >
              {runtime.error}
            </div>
          )}
          {runtime.logs.length > 0 ? (
            <div className="flex flex-col gap-[var(--st-space-2)]">
              {runtime.logs.map((line, idx) => (
                <div
                  key={idx}
                  className="whitespace-pre-wrap break-all"
                  style={{
                    color:
                      line.stream === "stderr"
                        ? "var(--st-status-fail-text)"
                        : line.stream === "system"
                          ? "var(--st-status-canceled-text)"
                          : "var(--st-text-primary)",
                  }}
                >
                  {line.text.length > 0 ? line.text : " "}
                </div>
              ))}
            </div>
          ) : (
            <span style={{ color: "var(--st-text-muted)" }}>
              {isRunning ? lang.scripts.logsWaiting : lang.scripts.logsEmpty}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
