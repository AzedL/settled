import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, Tag, X } from "lucide-react";
import { lang } from "../lang";
import { SearchTagToken, TagChip } from "./TagChip";

interface TagSearchInputProps {
  allTags: string[];
  selectedTags: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onChangeSelectedTags: (tags: string[]) => void;
}

type PendingFocusTarget =
  | { type: "tag"; index: number }
  | { type: "input"; pos: number }
  | null;

function isPrintableKey(e: React.KeyboardEvent): boolean {
  return (
    e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
  );
}

/**
 * Combined search box & tag-token selector with full keyboard support:
 * type to match items/tags, ArrowUp/ArrowDown + Enter to pick tags,
 * ArrowLeft/ArrowRight to move focus onto selected tag chips, and Backspace/Delete to remove them.
 */
export function TagSearchInput({
  allTags,
  selectedTags,
  search,
  onSearchChange,
  onChangeSelectedTags,
}: TagSearchInputProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tagRefs = useRef<Array<HTMLDivElement | null>>([]);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusRef = useRef<PendingFocusTarget>(null);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [focusedTagIndex, setFocusedTagIndex] = useState<number | null>(null);

  const unselectedTags = useMemo(
    () => allTags.filter((tag) => !selectedTags.includes(tag)),
    [allTags, selectedTags]
  );

  const normalizedTagQuery = search.trim().replace(/^#+/, "").toLowerCase();

  const candidates = useMemo(() => {
    if (normalizedTagQuery.length === 0) {
      return unselectedTags;
    }
    return unselectedTags
      .filter((tag) => tag.toLowerCase().includes(normalizedTagQuery))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(normalizedTagQuery) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(normalizedTagQuery) ? 0 : 1;
        if (aStarts !== bStarts) {
          return aStarts - bStarts;
        }
        return a.localeCompare(b);
      });
  }, [normalizedTagQuery, unselectedTags]);

  const showDropdown = dropdownOpen && candidates.length > 0;
  const clampedHighlight =
    showDropdown && candidates.length > 0
      ? Math.min(Math.max(highlightedIndex, 0), candidates.length - 1)
      : -1;

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) {
      return;
    }
    pendingFocusRef.current = null;

    if (pending.type === "tag") {
      const target = tagRefs.current[pending.index];
      target?.focus();
      target?.scrollIntoView({ block: "nearest" });
    } else {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.scrollIntoView({ block: "nearest" });
        const clampedPos = Math.min(
          Math.max(pending.pos, 0),
          input.value.length
        );
        input.setSelectionRange(clampedPos, clampedPos);
      }
    }
  }, [selectedTags, focusedTagIndex, search]);

  useLayoutEffect(() => {
    if (!showDropdown || clampedHighlight < 0) {
      return;
    }
    optionRefs.current[clampedHighlight]?.scrollIntoView({
      block: "nearest",
    });
  }, [showDropdown, clampedHighlight]);

  const focusInputAt = (pos: number) => {
    setFocusedTagIndex(null);
    pendingFocusRef.current = { type: "input", pos };
  };

  const focusTagAt = (index: number) => {
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    setFocusedTagIndex(index);
    pendingFocusRef.current = { type: "tag", index };
  };

  const selectCandidate = (tag: string) => {
    if (!selectedTags.includes(tag)) {
      onChangeSelectedTags([...selectedTags, tag]);
    }
    onSearchChange("");
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    focusInputAt(0);
  };

  const removeTagAt = (index: number, mode: "backspace" | "delete" | "click") => {
    const nextTags = selectedTags.filter((_, idx) => idx !== index);
    onChangeSelectedTags(nextTags);

    if (mode === "click") {
      focusInputAt(search.length);
      return;
    }

    if (mode === "backspace") {
      if (index > 0) {
        focusTagAt(index - 1);
      } else if (nextTags.length > 0) {
        focusTagAt(0);
      } else {
        focusInputAt(0);
      }
      return;
    }

    // Delete mode moves focus into the tag that slid into `index`, or back to the input.
    if (index < nextTags.length) {
      focusTagAt(index);
    } else {
      focusInputAt(0);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    onSearchChange(nextValue);
    setFocusedTagIndex(null);

    const query = nextValue.trim();
    if (query.length > 0 && unselectedTags.length > 0) {
      setDropdownOpen(true);
      setHighlightedIndex(0);
    } else if (query.length === 0) {
      setDropdownOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;

    if (e.key === "ArrowLeft" && atStart && selectedTags.length > 0) {
      e.preventDefault();
      focusTagAt(selectedTags.length - 1);
      return;
    }

    if (e.key === "Backspace" && atStart && selectedTags.length > 0) {
      e.preventDefault();
      onChangeSelectedTags(selectedTags.slice(0, -1));
      return;
    }

    if (e.key === "ArrowDown") {
      if (candidates.length > 0) {
        e.preventDefault();
        if (!showDropdown) {
          setDropdownOpen(true);
          setHighlightedIndex(0);
        } else {
          setHighlightedIndex((prev) =>
            prev < 0 ? 0 : (prev + 1) % candidates.length
          );
        }
      }
      return;
    }

    if (e.key === "ArrowUp") {
      if (showDropdown && candidates.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev <= 0 ? candidates.length - 1 : prev - 1
        );
      }
      return;
    }

    if (e.key === "Enter") {
      if (showDropdown && clampedHighlight >= 0 && candidates[clampedHighlight]) {
        e.preventDefault();
        selectCandidate(candidates[clampedHighlight]);
      }
      return;
    }

    if (e.key === "Escape") {
      if (showDropdown) {
        e.preventDefault();
        setDropdownOpen(false);
        setHighlightedIndex(-1);
      }
    }
  };

  const handleTagKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (index > 0) {
        focusTagAt(index - 1);
      }
      return;
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (index < selectedTags.length - 1) {
        focusTagAt(index + 1);
      } else {
        focusInputAt(0);
      }
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      focusTagAt(0);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      focusInputAt(search.length);
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      removeTagAt(index, "backspace");
      return;
    }

    if (e.key === "Delete") {
      e.preventDefault();
      removeTagAt(index, "delete");
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      focusInputAt(search.length);
      return;
    }

    if (isPrintableKey(e)) {
      e.preventDefault();
      const nextSearch = `${search}${e.key}`;
      onSearchChange(nextSearch);
      setDropdownOpen(unselectedTags.length > 0);
      setHighlightedIndex(0);
      focusInputAt(nextSearch.length);
    }
  };

  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && containerRef.current?.contains(nextTarget)) {
      return;
    }
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    setFocusedTagIndex(null);
  };

  const handleClearAll = () => {
    onChangeSelectedTags([]);
    onSearchChange("");
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    focusInputAt(0);
  };

  const handleToggleDropdown = () => {
    if (candidates.length === 0) {
      focusInputAt(search.length);
      return;
    }
    if (showDropdown) {
      setDropdownOpen(false);
      setHighlightedIndex(-1);
      focusInputAt(search.length);
    } else {
      setDropdownOpen(true);
      setHighlightedIndex(0);
      focusInputAt(search.length);
    }
  };

  const hasFilters = selectedTags.length > 0 || search.length > 0;

  return (
    <div
      ref={containerRef}
      onBlur={handleContainerBlur}
      className="relative w-full"
    >
      <div
        onClick={(e) => {
          if (e.target === inputRef.current) {
            return;
          }
          focusInputAt(search.length);
        }}
        className="min-h-[var(--st-control-h)] flex items-start gap-[var(--st-space-8)] pl-[var(--st-space-10)] pr-[var(--st-space-4)] py-[var(--st-space-2)] rounded-[var(--st-radius-md)] border st-search-box cursor-text"
      >
        <span className="my-[var(--st-space-2)] h-[var(--st-tag-h)] inline-flex items-center shrink-0">
          <Search
            className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]"
            style={{ color: "var(--st-text-muted)" }}
          />
        </span>

        <div className="flex-1 min-w-0 max-h-[var(--st-search-tags-max-h)] overflow-y-auto p-[var(--st-space-2)] flex flex-wrap items-center gap-[var(--st-space-4)]">
          {selectedTags.map((tag, index) => (
            <SearchTagToken
              key={tag}
              label={tag}
              active={focusedTagIndex === index}
              tokenRef={(node) => {
                tagRefs.current[index] = node;
              }}
              onFocusToken={() => focusTagAt(index)}
              onKeyDown={(e) => handleTagKeyDown(index, e)}
              onRemove={() => removeTagAt(index, "click")}
            />
          ))}

          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            value={search}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onFocus={() => setFocusedTagIndex(null)}
            placeholder={
              selectedTags.length === 0 ? lang.filters.searchPlaceholder : ""
            }
            className="flex-1 min-w-[72px] h-[var(--st-tag-h)] bg-transparent outline-none text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] text-[color:var(--st-text-primary)] placeholder:text-[color:var(--st-text-muted)]"
          />
        </div>

        <div className="my-[var(--st-space-2)] h-[var(--st-tag-h)] inline-flex items-center gap-[var(--st-space-2)] shrink-0">
          {hasFilters && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                handleClearAll();
              }}
              aria-label={lang.filters.clearSearchAria}
              className="w-[var(--st-tag-h)] h-[var(--st-tag-h)] inline-flex items-center justify-center rounded-[var(--st-radius-sm)] shrink-0 cursor-pointer st-control st-icon-ghost"
            >
              <X className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            </button>
          )}

          {unselectedTags.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleDropdown();
              }}
              aria-label={lang.filters.toggleTagsAria}
              aria-expanded={showDropdown}
              className="w-[var(--st-tag-h)] h-[var(--st-tag-h)] inline-flex items-center justify-center rounded-[var(--st-radius-sm)] shrink-0 cursor-pointer st-control st-icon-ghost"
            >
              <Tag className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
            </button>
          )}
        </div>
      </div>

      {showDropdown && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-[var(--st-space-4)] z-30 rounded-[var(--st-radius-md)] border p-[var(--st-space-4)] max-h-[var(--st-dropdown-max-h)] overflow-y-auto flex flex-col gap-[var(--st-space-2)]"
          style={{
            backgroundColor: "var(--st-bg-panel)",
            borderColor: "var(--st-border-default)",
            boxShadow: "var(--st-shadow-card)",
          }}
        >
          {candidates.map((tag, index) => {
            const highlighted = index === clampedHighlight;
            return (
              <button
                key={tag}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={highlighted}
                data-highlighted={highlighted ? "true" : "false"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectCandidate(tag);
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
                className="w-full px-[var(--st-space-8)] py-[var(--st-space-4)] rounded-[var(--st-radius-sm)] text-left flex items-center justify-between gap-[var(--st-space-8)] cursor-pointer st-tag-option"
              >
                <TagChip label={tag} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
