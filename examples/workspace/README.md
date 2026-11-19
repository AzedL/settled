# Settled 示例工作区

本示例工作区使用中文编写，无冗余占位条目，每项均用于覆盖桌面端与 CLI 核心能力及自动化测试验证：

- `settled-items/git-config/` — 多步骤独立 `check`、单步平台差异（Windows / macOS / Linux），以及单对象自定义脚本 `show-config`。
- `settled-items/node-toolchain/` — `@script/` 相对脚本路径解析、`cwd` 锁定与步骤说明。
- `settled-items/fix-verify-demo/` — 多步骤并发检查、并行 `fix` 修复与自动复检，以及数组/单对象自定义分组与失败模拟（可通过 `SETTLED_DEMO_DIR` 环境变量隔离临时目录供自动化测试）。
- `settled-items/windows-pwsh-utf8/` — 仅 `windows` 适用条目，覆盖平台过滤与中文 UTF-8 解码输出。
- `settled-items/macos-homebrew/` — 仅 `macos` 适用条目，覆盖跨平台禁用（`applicable: false`）与 `--all-platforms` 行为。
- `settled-items/manual-checklist/` — 无标签、无脚本的纯文档手动核对清单条目。
