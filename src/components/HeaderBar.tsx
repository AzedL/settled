import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
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
  recentWorkspaces: string[];
  themeMode: ThemeMode;
  isCheckingActive: boolean;
  onChangeThemeMode: (mode: ThemeMode) => void;
  onOpenWorkspace: () => void;
  onOpenRecent: (path: string) => void;
  onOpenRecentMenu?: () => void;
  onReload: () => void;
  onRunChecks: () => void;
  onStopChecks: () => void;
}

function getWorkspaceDisplayName(workspacePath: string): string {
  const segments = workspacePath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] ?? workspacePath;
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
  recentWorkspaces,
  themeMode,
  isCheckingActive,
  onChangeThemeMode,
  onOpenWorkspace,
  onOpenRecent,
  onOpenRecentMenu,
  onReload,
  onRunChecks,
  onStopChecks,
}: HeaderBarProps) {
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const recentMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!recentMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        recentMenuRef.current &&
        !recentMenuRef.current.contains(event.target as Node)
      ) {
        setRecentMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRecentMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [recentMenuOpen]);

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

        <div ref={recentMenuRef} className="relative inline-flex">
          <div
            className="h-[var(--st-control-h)] inline-flex items-stretch rounded-[var(--st-radius-md)] border overflow-hidden"
            style={{ borderColor: "var(--st-border-default)" }}
          >
            <button
              type="button"
              onClick={() => {
                setRecentMenuOpen(false);
                onOpenWorkspace();
              }}
              className="h-full px-[var(--st-space-12)] inline-flex items-center gap-[var(--st-space-6)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium whitespace-nowrap cursor-pointer st-control st-btn-surface border-0"
            >
              <FolderOpen className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
              <span>{lang.header.openWorkspace}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !recentMenuOpen;
                setRecentMenuOpen(next);
                if (next) {
                  onOpenRecentMenu?.();
                }
              }}
              aria-expanded={recentMenuOpen}
              aria-haspopup="menu"
              aria-label={lang.header.recentWorkspacesAria}
              title={lang.header.recentWorkspacesAria}
              className="h-full w-[var(--st-control-h-sm)] inline-flex items-center justify-center border-l cursor-pointer st-control st-btn-surface"
              style={{ borderLeftColor: "var(--st-border-default)" }}
            >
              <ChevronDown className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            </button>
          </div>

          {recentMenuOpen && (
            <div
              role="menu"
              aria-label={lang.header.recentWorkspacesTitle}
              className="absolute right-0 top-[calc(100%+var(--st-space-6))] z-50 w-[340px] max-w-[calc(100vw-32px)] rounded-[var(--st-radius-md)] border p-[var(--st-space-6)] flex flex-col gap-[var(--st-space-4)]"
              style={{
                backgroundColor: "var(--st-bg-panel)",
                borderColor: "var(--st-border-default)",
                boxShadow: "var(--st-shadow-card)",
              }}
            >
              <div className="px-[var(--st-space-8)] py-[var(--st-space-4)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-muted)]">
                {lang.header.recentWorkspacesTitle}
              </div>

              {recentWorkspaces.length === 0 ? (
                <div className="px-[var(--st-space-8)] py-[var(--st-space-12)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)] text-center">
                  {lang.header.recentWorkspacesEmpty}
                </div>
              ) : (
                <div className="max-h-[var(--st-dropdown-max-h)] overflow-y-auto flex flex-col gap-[var(--st-space-2)]">
                  {recentWorkspaces.map((path) => {
                    const isCurrent = workspace?.rootPath === path;
                    return (
                      <button
                        key={path}
                        type="button"
                        role="menuitem"
                        title={path}
                        data-active={isCurrent ? "true" : "false"}
                        onClick={() => {
                          setRecentMenuOpen(false);
                          onOpenRecent(path);
                        }}
                        className="w-full text-left px-[var(--st-space-8)] py-[var(--st-space-6)] rounded-[var(--st-radius-sm)] flex items-center justify-between gap-[var(--st-space-8)] cursor-pointer st-control st-dropdown-item"
                      >
                        <div className="min-w-0 flex-1 flex flex-col gap-[var(--st-space-2)]">
                          <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-primary)] truncate">
                            {getWorkspaceDisplayName(path)}
                          </span>
                          <span className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)] truncate">
                            {path}
                          </span>
                        </div>
                        {isCurrent && (
                          <Check
                            className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0"
                            style={{ color: "var(--st-accent-text)" }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

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
