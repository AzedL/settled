import { FolderOpen, History, Layers, Sparkles } from "lucide-react";
import { lang } from "../lang";
import type { Platform } from "../types";

interface WelcomeViewProps {
  hostPlatform: Platform;
  recentWorkspaces: string[];
  hasSampleWorkspace: boolean;
  onOpenWorkspace: () => void;
  onLoadSample: () => void;
  onOpenRecent: (path: string) => void;
}

export function WelcomeView({
  hostPlatform,
  recentWorkspaces,
  hasSampleWorkspace,
  onOpenWorkspace,
  onLoadSample,
  onOpenRecent,
}: WelcomeViewProps) {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center p-[var(--st-space-24)]">
      <div
        className="w-full max-w-[var(--st-welcome-w)] rounded-[var(--st-radius-xl)] border p-[var(--st-space-32)] flex flex-col gap-[var(--st-space-24)]"
        style={{
          backgroundColor: "var(--st-bg-panel)",
          borderColor: "var(--st-border-default)",
          boxShadow: "var(--st-shadow-card)",
        }}
      >
        <div className="flex flex-col gap-[var(--st-space-12)]">
          <div className="flex items-center gap-[var(--st-space-12)]">
            <img
              src="/icon.svg"
              alt=""
              className="w-[var(--st-space-40)] h-[var(--st-space-40)] shrink-0"
            />
            <div className="flex flex-wrap items-center gap-[var(--st-space-8)] min-w-0">
              <span
                className="px-[var(--st-space-10)] py-[var(--st-space-4)] rounded-[var(--st-radius-pill)] font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium"
                style={{
                  backgroundColor: "var(--st-accent-soft)",
                  color: "var(--st-accent-text)",
                }}
              >
                {lang.app.platformLabel(hostPlatform)}
              </span>
              <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
                {lang.app.tagline}
              </span>
            </div>
          </div>

          <h1 className="m-0 text-[length:var(--st-text-2xl)] leading-[var(--st-leading-2xl)] font-bold text-[color:var(--st-text-primary)]">
            {lang.welcome.title}
          </h1>
          <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-secondary)]">
            {lang.welcome.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--st-space-12)]">
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="inline-flex items-center gap-[var(--st-space-8)] px-[var(--st-space-16)] py-[var(--st-space-10)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-semibold cursor-pointer transition-colors"
            style={{
              backgroundColor: "var(--st-accent)",
              borderColor: "var(--st-accent)",
              color: "var(--st-accent-contrast)",
            }}
          >
            <FolderOpen className="w-[var(--st-icon-md)] h-[var(--st-icon-md)]" />
            <span>{lang.welcome.openFolderBtn}</span>
          </button>

          {hasSampleWorkspace && (
            <button
              type="button"
              onClick={onLoadSample}
              className="inline-flex items-center gap-[var(--st-space-8)] px-[var(--st-space-16)] py-[var(--st-space-10)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-medium cursor-pointer transition-colors"
              style={{
                backgroundColor: "var(--st-bg-surface)",
                borderColor: "var(--st-border-default)",
                color: "var(--st-text-primary)",
              }}
            >
              <Sparkles className="w-[var(--st-icon-md)] h-[var(--st-icon-md)]" />
              <span>{lang.welcome.loadSampleBtn}</span>
            </button>
          )}
        </div>

        {recentWorkspaces.length > 0 && (
          <div className="flex flex-col gap-[var(--st-space-10)]">
            <div className="flex items-center gap-[var(--st-space-6)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold text-[color:var(--st-text-secondary)]">
              <History className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
              <span>{lang.welcome.recentTitle}</span>
            </div>

            <div className="flex flex-col gap-[var(--st-space-6)]">
              {recentWorkspaces.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => onOpenRecent(path)}
                  className="w-full text-left px-[var(--st-space-12)] py-[var(--st-space-8)] rounded-[var(--st-radius-md)] border font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] truncate cursor-pointer transition-colors"
                  style={{
                    backgroundColor: "var(--st-bg-surface)",
                    borderColor: "var(--st-border-subtle)",
                    color: "var(--st-text-primary)",
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className="rounded-[var(--st-radius-md)] border p-[var(--st-space-14)] flex items-start gap-[var(--st-space-10)]"
          style={{
            backgroundColor: "var(--st-bg-canvas)",
            borderColor: "var(--st-border-subtle)",
          }}
        >
          <Layers
            className="w-[var(--st-icon-md)] h-[var(--st-icon-md)] shrink-0 mt-[var(--st-space-2)]"
            style={{ color: "var(--st-accent-text)" }}
          />
          <div className="flex flex-col gap-[var(--st-space-4)] min-w-0">
            <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold text-[color:var(--st-text-secondary)]">
              {lang.welcome.protocolHintTitle}
            </span>
            <code className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)] break-all">
              {lang.welcome.protocolHintBody}
            </code>
          </div>
        </div>
      </div>
    </main>
  );
}
