# Git 基础配置检查

核对新设备上 Git 工具与基础身份信息是否已就绪，并按操作系统区分换行符策略检查。

## 检查内容

1. **Git 可用性**：确认 `git --version` 可正常执行。
2. **提交身份**：校验 `user.name` 与 `user.email`。
3. **跨平台换行策略**：Windows 检查 `core.autocrlf` 已配置；macOS / Linux 要求为 `input`。

## 自定义只读命令

- `show-config`：使用单对象写法配置，可直接执行 `settled run git-config show-config` 查看完整配置来源。
