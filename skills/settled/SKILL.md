---
name: settled
description: Create, inspect, check, and troubleshoot cross-device environment items inside a Settled workspace using the `settled` CLI and the `settled-items/<item-id>/` specification.
---

# Settled Agent Skill

Use this skill whenever the user wants to:
1. Capture an environment setup requirement, recurring configuration, or niche troubleshooting pitfall into their **Settled** workspace.
2. Inspect failing environment checks, understand past context, apply fixes on the current machine, and verify resolution using `settled`.

---

## 1. Workspace Layout & Rules

A Settled workspace stores all definitions under `<workspace>/settled-items/`:

```text
<workspace>/
└── settled-items/
    └── <item-id>/            # Lowercase kebab-case directory name = unique ID
        ├── meta.json         # Explicit metadata & command registry
        ├── README.md         # Detailed background, symptoms, manual steps, references
        └── scripts/          # Optional scripts referenced via `@script/...`
```

### Mandatory Contracts
1. **Never store device-specific pass/fail/ignored state inside `meta.json` or `README.md`.** Definitions are shared across devices.
2. **Use exact platform enum values**: only `"windows"`, `"macos"`, `"linux"`. Never use `"win32"`, `"darwin"`, `"mac"`, or `"win64"`.
3. **Explicit registration only**: Settled only recognizes commands listed under `scripts` in `meta.json`. Unregistered files inside `scripts/` are never executed automatically.
4. **Always use `@script/` for local script paths** (e.g. `bash @script/check.sh`, `pwsh -File @script/fix.ps1`, `node @script/verify.mjs`). Never hardcode absolute paths. Execution `cwd` is always `<workspace>/settled-items/<item-id>/`.
5. **Independent & Idempotent Commands**:
   - All commands inside any `scripts.<key>` array run **independently and in parallel** (no sibling failure halts other commands).
   - Therefore, every command entry in an array MUST be safe to run independently, concurrently, and repeatedly (idempotent).
   - If a task requires strict sequential steps (e.g., install A then configure A), place those sequential steps inside **one** script file in `scripts/` and register that single script as one command entry.
6. **Check commands must be strictly read-only**: `scripts.check` probes environment state and exits `0` for pass or non-zero for fail. Do NOT mutate system state inside `check`.

---

## 2. `meta.json` Schema

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
        "run": "pwsh -NoProfile -Command \"if ((git config core.autocrlf) -ne 'true') { exit 1 }\"",
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

Field notes:
- `scripts.<key>` accepts `string | Step | (string | Step)[]`.
- `Step` fields:
  - `run` (required): command string.
  - `name` (optional): short label shown next to the traffic light.
  - `description` (optional): concise note shown inside the expanded log details panel.
  - `platforms` (optional): `("windows" | "macos" | "linux")[]`.
  - `shell` (optional): override default shell (`pwsh`/`powershell`/`cmd`/`bash`/`sh`/`zsh`).
  - `encoding` (optional): override default `utf-8` output decoding (e.g. `gbk`).
- A pure documentation / manual pitfall can omit `scripts` (or `scripts.check`) completely — just write `meta.json` and `README.md`.

---

## 3. CLI Workflows (`settled`)

Workspace resolution order: `-w/--workspace <path>` > `SETTLED_WORKSPACE` env > active workspace configured via `settled workspace use` > current directory (if it contains `settled-items/`; never walks parent directories).

### Selecting or Inspecting Workspace
```bash
settled workspace list
settled workspace use <workspace> [--init]
settled workspace current
settled list [--all-platforms]
```

### Capturing a New Pitfall or Setup Item
1. Scaffold `<workspace>/settled-items/<item-id>/` (`meta.json` starter + empty `README.md`):
   ```bash
   settled new <item-id>
   ```
2. Edit `README.md` directly (symptom, root cause, verified solution, manual steps) and populate `meta.json` / `scripts/`.
3. Validate contracts and immediately run `check`:
   ```bash
   settled lint <item-id>
   settled check <item-id>
   ```

### Diagnosing & Fixing a Failing Item on Current Device
1. Inspect workspace items (structured JSON with `id`, `path`, `applicable`, and `meta.json` fields) or run all checks:
   ```bash
   settled list
   settled check
   ```
2. For any `FAIL` item reported, inspect its `dir` directly (read `README.md`, `meta.json`, and `scripts/`) and optionally re-run with `-v` for verbose logs:
   ```bash
   settled check <item-id> -v
   ```
3. Fix the environment issue on the current machine (or run `settled fix <item-id>` if safe; `settled fix` automatically re-runs the item's `check` commands; use `settled run <item-id> <script_key>` to execute any group including `check`/`fix` directly without auto-verify).
4. **Always re-verify** before claiming success:
   ```bash
   settled check <item-id>
   ```
   Only report the item as resolved once all applicable `check` commands exit `0`.
