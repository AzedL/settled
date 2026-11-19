# Settled

**Settled** 是一个跨设备开发环境检查与问题台账桌面应用 + CLI 工具，用来记录不同系统上的环境配置、疑难排查笔记与验证脚本，并在当前机器上随时一键核对每项检查的真实状态。

## 核心能力

- **工作区协议清晰可读**：所有环境条目存放在用户自主管理的 `<workspace>/settled-items/<item-id>/` 目录中（通过 `meta.json`、`README.md` 和可选 `scripts/` 组织），运行态检查结果不污染配置仓库，方便通过 Git / 网盘跨设备同步。
- **独立命令与红绿灯**：每条 `check` 命令独立并发执行，实时流式输出日志并展示各自状态灯（未运行 / 运行中 / 通过 / 失败 / 已中止）。
- **修复后自动复检**：支持 `fix` 与自定义脚本分组执行；执行 `fix` 完成后若存在适用 `check`，会自动重跑 `check` 验收，并支持一键复制包含命令结果与文档在内的结构化 AI 上下文。
- **跨平台范围切换**：支持仅看「当前设备」适用条目，或在「全部平台」视图中查看其他系统条目（自动置灰并阻止误执行）。
- **浅色 / 深色 / 跟随系统主题**、关键词与键盘友好的多标签搜索、文件变更实时刷新监听，以及配套的 `settled` 命令行工具与 Agent Skill（[skills/settled/SKILL.md](skills/settled/SKILL.md)）。

## 项目结构

```text
settled/
├── crates/
│   ├── settled-core/     # 共享 Rust 核心引擎（工作区解析、并发执行器、AI 上下文生成）
│   └── settled-cli/      # 无头 CLI 二进制 `settled`
├── src-tauri/            # Tauri v2 桌面端后端（命令接口、偏好持久化、文件监听）
├── src/                  # React + TypeScript + Tailwind CSS v4 桌面前端
├── docs/DESIGN.md        # 架构设计与工作区契约说明
├── skills/settled/       # 供 AI 编程助手使用的 Settled Skill
└── examples/workspace/   # 开箱即用的示例工作区
```

## 工作区目录约定

```text
<workspace>/
└── settled-items/
    └── <item-id>/
        ├── meta.json     # 必填：名称、描述、平台、标签与显式声明的 scripts
        ├── README.md     # 可选：问题背景、排查记录与手动步骤（只读预览）
        └── scripts/      # 可选：通过 `@script/<path>` 引用的本地脚本
```

详细 schema 与执行契约见 [docs/DESIGN.md](docs/DESIGN.md)。

## 本地开发与构建

前置依赖：Node.js、Rust 工具链以及 Tauri v2 桌面端运行/打包环境。

```bash
# 安装前端依赖
npm install

# 启动 Tauri 桌面端开发环境
npm run tauri dev

# 前端类型检查与生产构建
npm run build

# 打包桌面应用
npm run tauri build
```

测试与代码检查：

```bash
# 运行核心库与 CLI 单元测试
cargo test -p settled-core -p settled-cli

# 编译检查桌面端与 CLI
cargo check --workspace
```

## CLI (`settled`) 用法

工作区解析顺序：`-w / --workspace <path>` > `SETTLED_WORKSPACE` 环境变量 > 全局激活工作区（`settled workspace use` 设置）> 当前目录（须包含 `settled-items/`，不向上级目录查找）。

```bash
# 注册并切换默认工作区（若缺少 settled-items/ 可加 --init 自动初始化）
cargo run -q -p settled-cli -- workspace use examples/workspace
cargo run -q -p settled-cli -- workspace list
cargo run -q -p settled-cli -- workspace current
cargo run -q -p settled-cli -- workspace remove examples/workspace

# 列出当前平台适用的条目及结构化元数据（加 --all-platforms 查看全平台）
cargo run -q -p settled-cli -- list -w examples/workspace

# 创建新条目骨架（meta.json 模板 + 空 README.md）并校验工作区契约
cargo run -q -p settled-cli -- new my-new-item -w examples/workspace
cargo run -q -p settled-cli -- lint -w examples/workspace

# 运行所有适用 check（或指定单个条目与 --step 下标，加 -v 查看通过项日志）
cargo run -q -p settled-cli -- check -w examples/workspace

# 执行 fix 并自动重跑条目适用 check 验收
cargo run -q -p settled-cli -- fix ui-check-fix-workflow -w examples/workspace

# 通用执行任意脚本分组（包含直接单独运行 check 或 fix，不附带自动复检）
cargo run -q -p settled-cli -- run self-cli-workspace-and-lint check -w examples/workspace
```
