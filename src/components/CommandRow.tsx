import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Play, Square, Terminal } from "lucide-react";
import { lang } from "../lang";
import type { CommandRuntimeState, ResolvedCommand } from "../types";
import { formatPlatforms } from "../utils/format";
import { TrafficLed } from "./TrafficLed";
import { Button } from "./Button";

interface CommandRowProps {
  command: ResolvedCommand;
  runtime: CommandRuntimeState;
  isActiveStop: boolean;
  onRun: () => void;
  onStop: () => void;
}

export function CommandRow({
  command,
  runtime,
  isActiveStop,
  onRun,
  onStop,
}: CommandRowProps) {
  const isRunning = runtime.status === "running";
  const [logOpen, setLogOpen] = useState(false);

  // Automatically expand logs when a command fails so diagnostics are immediately visible.
  useEffect(() => {
    if (runtime.status === "fail") {
      setLogOpen(true);
    }
  }, [runtime.status]);

  return (
    <div
      className="rounded-[var(--st-radius-md)] border transition-colors"
      style={{
        backgroundColor: "var(--st-bg-surface)",
        borderColor: !command.applicable
          ? "var(--st-border-subtle)"
          : runtime.status === "fail"
            ? "var(--st-border-danger)"
            : runtime.status === "running"
              ? "var(--st-border-running)"
              : "var(--st-border-subtle)",
      }}
    >
      <div className="px-[var(--st-space-12)] py-[var(--st-space-10)] flex items-center justify-between gap-[var(--st-space-12)]">
        <div className="flex items-center gap-[var(--st-space-10)] min-w-0 flex-1">
          <TrafficLed
            status={command.applicable ? runtime.status : "disabled"}
            size="md"
          />

          <span className="text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-medium text-[color:var(--st-text-primary)] truncate min-w-0">
            {command.name}
          </span>
        </div>

        <div className="flex items-center gap-[var(--st-space-8)] shrink-0">
          <Button
            size="sm"
            variant="panel"
            active={logOpen}
            onClick={() => setLogOpen((prev) => !prev)}
            aria-expanded={logOpen}
          >
            <Terminal className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            <span>{logOpen ? lang.scripts.logsHide : lang.scripts.logsShow}</span>
            {logOpen ? (
              <ChevronDown className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            ) : (
              <ChevronRight className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            )}
          </Button>

          {command.applicable && (
            <Button
              size="sm"
              variant={isActiveStop ? "warn-soft" : "accent-soft"}
              onClick={isActiveStop ? onStop : onRun}
            >
              {isActiveStop ? (
                <Square className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
              ) : (
                <Play className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
              )}
              <span>
                {isActiveStop ? lang.scripts.stopSingle : lang.scripts.runSingle}
              </span>
            </Button>
          )}
        </div>
      </div>

      {logOpen && (
        <>
          <div
            className="border-t px-[var(--st-space-12)] py-[var(--st-space-10)] flex flex-col gap-[var(--st-space-8)]"
            style={{
              backgroundColor: "var(--st-bg-panel)",
              borderColor: "var(--st-border-subtle)",
            }}
          >
            {command.description && (
              <p className="m-0 text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-secondary)]">
                {command.description}
              </p>
            )}

            <code
              className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] px-[var(--st-space-8)] py-[var(--st-space-4)] rounded-[var(--st-radius-sm)] break-all text-[color:var(--st-text-primary)]"
              style={{ backgroundColor: "var(--st-bg-terminal)" }}
            >
              {command.rawRun}
            </code>

            <div className="flex flex-wrap items-center gap-x-[var(--st-space-16)] gap-y-[var(--st-space-4)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
              <span>
                {lang.detail.platformsLabel}:{" "}
                <span className="font-medium text-[color:var(--st-text-secondary)]">
                  {formatPlatforms(command.platforms, lang.app.platformLabel)}
                </span>
              </span>

              {runtime.durationMs !== null && (
                <span>
                  {lang.scripts.durationTitle}:{" "}
                  <span className="font-mono text-[color:var(--st-text-secondary)]">
                    {lang.scripts.durationLabel(runtime.durationMs)}
                  </span>
                </span>
              )}

              {runtime.exitCode !== null && (
                <span
                  className="font-mono font-medium"
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
            </div>
          </div>

          <div
            className="border-t rounded-b-[calc(var(--st-radius-md)-var(--st-border-w))] p-[var(--st-space-12)] font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] max-h-[var(--st-log-max-h)] overflow-y-auto"
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
        </>
      )}
    </div>
  );
}
