import { lang } from "../lang";
import type { RunStatus } from "../types";

interface TrafficLedProps {
  status: RunStatus | "disabled";
  size?: "sm" | "md";
  title?: string;
}

export function TrafficLed({ status, size = "md", title }: TrafficLedProps) {
  const dimensionClass =
    size === "sm"
      ? "w-[var(--st-led-sm)] h-[var(--st-led-sm)]"
      : "w-[var(--st-led-md)] h-[var(--st-led-md)]";

  const statusStyles: Record<RunStatus | "disabled", React.CSSProperties> = {
    pass: {
      backgroundColor: "var(--st-status-pass)",
      boxShadow: "var(--st-status-pass-glow)",
    },
    fail: {
      backgroundColor: "var(--st-status-fail)",
      boxShadow: "var(--st-status-fail-glow)",
    },
    running: {
      backgroundColor: "var(--st-status-running)",
      boxShadow: "var(--st-status-running-glow)",
    },
    canceled: {
      backgroundColor: "var(--st-status-canceled)",
      boxShadow: "var(--st-status-canceled-glow)",
    },
    idle: {
      backgroundColor: "var(--st-status-idle)",
    },
    disabled: {
      backgroundColor: "transparent",
      borderWidth: "var(--st-space-2)",
      borderStyle: "solid",
      borderColor: "var(--st-status-disabled)",
      boxShadow: "var(--st-status-disabled-glow)",
    },
  };

  const label =
    status === "disabled" ? lang.status.disabled : lang.status.label(status);

  return (
    <span
      className={`inline-block rounded-full shrink-0 ${dimensionClass} ${
        status === "running" ? "animate-pulse" : ""
      }`}
      style={statusStyles[status]}
      title={title ?? label}
      aria-label={title ?? label}
    />
  );
}
