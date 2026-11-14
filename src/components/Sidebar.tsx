import {
  AlertCircle,
  Play,
  Search,
  Tag,
  X,
} from "lucide-react";
import { lang } from "../lang";
import type {
  CommandRuntimeState,
  RunStatus,
  ScopeMode,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "../types";
import {
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
  selectedItemId: string | null;
  runtimeMap: Record<string, CommandRuntimeState>;
  onChangeScope: (scope: ScopeMode) => void;
  onSearchChange: (value: string) => void;
  onSelectTag: (tag: string | null) => void;
  onSelectItem: (itemId: string) => void;
  onRunFilteredChecks: (items: WorkspaceItem[]) => void;
}

export function Sidebar({
  workspace,
  scope,
  search,
  selectedTag,
  selectedItemId,
  runtimeMap,
  onChangeScope,
  onSearchChange,
  onSelectTag,
  onSelectItem,
  onRunFilteredChecks,
}: SidebarProps) {
  const scopedItems =
    scope === "current"
      ? workspace.items.filter((item) => item.applicable)
      : workspace.items;

  const filteredItems = workspace.items.filter((item) =>
    matchesItemFilters(item, {
      scope,
      search,
      selectedTag,
    })
  );

  const hasActiveFilters = search.trim().length > 0 || selectedTag !== null;

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
          className={`h-[var(--st-control-h)] flex items-center gap-[var(--st-space-8)] pl-[var(--st-space-10)] ${
            search.length > 0
              ? "pr-[var(--st-space-4)]"
              : "pr-[var(--st-space-10)]"
          } rounded-[var(--st-radius-md)] border st-search-box`}
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
              className="p-[var(--st-space-4)] rounded-[var(--st-radius-sm)] shrink-0 cursor-pointer st-control st-icon-ghost"
            >
              <X className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            </button>
          )}
        </div>

        {workspace.allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-[var(--st-space-6)]">
            <button
              type="button"
              onClick={() => onSelectTag(null)}
              data-selected={selectedTag === null ? "neutral" : undefined}
              aria-pressed={selectedTag === null}
              className="inline-flex items-center gap-[var(--st-space-4)] px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-pill)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] cursor-pointer st-control st-filter-chip st-filter-chip--ghost"
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
                  data-selected={active ? "accent" : undefined}
                  aria-pressed={active}
                  className="px-[var(--st-space-8)] py-[var(--st-space-2)] rounded-[var(--st-radius-pill)] border font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] cursor-pointer st-control st-filter-chip"
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-[var(--st-space-8)] pt-[var(--st-space-2)]">
          <div className="flex items-center justify-between gap-[var(--st-space-8)]">
            <div
              className="h-[var(--st-control-h)] inline-flex items-center gap-[var(--st-space-4)] rounded-[var(--st-radius-md)] border p-[var(--st-space-4)]"
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
                aria-pressed={scope === "current"}
                data-active={scope === "current" ? "true" : "false"}
                className="h-full inline-flex items-center px-[var(--st-space-8)] rounded-[var(--st-radius-sm)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer st-control st-segmented-btn"
              >
                {lang.header.scopeCurrent}
              </button>
              <button
                type="button"
                onClick={() => onChangeScope("all")}
                aria-pressed={scope === "all"}
                data-active={scope === "all" ? "true" : "false"}
                className="h-full inline-flex items-center px-[var(--st-space-8)] rounded-[var(--st-radius-sm)] text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer st-control st-segmented-btn"
              >
                {lang.header.scopeAll}
              </button>
            </div>

            <span className="font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium text-[color:var(--st-text-muted)] tabular-nums">
              {lang.filters.itemsSummary(filteredItems.length, scopedItems.length)}
            </span>
          </div>

          {hasActiveFilters && filteredRunnableCheckCount > 0 && (
            <button
              type="button"
              onClick={() => onRunFilteredChecks(filteredItems)}
              className="w-full inline-flex items-center justify-center gap-[var(--st-space-6)] px-[var(--st-space-10)] py-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] font-medium cursor-pointer st-control st-btn-accent-soft"
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

      <div className="flex-1 overflow-y-auto p-[var(--st-space-10)] flex flex-col gap-[var(--st-space-6)]">
        {filteredItems.length === 0 ? (
          <div className="p-[var(--st-space-24)] text-center flex flex-col items-center gap-[var(--st-space-12)]">
            <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-muted)]">
              {workspace.items.length === 0
                ? lang.sidebar.noItemsInWorkspace
                : lang.sidebar.noItemsMatch}
            </p>
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

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectItem(item.id)}
                data-selected={isSelected ? "true" : "false"}
                data-applicable={item.applicable ? "true" : "false"}
                aria-current={isSelected ? "true" : undefined}
                className={`w-full text-left px-[var(--st-space-12)] py-[var(--st-space-10)] rounded-[var(--st-radius-md)] border flex flex-col gap-[var(--st-space-6)] cursor-pointer st-control st-sidebar-item ${
                  !item.applicable ? "border-dashed" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-[var(--st-space-8)]">
                  <span
                    className="text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-semibold truncate min-w-0 flex-1"
                    style={{
                      color: item.applicable
                        ? "var(--st-text-primary)"
                        : "var(--st-text-disabled)",
                    }}
                  >
                    {item.name}
                  </span>

                  {(displayedCheckCommands.length > 0 || item.parseError) && (
                    <div className="flex items-center gap-[var(--st-space-6)] shrink-0">
                      {displayedCheckCommands.length > 0 && (
                        <div className="flex items-center gap-[var(--st-space-6)]">
                          {displayedCheckCommands.map((cmd) => {
                            const effectiveApplicable =
                              item.applicable && cmd.applicable;
                            const status: RunStatus | "disabled" =
                              effectiveApplicable
                                ? getCommandRuntime(runtimeMap, cmd.commandId).status
                                : "disabled";
                            const title = effectiveApplicable
                              ? `${cmd.name}: ${lang.status.label(
                                  getCommandRuntime(runtimeMap, cmd.commandId).status
                                )}`
                              : `${cmd.name}: ${lang.status.disabled}`;

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
