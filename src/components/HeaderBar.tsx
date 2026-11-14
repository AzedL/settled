import {
  FolderOpen,
  Monitor,
  Moon,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Sun,
} from "lucide-react";
import { lang } from "../lang";
import type { ScopeMode, ThemeMode, WorkspaceSnapshot } from "../types";

interface HeaderBarProps {
  workspace: WorkspaceSnapshot | null;
  scope: ScopeMode;
  themeMode: ThemeMode;
  runningCount: number;
  failedCount: number;
  hasSampleWorkspace: boolean;
  onChangeScope: (scope: ScopeMode) => void;
  onChangeThemeMode: (mode: ThemeMode) => void;
  onOpenWorkspace: () => void;
  onLoadSample: () => void;
  onReload: () => void;
  onRunAllChecks: () => void;
  onRunFailedChecks: () => void;
  onCancelAll: () => void;
}

const THEME_OPTIONS: {
  value: ThemeMode;
  label: string;
  Icon: typeof Monitor;
}[] = [
  { value: "system", label: lang.header.themeSystem, Icon: Monitor },
  { value: "light", label: lang.header.themeLight, Icon: Sun },
  { value: "dark", label: lang.header.themeDark, Icon: Moon },
];

export function HeaderBar({
  workspace,
  scope,
  themeMode,
  runningCount,
  failedCount,
  hasSampleWorkspace,
  onChangeScope,
  onChangeThemeMode,
  onOpenWorkspace,
  onLoadSample,
  onReload,
  onRunAllChecks,
  onRunFailedChecks,
  onCancelAll,
}: HeaderBarProps) {
  return (
    <header
      className="h-[var(--st-header-h)] shrink-0 border-b px-[var(--st-space-16)] flex items-center justify-between gap-[var(--st-space-16)]"
      style={{
        backgroundColor: "var(--st-bg-panel)",
        borderColor: "var(--st-border-subtle)",
      }}
    >
      <div className="flex items-center gap-[var(--st-space-12)] min-w-0">
        <img
          src="/icon.svg"
          alt=""
          className="w-[var(--st-space-32)] h-[var(--st-space-32)] shrink-0"
        />

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-[var(--st-space-8)]">
            <span className="text-[length:var(--st-text-base)] leading-[var(--st-leading-base)] font-bold tracking-tight text-[color:var(--st-text-primary)]">
              {lang.app.name}
            </span>
            {workspace && (
              <span
                className="px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-pill)] border font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                style={{
                  backgroundColor: "var(--st-bg-surface)",
                  borderColor: "var(--st-border-subtle)",
                  color: "var(--st-text-secondary)",
                }}
              >
                {lang.app.hostBadge(workspace.hostPlatform, workspace.defaultShell)}
              </span>
            )}
          </div>
          <span className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)] truncate">
            {workspace ? workspace.rootPath : lang.header.noWorkspaceLoaded}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-[var(--st-space-8)] shrink-0">
        {workspace && (
          <>
            <div
              className="inline-flex rounded-[var(--st-radius-md)] border p-[var(--st-space-2)]"
              style={{
                backgroundColor: "var(--st-bg-canvas)",
                borderColor: "var(--st-border-default)",
              }}
              role="group"
              aria-label={lang.header.scopeLabel}
            >
              <button
                type="button"
                onClick={() => onChangeScope("current")}
                className="px-[var(--st-space-10)] py-[var(--st-space-4)] rounded-[var(--st-radius-sm)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer transition-colors"
                style={{
                  backgroundColor:
                    scope === "current" ? "var(--st-bg-surface-active)" : "transparent",
                  color:
                    scope === "current"
                      ? "var(--st-text-primary)"
                      : "var(--st-text-muted)",
                }}
              >
                {lang.header.scopeCurrent}
              </button>
              <button
                type="button"
                onClick={() => onChangeScope("all")}
                className="px-[var(--st-space-10)] py-[var(--st-space-4)] rounded-[var(--st-radius-sm)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer transition-colors"
                style={{
                  backgroundColor:
                    scope === "all" ? "var(--st-bg-surface-active)" : "transparent",
                  color:
                    scope === "all"
                      ? "var(--st-text-primary)"
                      : "var(--st-text-muted)",
                }}
              >
                {lang.header.scopeAll}
              </button>
            </div>

            <button
              type="button"
              onClick={onRunAllChecks}
              className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold cursor-pointer transition-colors"
              style={{
                backgroundColor: "var(--st-accent)",
                borderColor: "var(--st-accent)",
                color: "var(--st-accent-contrast)",
              }}
            >
              <Play className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
              <span>{lang.header.runAllChecks}</span>
            </button>

            {failedCount > 0 && (
              <button
                type="button"
                onClick={onRunFailedChecks}
                className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold cursor-pointer transition-colors"
                style={{
                  backgroundColor: "var(--st-status-fail-soft)",
                  borderColor: "var(--st-border-danger)",
                  color: "var(--st-status-fail-text)",
                }}
              >
                <RotateCcw className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
                <span>{lang.header.runFailedChecks}</span>
              </button>
            )}

            {runningCount > 0 && (
              <button
                type="button"
                onClick={onCancelAll}
                className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold cursor-pointer transition-colors"
                style={{
                  backgroundColor: "var(--st-status-canceled-soft)",
                  borderColor: "var(--st-border-warn)",
                  color: "var(--st-status-canceled-text)",
                }}
              >
                <Square className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
                <span>{lang.header.cancelAll}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onReload}
              title={lang.header.reload}
              aria-label={lang.header.reload}
              className="p-[var(--st-space-8)] rounded-[var(--st-radius-md)] border cursor-pointer transition-colors"
              style={{
                backgroundColor: "var(--st-bg-surface)",
                borderColor: "var(--st-border-default)",
                color: "var(--st-text-secondary)",
              }}
            >
              <RefreshCw className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            </button>
          </>
        )}

        {!workspace && hasSampleWorkspace && (
          <button
            type="button"
            onClick={onLoadSample}
            className="px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer transition-colors"
            style={{
              backgroundColor: "var(--st-bg-surface)",
              borderColor: "var(--st-border-default)",
              color: "var(--st-text-secondary)",
            }}
          >
            {lang.header.loadSample}
          </button>
        )}

        <button
          type="button"
          onClick={onOpenWorkspace}
          className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: "var(--st-bg-surface)",
            borderColor: "var(--st-border-default)",
            color: "var(--st-text-primary)",
          }}
        >
          <FolderOpen className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
          <span>
            {workspace ? lang.header.switchWorkspace : lang.header.openWorkspace}
          </span>
        </button>

        <div
          className="inline-flex rounded-[var(--st-radius-md)] border p-[var(--st-space-2)]"
          style={{
            backgroundColor: "var(--st-bg-canvas)",
            borderColor: "var(--st-border-default)",
          }}
          role="group"
          aria-label={lang.header.themeGroupAria}
        >
          {THEME_OPTIONS.map(({ value, label, Icon }) => {
            const active = themeMode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChangeThemeMode(value)}
                title={label}
                aria-label={label}
                aria-pressed={active}
                className="p-[var(--st-space-6)] rounded-[var(--st-radius-sm)] cursor-pointer transition-colors"
                style={{
                  backgroundColor: active
                    ? "var(--st-bg-surface-active)"
                    : "transparent",
                  color: active
                    ? "var(--st-accent-text)"
                    : "var(--st-text-muted)",
                }}
              >
                <Icon className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
