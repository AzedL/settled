import type { ReactNode } from "react";

interface TagChipProps {
  label: string;
  title?: string;
  icon?: ReactNode;
  mono?: boolean;
  muted?: boolean;
  ghost?: boolean;
  selected?: "accent" | "neutral";
  onClick?: () => void;
  className?: string;
}

/**
 * Shared tag pill used across filter chips, sidebar item cards, and item detail metadata.
 * Renders a `<button>` when interactive (`onClick` provided) or a `<span>` for read-only views.
 */
export function TagChip({
  label,
  title,
  icon,
  mono = true,
  muted = false,
  ghost = false,
  selected,
  onClick,
  className = "",
}: TagChipProps) {
  const classes = [
    "inline-flex items-center gap-[var(--st-space-4)] px-[var(--st-space-8)] py-[var(--st-space-2)]",
    "rounded-[var(--st-radius-pill)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)]",
    "max-w-full min-w-0 st-tag",
    mono ? "font-mono" : "",
    muted ? "st-tag--muted" : "",
    ghost ? "st-tag--ghost" : "",
    onClick ? "cursor-pointer st-control st-tag--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      <span className="truncate">{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? label}
        data-selected={selected}
        aria-pressed={Boolean(selected)}
        className={classes}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={title ?? label} className={classes}>
      {content}
    </span>
  );
}
