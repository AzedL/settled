# Settled Sample Workspace

This sample workspace demonstrates all core **Settled** patterns:

- `items/git-core-config/` — Multi-step independent `check` commands + custom `show-config` script.
- `items/node-runtime-ready/` — Step `description` notes and `@script/` helper execution.
- `items/demo-fix-verification/` — End-to-end `check` -> `fix` -> auto-recheck workflow demo.
- `items/windows-powershell-utf8/` — Windows-only item (active on Windows, `disabled` on macOS/Linux in **All** view).
- `items/macos-homebrew-health/` — macOS-only item (`disabled` on Windows/Linux in **All** view, hidden in **Current Device** view).
- `items/ide-extension-notes/` — Pure documentation / manual niche pitfall with no automated scripts.
- `items/no-description-probe/` — Omits item and command `description` fields while preserving runnable checks.
- `items/untagged-manual-note/` — Omits `tags` and `scripts` to verify empty-tag UI handling.
- `items/many-tags-overflow-probe/` — High-density tags (including an extra-long tag) verifying pill wrapping, truncation, `+N` collapse, and bounded scroll areas.
