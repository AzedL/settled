import type { CSSProperties } from "react";
import type { LogStream, OutputLine } from "../types";

export type AnsiNamedColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "bright-black"
  | "bright-red"
  | "bright-green"
  | "bright-yellow"
  | "bright-blue"
  | "bright-magenta"
  | "bright-cyan"
  | "bright-white";

export type AnsiColorValue =
  | { kind: "named"; name: AnsiNamedColor }
  | { kind: "rgb"; r: number; g: number; b: number };

export interface AnsiStyleState {
  fg: AnsiColorValue | null;
  bg: AnsiColorValue | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
}

export interface AnsiSegment extends AnsiStyleState {
  text: string;
}

export interface ParsedAnsiLine {
  stream: LogStream;
  segments: AnsiSegment[];
}

const BASIC_COLORS: AnsiNamedColor[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];

const BRIGHT_COLORS: AnsiNamedColor[] = [
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
];

function createDefaultStyle(): AnsiStyleState {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
  };
}

function cloneStyle(style: AnsiStyleState): AnsiStyleState {
  return { ...style };
}

function sameStyle(a: AnsiStyleState, b: AnsiStyleState): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse &&
    sameColor(a.fg, b.fg) &&
    sameColor(a.bg, b.bg)
  );
}

function sameColor(a: AnsiColorValue | null, b: AnsiColorValue | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "named" && b.kind === "named") {
    return a.name === b.name;
  }
  if (a.kind === "rgb" && b.kind === "rgb") {
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  return false;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.trunc(n)));
}

function xterm256ToColor(index: number): AnsiColorValue | null {
  if (!Number.isFinite(index) || index < 0 || index > 255) {
    return null;
  }
  const n = Math.trunc(index);
  if (n < 8) {
    return { kind: "named", name: BASIC_COLORS[n] };
  }
  if (n < 16) {
    return { kind: "named", name: BRIGHT_COLORS[n - 8] };
  }
  if (n >= 232) {
    const level = (n - 232) * 10 + 8;
    return { kind: "rgb", r: level, g: level, b: level };
  }
  const cube = n - 16;
  const rIdx = Math.floor(cube / 36);
  const gIdx = Math.floor((cube % 36) / 6);
  const bIdx = cube % 6;
  const toChannel = (idx: number) => (idx === 0 ? 0 : idx * 40 + 55);
  return {
    kind: "rgb",
    r: toChannel(rIdx),
    g: toChannel(gIdx),
    b: toChannel(bIdx),
  };
}

function applyExtendedColor(
  style: AnsiStyleState,
  target: "fg" | "bg",
  params: number[]
): void {
  const mode = params[0];
  if (mode === 5 && params.length >= 2) {
    const color = xterm256ToColor(params[1]);
    if (color) {
      style[target] = color;
    }
    return;
  }
  if (mode === 2 && params.length >= 4) {
    // Handle both `2;r;g;b` and ISO-8613-6 `2::r:g:b` (colorspace placeholder at index 1 when >=5 args).
    const offset = params.length >= 5 ? 2 : 1;
    if (offset + 2 < params.length) {
      style[target] = {
        kind: "rgb",
        r: clampByte(params[offset]),
        g: clampByte(params[offset + 1]),
        b: clampByte(params[offset + 2]),
      };
    }
  }
}

function applySgrSequence(style: AnsiStyleState, rawParams: string): void {
  const tokens = rawParams.length === 0 ? ["0"] : rawParams.split(";");
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token.includes(":")) {
      const sub = token.split(":").map((part) => (part === "" ? 0 : Number(part)));
      if ((sub[0] === 38 || sub[0] === 48) && sub.every(Number.isFinite)) {
        applyExtendedColor(style, sub[0] === 38 ? "fg" : "bg", sub.slice(1));
      }
      i += 1;
      continue;
    }

    const code = token === "" ? 0 : Number(token);
    if (!Number.isFinite(code)) {
      i += 1;
      continue;
    }

    if (code === 0) {
      Object.assign(style, createDefaultStyle());
    } else if (code === 1) {
      style.bold = true;
    } else if (code === 2) {
      style.dim = true;
    } else if (code === 3) {
      style.italic = true;
    } else if (code === 4) {
      style.underline = true;
    } else if (code === 7) {
      style.inverse = true;
    } else if (code === 9) {
      style.strikethrough = true;
    } else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 23) {
      style.italic = false;
    } else if (code === 24) {
      style.underline = false;
    } else if (code === 27) {
      style.inverse = false;
    } else if (code === 29) {
      style.strikethrough = false;
    } else if (code >= 30 && code <= 37) {
      style.fg = { kind: "named", name: BASIC_COLORS[code - 30] };
    } else if (code === 39) {
      style.fg = null;
    } else if (code >= 40 && code <= 47) {
      style.bg = { kind: "named", name: BASIC_COLORS[code - 40] };
    } else if (code === 49) {
      style.bg = null;
    } else if (code >= 90 && code <= 97) {
      style.fg = { kind: "named", name: BRIGHT_COLORS[code - 90] };
    } else if (code >= 100 && code <= 107) {
      style.bg = { kind: "named", name: BRIGHT_COLORS[code - 100] };
    } else if (code === 38 || code === 48) {
      const target = code === 38 ? "fg" : "bg";
      const subMode = Number(tokens[i + 1]);
      if (subMode === 5 && i + 2 < tokens.length) {
        applyExtendedColor(style, target, [5, Number(tokens[i + 2])]);
        i += 3;
        continue;
      }
      if (subMode === 2 && i + 4 < tokens.length) {
        applyExtendedColor(style, target, [
          2,
          Number(tokens[i + 2]),
          Number(tokens[i + 3]),
          Number(tokens[i + 4]),
        ]);
        i += 5;
        continue;
      }
    }

    i += 1;
  }
}

function appendSegment(
  segments: AnsiSegment[],
  text: string,
  style: AnsiStyleState
): void {
  if (!text) return;
  const prev = segments[segments.length - 1];
  if (prev && sameStyle(prev, style)) {
    prev.text += text;
    return;
  }
  segments.push({ text, ...cloneStyle(style) });
}

function parseSingleLine(raw: string, style: AnsiStyleState): AnsiSegment[] {
  let segments: AnsiSegment[] = [];
  let buffer = "";
  let pendingCarriageReturn = false;

  const flushBuffer = () => {
    if (!buffer) return;
    if (pendingCarriageReturn) {
      segments = [];
      pendingCarriageReturn = false;
    }
    appendSegment(segments, buffer, style);
    buffer = "";
  };

  let i = 0;
  while (i < raw.length) {
    const code = raw.charCodeAt(i);

    if (code === 0x1b) {
      flushBuffer();
      const next = raw.charCodeAt(i + 1);

      if (next === 0x5b /* '[' CSI */) {
        let j = i + 2;
        while (j < raw.length) {
          const b = raw.charCodeAt(j);
          if (b >= 0x40 && b <= 0x7e) {
            break;
          }
          j += 1;
        }
        if (j < raw.length) {
          const finalChar = raw[j];
          const params = raw.slice(i + 2, j);
          if (finalChar === "m" && !/^[?>=<]/.test(params)) {
            applySgrSequence(style, params);
          }
          i = j + 1;
        } else {
          break;
        }
        continue;
      }

      if (next === 0x5d /* ']' OSC */) {
        let j = i + 2;
        while (j < raw.length) {
          const b = raw.charCodeAt(j);
          if (b === 0x07) {
            j += 1;
            break;
          }
          if (b === 0x1b && raw.charCodeAt(j + 1) === 0x5c /* '\\' ST */) {
            j += 2;
            break;
          }
          j += 1;
        }
        i = j;
        continue;
      }

      // Strip 3-byte charset designators (`\x1b(B`) or 2-byte ESC sequences.
      if (next >= 0x20 && next <= 0x2f && i + 2 < raw.length) {
        i += 3;
      } else {
        i += next !== undefined && !Number.isNaN(next) ? 2 : 1;
      }
      continue;
    }

    if (code === 0x0d /* '\r' */) {
      flushBuffer();
      pendingCarriageReturn = true;
      i += 1;
      continue;
    }

    // Drop C0/DEL control bytes other than TAB so stray terminal codes never render as tofu boxes.
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      i += 1;
      continue;
    }

    buffer += raw[i];
    i += 1;
  }

  flushBuffer();
  return segments;
}

/**
 * Parses `OutputLine[]` into styled terminal lines while maintaining independent SGR state
 * across lines per stream (`stdout` / `stderr` / `system`) and stripping non-style control sequences.
 */
export function parseAnsiLogLines(lines: OutputLine[]): ParsedAnsiLine[] {
  const stylesByStream: Record<LogStream, AnsiStyleState> = {
    stdout: createDefaultStyle(),
    stderr: createDefaultStyle(),
    system: createDefaultStyle(),
  };

  return lines.map((line) => ({
    stream: line.stream,
    segments: parseSingleLine(line.text, stylesByStream[line.stream]),
  }));
}

/**
 * Resolves a parsed ANSI segment into theme-aware inline `CSSProperties`.
 */
export function getAnsiSegmentStyle(seg: AnsiSegment): CSSProperties | undefined {
  let effectiveFg: AnsiColorValue | "terminal-bg" | null = seg.fg;
  let effectiveBg: AnsiColorValue | "terminal-fg" | null = seg.bg;

  if (seg.inverse) {
    effectiveFg = seg.bg ?? "terminal-bg";
    effectiveBg = seg.fg ?? "terminal-fg";
  }

  const hasBg = effectiveBg !== null;
  const style: CSSProperties = {};
  let hasAny = false;

  if (effectiveFg === "terminal-bg") {
    style.color = "var(--st-bg-terminal)";
    hasAny = true;
  } else if (effectiveFg) {
    if (effectiveFg.kind === "named") {
      if (hasBg && effectiveFg.name === "black") {
        style.color = "var(--st-ansi-on-bg-black)";
      } else if (hasBg && effectiveFg.name === "white") {
        style.color = "var(--st-ansi-on-bg-white)";
      } else {
        style.color = `var(--st-ansi-fg-${effectiveFg.name})`;
      }
    } else {
      style.color = `rgb(${effectiveFg.r}, ${effectiveFg.g}, ${effectiveFg.b})`;
    }
    hasAny = true;
  }

  if (effectiveBg === "terminal-fg") {
    style.backgroundColor = "var(--st-text-primary)";
    hasAny = true;
  } else if (effectiveBg) {
    style.backgroundColor =
      effectiveBg.kind === "named"
        ? `var(--st-ansi-bg-${effectiveBg.name})`
        : `rgb(${effectiveBg.r}, ${effectiveBg.g}, ${effectiveBg.b})`;
    hasAny = true;
  }

  if (seg.bold) {
    style.fontWeight = 700;
    hasAny = true;
  }
  if (seg.dim) {
    style.opacity = 0.65;
    hasAny = true;
  }
  if (seg.italic) {
    style.fontStyle = "italic";
    hasAny = true;
  }
  if (seg.underline || seg.strikethrough) {
    style.textDecorationLine = [
      seg.underline ? "underline" : "",
      seg.strikethrough ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" ");
    hasAny = true;
  }

  return hasAny ? style : undefined;
}
