import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Play, Square, Terminal } from "lucide-react";
import { lang } from "../lang";
import type { CommandRuntimeState, ResolvedCommand } from "../types";
import { getAnsiSegmentStyle, parseAnsiLogLines } from "../utils/ansi";
import { formatPlatforms } from "../utils/format";
import { TrafficLed } from "./TrafficLed";
import { Button } from "./Button";

const AUTO_SCROLL_THRESHOLD_PX = 24;

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
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottomRef = useRef(true);

  // Automatically expand logs when a command fails so diagnostics are immediately visible.
  useEffect(() => {
    if (runtime.status === "fail") {
      setLogOpen(true);
    }
  }, [runtime.status]);

  const parsedLogs = useMemo(
    () => (logOpen ? parseAnsiLogLines(runtime.logs) : []),
    [logOpen, runtime.logs]
  );

  // Reset sticky-bottom tracking whenever the log drawer is reopened.
  useEffect(() => {
    if (logOpen) {
      isPinnedToBottomRef.current = true;
    }
  }, [logOpen]);

  // Smart auto-scroll: follow new streaming output while pinned near the bottom, pause when user scrolls up.
  useLayoutEffect(() => {
    const el = logContainerRef.current;
    if (!logOpen || !el || !isPinnedToBottomRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [logOpen, parsedLogs.length, runtime.error]);

  const handleLogScroll = () => {
    const el = logContainerRef.current;
    if (!el) {
      return;
    }
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isPinnedToBottomRef.current = distanceToBottom <= AUTO_SCROLL_THRESHOLD_PX;
  };

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
              className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] px-[var(--st-space-8)] py-[var(--st-space-4)] rounded-[var(--st-radius-sm)] break-all text-[color:var(--st-accent-text)]"
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
            ref={logContainerRef}
            onScroll={handleLogScroll}
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
          {parsedLogs.length > 0 ? (
            <div className="flex flex-col gap-[var(--st-space-2)]">
              {parsedLogs.map((line, idx) => (
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
                  {line.segments.length > 0
                    ? line.segments.map((seg, segIdx) => (
                        <span key={segIdx} style={getAnsiSegmentStyle(seg)}>
                          {seg.text}
                        </span>
                      ))
                    : " "}
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
