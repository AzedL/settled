# Git Core Configuration

Cross-device checklist for ensuring Git works consistently between Windows workstations and macOS/Linux environments.

## Symptoms When Missing
- Commits fail with `Author identity unknown` on a fresh machine.
- Mixed CRLF/LF diffs appear when sharing repositories between Windows and macOS.

## Notes
- On Windows, `core.autocrlf` is typically `true` (or `input` inside WSL).
- On macOS/Linux, `core.autocrlf` should usually be `input`.
- Use the `show-config` custom script to inspect which config file sets each key.
