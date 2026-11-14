export type Platform = "windows" | "macos" | "linux";
export type ScriptRole = "check" | "fix" | "custom";
export type RunStatus = "idle" | "running" | "pass" | "fail" | "canceled";
export type LogStream = "stdout" | "stderr" | "system";
export type ScopeMode = "current" | "all";
export type ThemeMode = "system" | "light" | "dark";

export interface OutputLine {
  stream: LogStream;
  text: string;
}

export interface ResolvedCommand {
  index: number;
  key: string;
  commandId: string;
  name: string;
  description: string | null;
  rawRun: string;
  resolvedRun: string;
  platforms: Platform[];
  applicable: boolean;
  shell: string | null;
  effectiveShell: string;
  encoding: string;
}

export interface ScriptGroup {
  key: string;
  role: ScriptRole;
  commands: ResolvedCommand[];
}

export interface WorkspaceItem {
  id: string;
  path: string;
  metaPath: string;
  readmePath: string | null;
  readme: string;
  rawMeta: string;
  name: string;
  description: string | null;
  createAt: number | null;
  tags: string[];
  platforms: Platform[];
  applicable: boolean;
  scriptGroups: ScriptGroup[];
  parseError: string | null;
}

export interface WorkspaceSnapshot {
  rootPath: string;
  itemsDir: string;
  itemsDirExists: boolean;
  hostPlatform: Platform;
  defaultShell: string;
  items: WorkspaceItem[];
  allTags: string[];
  scanWarnings: string[];
}

export interface CommandExecutionTarget {
  itemId: string;
  itemDir: string;
  groupKey: string;
  commandIndex: number;
  commandId: string;
  commandName: string;
  resolvedRun: string;
  shell: string;
  encoding: string;
}

export interface AppPrefs {
  lastWorkspace: string | null;
  recentWorkspaces: string[];
  confirmMutatingRuns: boolean;
}

export interface InitialAppState {
  prefs: AppPrefs;
  sampleWorkspacePath: string | null;
  hostPlatform: Platform;
}

export type RunEvent =
  | {
      kind: "started";
      runId: string;
      commandId: string;
      itemId: string;
      groupKey: string;
      commandIndex: number;
    }
  | {
      kind: "output";
      runId: string;
      commandId: string;
      stream: LogStream;
      text: string;
    }
  | {
      kind: "finished";
      runId: string;
      commandId: string;
      itemId: string;
      groupKey: string;
      commandIndex: number;
      status: RunStatus;
      exitCode: number | null;
      durationMs: number;
      error: string | null;
    };

export interface CommandResult {
  runId: string;
  commandId: string;
  itemId: string;
  groupKey: string;
  commandIndex: number;
  commandName: string;
  resolvedRun: string;
  status: RunStatus;
  exitCode: number | null;
  durationMs: number;
  logs: OutputLine[];
  error: string | null;
}

export interface CommandRuntimeState {
  status: RunStatus;
  exitCode: number | null;
  durationMs: number | null;
  logs: OutputLine[];
  error: string | null;
  lastRunId: string | null;
}

export type ActiveRunAction =
  | { kind: "header-checks" }
  | { kind: "group"; itemId: string; groupKey: string }
  | { kind: "command"; commandId: string };
