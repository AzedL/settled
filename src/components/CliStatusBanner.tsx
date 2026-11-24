import { useEffect, useRef, useState } from "react";
import { Check, Copy, Terminal, X } from "lucide-react";
import { lang } from "../lang";
import type { CliRegistrationInfo } from "../types";
import { Button } from "./Button";

interface CliStatusBannerProps {
  info: CliRegistrationInfo;
  isRegistering: boolean;
  errorMessage: string | null;
  onRegister: () => void;
  onCopyCommand: (command: string) => Promise<void> | void;
  onDismiss: () => void;
}

export function CliStatusBanner({
  info,
  isRegistering,
  errorMessage,
  onRegister,
  onCopyCommand,
  onDismiss,
}: CliStatusBannerProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (
    info.status !== "not_in_path" &&
    info.status !== "needs_applications_move"
  ) {
    return null;
  }

  const isNeedsMove = info.status === "needs_applications_move";
  const message = isNeedsMove
    ? lang.cliBanner.needsApplicationsMove
    : lang.cliBanner.notInPath;

  const handleCopy = async () => {
    if (!info.manualCommand) {
      return;
    }
    try {
      await onCopyCommand(info.manualCommand);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      // Ignore clipboard errors silently.
    }
  };

  return (
    <div
      role="status"
      className="shrink-0 border-b px-[var(--st-space-16)] py-[var(--st-space-8)] flex items-center justify-between gap-[var(--st-space-12)]"
      style={{
        backgroundColor: "var(--st-bg-panel)",
        borderColor: "var(--st-border-subtle)",
      }}
    >
      <div className="flex items-center gap-[var(--st-space-8)] min-w-0">
        <Terminal
          className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0"
          style={{ color: "var(--st-status-canceled-text)" }}
        />
        <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-primary)] truncate">
          {message}
        </span>
        {errorMessage && (
          <span
            className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] truncate"
            style={{ color: "var(--st-status-fail-text)" }}
            title={errorMessage}
          >
            {errorMessage}
          </span>
        )}
      </div>

      <div className="flex items-center gap-[var(--st-space-8)] shrink-0">
        {!isNeedsMove && (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={isRegistering}
              onClick={onRegister}
            >
              {isRegistering
                ? lang.cliBanner.registeringBtn
                : lang.cliBanner.registerBtn}
            </Button>
            {info.manualCommand && (
              <Button
                size="sm"
                variant="surface"
                onClick={() => void handleCopy()}
              >
                {copied ? (
                  <Check className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
                ) : (
                  <Copy className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
                )}
                <span>
                  {copied
                    ? lang.cliBanner.copiedCmdBtn
                    : lang.cliBanner.copyCmdBtn}
                </span>
              </Button>
            )}
          </>
        )}

        <Button
          size="sm"
          variant="surface"
          iconOnly
          aria-label={lang.cliBanner.dismissAria}
          title={lang.cliBanner.dismissAria}
          onClick={onDismiss}
        >
          <X className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
        </Button>
      </div>
    </div>
  );
}
