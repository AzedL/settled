# Settled — V1 Architecture & Contract Specification

> **Settled** is a cross-device environment management cockpit and CLI engine.  
> Core thesis: in the AI era, solving an environment issue once is easy; knowing **what is already settled vs. unsettled on the current machine** and capturing rare pitfalls with minimal friction is what scales across devices.

---

## 1. Repository Architecture

This repository is organized as a **Cargo Workspace + Tauri v2 + React + TypeScript + Tailwind CSS v4** project:

```text
settled/
├── Cargo.toml                   # Cargo workspace root
├── package.json                 # Frontend + Tauri CLI workspace
├── docs/
│   └── DESIGN.md                # Living architecture & schema contract
├── crates/
│   ├── settled-core/            # Shared Rust engine (workspace loader, runner, context)
│   └── settled-cli/             # `settled` headless CLI binary for terminals & AI agents
├── src-tauri/                   # Tauri v2 desktop backend (plugins, events, prefs, watcher)
├── src/                         # React + TS + Tailwind v4 UI cockpit
│   ├── styles/tokens.css        # Design tokens (colors, surfaces, spacing, typography)
│   └── lang.ts                  # Centralized UI copy (zero hardcoded strings in TSX)
├── skills/
│   └── settled/
│       └── SKILL.md             # AI agent instructions for capturing & fixing items
└── examples/
    └── workspace/               # Ready-to-run sample workspace for local validation
```

---

## 2. Workspace Open Protocol

Users own the `workspace/` folder and sync it however they prefer (Git, iCloud, Syncthing, etc.). `Settled` treats the workspace definition layer as read-only input during normal operation and never writes per-device run results into `meta.json` or `README.md`.

```text
<workspace>/
├── README.md                    # Optional user documentation
├── .gitignore                   # Optional VCS rules
└── settled-items/               # Aggregation directory for all Settled items
    └── <item-id>/               # Folder name = unique item ID (flat, tagged)
        ├── meta.json            # Required manifest & explicit script registry
        ├── README.md            # Problem background, symptoms, manual steps, notes
        └── scripts/             # Optional; `@script/` strictly resolves here
            ├── check.sh
            └── fix.ps1
```

### 2.1 Discovery Rules
- `Settled` scans `<workspace>/settled-items/*/`.
- Hidden directories starting with `.` are skipped.
- Only directories containing `meta.json` are loaded as items.
- Item documentation prefers `README.md` by convention while remaining compatible with lowercase `readme.md`.
- Malformed or unreadable `meta.json` directories are ignored cleanly without breaking the rest of the workspace.

### 2.2 Canonical Platform Values
The program enforces exact canonical platform strings:
- `"windows"`
- `"macos"`
- `"linux"`

Platform applicability applies at **two levels**:
1. **Item level** (`meta.json` `platforms`): if omitted or empty, applies to all platforms; otherwise applies only if it includes the current host platform.
2. **Command level** (`Step.platforms`): if omitted or empty, applies to all platforms (subject to item-level applicability); otherwise applies only to matching platforms.

### 2.3 `meta.json` Schema

```ts
type Platform = "windows" | "macos" | "linux";

interface StepObject {
  name?: string;         // Human-readable display label (falls back to `run`)
  description?: string;  // Optional explanation shown inside expanded log details
  run: string;           // Shell command or invocation using `@script/...`
  platforms?: Platform[];
  shell?: string;        // e.g. "pwsh" | "powershell" | "cmd" | "bash" | "sh" | "zsh"
  encoding?: string;     // e.g. "utf-8" (default) | "gbk" | ...
}

type CommandSpec = string | StepObject;
type ScriptSpec = CommandSpec | CommandSpec[];

interface ItemMeta {
  name: string;
  description?: string;
  createAt?: number;     // Unix timestamp (seconds)
  tags?: string[];
  platforms?: Platform[];
  scripts?: Record<string, ScriptSpec>;
}
```

### 2.4 Explicit Registration & `@script/` Convention
- Only commands explicitly declared in `meta.json` under `scripts` are recognized and runnable. Arbitrary files in `scripts/` are never auto-discovered or executed.
- `@script/<subpath>` inside `run` resolves to `./scripts/<subpath>` (or `.\scripts\<subpath>` when `shell` is `cmd`), with `cwd` always fixed to `<workspace>/settled-items/<item-id>/`.

---

## 3. Execution & Concurrency Model

- **Independent Parallel Execution**: Every command inside a `scripts.<key>` group (`check`, `fix`, or any custom script key) is treated as an independent, idempotent unit.
  - Individual commands can be executed one by one.
  - Running a whole group launches all applicable commands in that group concurrently (bounded by a worker semaphore across batch operations), never aborting sibling commands if one fails.
  - Multi-step operations that require strict sequential ordering should be consolidated into a single script file in `scripts/`.
- **Special Script Conventions**:
  - `check`: Drives independent per-command traffic lights (`idle` | `running` | `pass` | `fail` | `canceled`). Product-level batch runs (`Run All`, `Run by Tags`, `Run Failed`) execute **only `check`** commands.
  - `fix`: Highlighted when any `check` fails; executes with mandatory user confirmation. Upon completion of a `fix` run (single or group), if the item has applicable `check` commands, `Settled` automatically re-runs those `check` commands to verify the environment.
  - Any other key in `scripts` renders as a generic custom script group (with single-command and whole-group triggers).
- **Default Runtime Contract**:
  - Windows default shell: `pwsh` if available on `PATH`, otherwise `powershell` (configured for UTF-8 output by default).
  - macOS / Linux default shell: `bash` if available, otherwise `sh`.
  - Default output encoding: `utf-8` (decodable via `encoding_rs` when overridden, e.g., `gbk`).
  - Stdin is always closed (`null`) to prevent interactive hangs; running commands support live stdout/stderr streaming and process-tree cancellation.

---

## 4. V1 State & View Boundaries

- **Stateless V1 Business State**: V1 does not persist check results or manual overrides inside the workspace or disk. Every workspace open starts applicable checks in `idle` ("not run") state for on-demand live verification.
- **No Collapsed Item Traffic Light**: Instead of collapsing checks into a single pass/fail badge or adding a warning state, item cards display **each applicable check's independent traffic light side-by-side** so users immediately see which specific checks passed or failed. Filtering by "Has Failures", "Has Unrun", or "All Passed" remains supported.
- **Current Device / All View Switch**:
  - **Current Device**: Shows only items and script commands applicable to the host platform.
  - **All**: Shows all items and commands, rendering non-current-platform items and commands in a clearly distinguishable **disabled** visual state with execution blocked.
- **App Preferences**: Local desktop app preferences (last and recent workspace directories) are stored in the OS app-data directory via Tauri, separate from the workspace.
- **Cockpit Boundaries**: Read-only Markdown viewer, external IDE / file manager openers, structured AI context copy, and live file-system watching (`notify`) for workspace changes. No built-in code editor, PTY terminal, or LLM chat runtime.

---

## 5. Frontend Engineering Constraints

- **Official Tooling First**: Built with official `create-tauri-app`, `@tauri-apps/api`, official Tauri v2 plugins (`dialog`, `opener`, `clipboard-manager`), React, TypeScript, and official `@tailwindcss/vite` (Tailwind CSS v4).
- **Design Tokenization & Even-Pixel Rule**: All colors, surfaces, status lights, typography sizes, radii, spacing, and dimensions are defined via CSS tokens in `src/styles/tokens.css` and Tailwind `@theme`. **Odd pixel values are avoided** for font sizes, line heights, widths, heights, padding, margins, gaps, and borders.
- **Text Isolation**: All UI copy resides exclusively in `src/lang.ts`.
