# Settled

**Settled** 是一个跨设备开发环境检查与问题台账桌面应用 + CLI 工具，用于沉淀不同操作系统上的环境配置、疑难排查说明与可自动执行的校验/修复脚本，并在当前设备上随时核对真实环境状态。

## 设计理念与核心能力

- **纯文本、零污染的工作区协议**
  - 所有条目集中存放在用户自管理的 `<workspace>/settled-items/<item-id>/` 目录中，仅由 `meta.json`、`README.md` 和可选 `scripts/` 构成。
  - 桌面端与 CLI 均为只读消费定义文件，不在工作区目录内写入本机运行结果，方便通过 Git、iCloud 或网盘跨设备同步。
- **并发执行、独立状态灯与终端还原日志**
  - 同一脚本分组内的命令独立并发执行、互不阻断；每条 `check` 拥有独立状态灯（未运行 / 运行中 / 通过 / 失败 / 已中止）。
  - 执行 `fix` 后若条目存在适用 `check`，会自动重跑 `check` 完成环境验收；也支持自定义分组脚本执行。
  - 日志区域实时流式渲染，支持解析终端 ANSI 色彩（16 / 256 / TrueColor）与常见控制符，自动适配浅色与深色主题。
- **跨平台范围与条目上下文定位**
  - 支持在「当前设备」与「全部平台」视图间切换：非本机适用的条目与命令在全部平台视图下清晰置灰并禁用执行。
  - 详情区提供「在 VS Code 中打开」「在文件管理器中定位」与「复制条目上下文」（输出仅含工作区/条目路径、平台与 `scripts` 分组名的精简定位锚点，便于交由本地 AI Coding Agent 按需读取文件并按用户指令操作）。
- **无头 CLI 与 Agent Skill**
  - 提供独立 CLI 工具 `settled`（覆盖工作区管理、结构化列表、`new` 脚手架、`lint` 契约校验及 `check`/`fix`/`run` 执行引擎）与配套 Agent Skill（[skills/settled/SKILL.md](skills/settled/SKILL.md)）。

## 仓库结构

```text
settled/
├── crates/
│   ├── settled-core/     # 共享 Rust 核心引擎（工作区扫描、并发执行器、条目上下文构造）
│   └── settled-cli/      # 无头 CLI 二进制 `settled`
├── src-tauri/            # Tauri v2 桌面端后端（IPC 命令、本地偏好、分层文件监听）
├── src/                  # React + TypeScript + Tailwind CSS v4 桌面前端
├── docs/DESIGN.md        # V1 架构设计、Schema 与执行契约文档
├── skills/settled/       # 供 AI 编程助手使用的 Settled Skill
└── examples/workspace/   # 开箱即用的全中文 Dogfooding 自测工作区
```

## 工作区目录约定

```text
<workspace>/
└── settled-items/
    └── <item-id>/
        ├── meta.json     # 必填：名称、描述、创建时间、标签、平台与显式声明的 scripts
        ├── README.md     # 可选：问题背景、排查笔记与手动操作指南（只读 Markdown 渲染）
        └── scripts/      # 可选：通过 `@script/<path>` 令牌引用的本地脚本目录
```

完整的 Schema 定义、平台继承规则、Shell/编码默认值与执行边界见 [docs/DESIGN.md](docs/DESIGN.md)。

> **安全提示**：工作区中的 `meta.json`、`README.md` 与 `scripts/` 为纯文本同步文件，请勿在其中写入明文密钥、个人 Token 或密码。

## 本地开发、构建与测试

前置依赖：Node.js、Rust 工具链（Rust ≥ 1.85，使用 Edition 2024）及 Tauri v2 桌面构建环境。

```bash
# 安装前端依赖
npm install

# 启动 Tauri 桌面端热更新开发
npm run tauri dev

# 前端 TypeScript 类型检查与 Vite 生产构建
npm run build

# 打包桌面应用安装包
npm run tauri build
```

全量测试与代码质量检查：

```bash
# 前端 Vitest 单元测试与 V8 覆盖率统计
npm test
npm run test:coverage

# Rust 全工作区单元测试与 CLI 集成测试（settled-core、settled-cli、settled-desktop）
cargo test --workspace

# 全工作区严格静态检查（零警告）
cargo clippy --workspace --all-targets -- -D warnings
```

仓库内置了覆盖前端极限态、后端单测与 CLI 矩阵的中文示例工作区 [examples/workspace](examples/workspace/README.md)，可直接用桌面端打开或通过下方 CLI 命令本地试跑。

## CLI (`settled`) 速览

工作区解析优先级：`-w / --workspace <path>` > `SETTLED_WORKSPACE` 环境变量 > 全局激活工作区（`settled workspace use` 设置）> 当前目录（须直接包含 `settled-items/`，不向上级目录回溯）。

> 开发期未全局安装 `settled` 时，可将下方 `settled` 替换为 `cargo run -q -p settled-cli --`。

```bash
# 工作区管理（支持 ls / rm 别名）
settled workspace use examples/workspace [--init]
settled workspace list
settled workspace current
settled workspace remove examples/workspace

# 查看条目元数据 JSON（默认仅当前平台；--all-platforms 含非本机禁用条目）
settled list -w examples/workspace
settled list --all-platforms -w examples/workspace

# 创建新条目骨架，并通过 lint 检查语法、未知字段、文档、一级 @script/、平台交集与重复命令
settled new my-new-item -w examples/workspace
settled lint [item-id] -w examples/workspace

# 执行检查（可指定条目，配合条目名使用 --step <0-based> 单步；-v 展示通过项与完整不截断日志；--strict 在存在损坏/跳过条目时返回非 0）
settled check [item-id] [-v] [--strict] -w examples/workspace
settled check <item-id> --step 0 -v -w examples/workspace

# 执行修复并在未中止时自动重跑条目适用 check 验收（同样支持 --step 与 -v）
settled fix <item-id> [--step 0] [-v] -w examples/workspace

# 直接执行任意脚本分组（可直接调用 check / fix / 自定义分组，不触发自动复检）
settled run <item-id> <script-key> [--step 0] [-v] -w examples/workspace
```
