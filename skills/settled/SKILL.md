---
name: settled
description: Create, inspect, validate, execute, and edit cross-device environment items in a Settled workspace via the `settled` CLI and `settled-items/<item-id>/` manifests, including handling pasted `# Settled Item:` context blocks from the Settled desktop app.
---

# Settled Agent Skill

Use this skill whenever the user wants to:
1. Capture an environment check, recurring setup requirement, or troubleshooting pitfall into their **Settled** workspace.
2. Inspect, run, fix, or edit environment items using `settled`.
3. Act on a `# Settled Item: ...` locator context block pasted from the Settled desktop app.

---

## 1. Pasted Locator Context (`复制条目上下文`)

When a user copies an item from the Settled desktop app, they paste a minimal locator anchor such as:

```markdown
# Settled Item: <name> (`<item-id>`)

- **Workspace**: `<workspace-root>`
- **Item Directory**: `<item-dir>`
- **Host Platform**: `<windows|macos|linux>`
- **Target Platforms**: <platforms|all>
- **Description**: <description>
- **Tags**: <tags>
- **Scripts**: `check`, `fix`
```

(When the item does not apply to the host OS, `- **Applicable on Host**: false` is also included; empty optional fields are omitted.)

This block intentionally carries **only identity and path metadata** (no `README.md`, `meta.json`, or run logs) so the user can attach any intent (diagnose a failure, fix the host, add/modify scripts, update docs, or explain the item):
1. Read `<item-dir>/meta.json`, `<item-dir>/README.md`, and relevant files inside `<item-dir>/scripts/` directly.
2. Pass `-w "<workspace-root>"` to `settled` CLI commands unless that workspace is already active.

---

## 2. Workspace Layout & Manifest Contract

All definitions live under `<workspace>/settled-items/`:

```text
<workspace>/
└── settled-items/
    └── <item-id>/            # Unique ID: [a-z0-9][a-z0-9_-]* (max 128 chars; kebab-case recommended)
        ├── meta.json         # Explicit metadata & script registry (required)
        ├── README.md         # Background, symptoms, manual steps (optional; non-empty avoids lint WARN)
        └── scripts/          # Local scripts referenced via `@script/...` (optional)
```

### Canonical `meta.json` Schema

```json
{
  "name": "Git Core Configuration",
  "description": "Ensure Git identity, line endings, and credential helper fit the OS",
  "createAt": 1794596400,
  "tags": ["git", "init"],
  "platforms": ["windows", "macos", "linux"],
  "scripts": {
    "check": [
      {
        "name": "User identity configured",
        "description": "Verify git user.name and user.email are non-empty",
        "run": "git config user.name && git config user.email"
      },
      {
        "name": "Windows CRLF policy",
        "description": "Verify core.autocrlf is true on Windows",
        "run": "if ((git config core.autocrlf) -ne 'true') { exit 1 }",
        "platforms": ["windows"]
      },
      {
        "name": "macOS line endings",
        "run": "test \"$(git config core.autocrlf)\" = \"input\"",
        "platforms": ["macos"]
      }
    ],
    "fix": [
      {
        "name": "Apply Windows autocrlf",
        "run": "git config --global core.autocrlf true",
        "platforms": ["windows"]
      }
    ]
  }
}
```

### Field & Runtime Rules
- **Top-level allowed keys**: `name` (required string), `description`, `createAt`, `tags`, `platforms`, `scripts`.
- **`createAt`**: prefer Unix timestamp seconds (also accepts Unix milliseconds and ISO-8601 strings).
- **`tags`**: JSON string array (`string[]`), never a bare string.
- **`platforms`**: array of `"windows"`, `"macos"`, `"linux"` only (never `"win32"`, `"darwin"`, `"mac"`, `"win64"`, or `null`). Omitting `platforms` or passing `[]` targets all platforms.
- **`scripts.<key>`**: `string | Step | (string | Step)[]`.
  - Allowed `Step` keys: `run` (required, non-empty), `name`, `description`, `platforms`, `shell`, `encoding`.
  - Default shells: `pwsh` (fallback `powershell`) on Windows; `bash` (fallback `sh`) on macOS/Linux.
  - Default output decoding: `utf-8` (override with e.g. `"encoding": "gbk"` when needed).

### Mandatory Invariants
1. **Keep workspace definitions stateless across devices**: never write machine-specific pass/fail/ignored state into `meta.json` or `README.md`.
2. **Explicit registration + `@script/` paths**: Settled executes only commands declared in `scripts` with `cwd` fixed to `<workspace>/settled-items/<item-id>/`. Reference local files via `@script/<subpath>` (never hardcode machine paths).
3. **Parallel & idempotent array commands**: every command inside a `scripts.<key>` array runs concurrently and independently without aborting siblings on failure. Keep each entry safe to re-run concurrently; consolidate strictly sequential steps into a single script in `scripts/`.
4. **Read-only `check`**: `scripts.check` must only probe state and exit `0` (pass) or non-zero (fail) — put side effects in `scripts.fix` or custom script keys.
5. **Avoid silent skips & `settled lint` warnings**:
   - Invalid JSON or wrong field types (e.g. `tags` as string, `platforms: null`, invalid platform string) cause `load_workspace` and the desktop app to skip the item — `settled lint` flags these as `[ERROR]` (exit `1`).
   - Unexpected keys, missing/empty `README.md`, missing first-level `@script/` targets, step `platforms` disjoint from item `platforms`, and duplicate commands (same normalized `run`, `shell`, `encoding` with overlapping `platforms`) within or across `scripts` groups emit `[WARN]`.

---

## 3. `settled` CLI Workflows

**Workspace resolution order**: `-w/--workspace <path>` > `SETTLED_WORKSPACE` env > active CLI workspace (`settled workspace use`) > current working directory (only if it directly contains `settled-items/`; never searches parent directories).

**Exit codes**:
- `0`: success (including `settled lint` with warnings only and 0 errors).
- `1`: executed command failed, or `settled lint` reported `[ERROR]` items.
- `2`: invocation/setup failure (missing workspace, invalid item ID, item inapplicable on host OS, `--step` out of range, missing item, malformed target item).

### Workspace & Listing
```bash
settled workspace list                # alias: ls
settled workspace use <path> [--init]
settled workspace remove <path>       # alias: rm
settled workspace current
settled list [--all-platforms]        # JSON with id, path, applicable, and raw meta fields
```

### Creating & Validating an Item
1. Scaffold `<workspace>/settled-items/<item-id>/`:
   ```bash
   settled new <item-id>
   ```
   (`settled new` creates an empty `README.md` and starter `meta.json` with a placeholder failing `check`: `exit 1`.)
2. Replace the placeholder `check`, write clear troubleshooting/setup notes in `README.md`, and add any files in `scripts/`.
3. Validate schema/lint contracts and run checks:
   ```bash
   settled lint <item-id>
   settled check <item-id>
   ```

### Diagnosing, Fixing & Verifying
1. Run workspace or item checks:
   ```bash
   settled check                         # run all applicable checks (warns on stderr for skipped invalid items)
   settled check --strict                # fail (exit 1) if any item was skipped due to missing/invalid meta.json
   settled check <item-id> [--step 0] -v # -v prints passing logs and >120-line untruncated output
   ```
2. On failure, `settled check` prints the item's `dir`, failing `cmd`, exit code, and stderr/stdout tail; inspect `<dir>/README.md`, `meta.json`, and `scripts/` directly.
3. Apply fixes manually or run `settled fix`:
   ```bash
   settled fix <item-id> [--step 0] [-v] # runs fix, then automatically re-runs item's applicable check
   settled run <item-id> <group> [--step 0] [-v] # runs any group directly without auto-verify
   ```
4. **Always finish with verification** before reporting success:
   ```bash
   settled check <item-id>
   ```
   Only treat an item as resolved once all applicable `check` commands exit `0`.
