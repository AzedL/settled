# Settled 自测工作区（Examples）

本目录是 **Settled 自身的 Dogfooding 自测工作区**（全中文），分为两个层面设计，无任何冗余或无效条目：

## 一、前端桌面端视角全场景覆盖（`ui-*`）

1. `settled-items/ui-check-fix-workflow/` — **混合 Check、多步骤 Fix 自动复检与自定义命令**
   - 同条目内并存「固定通过」「待修复失败」「延时运行（可测中止）」三种状态灯；
   - 多个并行 `fix` 触发确认弹窗并执行后自动重跑 `check` 转绿；
   - 包含对象与字符串简写自定义组、`reset` 一键复位、固定 stderr 失败演示，以及完整 GFM `README.md`。
2. `settled-items/ui-empty-and-defaults/` — **前端空态与缺省字段边界**
   - 省略 `tags`（列表无 tag、详情显示 `无标签`）、省略 `createAt`（详情显示 `无`）、省略 `description`、省略 `scripts`（显示 `该条目未注册命令`），并故意保留**空 `README.md`**（验证空白最小高度展示与 `lint` 警告）。
3. `settled-items/ui-many-tags-and-logs/` — **高频/超长标签溢出、无步骤说明与长日志滚动**
   - 20 个以上标签及超长标签，验证侧边栏 `+N` 折叠、详情卡片 `+N` 悬浮气泡及筛选框滚动；
   - 混合无 `description` 简写成功步、150 行多行中文日志输出与独立失败检查项。
4. `settled-items/ui-platform-windows/` — **仅 Windows 适用条目**（验证 Windows UTF-8 与其他平台置灰禁用）。
5. `settled-items/ui-platform-macos/` — **仅 macOS 适用条目**（验证 Windows / Linux 下「全部平台」虚线禁用态及「当前设备」过滤隐藏）。

## 二、Rust 后端、前端工程与 CLI 自检条目（`self-*`）

6. `settled-items/self-rust-core-and-desktop/` — 直接调用 Cargo 运行 `settled-core`、`settled-desktop` 单元测试与全工作区 `clippy`。
7. `settled-items/self-frontend-vitest/` — 直接运行 Vitest 前端单测、`tsc && vite build` 及 V8 覆盖率报告生成。
8. `settled-items/self-cli-workspace-and-lint/` — 通过隔离沙箱实测 `settled` 二进制的工作区管理、`list`、`new` 及 `lint` 全部 `[ERROR]` / `[WARN]` 矩阵。
9. `settled-items/self-cli-execution-matrix/` — 通过隔离沙箱实测 `settled check` / `fix` / `run`、超过 120 行日志截断、`-v` 全量输出与 `0/1/2` 退出码。
