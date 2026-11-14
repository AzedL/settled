import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { lang } from "../lang";
import type { CommandExecutionTarget, ScriptRole } from "../types";
import { Button } from "./Button";

interface ConfirmModalProps {
  role: ScriptRole;
  targets: CommandExecutionTarget[];
  onConfirm: (skipFuture: boolean) => void;
  onCancel: () => void;
}

export function ConfirmModal({
  role,
  targets,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [skipFuture, setSkipFuture] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-[var(--st-space-16)]"
      style={{ backgroundColor: "var(--st-bg-overlay)" }}
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="w-full max-w-[var(--st-modal-w)] rounded-[var(--st-radius-lg)] border p-[var(--st-space-24)] flex flex-col gap-[var(--st-space-16)]"
        style={{
          backgroundColor: "var(--st-bg-panel)",
          borderColor: "var(--st-border-warn)",
          boxShadow: "var(--st-shadow-modal)",
        }}
      >
        <div className="flex items-start gap-[var(--st-space-12)]">
          <div
            className="shrink-0 w-[var(--st-space-36)] h-[var(--st-space-36)] rounded-[var(--st-radius-md)] flex items-center justify-center"
            style={{
              backgroundColor: "var(--st-status-canceled-soft)",
              color: "var(--st-status-canceled-text)",
            }}
          >
            <AlertTriangle className="w-[var(--st-icon-lg)] h-[var(--st-icon-lg)]" />
          </div>
          <div className="flex flex-col gap-[var(--st-space-4)] min-w-0">
            <h2 className="m-0 text-[length:var(--st-text-base)] leading-[var(--st-leading-base)] font-semibold text-[color:var(--st-text-primary)]">
              {lang.confirmModal.title}
            </h2>
            <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-secondary)]">
              {role === "fix"
                ? lang.confirmModal.subtitleFix
                : lang.confirmModal.subtitleCustom}
            </p>
          </div>
        </div>

        <div
          className="rounded-[var(--st-radius-md)] border p-[var(--st-space-12)] flex flex-col gap-[var(--st-space-8)] max-h-[200px] overflow-y-auto"
          style={{
            backgroundColor: "var(--st-bg-terminal)",
            borderColor: "var(--st-border-subtle)",
          }}
        >
          {targets.map((target) => (
            <div
              key={target.commandId}
              className="flex flex-col gap-[var(--st-space-2)]"
            >
              <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-secondary)]">
                {target.commandName}
              </span>
              <code className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-accent-text)] break-all">
                {target.resolvedRun}
              </code>
            </div>
          ))}
        </div>

        <label className="flex items-center gap-[var(--st-space-8)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipFuture}
            onChange={(e) => setSkipFuture(e.target.checked)}
            className="w-[var(--st-space-16)] h-[var(--st-space-16)] accent-[var(--st-accent)] cursor-pointer"
          />
          <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-secondary)]">
            {lang.confirmModal.skipFutureLabel}
          </span>
        </label>

        <div className="flex items-center justify-end gap-[var(--st-space-12)] pt-[var(--st-space-4)]">
          <Button size="md" variant="surface" onClick={onCancel}>
            {lang.confirmModal.cancelBtn}
          </Button>
          <Button size="md" variant="primary" onClick={() => onConfirm(skipFuture)}>
            {lang.confirmModal.confirmBtn}
          </Button>
        </div>
      </div>
    </div>
  );
}
