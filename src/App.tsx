import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAiContext,
  cancelRun,
  copyTextToClipboard,
  getInitialState,
  openInVscode,
  openWorkspace,
  pickWorkspaceFolder,
  reloadWorkspace,
  revealPathInExplorer,
  runCommands,
  showMainWindow,
  subscribeRunEvents,
  subscribeWorkspaceChanges,
  syncWindowTheme,
} from "./api/tauri";
import { ConfirmModal } from "./components/ConfirmModal";
import { DetailPanel } from "./components/DetailPanel";
import { HeaderBar } from "./components/HeaderBar";
import { Sidebar } from "./components/Sidebar";
import { lang } from "./lang";
import type {
  ActiveRunAction,
  CommandExecutionTarget,
  CommandRuntimeState,
  InitialAppState,
  ResolvedCommand,
  ScopeMode,
  ScriptGroup,
  ScriptRole,
  ThemeMode,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "./types";
import { formatScriptGroupTitle } from "./utils/format";
import {
  collectItemCommandResults,
  DEFAULT_COMMAND_RUNTIME,
  getApplicableCheckCommands,
  matchesItemFilters,
  reconcileRuntimeWithSnapshot,
  toExecutionTarget,
} from "./utils/itemStatus";

interface PendingConfirmState {
  title: string;
  action: ActiveRunAction;
  item: WorkspaceItem;
  role: ScriptRole;
  commands: ResolvedCommand[];
}

function createRunId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function applyResolvedTheme(mode: ThemeMode): "light" | "dark" {
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved =
    mode === "dark" || (mode === "system" && prefersDark) ? "dark" : "light";
  document.documentElement.dataset.resolvedTheme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export default function App() {
  const [initialState, setInitialState] = useState<InitialAppState | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [scope, setScope] = useState<ScopeMode>("current");
  const [themeMode, setThemeMode] = useState<ThemeMode>(readStoredThemeMode);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [runtimeMap, setRuntimeMap] = useState<
    Record<string, CommandRuntimeState>
  >({});
  const [activeAction, setActiveAction] = useState<ActiveRunAction | null>(
    null
  );
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingConfirmState | null>(null);

  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  workspaceRef.current = workspace;

  const activeActionRef = useRef<ActiveRunAction | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const canceledRunIdsRef = useRef<Set<string>>(new Set());
  const actionSeqRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage write errors.
    }
    const resolved = applyResolvedTheme(themeMode);
    void syncWindowTheme(resolved).catch(() => {});

    if (
      themeMode !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => {
      const nextResolved = applyResolvedTheme("system");
      void syncWindowTheme(nextResolved).catch(() => {});
    };
    mediaQuery.addEventListener("change", onSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", onSystemThemeChange);
  }, [themeMode]);

  useEffect(() => {
    const resolved =
      document.documentElement.dataset.resolvedTheme === "dark"
        ? "dark"
        : "light";
    const reveal = () => void showMainWindow(resolved).catch(() => {});

    if (!isBootstrapping) {
      let raf2 = 0;
      const raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(reveal);
      });
      return () => {
        window.cancelAnimationFrame(raf1);
        window.cancelAnimationFrame(raf2);
      };
    }

    const fallbackTimer = window.setTimeout(reveal, 1500);
    return () => window.clearTimeout(fallbackTimer);
  }, [isBootstrapping]);

  const applyWorkspaceSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot, isSameRootReload: boolean) => {
      const previousSnapshot = isSameRootReload ? workspaceRef.current : null;
      setWorkspace(snapshot);

      setRuntimeMap((prev) =>
        previousSnapshot
          ? reconcileRuntimeWithSnapshot(prev, previousSnapshot, snapshot)
          : {}
      );

      if (!isSameRootReload) {
        setSearch("");
        setSelectedTags([]);
      } else {
        setSelectedTags((prev) =>
          prev.filter((tag) => snapshot.allTags.includes(tag))
        );
      }

      setSelectedItemId((prevId) => {
        if (prevId && snapshot.items.some((item) => item.id === prevId)) {
          return prevId;
        }
        const firstApplicable = snapshot.items.find((item) => item.applicable);
        return firstApplicable?.id ?? snapshot.items[0]?.id ?? null;
      });
    },
    []
  );

  const handleStopActiveAction = useCallback(() => {
    if (activeActionRef.current === null) {
      return;
    }
    const runId = activeRunIdRef.current;
    actionSeqRef.current += 1;
    activeActionRef.current = null;
    activeRunIdRef.current = null;
    setActiveAction(null);

    if (!runId) {
      return;
    }
    const canceledIds = canceledRunIdsRef.current;
    canceledIds.add(runId);
    if (canceledIds.size > 100) {
      const oldest = canceledIds.values().next().value;
      if (oldest !== undefined) {
        canceledIds.delete(oldest);
      }
    }
    void cancelRun(runId).catch(() => {});
  }, []);

  const loadWorkspaceAtPath = useCallback(
    async (path: string, clearOnFailure = false) => {
      try {
        const previousRoot = workspaceRef.current?.rootPath;
        const snapshot = await openWorkspace(path);
        if (
          previousRoot &&
          previousRoot !== snapshot.rootPath &&
          activeActionRef.current !== null
        ) {
          handleStopActiveAction();
        }
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
      } catch {
        if (clearOnFailure) {
          setWorkspace(null);
        }
      }
    },
    [applyWorkspaceSnapshot, handleStopActiveAction]
  );

  const handleReloadWorkspace = useCallback(async () => {
    try {
      const snapshot = await reloadWorkspace();
      if (snapshot) {
        applyWorkspaceSnapshot(snapshot, true);
      }
    } catch {
      // Ignore transient reload errors silently.
    }
  }, [applyWorkspaceSnapshot]);

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
              if (
                canceledRunIdsRef.current.has(event.runId) ||
                (current.lastRunId !== null &&
                  current.lastRunId !== event.runId &&
                  current.status === "running")
              ) {
                return prev;
              }
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
            void handleReloadWorkspace();
          }
        });
        if (!active) {
          unlistenWatch();
          return;
        }
        unlisteners.push(unlistenWatch);
      } catch {
        // Ignore event subscription errors when running outside Tauri.
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
      } catch {
        // Ignore bootstrap errors outside Tauri or when no previous workspace is readable.
      } finally {
        if (active) {
          setIsBootstrapping(false);
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
      seq: number,
      verifyItemAfterFix?: WorkspaceItem
    ) => {
      if (targets.length === 0 || actionSeqRef.current !== seq) {
        return;
      }

      const runId = createRunId(verifyItemAfterFix ? "fix" : "run");
      activeRunIdRef.current = runId;

      setRuntimeMap((prev) => {
        const next = { ...prev };
        for (const target of targets) {
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
        const summary = await runCommands(runId, targets);
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

        const wasCanceled =
          actionSeqRef.current !== seq ||
          summary.results.some((result) => result.status === "canceled");

        if (verifyItemAfterFix && !wasCanceled && actionSeqRef.current === seq) {
          const currentItem =
            workspaceRef.current?.items.find(
              (candidate) => candidate.id === verifyItemAfterFix.id
            ) ?? verifyItemAfterFix;
          const verifyCommands = getApplicableCheckCommands(currentItem);
          if (verifyCommands.length > 0) {
            await executeTargets(
              verifyCommands.map((cmd) => toExecutionTarget(currentItem, cmd)),
              seq
            );
          }
        }
      } catch {
        // Command failures are reflected directly in command runtime state.
      }
    },
    []
  );

  const startTrackedAction = useCallback(
    async (
      action: ActiveRunAction,
      targets: CommandExecutionTarget[],
      verifyItemAfterFix?: WorkspaceItem
    ) => {
      if (activeActionRef.current !== null || targets.length === 0) {
        return;
      }

      const seq = ++actionSeqRef.current;
      activeActionRef.current = action;
      activeRunIdRef.current = null;
      setActiveAction(action);

      try {
        await executeTargets(targets, seq, verifyItemAfterFix);
      } finally {
        if (actionSeqRef.current === seq) {
          activeActionRef.current = null;
          activeRunIdRef.current = null;
          setActiveAction(null);
        }
      }
    },
    [executeTargets]
  );

  const triggerWithConfirm = useCallback(
    (
      title: string,
      action: ActiveRunAction,
      item: WorkspaceItem,
      role: ScriptRole,
      commands: ResolvedCommand[]
    ) => {
      if (activeActionRef.current !== null || commands.length === 0) {
        return;
      }
      if (role === "check") {
        void startTrackedAction(
          action,
          commands.map((cmd) => toExecutionTarget(item, cmd))
        );
        return;
      }

      setPendingConfirm({ title, action, item, role, commands });
    },
    [startTrackedAction]
  );

  const handleOpenWorkspaceDialog = async () => {
    try {
      const selected = await pickWorkspaceFolder(
        lang.header.selectWorkspaceTitle
      );
      if (selected) {
        await loadWorkspaceAtPath(selected);
      }
    } catch {
      // Ignore cancelled or failed folder dialog invocations.
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

  const scopedCount = useMemo(() => {
    if (!workspace) {
      return 0;
    }
    return scope === "current"
      ? workspace.items.filter((item) => item.applicable).length
      : workspace.items.length;
  }, [scope, workspace]);

  const filteredItems = useMemo(() => {
    if (!workspace) {
      return [];
    }
    return workspace.items.filter((item) =>
      matchesItemFilters(item, {
        scope,
        search,
        selectedTags,
      })
    );
  }, [scope, search, selectedTags, workspace]);

  const handleRunHeaderChecks = () => {
    if (activeActionRef.current !== null || !workspace) {
      return;
    }
    const targets: CommandExecutionTarget[] = [];
    for (const item of filteredItems) {
      for (const cmd of getApplicableCheckCommands(item)) {
        targets.push(toExecutionTarget(item, cmd));
      }
    }
    if (targets.length === 0) {
      return;
    }
    void startTrackedAction({ kind: "header-checks" }, targets);
  };

  const handleRunGroup = (item: WorkspaceItem, group: ScriptGroup) => {
    if (activeActionRef.current !== null || !item.applicable) {
      return;
    }
    const commands = group.commands.filter((cmd) => cmd.applicable);
    triggerWithConfirm(
      formatScriptGroupTitle(group.key),
      { kind: "group", itemId: item.id, groupKey: group.key },
      item,
      group.role,
      commands
    );
  };

  const handleRunSingleCommand = (
    item: WorkspaceItem,
    group: ScriptGroup,
    cmd: ResolvedCommand
  ) => {
    if (activeActionRef.current !== null || !item.applicable || !cmd.applicable) {
      return;
    }
    triggerWithConfirm(
      cmd.name,
      { kind: "command", commandId: cmd.commandId },
      item,
      group.role,
      [cmd]
    );
  };

  const handleConfirmModalSubmit = async () => {
    if (!pendingConfirm) {
      return;
    }
    const pending = pendingConfirm;
    setPendingConfirm(null);

    await startTrackedAction(
      pending.action,
      pending.commands.map((cmd) => toExecutionTarget(pending.item, cmd)),
      pending.role === "fix" ? pending.item : undefined
    );
  };

  const handleOpenInVscode = async (path: string) => {
    try {
      await openInVscode(path);
    } catch {
      // Ignore launcher errors when VS Code CLI is unavailable.
    }
  };

  const handleRevealInExplorer = async (path: string) => {
    try {
      await revealPathInExplorer(path);
    } catch {
      // Ignore file-manager opener errors.
    }
  };

  const handleCopyAiContext = async (item: WorkspaceItem) => {
    const latestResults = collectItemCommandResults(item, runtimeMap);
    const markdown = await buildAiContext(item.id, latestResults);
    await copyTextToClipboard(markdown);
  };

  const selectedItem = useMemo(
    () => workspace?.items.find((item) => item.id === selectedItemId) ?? null,
    [workspace, selectedItemId]
  );

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
        recentWorkspaces={initialState?.prefs.recentWorkspaces ?? []}
        themeMode={themeMode}
        isCheckingActive={activeAction?.kind === "header-checks"}
        onChangeThemeMode={setThemeMode}
        onOpenWorkspace={handleOpenWorkspaceDialog}
        onOpenRecent={(path) => void loadWorkspaceAtPath(path)}
        onReload={() => void handleReloadWorkspace()}
        onRunChecks={handleRunHeaderChecks}
        onStopChecks={() => void handleStopActiveAction()}
      />

      {isBootstrapping && !workspace ? (
        <div className="flex-1 min-h-0" />
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <Sidebar
            workspace={workspace}
            filteredItems={filteredItems}
            scopedCount={scopedCount}
            scope={scope}
            search={search}
            selectedTags={selectedTags}
            selectedItemId={selectedItemId}
            runtimeMap={runtimeMap}
            onChangeScope={handleChangeScope}
            onSearchChange={setSearch}
            onChangeSelectedTags={setSelectedTags}
            onSelectItem={setSelectedItemId}
          />

          <DetailPanel
            item={selectedItem}
            scope={scope}
            runtimeMap={runtimeMap}
            activeAction={activeAction}
            onRunGroup={handleRunGroup}
            onRunCommand={handleRunSingleCommand}
            onStopActiveRun={() => void handleStopActiveAction()}
            onOpenInVscode={(path) => void handleOpenInVscode(path)}
            onRevealInExplorer={(path) => void handleRevealInExplorer(path)}
            onCopyAiContext={handleCopyAiContext}
          />
        </div>
      )}

      {pendingConfirm && (
        <ConfirmModal
          title={pendingConfirm.title}
          commands={pendingConfirm.commands}
          onConfirm={() => void handleConfirmModalSubmit()}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
