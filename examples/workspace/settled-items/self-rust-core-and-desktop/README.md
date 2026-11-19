# 后端自测：Rust 核心库、桌面后端与 Clippy

在仓库根目录执行 Rust 侧核心断言与静态分析，覆盖：
- `settled-core` 工作区加载、`@script/` 令牌解析、多格式 `createAt`、异步并发运行与 GBK/超长日志截断；
- `settled-desktop` 最近工作区偏好管理、方案 3 实时目录监听与 `AppState`；
- 全工作区 `cargo clippy -- -D warnings`。
