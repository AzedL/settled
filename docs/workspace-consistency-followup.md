# Workspace consistency follow-up (tracking)

> **Status: not implemented.** This file exists to keep two review findings and their regression criteria together in a Draft PR until implementation is resumed. No runtime behavior is changed by this commit.

## 1. Workspace switch can be superseded by an old workspace's reload

**Severity:** P1 (potential frontend/backend workspace divergence)

**Code:** `src/App.tsx`, `loadWorkspaceAtPath`, `handleReloadWorkspace`, `workspaceLoadSeqRef`.

Both a user-initiated workspace open and a file-watcher-triggered reload increment the same `workspaceLoadSeqRef`. A reload for workspace A can therefore invalidate an in-flight user request to open workspace B:

1. Workspace A is displayed.
2. User starts opening workspace B (`loadSeq = N`).
3. Before opening B resolves, a file-watcher event from A starts a reload (`loadSeq = N + 1`).
4. Rust successfully commits B as the active workspace and returns B's snapshot.
5. React discards B's response because its sequence is stale.
6. React may continue showing A while Rust has B active.

The backend's `open_seq`/`snapshot_seq` prevents its own stale commits, but does not enforce frontend priority between opening and reloading.

**Acceptance criteria**

- User-initiated workspace switches take precedence over watcher reloads for the previous workspace.
- Once a successful switch to B completes, frontend and backend both reflect B.
- A stale reload of A cannot invalidate B's open response or overwrite B in either layer.
- Add a controlled-promise integration test for **open B pending -> A watcher event -> open B succeeds**.
- Test rapid consecutive workspace switches and same-workspace concurrent reloads.

## 2. Command fingerprint is not bound to workspace identity

**Severity:** P1 (potential execution of a command from a different workspace)

**Code:** `src-tauri/src/lib.rs`, `CommandSelector` and `resolve_execution_targets`; `crates/settled-core/src/workspace.rs`, command fingerprint generation; `src/utils/itemStatus.ts`, `toCommandSelector`.

`CommandSelector` now validates `item_id`, `group_key`, `command_index`, and `fingerprint`, which correctly rejects changed or reordered commands *within the same active workspace*. However, the fingerprint is derived from command configuration and does not identify the workspace.

If workspaces A and B contain an item with the same ID, group, index and identical metadata command (e.g. `node @script/fix.mjs`), the selector produced by A may also validate against B. The script files may differ between workspaces. In combination with finding #1, the user can see A but execute B's `fix` script.

**Acceptance criteria**

- Include a stable workspace identity and/or explicit active-workspace revision in execution requests, independent of the per-command fingerprint.
- Reject any command request that was selected in a different workspace or invalidated by a workspace switch.
- Maintain legitimate same-workspace command execution and existing hot-reload command mapping behavior.
- Add a backend regression test with A and B sharing the same item ID, command index and command metadata but different script file contents.
- Add a frontend integration test showing stale A selection cannot execute against B after a switch.
- Explicitly define behavior for a switch that occurs after selector resolution but before a long-running command starts.

## Notes

- These findings were reviewed against `main` at `9271297dbd398e97398adb8253a64e86b4b76587`.
- This Draft PR intentionally contains only the tracking document. Implement fixes and tests on this branch before marking it ready for review.
