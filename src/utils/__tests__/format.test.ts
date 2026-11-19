import { describe, expect, it } from "vitest";
import {
  formatLocalDateTime,
  formatPlatforms,
  formatScriptGroupTitle,
} from "../format";

describe("format utilities", () => {
  it("expands empty platform arrays to all three OSes", () => {
    const label = (p: string) => p.toUpperCase();
    expect(formatPlatforms([], label)).toBe("WINDOWS / MACOS / LINUX");
    expect(formatPlatforms(["windows", "linux"], label)).toBe("WINDOWS / LINUX");
  });

  it("normalizes script group keys to Title Case", () => {
    expect(formatScriptGroupTitle("check")).toBe("Check");
    expect(formatScriptGroupTitle("reset-demo")).toBe("Reset Demo");
    expect(formatScriptGroupTitle("diagnose_env")).toBe("Diagnose Env");
    expect(formatScriptGroupTitle("showConfigOrigins")).toBe("Show Config Origins");
    expect(formatScriptGroupTitle("HTTPSProxySetup")).toBe("Https Proxy Setup");
    expect(formatScriptGroupTitle("---")).toBe("---");
  });

  it("formats Unix seconds and millisecond timestamps consistently", () => {
    expect(formatLocalDateTime(null)).toBe("");
    expect(formatLocalDateTime(Number.NaN)).toBe("");

    const secOut = formatLocalDateTime(1794596400);
    const msOut = formatLocalDateTime(1794596400 * 1000);
    expect(secOut).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(msOut).toBe(secOut);
    expect(formatLocalDateTime(1e30)).toBe("");
  });
});
