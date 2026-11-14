import {
  FolderOpen,
  Monitor,
  Moon,
  Play,
  RefreshCw,
  Square,
  Sun,
} from "lucide-react";
import { lang } from "../lang";
import type { ThemeMode, WorkspaceSnapshot } from "../types";
import { Button } from "./Button";

interface HeaderBarProps {
  workspace: WorkspaceSnapshot | null;
  themeMode: ThemeMode;
  isCheckingActive: boolean;
  hasSampleWorkspace: boolean;
  onChangeThemeMode: (mode: ThemeMode) => void;
  onOpenWorkspace: () => void;
  onLoadSample: () => void;
  onReload: () => void;
  onRunChecks: () => void;
  onStopChecks: () => void;
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
  themeMode,
  isCheckingActive,
  hasSampleWorkspace,
  onChangeThemeMode,
  onOpenWorkspace,
  onLoadSample,
  onReload,
  onRunChecks,
  onStopChecks,
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
          <span className="text-[length:var(--st-text-base)] leading-[var(--st-leading-base)] font-bold tracking-tight text-[color:var(--st-text-primary)]">
            {lang.app.name}
          </span>
          <span className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)] truncate">
            {workspace ? workspace.rootPath : lang.header.noWorkspaceLoaded}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-[var(--st-space-8)] shrink-0">
        {workspace && (
          <>
            <Button
              size="md"
              variant={isCheckingActive ? "warn-soft" : "primary"}
              onClick={isCheckingActive ? onStopChecks : onRunChecks}
            >
              {isCheckingActive ? (
                <Square className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
              ) : (
                <Play className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
              )}
              <span>
                {isCheckingActive
                  ? lang.header.stopChecks
                  : lang.header.runChecks}
              </span>
            </Button>

            <Button
              size="md"
              variant="surface"
              iconOnly
              onClick={onReload}
              title={lang.header.reload}
              aria-label={lang.header.reload}
            >
              <RefreshCw className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            </Button>
          </>
        )}

        {!workspace && hasSampleWorkspace && (
          <Button size="md" variant="surface" onClick={onLoadSample}>
            {lang.header.loadSample}
          </Button>
        )}

        <Button size="md" variant="surface" onClick={onOpenWorkspace}>
          <FolderOpen className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
          <span>
            {workspace ? lang.header.switchWorkspace : lang.header.openWorkspace}
          </span>
        </Button>

        <div
          className="h-[var(--st-control-h)] inline-flex items-center gap-[var(--st-space-4)] rounded-[var(--st-radius-md)] border p-[var(--st-space-4)]"
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
                data-active={active ? "true" : "false"}
                data-accent-active={active ? "true" : "false"}
                className="h-full inline-flex items-center justify-center px-[var(--st-space-6)] rounded-[var(--st-radius-sm)] cursor-pointer st-control st-segmented-btn"
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
