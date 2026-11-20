# CLI 自测：工作区管理、`list`、`new` 与 `lint` 诊断矩阵

本条目在隔离沙箱目录（`mkdtempSync` + `SETTLED_CLI_CONFIG`）中直接驱动真实 `settled` 二进制，确保测试完全不污染本机全局 CLI 配置或实际工作区：

- **`workspace`**：校验 `use --init`、`* ` 当前激活标记、失效目录 `warning:`、回退仅查当前目录不向上寻找、`remove` 与 `current`。
- **`list`**：校验固定 JSON 结构（`id` / `path` / `applicable` + `meta` 字段，剔除 `metaPath`/`readmePath`/`readme`/`rawMeta`）。
- **`new`**：校验 `<item-id>` 格式及防重复保护。
- **`lint`**：直观打印并断言所有 `[ERROR]`（会被 `load_workspace` 静默忽略的情形，退出码 `1`）与 `[WARN]`（未知字段、空/缺 README、一级脚本不存在、跨平台交集为空，退出码 `0`）。
- **`终端上色`**：验证 `CLICOLOR_FORCE=1` 下 `[ERROR]`/`[WARN]`/`error:`/`warning:` 与 `workspace list` 的 ANSI 色彩输出（同时直接在 Settled UI 中预览效果），以及 `NO_COLOR=1`、`list` JSON 与 `workspace current` 的无色隔离。
