import { Search, X } from "lucide-react";
import { lang } from "../lang";
import type {
  CommandRuntimeState,
  RunStatus,
  ScopeMode,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "../types";
import { getCommandRuntime } from "../utils/itemStatus";
import { TagFilterInput } from "./TagFilterInput";
import { TagOverflowList } from "./TagOverflowList";
import { TrafficLed } from "./TrafficLed";

interface SidebarProps {
  workspace: WorkspaceSnapshot;
  filteredItems: WorkspaceItem[];
  scopedCount: number;
  scope: ScopeMode;
  search: string;
  selectedTags: string[];
  selectedItemId: string | null;
  runtimeMap: Record<string, CommandRuntimeState>;
  onChangeScope: (scope: ScopeMode) => void;
  onSearchChange: (value: string) => void;
  onChangeSelectedTags: (tags: string[]) => void;
  onSelectItem: (itemId: string) => void;
}

export function Sidebar({
  workspace,
  filteredItems,
  scopedCount,
  scope,
  search,
  selectedTags,
  selectedItemId,
  runtimeMap,
  onChangeScope,
  onSearchChange,
  onChangeSelectedTags,
  onSelectItem,
}: SidebarProps) {

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
          <TagFilterInput
            key={workspace.rootPath}
            allTags={workspace.allTags}
            selectedTags={selectedTags}
            onChangeSelectedTags={onChangeSelectedTags}
          />
        )}

        <div className="flex items-center justify-between gap-[var(--st-space-8)] pt-[var(--st-space-2)]">
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
            {lang.filters.itemsSummary(filteredItems.length, scopedCount)}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-[var(--st-space-10)] flex flex-col gap-[var(--st-space-6)]">
        {filteredItems.length === 0 ? (
          <div className="p-[var(--st-space-24)] text-center flex flex-col items-center gap-[var(--st-space-12)]">
            <p className="m-0 text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-muted)]">
              {lang.sidebar.noItemsMatch}
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
                className={`w-full min-w-0 shrink-0 text-left px-[var(--st-space-12)] py-[var(--st-space-10)] rounded-[var(--st-radius-md)] border flex flex-col gap-[var(--st-space-6)] cursor-pointer st-control st-sidebar-item ${
                  !item.applicable ? "border-dashed" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-[var(--st-space-8)] min-w-0">
                  <span
                    className="text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] font-semibold truncate min-w-0 flex-1"
                    title={item.name}
                    style={{
                      color: item.applicable
                        ? "var(--st-text-primary)"
                        : "var(--st-text-disabled)",
                    }}
                  >
                    {item.name}
                  </span>

                  {displayedCheckCommands.length > 0 && (
                    <div className="flex items-center gap-[var(--st-space-6)] shrink-0">
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
                </div>

                {item.tags.length > 0 && (
                  <TagOverflowList
                    tags={item.tags}
                    muted={!item.applicable}
                  />
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
