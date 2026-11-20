import { describe, expect, it } from "vitest";
import { getAnsiSegmentStyle, parseAnsiLogLines } from "../ansi";

describe("ansi terminal parser", () => {
  it("parses Vitest-style badges and decorations into themed styles", () => {
    const parsed = parseAnsiLogLines([
      {
        stream: "stdout",
        text: "\x1b[1m\x1b[30m\x1b[46m RUN \x1b[49m\x1b[39m\x1b[22m \x1b[32m✓\x1b[39m \x1b[2m(3 tests)\x1b[22m",
      },
    ]);

    expect(parsed).toHaveLength(1);
    const segs = parsed[0].segments;
    expect(segs.map((s) => s.text)).toEqual([" RUN ", " ", "✓", " ", "(3 tests)"]);

    expect(getAnsiSegmentStyle(segs[0])).toEqual({
      color: "var(--st-ansi-on-bg-black)",
      backgroundColor: "var(--st-ansi-bg-cyan)",
      fontWeight: 700,
    });
    expect(getAnsiSegmentStyle(segs[2])).toEqual({
      color: "var(--st-ansi-fg-green)",
    });
    expect(getAnsiSegmentStyle(segs[4])).toEqual({
      opacity: 0.65,
    });
  });

  it("carries SGR styles across newlines independently per stream", () => {
    const parsed = parseAnsiLogLines([
      { stream: "stdout", text: "\x1b[32mgreen start" },
      { stream: "stderr", text: "plain stderr" },
      { stream: "stdout", text: "green continued\x1b[0m plain" },
    ]);

    expect(parsed[0].segments[0]).toMatchObject({
      text: "green start",
      fg: { kind: "named", name: "green" },
    });
    expect(parsed[1].segments[0]).toMatchObject({
      text: "plain stderr",
      fg: null,
    });
    expect(parsed[2].segments[0]).toMatchObject({
      text: "green continued",
      fg: { kind: "named", name: "green" },
    });
    expect(parsed[2].segments[1]).toMatchObject({
      text: " plain",
      fg: null,
    });
  });

  it("strips non-display CSI, OSC, charset, and C0 control sequences", () => {
    const parsed = parseAnsiLogLines([
      {
        stream: "stdout",
        text: "\x1b[?25l\x1b[2K\x1b]8;;https://example.com\x07link\x1b]8;;\x07 \x1b(B\x07ok\x1b[?25h",
      },
      {
        stream: "stdout",
        text: "\x1b[33mstep 10%\rstep 100%\x1b[0m",
      },
      {
        stream: "stdout",
        text: "trailing cr\r\x1b[0m",
      },
      {
        stream: "stdout",
        text: "\x1b[2K",
      },
    ]);

    expect(parsed[0].segments.map((s) => s.text).join("")).toBe("link ok");
    expect(parsed[1].segments).toHaveLength(1);
    expect(parsed[1].segments[0]).toMatchObject({
      text: "step 100%",
      fg: { kind: "named", name: "yellow" },
    });
    expect(parsed[2].segments[0].text).toBe("trailing cr");
    expect(parsed[3].segments).toEqual([]);
  });

  it("supports bright, 256-color, truecolor RGB, inverse, italic, underline, and strikethrough", () => {
    const parsed = parseAnsiLogLines([
      {
        stream: "stdout",
        text: [
          "\x1b[91;3;4;9mstyled\x1b[0m",
          "\x1b[38;5;196;48;2;10;20;30mrgb\x1b[0m",
          "\x1b[38:2::1:2:3;7minv\x1b[27m",
        ].join(" "),
      },
    ]);

    const segs = parsed[0].segments;
    expect(getAnsiSegmentStyle(segs[0])).toEqual({
      color: "var(--st-ansi-fg-bright-red)",
      fontStyle: "italic",
      textDecorationLine: "underline line-through",
    });
    expect(getAnsiSegmentStyle(segs[2])).toEqual({
      color: "rgb(255, 0, 0)",
      backgroundColor: "rgb(10, 20, 30)",
    });
    expect(getAnsiSegmentStyle(segs[4])).toEqual({
      color: "var(--st-bg-terminal)",
      backgroundColor: "rgb(1, 2, 3)",
    });
  });
});
