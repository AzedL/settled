---
name: settled
description: Create, inspect, check, and troubleshoot cross-device environment items inside a Settled workspace using the `settled` CLI and the `items/<item-id>/` specification.
---

# Settled Agent Skill

Use this skill whenever the user wants to:
1. Capture an environment setup requirement, recurring configuration, or niche troubleshooting pitfall into their **Settled** workspace.
2. Inspect failing environment checks, understand past context, apply fixes on the current machine, and verify resolution using `settled`.

---

## 1. Workspace Layout & Rules

A Settled workspace stores all definitions under `<workspace>/items/`:

```text
<workspace>/
└── items/
    └── <item-id>/            # Lowercase kebab-case directory name = unique ID
        ├── meta.json         # Explicit metadata & command registry
        ├── README.md         # Detailed background, symptoms, manual steps, references
        └── scripts/          # Optional scripts referenced via `@script/...`
```

### Mandatory Contracts
1. **Never store device-specific pass/fail/ignored state inside `meta.json` or `README.md`.** Definitions are shared across devices.
2. **Use exact platform enum values**: only `"windows"`, `"macos"`, `"linux"`. Never use `"win32"`, `"darwin"`, `"mac"`, or `"win64"`.
3. **Explicit registration only**: Settled only recognizes commands listed under `scripts` in `meta.json`. Unregistered files inside `scripts/` are never executed automatically.
4. **Always use `@script/` for local script paths** (e.g. `bash @script/check.sh`, `pwsh -File @script/fix.ps1`, `node @script/verify.mjs`). Never hardcode absolute paths. Execution `cwd` is always `<workspace>/items/<item-id>/`.
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
  - `description` (optional): hover tooltip explaining what the command checks or does.
  - `platforms` (optional): `("windows" | "macos" | "linux")[]`.
  - `shell` (optional): override default shell (`pwsh`/`powershell`/`cmd`/`bash`/`sh`/`zsh`).
  - `encoding` (optional): override default `utf-8` output decoding (e.g. `gbk`).
- A pure documentation / manual pitfall can omit `scripts` (or `scripts.check`) completely — just write `meta.json` and `README.md`.

---

## 3. CLI Workflows (`settled`)

### Capturing a New Pitfall or Setup Item
1. Choose a concise kebab-case `<item-id>` under `<workspace>/items/<item-id>/`.
2. Write `README.md` documenting: symptom, root cause, verified solution across relevant OSes, and any manual steps.
3. Write `meta.json` with `name`, `description`, `createAt` (current Unix timestamp in seconds, e.g. `1794596400`), `tags`, optional `platforms`, and read-only `scripts.check` (plus optional `scripts.fix` / custom scripts) if automatable.
4. Immediately validate using:
   ```bash
   settled check <item-id> --workspace <workspace> --json
   ```

### Diagnosing & Fixing a Failing Item on Current Device
1. Inspect workspace items or run checks:
   ```bash
   settled list --workspace <workspace> --json
   settled check --workspace <workspace> --json
   ```
2. Pull full structured context (metadata + `README.md` + fresh failure logs) for a failing item:
   ```bash
   settled context <item-id> --workspace <workspace> --run-check
   ```
3. Fix the environment issue on the current machine (or run `settled fix <item-id> --workspace <workspace>` if appropriate and safe).
4. **Always re-verify** before claiming success:
   ```bash
   settled check <item-id> --workspace <workspace> --json
   ```
   Only report the item as resolved once all applicable `check` commands exit `0`.
