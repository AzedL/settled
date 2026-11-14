import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  buildAiContext,
  cancelAllRuns,
  cancelCommand,
  copyTextToClipboard,
  getInitialState,
  openInVscode,
  openWorkspace,
  pickWorkspaceFolder,
  reloadWorkspace,
  revealPathInExplorer,
  runCommands,
  setConfirmMutatingRuns,
  subscribeRunEvents,
  subscribeWorkspaceChanges,
} from "./api/tauri";
import { ConfirmModal } from "./components/ConfirmModal";
import { DetailPanel } from "./components/DetailPanel";
import { HeaderBar } from "./components/HeaderBar";
import { Sidebar } from "./components/Sidebar";
import { WelcomeView } from "./components/WelcomeView";
import { lang } from "./lang";
import type {
  CommandExecutionTarget,
  CommandRuntimeState,
  InitialAppState,
  ResolvedCommand,
  ScopeMode,
  ScriptGroup,
  ScriptRole,
  StatusFilter,
  ThemeMode,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "./types";
import {
  collectItemCommandResults,
  computeCheckStats,
  DEFAULT_COMMAND_RUNTIME,
  getApplicableCheckCommands,
  getCommandRuntime,
  toExecutionTarget,
} from "./utils/itemStatus";

interface ToastMessage {
  kind: "error" | "warn";
  message: string;
}

interface PendingConfirmState {
  item: WorkspaceItem;
  role: ScriptRole;
  targets: CommandExecutionTarget[];
}

function createRunId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function reconcileRuntimeWithSnapshot(
  prevMap: Record<string, CommandRuntimeState>,
  snapshot: WorkspaceSnapshot
): Record<string, CommandRuntimeState> {
  const validCommandIds = new Set<string>();
  for (const item of snapshot.items) {
    for (const group of item.scriptGroups) {
      for (const cmd of group.commands) {
        validCommandIds.add(cmd.commandId);
      }
    }
  }

  const nextMap: Record<string, CommandRuntimeState> = {};
  for (const [commandId, state] of Object.entries(prevMap)) {
    if (validCommandIds.has(commandId)) {
      nextMap[commandId] = state;
    }
  }
  return nextMap;
}

const THEME_STORAGE_KEY = "settled.theme";

function readStoredThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // Ignore storage read errors in restricted environments.
  }
  return "system";
}

function applyResolvedTheme(mode: ThemeMode) {
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved =
    mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light";
  document.documentElement.dataset.resolvedTheme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export default function App() {
  const [initialState, setInitialState] = useState<InitialAppState | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [scope, setScope] = useState<ScopeMode>("current");
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [runtimeMap, setRuntimeMap] = useState<
    Record<string, CommandRuntimeState>
  >({});
  const [verifyingItemId, setVerifyingItemId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingConfirmState | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  workspaceRef.current = workspace;

  const runtimeMapRef = useRef<Record<string, CommandRuntimeState>>(runtimeMap);
  runtimeMapRef.current = runtimeMap;

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage write errors.
    }
    applyResolvedTheme(themeMode);

    if (
      themeMode !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => applyResolvedTheme("system");
    mediaQuery.addEventListener("change", onSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", onSystemThemeChange);
  }, [themeMode]);

  const applyWorkspaceSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot, isSameRootReload: boolean) => {
      setWorkspace(snapshot);

      setRuntimeMap((prev) =>
        isSameRootReload ? reconcileRuntimeWithSnapshot(prev, snapshot) : {}
      );

      if (!isSameRootReload) {
        setSearch("");
        setSelectedTag(null);
        setStatusFilter("all");
      }

      setSelectedItemId((prevId) => {
        if (prevId && snapshot.items.some((item) => item.id === prevId)) {
          return prevId;
        }
        const firstApplicable = snapshot.items.find((item) => item.applicable);
        return firstApplicable?.id ?? snapshot.items[0]?.id ?? null;
      });

      if (!snapshot.itemsDirExists) {
        setToast({
          kind: "warn",
          message: lang.notifications.workspaceMissingNotice,
        });
      } else if (snapshot.scanWarnings.length > 0) {
        setToast({
          kind: "warn",
          message: `${lang.notifications.scanWarningsPrefix}${snapshot.scanWarnings.join(" | ")}`,
        });
      } else {
        setToast(null);
      }
    },
    []
  );

  const loadWorkspaceAtPath = useCallback(
    async (path: string, clearOnFailure = false) => {
      try {
        const previousRoot = workspaceRef.current?.rootPath;
        const snapshot = await openWorkspace(path);
        applyWorkspaceSnapshot(snapshot, previousRoot === snapshot.rootPath);
        setInitialState((prev) =>
          prev
            ? {
                ...prev,
                prefs: {
                  ...prev.prefs,
                  lastWorkspace: snapshot.rootPath,
                  recentWorkspaces: [
                    snapshot.rootPath,
                    ...prev.prefs.recentWorkspaces.filter(
                      (p) => p !== snapshot.rootPath
                    ),
                  ].slice(0, 8),
                },
              }
            : prev
        );
      } catch (err) {
        if (clearOnFailure) {
          setWorkspace(null);
        }
        setToast({
          kind: "error",
          message: `${lang.notifications.errorPrefix}${formatError(err)}`,
        });
      }
    },
    [applyWorkspaceSnapshot]
  );

  const handleReloadWorkspace = useCallback(
    async (silentIfMissing = false) => {
      try {
        const snapshot = await reloadWorkspace();
        if (snapshot) {
          applyWorkspaceSnapshot(snapshot, true);
        }
      } catch (err) {
        if (!silentIfMissing) {
          setToast({
            kind: "error",
            message: `${lang.notifications.errorPrefix}${formatError(err)}`,
          });
        }
      }
    },
    [applyWorkspaceSnapshot]
  );

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    (async () => {
      try {
        const unlistenRun = await subscribeRunEvents((event) => {
          if (!active) {
            return;
          }
          setRuntimeMap((prev) => {
            const current = prev[event.commandId] ?? DEFAULT_COMMAND_RUNTIME;
            if (event.kind === "started") {
              return {
                ...prev,
                [event.commandId]: {
                  status: "running",
                  exitCode: null,
                  durationMs: null,
                  logs: [],
                  error: null,
                  lastRunId: event.runId,
                },
              };
            }

            if (
              current.lastRunId !== null &&
              current.lastRunId !== event.runId
            ) {
              return prev;
            }

            if (event.kind === "output") {
              const nextLogs = [
                ...current.logs,
                { stream: event.stream, text: event.text },
              ];
              return {
                ...prev,
                [event.commandId]: {
                  ...current,
                  lastRunId: event.runId,
                  logs:
                    nextLogs.length > 2000
                      ? nextLogs.slice(nextLogs.length - 2000)
                      : nextLogs,
                },
              };
            }

            return {
              ...prev,
              [event.commandId]: {
                status: event.status,
                exitCode: event.exitCode,
                durationMs: event.durationMs,
                logs: current.logs,
                error: event.error,
                lastRunId: event.runId,
              },
            };
          });
        });
        if (!active) {
          unlistenRun();
          return;
        }
        unlisteners.push(unlistenRun);

        const unlistenWatch = await subscribeWorkspaceChanges((rootPath) => {
          if (!active) {
            return;
          }
          if (workspaceRef.current?.rootPath === rootPath) {
            void handleReloadWorkspace(true);
          }
        });
        if (!active) {
          unlistenWatch();
          return;
        }
        unlisteners.push(unlistenWatch);
      } catch (err) {
        if (active) {
          setToast({
            kind: "error",
            message: `${lang.notifications.errorPrefix}${formatError(err)}`,
          });
        }
      }

      try {
        const state = await getInitialState();
        if (!active) {
          return;
        }
        setInitialState(state);
        if (state.prefs.lastWorkspace) {
          await loadWorkspaceAtPath(state.prefs.lastWorkspace, true);
        }
      } catch (err) {
        if (active) {
          setToast({
            kind: "error",
            message: `${lang.notifications.errorPrefix}${formatError(err)}`,
          });
        }
      }
    })();

    return () => {
      active = false;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [handleReloadWorkspace, loadWorkspaceAtPath]);

  const executeTargets = useCallback(
    async (
      targets: CommandExecutionTarget[],
      verifyItemAfterFix?: WorkspaceItem
    ) => {
      const runnable = targets.filter(
        (target) =>
          getCommandRuntime(runtimeMapRef.current, target.commandId).status !==
          "running"
      );
      if (runnable.length === 0) {
        return;
      }

      const runId = createRunId(verifyItemAfterFix ? "fix" : "run");
      setRuntimeMap((prev) => {
        const next = { ...prev };
        for (const target of runnable) {
          next[target.commandId] = {
            status: "running",
            exitCode: null,
            durationMs: null,
            logs: [],
            error: null,
            lastRunId: runId,
          };
        }
        return next;
      });

      try {
        const summary = await runCommands(runId, runnable);
        setRuntimeMap((prev) => {
          const next = { ...prev };
          for (const result of summary.results) {
            const current = next[result.commandId];
            if (current && current.lastRunId === summary.runId) {
              next[result.commandId] = {
                status: result.status,
                exitCode: result.exitCode,
                durationMs: result.durationMs,
                logs: current.logs.length > 0 ? current.logs : result.logs,
                error: result.error,
                lastRunId: summary.runId,
              };
            }
          }
          return next;
        });

        if (verifyItemAfterFix) {
          const currentItem =
            workspaceRef.current?.items.find(
              (candidate) => candidate.id === verifyItemAfterFix.id
            ) ?? verifyItemAfterFix;
          const verifyCommands = getApplicableCheckCommands(currentItem);
          if (verifyCommands.length > 0) {
            setVerifyingItemId(currentItem.id);
            try {
              await executeTargets(
                verifyCommands.map((cmd) => toExecutionTarget(currentItem, cmd))
              );
            } finally {
              setVerifyingItemId((prevId) =>
                prevId === currentItem.id ? null : prevId
              );
            }
          }
        }
      } catch (err) {
        setToast({
          kind: "error",
          message: `${lang.notifications.errorPrefix}${formatError(err)}`,
        });
      }
    },
    []
  );

  const triggerWithOptionalConfirm = useCallback(
    (
      item: WorkspaceItem,
      role: ScriptRole,
      targets: CommandExecutionTarget[]
    ) => {
      if (targets.length === 0) {
        return;
      }
      if (role === "check") {
        void executeTargets(targets);
        return;
      }

      const shouldConfirm = initialState?.prefs.confirmMutatingRuns ?? true;
      if (shouldConfirm) {
        setPendingConfirm({ item, role, targets });
      } else {
        void executeTargets(targets, role === "fix" ? item : undefined);
      }
    },
    [executeTargets, initialState?.prefs.confirmMutatingRuns]
  );

  const handleOpenWorkspaceDialog = async () => {
    try {
      const selected = await pickWorkspaceFolder(
        lang.header.selectWorkspaceTitle
      );
      if (selected) {
        await loadWorkspaceAtPath(selected);
      }
    } catch (err) {
      setToast({
        kind: "error",
        message: `${lang.notifications.errorPrefix}${formatError(err)}`,
      });
    }
  };

  const handleLoadSample = async () => {
    const samplePath = initialState?.sampleWorkspacePath;
    if (samplePath) {
      await loadWorkspaceAtPath(samplePath);
    }
  };

  const handleChangeScope = (nextScope: ScopeMode) => {
    setScope(nextScope);
    if (nextScope === "current" && workspace) {
      const currentSelected = workspace.items.find(
        (item) => item.id === selectedItemId
      );
      if (currentSelected && !currentSelected.applicable) {
        const firstApplicable = workspace.items.find((item) => item.applicable);
        setSelectedItemId(firstApplicable?.id ?? null);
      }
    }
  };

  const handleRunAllChecks = () => {
    if (!workspace) {
      return;
    }
    const targets: CommandExecutionTarget[] = [];
    for (const item of workspace.items) {
      for (const cmd of getApplicableCheckCommands(item)) {
        targets.push(toExecutionTarget(item, cmd));
      }
    }
    if (targets.length === 0) {
      setToast({
        kind: "warn",
        message: lang.notifications.noRunnableChecks,
      });
      return;
    }
    void executeTargets(targets);
  };

  const handleRunFailedChecks = () => {
    if (!workspace) {
      return;
    }
    const targets: CommandExecutionTarget[] = [];
    for (const item of workspace.items) {
      for (const cmd of getApplicableCheckCommands(item)) {
        const status = getCommandRuntime(runtimeMap, cmd.commandId).status;
        if (status === "fail" || status === "canceled") {
          targets.push(toExecutionTarget(item, cmd));
        }
      }
    }
    if (targets.length === 0) {
      setToast({
        kind: "warn",
        message: lang.notifications.noFailedChecks,
      });
      return;
    }
    void executeTargets(targets);
  };

  const handleRunFilteredChecks = (items: WorkspaceItem[]) => {
    const targets: CommandExecutionTarget[] = [];
    for (const item of items) {
      for (const cmd of getApplicableCheckCommands(item)) {
        targets.push(toExecutionTarget(item, cmd));
      }
    }
    if (targets.length === 0) {
      setToast({
        kind: "warn",
        message: lang.notifications.noRunnableChecks,
      });
      return;
    }
    void executeTargets(targets);
  };

  const handleRunGroup = (item: WorkspaceItem, group: ScriptGroup) => {
    if (!item.applicable) {
      return;
    }
    const targets = group.commands
      .filter((cmd) => cmd.applicable)
      .map((cmd) => toExecutionTarget(item, cmd));
    triggerWithOptionalConfirm(item, group.role, targets);
  };

  const handleRunSingleCommand = (
    item: WorkspaceItem,
    group: ScriptGroup,
    cmd: ResolvedCommand
  ) => {
    if (!item.applicable || !cmd.applicable) {
      return;
    }
    triggerWithOptionalConfirm(item, group.role, [
      toExecutionTarget(item, cmd),
    ]);
  };

  const handleStopCommand = async (commandId: string) => {
    try {
      await cancelCommand(commandId);
    } catch (err) {
      setToast({
        kind: "error",
        message: `${lang.notifications.errorPrefix}${formatError(err)}`,
      });
    }
  };

  const handleCancelAll = async () => {
    try {
      await cancelAllRuns();
    } catch (err) {
      setToast({
        kind: "error",
        message: `${lang.notifications.errorPrefix}${formatError(err)}`,
      });
    }
  };

  const handleConfirmModalSubmit = async (skipFuture: boolean) => {
    if (!pendingConfirm) {
      return;
    }
    const pending = pendingConfirm;
    setPendingConfirm(null);

    if (skipFuture) {
      try {
        const updatedPrefs = await setConfirmMutatingRuns(false);
        setInitialState((prev) =>
          prev ? { ...prev, prefs: updatedPrefs } : prev
        );
      } catch (err) {
        setToast({
          kind: "error",
          message: `${lang.notifications.errorPrefix}${formatError(err)}`,
        });
      }
    }

    await executeTargets(
      pending.targets,
      pending.role === "fix" ? pending.item : undefined
    );
  };

  const handleOpenInVscode = async (path: string) => {
    try {
      await openInVscode(path);
    } catch (err) {
      setToast({
        kind: "error",
        message: `${lang.notifications.errorPrefix}${formatError(err)} ${lang.notifications.vscodeFallbackHint}`,
      });
    }
  };

  const handleRevealInExplorer = async (path: string) => {
    try {
      await revealPathInExplorer(path);
    } catch (err) {
      setToast({
        kind: "error",
        message: `${lang.notifications.errorPrefix}${formatError(err)}`,
      });
    }
  };

  const handleCopyAiContext = async (item: WorkspaceItem) => {
    try {
      const latestResults = collectItemCommandResults(item, runtimeMap);
      const markdown = await buildAiContext(item.id, latestResults);
      await copyTextToClipboard(markdown);
    } catch (err) {
      setToast({
        kind: "error",
        message: `${lang.notifications.errorPrefix}${formatError(err)}`,
      });
    }
  };

  const globalCheckStats = useMemo(
    () =>
      workspace
        ? computeCheckStats(workspace.items, runtimeMap)
        : { idle: 0, running: 0, pass: 0, fail: 0, canceled: 0 },
    [workspace, runtimeMap]
  );

  const totalRunningCount = useMemo(
    () =>
      Object.values(runtimeMap).filter((state) => state.status === "running")
        .length,
    [runtimeMap]
  );

  const selectedItem = useMemo(
    () => workspace?.items.find((item) => item.id === selectedItemId) ?? null,
    [workspace, selectedItemId]
  );

  const hostPlatform =
    workspace?.hostPlatform ?? initialState?.hostPlatform ?? "windows";

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--st-bg-canvas)",
        color: "var(--st-text-primary)",
      }}
    >
      <HeaderBar
        workspace={workspace}
        scope={scope}
        themeMode={themeMode}
        runningCount={totalRunningCount}
        failedCount={globalCheckStats.fail + globalCheckStats.canceled}
        hasSampleWorkspace={Boolean(initialState?.sampleWorkspacePath)}
        onChangeScope={handleChangeScope}
        onChangeThemeMode={setThemeMode}
        onOpenWorkspace={handleOpenWorkspaceDialog}
        onLoadSample={handleLoadSample}
        onReload={() => void handleReloadWorkspace(false)}
        onRunAllChecks={handleRunAllChecks}
        onRunFailedChecks={handleRunFailedChecks}
        onCancelAll={() => void handleCancelAll()}
      />

      {toast && (
        <div
          className="px-[var(--st-space-16)] py-[var(--st-space-8)] border-b flex items-center justify-between gap-[var(--st-space-12)] shrink-0"
          style={{
            backgroundColor:
              toast.kind === "error"
                ? "var(--st-status-fail-soft)"
                : "var(--st-status-canceled-soft)",
            borderColor:
              toast.kind === "error"
                ? "var(--st-border-danger)"
                : "var(--st-border-warn)",
            color:
              toast.kind === "error"
                ? "var(--st-status-fail-text)"
                : "var(--st-status-canceled-text)",
          }}
        >
          <div className="flex items-center gap-[var(--st-space-8)] min-w-0">
            <AlertTriangle className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)] shrink-0" />
            <span className="text-[length:var(--st-text-xs)] leading-[var(--st-leading-xs)] truncate">
              {toast.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label={lang.notifications.clearToast}
            className="p-[var(--st-space-4)] rounded-[var(--st-radius-sm)] cursor-pointer shrink-0 st-control hover:opacity-70"
          >
            <X className="w-[var(--st-icon-sm)] h-[var(--st-icon-sm)]" />
          </button>
        </div>
      )}

      {workspace ? (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <Sidebar
            workspace={workspace}
            scope={scope}
            search={search}
            selectedTag={selectedTag}
            statusFilter={statusFilter}
            selectedItemId={selectedItemId}
            runtimeMap={runtimeMap}
            onSearchChange={setSearch}
            onSelectTag={setSelectedTag}
            onStatusFilterChange={setStatusFilter}
            onSelectItem={setSelectedItemId}
            onClearFilters={() => {
              setSearch("");
              setSelectedTag(null);
              setStatusFilter("all");
            }}
            onRunFilteredChecks={handleRunFilteredChecks}
          />

          <DetailPanel
            item={selectedItem}
            hostPlatform={hostPlatform}
            scope={scope}
            runtimeMap={runtimeMap}
            verifyingItemId={verifyingItemId}
            onRunGroup={handleRunGroup}
            onRunCommand={handleRunSingleCommand}
            onStopCommand={(commandId) => void handleStopCommand(commandId)}
            onOpenInVscode={(path) => void handleOpenInVscode(path)}
            onRevealInExplorer={(path) => void handleRevealInExplorer(path)}
            onCopyAiContext={handleCopyAiContext}
          />
        </div>
      ) : (
        <WelcomeView
          hostPlatform={hostPlatform}
          recentWorkspaces={initialState?.prefs.recentWorkspaces ?? []}
          hasSampleWorkspace={Boolean(initialState?.sampleWorkspacePath)}
          onOpenWorkspace={() => void handleOpenWorkspaceDialog()}
          onLoadSample={() => void handleLoadSample()}
          onOpenRecent={(path) => void loadWorkspaceAtPath(path)}
        />
      )}

      {pendingConfirm && (
        <ConfirmModal
          role={pendingConfirm.role}
          targets={pendingConfirm.targets}
          onConfirm={(skipFuture) => void handleConfirmModalSubmit(skipFuture)}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
