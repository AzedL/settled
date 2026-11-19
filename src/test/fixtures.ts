import type {
  CommandRuntimeState,
  ResolvedCommand,
  ScriptGroup,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "../types";

export function makeCommand(
  overrides: Partial<ResolvedCommand> = {}
): ResolvedCommand {
  const index = overrides.index ?? 0;
  const key = overrides.key ?? "check";
  const commandId = overrides.commandId ?? `git-config::${key}::${index}`;
  return {
    index,
    key,
    commandId,
    name: "Git 已安装",
    description: "确认 git 可执行",
    rawRun: "git --version",
    resolvedRun: "git --version",
    platforms: [],
    applicable: true,
    shell: null,
    effectiveShell: "pwsh",
    encoding: "utf-8",
    ...overrides,
  };
}

export function makeGroup(overrides: Partial<ScriptGroup> = {}): ScriptGroup {
  const key = overrides.key ?? "check";
  return {
    key,
    role: overrides.role ?? (key === "check" ? "check" : key === "fix" ? "fix" : "custom"),
    commands: overrides.commands ?? [makeCommand({ key })],
  };
}

export function makeItem(overrides: Partial<WorkspaceItem> = {}): WorkspaceItem {
  const id = overrides.id ?? "git-config";
  return {
    id,
    path: `D:\\ws\\settled-items\\${id}`,
    metaPath: `D:\\ws\\settled-items\\${id}\\meta.json`,
    readmePath: `D:\\ws\\settled-items\\${id}\\README.md`,
    readme: "# Git 基础配置\n\n检查 Git 状态。",
    rawMeta: '{"name":"Git 基础配置检查"}',
    name: "Git 基础配置检查",
    description: "验证 git 与身份信息",
    createAt: 1794596400,
    tags: ["git", "基础环境"],
    platforms: ["windows", "macos", "linux"],
    applicable: true,
    scriptGroups: [makeGroup()],
    ...overrides,
  };
}

export function makeSnapshot(
  overrides: Partial<WorkspaceSnapshot> = {}
): WorkspaceSnapshot {
  const items = overrides.items ?? [makeItem()];
  const tagSet = new Set<string>();
  for (const item of items) {
    for (const tag of item.tags) {
      tagSet.add(tag);
    }
  }
  return {
    rootPath: "D:\\ws",
    itemsDir: "D:\\ws\\settled-items",
    itemsDirExists: true,
    hostPlatform: "windows",
    defaultShell: "pwsh",
    items,
    allTags: overrides.allTags ?? Array.from(tagSet).sort(),
    scanWarnings: [],
    ...overrides,
  };
}

export function makeRuntime(
  overrides: Partial<CommandRuntimeState> = {}
): CommandRuntimeState {
  return {
    status: "idle",
    exitCode: null,
    durationMs: null,
    logs: [],
    error: null,
    lastRunId: null,
    ...overrides,
  };
}
