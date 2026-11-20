# CLI 自测：执行引擎与退出码矩阵

本条目在隔离工作区（及 `SETTLED_DEMO_DIR` 隔离环境变量）中直接调起 `settled` 二进制，实测所有执行分支：

- **`check` / `--step`**：通过折叠、部分失败分流、`dir` & `cmd` 原样报错输出；
- **日志截断**：`> 120` 行默认截断提示与 `-v` 全量展示；
- **`fix` vs `run`**：`fix` 执行后必定触发 `check` 复检，而 `run <item> fix` 单独执行修复但不触发自动复检；
- **退出码 2 防线**：覆盖 `--step` 缺少 `<item>`、步骤下标越界、非当前平台条目、无脚本条目及损坏 `meta.json` 提示引导 `settled lint`。
- **终端彩色展示**：验证 `CLICOLOR_FORCE=1` 下 `PASS`/`FAIL`/`== Fix ==`/`== Verify ==` 与 `Summary` 的终端着色效果。
