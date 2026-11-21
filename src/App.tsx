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
  CommandRuntimeState,
  CommandSelector,
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
  buildCommandIdRemap,
  DEFAULT_COMMAND_RUNTIME,
  getApplicableCheckCommands,
  matchesItemFilters,
  MAX_RETAINED_LOG_LINES,
  reconcileRuntimeWithSnapshot,
  toCommandSelector,
} from "./utils/itemStatus";

interface PendingConfirmState {
  title: string;
  action: ActiveRunAction;
  item: WorkspaceItem;
  role: ScriptRole;
  commands: ResolvedCommand[];
}

interface RunTargetEntry {
  commandId: string;
  selector: CommandSelector;
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
  const activeRunIdMapRef = useRef<Map<string, Map<string, string | null>>>(
    new Map()
  );
  const canceledRunIdsRef = useRef<Set<string>>(new Set());
  const actionSeqRef = useRef(0);
  const workspaceLoadSeqRef = useRef(0);

  const resolveMappedCommandId = useCallback(
    (runId: string, originalCommandId: string): string | null => {
      const runMap = activeRunIdMapRef.current.get(runId);
      if (!runMap || !runMap.has(originalCommandId)) {
        return originalCommandId;
      }
      return runMap.get(originalCommandId) ?? null;
    },
    []
  );

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

  const applyWorkspaceSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot, isSameRootReload: boolean) => {
      const previousSnapshot = isSameRootReload ? workspaceRef.current : null;
      const idRemap = previousSnapshot
        ? buildCommandIdRemap(previousSnapshot, snapshot)
        : null;

      let shouldCancelActiveRun = false;
      if (!isSameRootReload) {
        activeRunIdMapRef.current.clear();
        setPendingConfirm(null);
      } else if (idRemap) {
        for (const cmdMap of activeRunIdMapRef.current.values()) {
          for (const [origId, currId] of cmdMap.entries()) {
            if (currId !== null) {
              cmdMap.set(origId, idRemap.get(currId) ?? null);
            }
          }
        }

        const currentAction = activeActionRef.current;
        if (currentAction?.kind === "command") {
          const nextCmdId = idRemap.get(currentAction.commandId);
          if (!nextCmdId) {
            shouldCancelActiveRun = true;
          } else if (nextCmdId !== currentAction.commandId) {
            const nextAction: ActiveRunAction = {
              kind: "command",
              commandId: nextCmdId,
            };
            activeActionRef.current = nextAction;
            setActiveAction(nextAction);
          }
        } else if (currentAction?.kind === "group") {
          const nextItem = snapshot.items.find(
            (it) => it.id === currentAction.itemId
          );
          const nextGroup = nextItem?.scriptGroups.find(
            (g) => g.key === currentAction.groupKey
          );
          const hasApplicable =
            Boolean(nextItem?.applicable) &&
            Boolean(nextGroup?.commands.some((c) => c.applicable));
          const activeMap = activeRunIdRef.current
            ? activeRunIdMapRef.current.get(activeRunIdRef.current)
            : undefined;
          const allUnmapped =
            Boolean(activeMap && activeMap.size > 0) &&
            Array.from(activeMap!.values()).every((id) => id === null);
          if (!hasApplicable || allUnmapped) {
            shouldCancelActiveRun = true;
          }
        }

        setPendingConfirm((prev) => {
          if (!prev) {
            return null;
          }
          const nextItem = snapshot.items.find((it) => it.id === prev.item.id);
          if (!nextItem || !nextItem.applicable) {
            return null;
          }
          for (const cmd of prev.commands) {
            const group = nextItem.scriptGroups.find((g) => g.key === cmd.key);
            const nextCmd = group?.commands[cmd.index];
            if (
              !nextCmd ||
              !nextCmd.applicable ||
              nextCmd.fingerprint !== cmd.fingerprint
            ) {
              return null;
            }
          }
          return prev;
        });
      }

      if (shouldCancelActiveRun) {
        handleStopActiveAction();
      }

      setWorkspace(snapshot);

      setRuntimeMap((prev) =>
        previousSnapshot && idRemap
          ? reconcileRuntimeWithSnapshot(prev, previousSnapshot, snapshot, idRemap)
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
    [handleStopActiveAction]
  );

  const loadWorkspaceAtPath = useCallback(
    async (path: string, clearOnFailure = false) => {
      const loadSeq = ++workspaceLoadSeqRef.current;
      try {
        const previousRoot = workspaceRef.current?.rootPath;
        const snapshot = await openWorkspace(path);
        if (workspaceLoadSeqRef.current !== loadSeq) {
          return;
        }
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
        if (clearOnFailure && workspaceLoadSeqRef.current === loadSeq) {
          setWorkspace(null);
        }
      }
    },
    [applyWorkspaceSnapshot, handleStopActiveAction]
  );

  const handleReloadWorkspace = useCallback(async () => {
    const expectedRoot = workspaceRef.current?.rootPath;
    if (!expectedRoot) {
      return;
    }
    const loadSeq = ++workspaceLoadSeqRef.current;
    try {
      const snapshot = await reloadWorkspace();
      if (
        workspaceLoadSeqRef.current !== loadSeq ||
        !snapshot ||
        snapshot.rootPath !== expectedRoot
      ) {
        return;
      }
      applyWorkspaceSnapshot(snapshot, true);
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
          const targetCommandId = resolveMappedCommandId(
            event.runId,
            event.commandId
          );
          if (targetCommandId === null) {
            return;
          }
          setRuntimeMap((prev) => {
            const current = prev[targetCommandId] ?? DEFAULT_COMMAND_RUNTIME;
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
                [targetCommandId]: {
                  status: "running",
                  exitCode: null,
                  durationMs: null,
                  logs: [],
                  error: null,
                  lastRunId: event.runId,
                },
              };
            }

            if (current.lastRunId !== event.runId) {
              return prev;
            }

            if (event.kind === "output") {
              if (current.logs.length >= MAX_RETAINED_LOG_LINES + 1) {
                return prev;
              }
              return {
                ...prev,
                [targetCommandId]: {
                  ...current,
                  lastRunId: event.runId,
                  logs: [
                    ...current.logs,
                    { stream: event.stream, text: event.text },
                  ],
                },
              };
            }

            return {
              ...prev,
              [targetCommandId]: {
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
  }, [handleReloadWorkspace, loadWorkspaceAtPath, resolveMappedCommandId]);

  const executeTargets = useCallback(
    async (
      targets: RunTargetEntry[],
      seq: number,
      verifyItemAfterFix?: WorkspaceItem
    ) => {
      if (targets.length === 0 || actionSeqRef.current !== seq) {
        return;
      }

      const runId = createRunId(verifyItemAfterFix ? "fix" : "run");
      activeRunIdRef.current = runId;

      const idMap = new Map<string, string | null>();
      for (const target of targets) {
        idMap.set(target.commandId, target.commandId);
      }
      activeRunIdMapRef.current.set(runId, idMap);

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
        const summary = await runCommands(
          runId,
          targets.map((target) => target.selector)
        );
        setRuntimeMap((prev) => {
          const next = { ...prev };
          for (const result of summary.results) {
            const targetCommandId = resolveMappedCommandId(
              summary.runId,
              result.commandId
            );
            if (targetCommandId === null) {
              continue;
            }
            const current = next[targetCommandId];
            if (current && current.lastRunId === summary.runId) {
              next[targetCommandId] = {
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
              verifyCommands.map((cmd) => ({
                commandId: cmd.commandId,
                selector: toCommandSelector(currentItem, cmd),
              })),
              seq
            );
          }
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err || "Execution failed");
        setRuntimeMap((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const [cmdId, entry] of Object.entries(prev)) {
            if (entry.lastRunId === runId && entry.status === "running") {
              next[cmdId] = {
                ...entry,
                status: "fail",
                error: errorMessage,
              };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      } finally {
        activeRunIdMapRef.current.delete(runId);
      }
    },
    [resolveMappedCommandId]
  );

  const startTrackedAction = useCallback(
    async (
      action: ActiveRunAction,
      targets: RunTargetEntry[],
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
          commands.map((cmd) => ({
            commandId: cmd.commandId,
            selector: toCommandSelector(item, cmd),
          }))
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
    const targets: RunTargetEntry[] = [];
    for (const item of filteredItems) {
      for (const cmd of getApplicableCheckCommands(item)) {
        targets.push({
          commandId: cmd.commandId,
          selector: toCommandSelector(item, cmd),
        });
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
      pending.commands.map((cmd) => ({
        commandId: cmd.commandId,
        selector: toCommandSelector(pending.item, cmd),
      })),
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
    const markdown = await buildAiContext(item.id);
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
