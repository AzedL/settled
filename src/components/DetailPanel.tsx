import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  FolderSearch,
  Sparkles,
} from "lucide-react";
import { lang } from "../lang";
import type {
  CommandRuntimeState,
  Platform,
  ResolvedCommand,
  ScopeMode,
  ScriptGroup,
  WorkspaceItem,
} from "../types";
import { formatLocalDateTime } from "../utils/format";
import { getCommandRuntime } from "../utils/itemStatus";
import { MarkdownView } from "./MarkdownView";
import { ScriptGroupCard } from "./ScriptGroupCard";

interface DetailPanelProps {
  item: WorkspaceItem | null;
  hostPlatform: Platform;
  scope: ScopeMode;
  runtimeMap: Record<string, CommandRuntimeState>;
  verifyingItemId: string | null;
  onRunGroup: (item: WorkspaceItem, group: ScriptGroup) => void;
  onRunCommand: (
    item: WorkspaceItem,
    group: ScriptGroup,
    cmd: ResolvedCommand
  ) => void;
  onStopCommand: (commandId: string) => void;
  onOpenInVscode: (path: string) => void;
  onRevealInExplorer: (path: string) => void;
  onCopyAiContext: (item: WorkspaceItem) => Promise<void>;
}

const ALL_PLATFORMS: Platform[] = ["windows", "macos", "linux"];

interface CollapsibleDetailCardProps {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  rightHint?: string;
  bodyStyle?: CSSProperties;
  bodyClassName?: string;
  children: ReactNode;
}

function CollapsibleDetailCard({
  title,
  icon,
  open,
  onToggle,
  rightHint,
  bodyStyle,
  bodyClassName = "",
  children,
}: CollapsibleDetailCardProps) {
  return (
    <section
      className="rounded-[var(--st-radius-lg)] border overflow-hidden"
      style={{
        backgroundColor: "var(--st-bg-panel)",
        borderColor: "var(--st-border-default)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-[var(--st-space-16)] py-[var(--st-space-12)] flex items-center justify-between gap-[var(--st-space-12)] text-left cursor-pointer st-control st-raw-toggle"
      >
        <div className="flex items-center gap-[var(--st-space-8)] min-w-0">
          {open ? (
            <ChevronDown className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
          ) : (
            <ChevronRight className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
          )}
          <span
            className="inline-flex items-center shrink-0"
            style={{ color: "var(--st-text-muted)" }}
          >
            {icon}
          </span>
          <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium truncate">
            {title}
          </span>
        </div>

        {rightHint && (
          <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)] shrink-0">
            {rightHint}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`border-t max-h-[var(--st-doc-max-h)] ${bodyClassName}`}
          style={{
            borderColor: "var(--st-border-subtle)",
            ...bodyStyle,
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

export function DetailPanel({
  item,
  hostPlatform,
  scope,
  runtimeMap,
  verifyingItemId,
  onRunGroup,
  onRunCommand,
  onStopCommand,
  onOpenInVscode,
  onRevealInExplorer,
  onCopyAiContext,
}: DetailPanelProps) {
  const [copiedContext, setCopiedContext] = useState(false);
  const [showReadme, setShowReadme] = useState(false);
  const [showRawMeta, setShowRawMeta] = useState(false);

  useEffect(() => {
    setCopiedContext(false);
    setShowReadme(false);
    setShowRawMeta(false);
  }, [item?.id]);

  if (!item) {
    return (
      <main className="flex-1 min-w-0 flex items-center justify-center p-[var(--st-space-32)]">
        <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-muted)] text-center">
          {lang.detail.selectItemPrompt}
        </p>
      </main>
    );
  }

  const checkGroup = item.scriptGroups.find((g) => g.role === "check");
  const hasFailingCheck =
    checkGroup?.commands.some((cmd) => {
      if (!cmd.applicable) {
        return false;
      }
      const status = getCommandRuntime(runtimeMap, cmd.commandId).status;
      return status === "fail" || status === "canceled";
    }) ?? false;

  const isVerifyingFix = verifyingItemId === item.id;

  const effectivePlatforms =
    item.platforms.length > 0 ? item.platforms : ALL_PLATFORMS;
  const platformsText = effectivePlatforms.map(lang.app.platformLabel).join(" / ");

  const createdAtText = formatLocalDateTime(item.createAt);
  const hasReadme = item.readme.trim().length > 0;

  const handleCopyContext = async () => {
    await onCopyAiContext(item);
    setCopiedContext(true);
    window.setTimeout(() => setCopiedContext(false), 2000);
  };

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-[var(--st-space-24)]">
      <div className="max-w-[960px] mx-auto flex flex-col gap-[var(--st-space-20)]">
        <section
          className="rounded-[var(--st-radius-lg)] border p-[var(--st-space-20)] flex flex-col gap-[var(--st-space-16)]"
          style={{
            backgroundColor: item.applicable
              ? "var(--st-bg-panel)"
              : "var(--st-bg-disabled)",
            borderColor: item.applicable
              ? "var(--st-border-default)"
              : "var(--st-border-subtle)",
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-[var(--st-space-16)]">
            <div className="flex flex-col gap-[var(--st-space-6)] min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-[var(--st-space-10)]">
                <h1 className="m-0 text-[length:var(--st-text-xl)] leading-[var(--st-leading-xl)] font-bold text-[color:var(--st-text-primary)]">
                  {item.name}
                </h1>
                {!item.applicable && (
                  <span
                    className="inline-flex items-center gap-[var(--st-space-4)] px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-pill)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium"
                    style={{
                      backgroundColor: "var(--st-status-disabled-soft)",
                      borderColor: "var(--st-border-subtle)",
                      color: "var(--st-status-disabled-text)",
                    }}
                  >
                    <Ban className="w-[var(--st-space-12)] h-[var(--st-space-12)]" />
                    <span>{lang.sidebar.disabledOsBadge}</span>
                  </span>
                )}
              </div>

              {item.description && (
                <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-secondary)]">
                  {item.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-[var(--st-space-8)] shrink-0">
              <button
                type="button"
                onClick={() => onOpenInVscode(item.path)}
                className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer st-control st-btn-surface"
              >
                <Code2 className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
                <span>{lang.detail.openInVscode}</span>
              </button>

              <button
                type="button"
                onClick={() => onRevealInExplorer(item.metaPath)}
                className="inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer st-control st-btn-surface st-btn-surface--muted"
              >
                <FolderSearch className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
                <span>{lang.detail.revealInExplorer}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyContext}
                className={`inline-flex items-center gap-[var(--st-space-6)] px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-semibold cursor-pointer st-control ${
                  copiedContext ? "st-btn-pass-soft" : "st-btn-accent-soft"
                }`}
              >
                {copiedContext ? (
                  <Check className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
                ) : (
                  <Sparkles className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
                )}
                <span>
                  {copiedContext
                    ? lang.detail.copiedAiContext
                    : lang.detail.copyAiContext}
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[var(--st-space-10)]">
            <div
              className="rounded-[var(--st-radius-md)] border px-[var(--st-space-12)] py-[var(--st-space-8)] flex flex-col gap-[var(--st-space-2)]"
              style={{
                backgroundColor: "var(--st-bg-surface)",
                borderColor: "var(--st-border-subtle)",
              }}
            >
              <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
                {lang.detail.createdAtLabel}
              </span>
              <span className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-primary)] truncate">
                {createdAtText || lang.detail.createdAtEmpty}
              </span>
            </div>

            <div
              className="rounded-[var(--st-radius-md)] border px-[var(--st-space-12)] py-[var(--st-space-8)] flex flex-col gap-[var(--st-space-2)]"
              style={{
                backgroundColor: "var(--st-bg-surface)",
                borderColor: "var(--st-border-subtle)",
              }}
            >
              <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
                {lang.detail.platformsLabel}
              </span>
              <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-primary)] truncate">
                {platformsText}
              </span>
            </div>

            <div
              className="rounded-[var(--st-radius-md)] border px-[var(--st-space-12)] py-[var(--st-space-8)] flex flex-col gap-[var(--st-space-2)]"
              style={{
                backgroundColor: "var(--st-bg-surface)",
                borderColor: "var(--st-border-subtle)",
              }}
            >
              <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
                {lang.detail.tagsLabel}
              </span>
              {item.tags.length > 0 ? (
                <div className="flex flex-wrap gap-[var(--st-space-4)]">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-accent-text)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
                  {lang.detail.noTagsValue}
                </span>
              )}
            </div>
          </div>
        </section>

        {!item.applicable && (
          <section
            className="rounded-[var(--st-radius-lg)] border border-dashed p-[var(--st-space-16)] flex items-start gap-[var(--st-space-12)]"
            style={{
              backgroundColor: "var(--st-bg-disabled)",
              borderColor: "var(--st-border-default)",
            }}
          >
            <Ban
              className="w-[var(--st-icon-md)] h-[var(--st-icon-md)] shrink-0 mt-[var(--st-space-2)]"
              style={{ color: "var(--st-status-disabled-text)" }}
            />
            <div className="flex flex-col gap-[var(--st-space-4)] min-w-0">
              <h2 className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-semibold text-[color:var(--st-text-secondary)]">
                {lang.detail.disabledNoticeTitle}
              </h2>
              <p className="m-0 text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
                {lang.detail.disabledNoticeBody(hostPlatform, item.platforms)}
              </p>
            </div>
          </section>
        )}

        {item.parseError && (
          <section
            className="rounded-[var(--st-radius-lg)] border p-[var(--st-space-16)] flex items-start gap-[var(--st-space-12)]"
            style={{
              backgroundColor: "var(--st-status-fail-soft)",
              borderColor: "var(--st-border-danger)",
            }}
          >
            <AlertTriangle
              className="w-[var(--st-icon-md)] h-[var(--st-icon-md)] shrink-0 mt-[var(--st-space-2)]"
              style={{ color: "var(--st-status-fail-text)" }}
            />
            <div className="flex flex-col gap-[var(--st-space-4)] min-w-0">
              <h2 className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-semibold text-[color:var(--st-status-fail-text)]">
                {lang.detail.parseErrorTitle}
              </h2>
              <pre className="m-0 font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-primary)] whitespace-pre-wrap break-all">
                {item.parseError}
              </pre>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-[var(--st-space-12)]">
          <h2 className="m-0 text-[length:var(--st-text-base)] leading-[var(--st-leading-base)] font-semibold text-[color:var(--st-text-primary)]">
            {lang.detail.scriptsSectionTitle}
          </h2>

          {item.scriptGroups.length === 0 ? (
            <div
              className="rounded-[var(--st-radius-lg)] border p-[var(--st-space-16)] text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-muted)]"
              style={{
                backgroundColor: "var(--st-bg-panel)",
                borderColor: "var(--st-border-subtle)",
              }}
            >
              {lang.detail.noScriptsNotice}
            </div>
          ) : (
            <div className="flex flex-col gap-[var(--st-space-12)]">
              {item.scriptGroups.map((group) => (
                <ScriptGroupCard
                  key={group.key}
                  group={group}
                  itemApplicable={item.applicable}
                  scope={scope}
                  runtimeMap={runtimeMap}
                  hasFailingCheck={hasFailingCheck}
                  isVerifyingFix={isVerifyingFix}
                  onRunGroup={(targetGroup) => onRunGroup(item, targetGroup)}
                  onRunCommand={(targetGroup, cmd) =>
                    onRunCommand(item, targetGroup, cmd)
                  }
                  onStopCommand={onStopCommand}
                />
              ))}
            </div>
          )}
        </section>

        <CollapsibleDetailCard
          title={
            showReadme
              ? lang.detail.readmeToggleHide
              : lang.detail.readmeToggleShow
          }
          icon={
            <FileText className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
          }
          open={showReadme}
          onToggle={() => setShowReadme((prev) => !prev)}
          rightHint={!hasReadme ? lang.detail.readmeEmptyHint : undefined}
          bodyClassName="p-[var(--st-space-20)] overflow-y-auto"
          bodyStyle={{ backgroundColor: "var(--st-bg-panel)" }}
        >
          <MarkdownView content={item.readme} />
        </CollapsibleDetailCard>

        <CollapsibleDetailCard
          title={
            showRawMeta
              ? lang.detail.rawMetaToggleHide
              : lang.detail.rawMetaToggleShow
          }
          icon={
            <Braces className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
          }
          open={showRawMeta}
          onToggle={() => setShowRawMeta((prev) => !prev)}
          bodyClassName="overflow-auto"
          bodyStyle={{ backgroundColor: "var(--st-bg-terminal)" }}
        >
          <pre
            className="m-0 min-w-full w-max p-[var(--st-space-16)] font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
            style={{ color: "var(--st-text-secondary)" }}
          >
            {item.rawMeta}
          </pre>
        </CollapsibleDetailCard>
      </div>
    </main>
  );
}
