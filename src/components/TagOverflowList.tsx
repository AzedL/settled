import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lang } from "../lang";
import { TagChip } from "./TagChip";

interface TagOverflowListProps {
  tags: string[];
  muted?: boolean;
  /** Allow focusing the overflow badge via keyboard (disable inside `<button>` cards). */
  focusableBadge?: boolean;
  className?: string;
}

interface OverflowLayout {
  visibleCount: number;
  truncateSingle: boolean;
}

interface HoverPopoverState {
  anchorRect: DOMRect;
  tags: string[];
}

function getViewportSafePosition(
  anchor: DOMRect,
  popoverWidth: number,
  popoverHeight: number
) {
  const margin = 8;
  const gap = 6;
  const maxLeft = Math.max(margin, window.innerWidth - popoverWidth - margin);
  const left = Math.min(Math.max(margin, anchor.left), maxLeft);

  const spaceBelow = window.innerHeight - anchor.bottom;
  const showAbove =
    spaceBelow < popoverHeight + gap + margin && anchor.top > spaceBelow;

  const rawTop = showAbove
    ? anchor.top - popoverHeight - gap
    : anchor.bottom + gap;
  const maxTop = Math.max(margin, window.innerHeight - popoverHeight - margin);
  const top = Math.min(Math.max(margin, rawTop), maxTop);

  return { left, top };
}

function TagHoverPopover({
  anchorRect,
  tags,
  muted,
}: HoverPopoverState & { muted: boolean }) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState(() =>
    getViewportSafePosition(anchorRect, 240, 64)
  );

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords(getViewportSafePosition(anchorRect, rect.width, rect.height));
  }, [anchorRect, tags]);

  return createPortal(
    <div
      ref={popoverRef}
      role="tooltip"
      className="fixed z-50 pointer-events-none max-w-[min(520px,calc(100vw-16px))] rounded-[var(--st-radius-md)] border p-[var(--st-space-8)] flex flex-wrap gap-[var(--st-space-6)]"
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        backgroundColor: "var(--st-bg-panel)",
        borderColor: "var(--st-border-default)",
        boxShadow: "var(--st-shadow-card)",
      }}
    >
      {tags.map((tag, index) => (
        <TagChip key={`${tag}-${index}`} label={tag} muted={muted} />
      ))}
    </div>,
    document.body
  );
}

/**
 * Single-line tag strip that dynamically fits as many 20px tags as available width permits,
 * collapses overflowing items into a matching `+N` chip, and reveals hidden tags on hover.
 */
export function TagOverflowList({
  tags,
  muted = false,
  focusableBadge = false,
  className = "",
}: TagOverflowListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<OverflowLayout>({
    visibleCount: tags.length,
    truncateSingle: false,
  });
  const [popover, setPopover] = useState<HoverPopoverState | null>(null);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) {
      return;
    }

    const containerWidth = container.clientWidth;
    if (containerWidth <= 0 || tags.length === 0) {
      setLayout((prev) =>
        prev.visibleCount === tags.length && !prev.truncateSingle
          ? prev
          : { visibleCount: tags.length, truncateSingle: false }
      );
      return;
    }

    const style = getComputedStyle(measure);
    const gap = parseFloat(style.columnGap || style.gap) || 6;
    const children = Array.from(measure.children) as HTMLElement[];

    const tagWidths = children
      .slice(0, tags.length)
      .map((el) => Math.ceil(el.getBoundingClientRect().width));

    const badgeWidths = [0, 1, 2].map((offset) => {
      const el = children[tags.length + offset];
      return el ? Math.ceil(el.getBoundingClientRect().width) : 28;
    });

    const badgeWidthFor = (hiddenCount: number) => {
      const digits = Math.min(Math.max(String(hiddenCount).length, 1), 3);
      return badgeWidths[digits - 1];
    };

    if (tags.length === 1) {
      const truncateSingle = tagWidths[0] > containerWidth;
      setLayout((prev) =>
        prev.visibleCount === 1 && prev.truncateSingle === truncateSingle
          ? prev
          : { visibleCount: 1, truncateSingle }
      );
      return;
    }

    const totalAll =
      tagWidths.reduce((sum, width) => sum + width, 0) + gap * (tags.length - 1);

    if (totalAll <= containerWidth) {
      setLayout((prev) =>
        prev.visibleCount === tags.length && !prev.truncateSingle
          ? prev
          : { visibleCount: tags.length, truncateSingle: false }
      );
      return;
    }

    let prefix = 0;
    let bestCount = 0;
    for (let i = 0; i < tags.length - 1; i++) {
      prefix += (i > 0 ? gap : 0) + tagWidths[i];
      const hiddenCount = tags.length - (i + 1);
      if (prefix + gap + badgeWidthFor(hiddenCount) <= containerWidth) {
        bestCount = i + 1;
      } else {
        break;
      }
    }

    if (bestCount > 0) {
      setLayout((prev) =>
        prev.visibleCount === bestCount && !prev.truncateSingle
          ? prev
          : { visibleCount: bestCount, truncateSingle: false }
      );
      return;
    }

    const minTagWidth = 48;
    const badgeOnlyNeed = badgeWidthFor(tags.length - 1);
    const next: OverflowLayout =
      containerWidth >= minTagWidth + gap + badgeOnlyNeed
        ? { visibleCount: 1, truncateSingle: true }
        : { visibleCount: 0, truncateSingle: false };

    setLayout((prev) =>
      prev.visibleCount === next.visibleCount &&
      prev.truncateSingle === next.truncateSingle
        ? prev
        : next
    );
  }, [tags]);

  useLayoutEffect(() => {
    recompute();
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => recompute());
      observer.observe(container);
    }

    let canceled = false;
    document.fonts?.ready.then(() => {
      if (!canceled) {
        recompute();
      }
    });

    return () => {
      canceled = true;
      observer?.disconnect();
    };
  }, [recompute]);

  useLayoutEffect(() => {
    if (!popover) {
      return;
    }
    const close = () => setPopover(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [popover]);

  if (tags.length === 0) {
    return null;
  }

  const visibleTags = tags.slice(0, layout.visibleCount);
  const hiddenTags = tags.slice(layout.visibleCount);
  const canHoverSingleTruncated = tags.length === 1 && layout.truncateSingle;

  const openPopover = (
    target: HTMLElement,
    tagsToShow: string[]
  ) => {
    setPopover({
      anchorRect: target.getBoundingClientRect(),
      tags: tagsToShow,
    });
  };

  return (
    <div
      ref={containerRef}
      className={`w-full min-w-0 h-[var(--st-tag-h)] relative overflow-hidden ${className}`}
    >
      {/* Hidden natural-width row used to measure tags and 1/2/3-digit +N badges accurately. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-[var(--st-space-6)]"
      >
        {tags.map((tag, index) => (
          <TagChip
            key={`m-${tag}-${index}`}
            label={tag}
            muted={muted}
            className="shrink-0 max-w-none"
          />
        ))}
        <TagChip label="+8" muted={muted} className="shrink-0 max-w-none" />
        <TagChip label="+88" muted={muted} className="shrink-0 max-w-none" />
        <TagChip label="+888" muted={muted} className="shrink-0 max-w-none" />
      </div>

      <div className="w-full h-full flex items-center gap-[var(--st-space-6)] min-w-0">
        {visibleTags.map((tag, index) => {
          const isTruncatedHead = layout.truncateSingle && index === 0;
          return (
            <TagChip
              key={`${tag}-${index}`}
              label={tag}
              muted={muted}
              className={isTruncatedHead ? "min-w-0 shrink" : "shrink-0"}
              onMouseEnter={
                canHoverSingleTruncated
                  ? (e) => openPopover(e.currentTarget, tags)
                  : undefined
              }
              onMouseLeave={
                canHoverSingleTruncated ? () => setPopover(null) : undefined
              }
            />
          );
        })}

        {hiddenTags.length > 0 && (
          <TagChip
            label={lang.filters.moreTagsCount(hiddenTags.length)}
            muted={muted}
            className="shrink-0"
            tabIndex={focusableBadge ? 0 : undefined}
            onMouseEnter={(e) => openPopover(e.currentTarget, hiddenTags)}
            onMouseLeave={() => setPopover(null)}
            onFocus={
              focusableBadge
                ? (e) => openPopover(e.currentTarget, hiddenTags)
                : undefined
            }
            onBlur={focusableBadge ? () => setPopover(null) : undefined}
          />
        )}
      </div>

      {popover && (
        <TagHoverPopover
          anchorRect={popover.anchorRect}
          tags={popover.tags}
          muted={muted}
        />
      )}
    </div>
  );
}
