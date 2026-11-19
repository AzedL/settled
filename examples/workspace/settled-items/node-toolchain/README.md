# Node.js 与 npm 工具链

通过本地 `scripts/check-node.mjs` 脚本验证当前机器的 Node.js 运行环境。

- 通过 `@script/check-node.mjs` 引用相对脚本，兼容 bash / pwsh / cmd。
- 执行时 `cwd` 固定锁定在 `settled-items/node-toolchain/` 目录。
