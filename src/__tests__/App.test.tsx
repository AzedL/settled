import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lang } from "../lang";
import { makeCommand, makeGroup, makeItem, makeSnapshot } from "../test/fixtures";
import type { RunEvent } from "../types";

const apiMocks = vi.hoisted(() => ({
  getInitialState: vi.fn(),
  openWorkspace: vi.fn(),
  reloadWorkspace: vi.fn(),
  pickWorkspaceFolder: vi.fn(),
  runCommands: vi.fn(),
  cancelRun: vi.fn(),
  buildAiContext: vi.fn(),
  copyTextToClipboard: vi.fn(),
  openInVscode: vi.fn(),
  revealPathInExplorer: vi.fn(),
  showMainWindow: vi.fn(),
  syncWindowTheme: vi.fn(),
  subscribeRunEvents: vi.fn(),
  subscribeWorkspaceChanges: vi.fn(),
}));

vi.mock("../api/tauri", () => apiMocks);

import App from "../App";

describe("App integration", () => {
  let runEventCb: ((event: RunEvent) => void) | null = null;
  let watchCb: ((rootPath: string) => void) | null = null;

  const checkCmd = makeCommand({
    index: 0,
    key: "check",
    commandId: "demo::check::0",
    name: "检查标记",
    rawRun: "node @script/demo.mjs check",
    applicable: true,
  });
  const fixCmd = makeCommand({
    index: 0,
    key: "fix",
    commandId: "demo::fix::0",
    name: "写入标记",
    rawRun: "node @script/demo.mjs fix",
    applicable: true,
  });
  const demoItem = makeItem({
    id: "demo",
    name: "修复复检演练",
    tags: ["演练"],
    applicable: true,
    scriptGroups: [
      makeGroup({ key: "check", role: "check", commands: [checkCmd] }),
      makeGroup({ key: "fix", role: "fix", commands: [fixCmd] }),
    ],
  });
  const macItem = makeItem({
    id: "mac-only",
    name: "macOS 专属项",
    tags: ["macos"],
    applicable: false,
    scriptGroups: [
      makeGroup({
        key: "check",
        role: "check",
        commands: [
          makeCommand({
            commandId: "mac::check::0",
            name: "Brew",
            applicable: false,
          }),
        ],
      }),
    ],
  });
  const snapshot = makeSnapshot({
    rootPath: "D:\\ws-main",
    items: [demoItem, macItem],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    runEventCb = null;
    watchCb = null;

    apiMocks.showMainWindow.mockResolvedValue(undefined);
    apiMocks.syncWindowTheme.mockResolvedValue(undefined);
    apiMocks.cancelRun.mockResolvedValue(1);
    apiMocks.buildAiContext.mockResolvedValue("# Context");
    apiMocks.copyTextToClipboard.mockResolvedValue(undefined);
    apiMocks.openInVscode.mockResolvedValue(undefined);
    apiMocks.revealPathInExplorer.mockResolvedValue(undefined);

    apiMocks.subscribeRunEvents.mockImplementation(async (cb) => {
      runEventCb = cb;
      return () => {};
    });
    apiMocks.subscribeWorkspaceChanges.mockImplementation(async (cb) => {
      watchCb = cb;
      return () => {};
    });
    apiMocks.getInitialState.mockResolvedValue({
      prefs: {
        lastWorkspace: "D:\\ws-main",
        recentWorkspaces: ["D:\\ws-main"],
      },
      hostPlatform: "windows",
    });
    apiMocks.openWorkspace.mockResolvedValue(snapshot);
  });

  it("bootstraps lastWorkspace, streams run events, executes fix -> auto-verify, and reacts to file watcher", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("D:\\ws-main")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "修复复检演练" })).toBeInTheDocument();

    // Header Run Checks streams events and transitions to pass
    apiMocks.runCommands.mockImplementationOnce(async (runId: string) => {
      runEventCb?.({
        kind: "started",
        runId,
        commandId: checkCmd.commandId,
        itemId: "demo",
        groupKey: "check",
        commandIndex: 0,
      });
      runEventCb?.({
        kind: "output",
        runId,
        commandId: checkCmd.commandId,
        stream: "stderr",
        text: "marker missing",
      });
      const result = {
        runId,
        commandId: checkCmd.commandId,
        itemId: "demo",
        groupKey: "check",
        commandIndex: 0,
        commandName: checkCmd.name,
        status: "fail" as const,
        exitCode: 1,
        durationMs: 12,
        logs: [{ stream: "stderr" as const, text: "marker missing" }],
        error: null,
      };
      runEventCb?.({
        kind: "finished",
        runId,
        commandId: checkCmd.commandId,
        itemId: "demo",
        groupKey: "check",
        commandIndex: 0,
        status: "fail",
        exitCode: 1,
        durationMs: 12,
        error: null,
      });
      return { runId, results: [result] };
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText(lang.header.runChecks)[0]);
    });
    await waitFor(() => {
      expect(screen.getByText("marker missing")).toBeInTheDocument();
    });

    // Running Fix opens ConfirmModal -> Confirm runs fix then automatically re-runs check!
    fireEvent.click(screen.getByText(lang.scripts.runGroup("Fix")));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    apiMocks.runCommands
      .mockImplementationOnce(async (runId: string) => ({
        runId,
        results: [
          {
            runId,
            commandId: fixCmd.commandId,
            itemId: "demo",
            groupKey: "fix",
            commandIndex: 0,
            commandName: fixCmd.name,
            status: "pass",
            exitCode: 0,
            durationMs: 8,
            logs: [],
            error: null,
          },
        ],
      }))
      .mockImplementationOnce(async (runId: string) => ({
        runId,
        results: [
          {
            runId,
            commandId: checkCmd.commandId,
            itemId: "demo",
            groupKey: "check",
            commandIndex: 0,
            commandName: checkCmd.name,
            status: "pass",
            exitCode: 0,
            durationMs: 9,
            logs: [{ stream: "stdout", text: "verified" }],
            error: null,
          },
        ],
      }));

    await act(async () => {
      fireEvent.click(screen.getByText(lang.confirmModal.confirmBtn));
    });

    await waitFor(() => {
      expect(apiMocks.runCommands).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText("verified")).toBeInTheDocument();

    // Watcher notification reloads workspace cleanly and resets newly inserted command to idle
    // while migrating unchanged commands' states to their shifted indices.
    const insertedCmd = makeCommand({
      index: 0,
      key: "check",
      commandId: "demo::check::0",
      name: "新插入的检查项",
      rawRun: "echo brand_new",
      applicable: true,
    });
    const shiftedCheckCmd = makeCommand({
      ...checkCmd,
      index: 1,
      commandId: "demo::check::1",
    });
    const reloadedSnapshot = makeSnapshot({
      rootPath: "D:\\ws-main",
      items: [
        makeItem({
          ...demoItem,
          scriptGroups: [
            makeGroup({
              key: "check",
              role: "check",
              commands: [insertedCmd, shiftedCheckCmd],
            }),
            makeGroup({ key: "fix", role: "fix", commands: [fixCmd] }),
          ],
        }),
        macItem,
      ],
    });
    apiMocks.reloadWorkspace.mockResolvedValueOnce(reloadedSnapshot);
    await act(async () => {
      watchCb?.("D:\\ws-main");
    });
    expect(apiMocks.reloadWorkspace).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText("新插入的检查项")).toBeInTheDocument();
    });
    // Newly inserted index 0 check must start idle ("未运行"), NOT inherit old index 0's green pass light!
    const statusDots = screen.getAllByLabelText(lang.status.label("idle"));
    expect(statusDots.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(lang.status.label("pass")).length).toBeGreaterThanOrEqual(1);

    // Copy item context triggers IPC + clipboard write
    await act(async () => {
      fireEvent.click(screen.getByText(lang.detail.copyAiContext));
    });
    expect(apiMocks.buildAiContext).toHaveBeenCalledWith("demo");
    expect(apiMocks.copyTextToClipboard).toHaveBeenCalledWith("# Context");

    // Switching scope to `all`, selecting disabled item, then switching back to `current` resets selection
    fireEvent.click(screen.getByText(lang.header.scopeAll));
    fireEvent.click(screen.getByText("macOS 专属项"));
    expect(screen.getByRole("heading", { name: "macOS 专属项" })).toBeInTheDocument();

    fireEvent.click(screen.getByText(lang.header.scopeCurrent));
    expect(screen.getByRole("heading", { name: "修复复检演练" })).toBeInTheDocument();

    // Theme switching persists to localStorage
    fireEvent.click(screen.getByLabelText(lang.header.themeDark));
    expect(document.documentElement.dataset.resolvedTheme).toBe("dark");
    expect(localStorage.getItem("settled.theme")).toBe("dark");
  });

  it("supports opening another workspace via picker and canceling active runs", async () => {
    let resolveRun: ((v: unknown) => void) | null = null;
    apiMocks.runCommands.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        })
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("D:\\ws-main")).toBeInTheDocument();
    });

    // Start single check command, then stop it cleanly via Stop button
    const runButtons = screen.getAllByText(lang.scripts.runSingle);
    fireEvent.click(runButtons[0]);
    expect(screen.getByText(lang.scripts.stopSingle)).toBeInTheDocument();

    fireEvent.click(screen.getByText(lang.scripts.stopSingle));
    expect(apiMocks.cancelRun).toHaveBeenCalledTimes(1);

    // Resolve the canceled promise cleanly
    await act(async () => {
      resolveRun?.({ runId: "any", results: [] });
    });

    // Open another workspace via folder dialog
    const secondSnap = makeSnapshot({
      rootPath: "D:\\ws-second",
      items: [makeItem({ id: "second", name: "第二工作区条目" })],
    });
    apiMocks.pickWorkspaceFolder.mockResolvedValueOnce("D:\\ws-second");
    apiMocks.openWorkspace.mockResolvedValueOnce(secondSnap);

    await act(async () => {
      fireEvent.click(screen.getByText(lang.header.openWorkspace));
    });
    await waitFor(() => {
      expect(screen.getByText("D:\\ws-second")).toBeInTheDocument();
    });
  });

  it("routes in-flight run events to shifted command indices on hot reload and handles IPC failures", async () => {
    let activeRunId = "";
    let resolveRun: ((v: unknown) => void) | null = null;
    apiMocks.runCommands.mockImplementationOnce(
      (runId: string, selectors: unknown) => {
        activeRunId = runId;
        // Verify frontend only sends command selectors (no runtime shell/encoding/resolvedRun)
        expect(selectors).toEqual([
          {
            itemId: "demo",
            groupKey: "check",
            commandIndex: 0,
            fingerprint: checkCmd.fingerprint,
          },
        ]);
        return new Promise((resolve) => {
          resolveRun = resolve;
        });
      }
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("D:\\ws-main")).toBeInTheDocument();
    });

    // Start single check command at index 0
    fireEvent.click(screen.getAllByText(lang.scripts.runSingle)[0]);
    expect(screen.getByText(lang.scripts.stopSingle)).toBeInTheDocument();

    // While running, hot reload inserts a new command at index 0, shifting running checkCmd -> index 1
    const brandNewCmd = makeCommand({
      index: 0,
      key: "check",
      commandId: "demo::check::0",
      name: "热插队新命令",
      rawRun: "echo inserted",
      applicable: true,
    });
    const shiftedRunningCmd = makeCommand({
      ...checkCmd,
      index: 1,
      commandId: "demo::check::1",
    });
    const reorderedSnapshot = makeSnapshot({
      rootPath: "D:\\ws-main",
      items: [
        makeItem({
          ...demoItem,
          scriptGroups: [
            makeGroup({
              key: "check",
              role: "check",
              commands: [brandNewCmd, shiftedRunningCmd],
            }),
            makeGroup({ key: "fix", role: "fix", commands: [fixCmd] }),
          ],
        }),
        macItem,
      ],
    });
    apiMocks.reloadWorkspace.mockResolvedValueOnce(reorderedSnapshot);

    await act(async () => {
      watchCb?.("D:\\ws-main");
    });
    await waitFor(() => {
      expect(screen.getByText("热插队新命令")).toBeInTheDocument();
    });

    // Stop button stays attached to shifted running command
    expect(screen.getByText(lang.scripts.stopSingle)).toBeInTheDocument();

    // Backend emits output + finished with ORIGINAL commandId `demo::check::0`
    await act(async () => {
      runEventCb?.({
        kind: "output",
        runId: activeRunId,
        commandId: "demo::check::0",
        stream: "stdout",
        text: "late-shifted-output",
      });
      runEventCb?.({
        kind: "finished",
        runId: activeRunId,
        commandId: "demo::check::0",
        itemId: "demo",
        groupKey: "check",
        commandIndex: 0,
        status: "pass",
        exitCode: 0,
        durationMs: 33,
        error: null,
      });
      resolveRun?.({
        runId: activeRunId,
        results: [
          {
            runId: activeRunId,
            commandId: "demo::check::0",
            itemId: "demo",
            groupKey: "check",
            commandIndex: 0,
            commandName: checkCmd.name,
            status: "pass",
            exitCode: 0,
            durationMs: 33,
            logs: [{ stream: "stdout", text: "late-shifted-output" }],
            error: null,
          },
        ],
      });
    });

    // Newly inserted index 0 must remain idle, while shifted index 1 transitions to pass (no stuck running!)
    expect(screen.queryAllByLabelText(lang.status.label("running"))).toHaveLength(0);
    expect(screen.getAllByLabelText(lang.status.label("idle")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(lang.status.label("pass")).length).toBeGreaterThanOrEqual(1);

    // If runCommands IPC rejects, the command converges to `fail` instead of sticking in `running`
    apiMocks.runCommands.mockRejectedValueOnce(new Error("ipc backend error"));
    await act(async () => {
      fireEvent.click(screen.getAllByText(lang.scripts.runSingle)[0]);
    });
    await waitFor(() => {
      expect(screen.getByText("ipc backend error")).toBeInTheDocument();
    });
    expect(screen.queryAllByLabelText(lang.status.label("running"))).toHaveLength(0);
  });

  it("discards stale out-of-order workspace reload snapshots after switching workspaces", async () => {
    let resolveStaleReload: ((v: unknown) => void) | null = null;
    apiMocks.reloadWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleReload = resolve;
        })
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("D:\\ws-main")).toBeInTheDocument();
    });

    // Trigger reload for ws-main that stays in-flight
    fireEvent.click(screen.getByLabelText(lang.header.reload));

    // User immediately opens ws-second before ws-main reload finishes
    const secondSnap = makeSnapshot({
      rootPath: "D:\\ws-second",
      items: [makeItem({ id: "second", name: "新工作区" })],
    });
    apiMocks.pickWorkspaceFolder.mockResolvedValueOnce("D:\\ws-second");
    apiMocks.openWorkspace.mockResolvedValueOnce(secondSnap);

    await act(async () => {
      fireEvent.click(screen.getByText(lang.header.openWorkspace));
    });
    await waitFor(() => {
      expect(screen.getByText("D:\\ws-second")).toBeInTheDocument();
    });

    // Stale reload from ws-main resolves late -> MUST be ignored
    await act(async () => {
      resolveStaleReload?.(snapshot);
    });
    expect(screen.getByText("D:\\ws-second")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新工作区" })).toBeInTheDocument();
  });

  it("closes stale confirm modal and cancels orphaned active run when hot reload removes or changes commands", async () => {
    let resolveRun: ((v: unknown) => void) | null = null;
    apiMocks.runCommands.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        })
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("D:\\ws-main")).toBeInTheDocument();
    });

    // 1. Open Fix ConfirmModal, then hot-reload with a modified fix command -> modal must auto-close
    fireEvent.click(screen.getByText(lang.scripts.runGroup("Fix")));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const modifiedFixCmd = makeCommand({
      ...fixCmd,
      rawRun: "node @script/demo.mjs fix-v2",
      fingerprint: JSON.stringify([fixCmd.name, "node @script/demo.mjs fix-v2", true]),
    });
    const modifiedFixSnap = makeSnapshot({
      rootPath: "D:\\ws-main",
      items: [
        makeItem({
          ...demoItem,
          scriptGroups: [
            makeGroup({ key: "check", role: "check", commands: [checkCmd] }),
            makeGroup({ key: "fix", role: "fix", commands: [modifiedFixCmd] }),
          ],
        }),
        macItem,
      ],
    });
    apiMocks.reloadWorkspace.mockResolvedValueOnce(modifiedFixSnap);

    await act(async () => {
      watchCb?.("D:\\ws-main");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // 2. Start single check command, then hot-reload removes that command -> active run is auto-canceled
    fireEvent.click(screen.getAllByText(lang.scripts.runSingle)[0]);
    expect(screen.getByText(lang.scripts.stopSingle)).toBeInTheDocument();

    const deletedCheckSnap = makeSnapshot({
      rootPath: "D:\\ws-main",
      items: [
        makeItem({
          ...demoItem,
          scriptGroups: [
            makeGroup({ key: "fix", role: "fix", commands: [modifiedFixCmd] }),
          ],
        }),
        macItem,
      ],
    });
    apiMocks.reloadWorkspace.mockResolvedValueOnce(deletedCheckSnap);

    await act(async () => {
      watchCb?.("D:\\ws-main");
    });
    await waitFor(() => {
      expect(apiMocks.cancelRun).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(lang.scripts.stopSingle)).not.toBeInTheDocument();

    await act(async () => {
      resolveRun?.({ runId: "canceled", results: [] });
    });
  });
});
