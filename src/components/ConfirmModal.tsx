import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { lang } from "../lang";
import type { ResolvedCommand } from "../types";
import { Button } from "./Button";

interface ConfirmModalProps {
  title: string;
  commands: ResolvedCommand[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  commands,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {

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
        <div className="flex flex-col gap-[var(--st-space-12)]">
          <div className="flex items-center gap-[var(--st-space-12)] min-w-0">
            <div
              className="shrink-0 w-[var(--st-space-36)] h-[var(--st-space-36)] rounded-[var(--st-radius-md)] flex items-center justify-center"
              style={{
                backgroundColor: "var(--st-status-canceled-soft)",
                color: "var(--st-status-canceled-text)",
              }}
            >
              <AlertTriangle className="w-[var(--st-icon-lg)] h-[var(--st-icon-lg)]" />
            </div>
            <h2
              className="m-0 text-[length:var(--st-text-base)] leading-[var(--st-leading-base)] font-semibold text-[color:var(--st-text-primary)] truncate min-w-0 flex-1"
              title={title}
            >
              {title}
            </h2>
          </div>

          <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-secondary)]">
            {lang.confirmModal.subtitle}
          </p>
        </div>

        <div
          className="rounded-[var(--st-radius-md)] border p-[var(--st-space-12)] flex flex-col gap-[var(--st-space-8)] max-h-[200px] overflow-y-auto"
          style={{
            backgroundColor: "var(--st-bg-terminal)",
            borderColor: "var(--st-border-subtle)",
          }}
        >
          {commands.map((cmd) => (
            <div
              key={cmd.commandId}
              className="flex flex-col gap-[var(--st-space-2)]"
            >
              {cmd.name !== cmd.rawRun && (
                <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-secondary)]">
                  {cmd.name}
                </span>
              )}
              <code className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-accent-text)] break-all">
                {cmd.rawRun}
              </code>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-[var(--st-space-12)] pt-[var(--st-space-4)]">
          <Button size="md" variant="surface" onClick={onCancel}>
            {lang.confirmModal.cancelBtn}
          </Button>
          <Button size="md" variant="primary" onClick={onConfirm}>
            {lang.confirmModal.confirmBtn}
          </Button>
        </div>
      </div>
    </div>
  );
}
