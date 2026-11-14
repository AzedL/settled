import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "surface"
  | "panel"
  | "accent-soft"
  | "pass-soft"
  | "warn-soft";

export type ButtonSize = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  active?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "font-semibold st-btn-primary",
  surface: "font-medium st-btn-surface",
  panel: "font-medium st-btn-panel",
  "accent-soft": "font-semibold st-btn-accent-soft",
  "pass-soft": "font-semibold st-btn-pass-soft",
  "warn-soft": "font-semibold st-btn-warn-soft",
};

const SIZE_CLASSES: Record<ButtonSize, { text: string; iconOnly: string }> = {
  md: {
    text: "h-[var(--st-control-h)] px-[var(--st-space-12)]",
    iconOnly:
      "w-[var(--st-control-h)] h-[var(--st-control-h)] px-[var(--st-space-0)]",
  },
  sm: {
    text: "h-[var(--st-control-h-sm)] px-[var(--st-space-10)]",
    iconOnly:
      "w-[var(--st-control-h-sm)] h-[var(--st-control-h-sm)] px-[var(--st-space-0)]",
  },
};

/**
 * Shared action button supporting unified visual variants and 32px (`md`) / 28px (`sm`) heights.
 */
export function Button({
  variant = "surface",
  size = "md",
  iconOnly = false,
  active = false,
  type = "button",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const sizeClass = iconOnly
    ? SIZE_CLASSES[size].iconOnly
    : SIZE_CLASSES[size].text;
  const activeClass =
    active && variant === "panel" ? "st-btn-panel--active" : "";

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-[var(--st-space-6)] rounded-[var(--st-radius-md)] border text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] whitespace-nowrap shrink-0 cursor-pointer st-control ${sizeClass} ${VARIANT_CLASSES[variant]} ${activeClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
