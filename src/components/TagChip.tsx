import { X } from "lucide-react";
import { lang } from "../lang";

export const TAG_CHIP_CLASS =
  "inline-flex items-center gap-[var(--st-space-4)] h-[var(--st-tag-h)] px-[var(--st-space-6)] rounded-[var(--st-radius-sm)] border font-mono text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] max-w-full min-w-0 st-tag";

interface TagChipProps {
  label: string;
  title?: string;
  muted?: boolean;
  className?: string;
  onMouseEnter?: (e: React.MouseEvent<HTMLSpanElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLSpanElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLSpanElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLSpanElement>) => void;
  tabIndex?: number;
}

/**
 * Shared 20px-high square-rounded tag pill (`border`, `4px` radius, subtle surface palette).
 */
export function TagChip({
  label,
  title,
  muted = false,
  className = "",
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  tabIndex,
}: TagChipProps) {
  return (
    <span
      title={title}
      tabIndex={tabIndex}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      className={[TAG_CHIP_CLASS, muted ? "st-tag--muted" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

interface SearchTagTokenProps {
  label: string;
  active: boolean;
  tokenRef: (node: HTMLDivElement | null) => void;
  onFocusToken: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onRemove: () => void;
}

/**
 * Keyboard-focusable and removable tag token rendered inside `TagSearchInput`.
 * Uses a focusable `<div>` wrapper so the remove icon can safely stay a `<button>`.
 */
export function SearchTagToken({
  label,
  active,
  tokenRef,
  onFocusToken,
  onKeyDown,
  onRemove,
}: SearchTagTokenProps) {
  return (
    <div
      ref={tokenRef}
      tabIndex={-1}
      data-active={active ? "true" : "false"}
      onClick={(e) => {
        e.stopPropagation();
        onFocusToken();
      }}
      onKeyDown={onKeyDown}
      title={label}
      className={`${TAG_CHIP_CLASS} shrink-0 cursor-pointer select-none st-tag--token pr-[var(--st-space-2)]`}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={lang.filters.removeTagAria(label)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="w-[var(--st-space-14)] h-[var(--st-space-14)] inline-flex items-center justify-center rounded-[var(--st-radius-sm)] shrink-0 cursor-pointer st-icon-ghost"
      >
        <X className="w-[var(--st-space-10)] h-[var(--st-space-10)]" />
      </button>
    </div>
  );
}
