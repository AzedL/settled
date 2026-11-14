import {
  AlertCircle,
  Ban,
  Play,
  RotateCcw,
  Search,
  Tag,
  X,
} from "lucide-react";
import { lang } from "../lang";
import type {
  CommandRuntimeState,
  RunStatus,
  ScopeMode,
  StatusFilter,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "../types";
import {
  computeCheckStats,
  getApplicableCheckCommands,
  getCommandRuntime,
  matchesItemFilters,
} from "../utils/itemStatus";
import { TrafficLed } from "./TrafficLed";

interface SidebarProps {
  workspace: WorkspaceSnapshot;
  scope: ScopeMode;
  search: string;
  selectedTag: string | null;
  statusFilter: StatusFilter;
  selectedItemId: string | null;
  runtimeMap: Record<string, CommandRuntimeState>;
  onSearchChange: (value: string) => void;
  onSelectTag: (tag: string | null) => void;
  onStatusFilterChange: (filter: StatusFilter) => void;
  onSelectItem: (itemId: string) => void;
  onClearFilters: () => void;
  onRunFilteredChecks: (items: WorkspaceItem[]) => void;
}

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: lang.filters.statusAll },
  { value: "has-fail", label: lang.filters.statusHasFail },
  { value: "has-idle", label: lang.filters.statusHasIdle },
  { value: "all-pass", label: lang.filters.statusAllPass },
  { value: "no-check", label: lang.filters.statusNoCheck },
];

export function Sidebar({
  workspace,
  scope,
  search,
  selectedTag,
  statusFilter,
  selectedItemId,
  runtimeMap,
  onSearchChange,
  onSelectTag,
  onStatusFilterChange,
  onSelectItem,
  onClearFilters,
  onRunFilteredChecks,
}: SidebarProps) {
  const scopedItems =
    scope === "current"
      ? workspace.items.filter((item) => item.applicable)
      : workspace.items;

  const filteredItems = workspace.items.filter((item) =>
    matchesItemFilters(item, runtimeMap, {
      scope,
      search,
      selectedTag,
      statusFilter,
    })
  );

  const hasActiveFilters =
    search.trim().length > 0 || selectedTag !== null || statusFilter !== "all";

  const stats = computeCheckStats(scopedItems, runtimeMap);
  const filteredRunnableCheckCount = filteredItems.reduce(
    (sum, item) => sum + getApplicableCheckCommands(item).length,
    0
  );

  return (
    <aside
      className="w-[var(--st-sidebar-w)] shrink-0 border-r flex flex-col min-h-0"
      style={{
        backgroundColor: "var(--st-bg-panel)",
        borderColor: "var(--st-border-subtle)",
      }}
    >
      <div
        className="p-[var(--st-space-12)] border-b flex flex-col gap-[var(--st-space-10)] shrink-0"
        style={{ borderColor: "var(--st-border-subtle)" }}
      >
        <div
          className="flex items-center gap-[var(--st-space-8)] px-[var(--st-space-10)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border"
          style={{
            backgroundColor: "var(--st-bg-canvas)",
            borderColor: "var(--st-border-default)",
          }}
        >
          <Search
            className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0"
            style={{ color: "var(--st-text-muted)" }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={lang.filters.searchPlaceholder}
            className="w-full min-w-0 bg-transparent outline-none text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-primary)] placeholder:text-[color:var(--st-text-muted)]"
          />
          {search.length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label={lang.filters.clearSearchAria}
              className="p-[var(--st-space-2)] rounded-[var(--st-radius-sm)] cursor-pointer transition-colors"
              style={{ color: "var(--st-text-muted)" }}
            >
              <X className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-[var(--st-space-6)]">
          {STATUS_FILTER_OPTIONS.map((option) => {
            const active = statusFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onStatusFilterChange(option.value)}
                className="px-[var(--st-space-8)] py-[var(--st-space-4)] rounded-[var(--st-radius-sm)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer transition-colors"
                style={{
                  backgroundColor: active
                    ? "var(--st-accent-soft)"
                    : "var(--st-bg-surface)",
                  borderColor: active
                    ? "var(--st-border-accent)"
                    : "var(--st-border-subtle)",
                  color: active
                    ? "var(--st-accent-text)"
                    : "var(--st-text-secondary)",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {workspace.allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-[var(--st-space-6)]">
            <button
              type="button"
              onClick={() => onSelectTag(null)}
              className="inline-flex items-center gap-[var(--st-space-4)] px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-pill)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] cursor-pointer transition-colors"
              style={{
                backgroundColor:
                  selectedTag === null
                    ? "var(--st-bg-surface-active)"
                    : "transparent",
                borderColor:
                  selectedTag === null
                    ? "var(--st-border-strong)"
                    : "var(--st-border-subtle)",
                color:
                  selectedTag === null
                    ? "var(--st-text-primary)"
                    : "var(--st-text-muted)",
              }}
            >
              <Tag className="w-[var(--st-space-12)] h-[var(--st-space-12)]" />
              <span>{lang.filters.allTags}</span>
            </button>

            {workspace.allTags.map((tag) => {
              const active = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onSelectTag(active ? null : tag)}
                  className="px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-pill)] border font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active
                      ? "var(--st-accent-soft)"
                      : "var(--st-bg-surface)",
                    borderColor: active
                      ? "var(--st-border-accent)"
                      : "var(--st-border-subtle)",
                    color: active
                      ? "var(--st-accent-text)"
                      : "var(--st-text-secondary)",
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-[var(--st-space-6)] pt-[var(--st-space-2)]">
          <div className="flex items-center justify-between gap-[var(--st-space-8)]">
            <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-secondary)]">
              {lang.filters.itemsSummary(filteredItems.length, scopedItems.length)}
            </span>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={onClearFilters}
                className="inline-flex items-center gap-[var(--st-space-4)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] cursor-pointer transition-colors"
                style={{ color: "var(--st-accent-text)" }}
              >
                <RotateCcw className="w-[var(--st-space-12)] h-[var(--st-space-12)]" />
                <span>{lang.filters.clearFilters}</span>
              </button>
            )}
          </div>

          <span className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)]">
            {lang.filters.checksCounter(
              stats.pass,
              stats.fail,
              stats.idle,
              stats.running
            )}
          </span>

          {hasActiveFilters && filteredRunnableCheckCount > 0 && (
            <button
              type="button"
              onClick={() => onRunFilteredChecks(filteredItems)}
              className="w-full inline-flex items-center justify-center gap-[var(--st-space-6)] px-[var(--st-space-10)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer transition-colors"
              style={{
                backgroundColor: "var(--st-accent-soft)",
                borderColor: "var(--st-border-accent)",
                color: "var(--st-accent-text)",
              }}
            >
              <Play className="w-[var(--st-space-12)] h-[var(--st-space-12)]" />
              <span>{lang.filters.runFilteredChecks(filteredRunnableCheckCount)}</span>
            </button>
          )}
        </div>
      </div>

      {!workspace.itemsDirExists && (
        <div
          className="m-[var(--st-space-10)] p-[var(--st-space-10)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
          style={{
            backgroundColor: "var(--st-status-canceled-soft)",
            borderColor: "var(--st-border-warn)",
            color: "var(--st-status-canceled-text)",
          }}
        >
          {lang.sidebar.missingItemsDirHint}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-[var(--st-space-10)] flex flex-col gap-[var(--st-space-8)]">
        {filteredItems.length === 0 ? (
          <div className="p-[var(--st-space-24)] text-center flex flex-col items-center gap-[var(--st-space-12)]">
            <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-muted)]">
              {workspace.items.length === 0
                ? lang.sidebar.noItemsInWorkspace
                : lang.sidebar.noItemsMatch}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={onClearFilters}
                className="px-[var(--st-space-12)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer"
                style={{
                  backgroundColor: "var(--st-bg-surface)",
                  borderColor: "var(--st-border-default)",
                  color: "var(--st-text-primary)",
                }}
              >
                {lang.filters.clearFilters}
              </button>
            )}
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = item.id === selectedItemId;
            const checkGroup = item.scriptGroups.find(
              (group) => group.role === "check"
            );
            const displayedCheckCommands = checkGroup
              ? scope === "current"
                ? checkGroup.commands.filter((cmd) => cmd.applicable)
                : checkGroup.commands
              : [];
            const applicableCheckCount = getApplicableCheckCommands(item).length;

            const cardBg = !item.applicable
              ? isSelected
                ? "var(--st-bg-surface)"
                : "var(--st-bg-disabled)"
              : isSelected
                ? "var(--st-bg-surface-active)"
                : "var(--st-bg-surface)";

            const cardBorder = !item.applicable
              ? isSelected
                ? "var(--st-border-strong)"
                : "var(--st-border-subtle)"
              : isSelected
                ? "var(--st-border-accent)"
                : "var(--st-border-default)";

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectItem(item.id)}
                className={`w-full text-left p-[var(--st-space-12)] rounded-[var(--st-radius-md)] border flex flex-col gap-[var(--st-space-8)] cursor-pointer transition-colors ${
                  !item.applicable ? "border-dashed" : ""
                }`}
                style={{
                  backgroundColor: cardBg,
                  borderColor: cardBorder,
                  opacity: item.applicable ? 1 : 0.72,
                }}
              >
                <div className="flex items-start justify-between gap-[var(--st-space-8)]">
                  <div className="flex flex-col gap-[var(--st-space-2)] min-w-0">
                    <span
                      className="text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-semibold truncate"
                      style={{
                        color: item.applicable
                          ? "var(--st-text-primary)"
                          : "var(--st-text-muted)",
                      }}
                    >
                      {item.name}
                    </span>
                    <span
                      className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] truncate"
                      style={{
                        color: item.applicable
                          ? "var(--st-text-muted)"
                          : "var(--st-text-disabled)",
                      }}
                    >
                      {item.id}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-[var(--st-space-4)] shrink-0">
                    {!item.applicable && (
                      <span
                        className="inline-flex items-center gap-[var(--st-space-4)] px-[var(--st-space-6)] py-[var(--st-space-2)] rounded-[var(--st-radius-sm)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                        style={{
                          backgroundColor: "var(--st-status-disabled-soft)",
                          color: "var(--st-status-disabled-text)",
                        }}
                      >
                        <Ban className="w-[var(--st-space-12)] h-[var(--st-space-12)]" />
                        <span>{lang.sidebar.disabledOsBadge}</span>
                      </span>
                    )}

                    {item.parseError && (
                      <span
                        className="inline-flex items-center gap-[var(--st-space-4)] px-[var(--st-space-6)] py-[var(--st-space-2)] rounded-[var(--st-radius-sm)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                        style={{
                          backgroundColor: "var(--st-status-fail-soft)",
                          color: "var(--st-status-fail-text)",
                        }}
                      >
                        <AlertCircle className="w-[var(--st-space-12)] h-[var(--st-space-12)]" />
                        <span>{lang.sidebar.parseErrorBadge}</span>
                      </span>
                    )}
                  </div>
                </div>

                {item.description && (
                  <p
                    className="m-0 text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] line-clamp-2"
                    style={{
                      color: item.applicable
                        ? "var(--st-text-secondary)"
                        : "var(--st-text-disabled)",
                    }}
                  >
                    {item.description}
                  </p>
                )}

                <div className="flex items-center justify-between gap-[var(--st-space-8)] pt-[var(--st-space-2)]">
                  {displayedCheckCommands.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-[var(--st-space-6)] min-w-0">
                      {displayedCheckCommands.map((cmd) => {
                        const effectiveApplicable =
                          item.applicable && cmd.applicable;
                        const status: RunStatus | "disabled" = effectiveApplicable
                          ? getCommandRuntime(runtimeMap, cmd.commandId).status
                          : "disabled";
                        const tooltipPlatforms =
                          cmd.platforms.length > 0 ? cmd.platforms : item.platforms;
                        const title = effectiveApplicable
                          ? `${cmd.name}: ${lang.status.label(
                              getCommandRuntime(runtimeMap, cmd.commandId).status
                            )}`
                          : lang.sidebar.disabledCommandTooltip(
                              cmd.name,
                              tooltipPlatforms
                            );

                        return (
                          <TrafficLed
                            key={cmd.commandId}
                            status={status}
                            size="sm"
                            title={title}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <span
                      className="px-[var(--st-space-6)] py-[var(--st-space-2)] rounded-[var(--st-radius-sm)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                      style={{
                        backgroundColor: "var(--st-status-idle-soft)",
                        color: "var(--st-text-muted)",
                      }}
                    >
                      {lang.sidebar.noCheckBadge}
                    </span>
                  )}

                  {applicableCheckCount > 0 && (
                    <span className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-muted)] shrink-0">
                      {lang.sidebar.commandsCount(applicableCheckCount)}
                    </span>
                  )}
                </div>

                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-[var(--st-space-4)]">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-[var(--st-space-6)] py-[var(--st-space-2)] rounded-[var(--st-radius-sm)] font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]"
                        style={{
                          backgroundColor: "var(--st-bg-canvas)",
                          color: item.applicable
                            ? "var(--st-text-muted)"
                            : "var(--st-text-disabled)",
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
