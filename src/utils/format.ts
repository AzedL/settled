/**
 * Normalizes a script group key across kebab-case, snake_case, camelCase, PascalCase,
 * and space-delimited forms into clean Title Case (e.g. `work-out` / `workOut` -> `Work Out`).
 */
export function formatScriptGroupTitle(key: string): string {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_.\s/:]+/g, " ")
    .trim();

  if (!normalized) {
    return key;
  }

  return normalized
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Formats a persisted Unix timestamp (seconds or milliseconds) in the browser's local timezone.
 */
export function formatLocalDateTime(unixTimestamp: number | null): string {
  if (unixTimestamp === null || !Number.isFinite(unixTimestamp)) {
    return "";
  }
  const millis =
    Math.abs(unixTimestamp) >= 100_000_000_000
      ? unixTimestamp
      : unixTimestamp * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}
