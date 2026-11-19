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
    resolvedRun: "node ./scripts/demo.mjs check",
    applicable: true,
  });
  const fixCmd = makeCommand({
    index: 0,
    key: "fix",
    commandId: "demo::fix::0",
    name: "写入标记",
    rawRun: "node @script/demo.mjs fix",
    resolvedRun: "node ./scripts/demo.mjs fix",
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
        resolvedRun: checkCmd.resolvedRun,
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
            resolvedRun: fixCmd.resolvedRun,
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
            resolvedRun: checkCmd.resolvedRun,
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

    // Watcher notification reloads workspace cleanly
    apiMocks.reloadWorkspace.mockResolvedValueOnce(snapshot);
    await act(async () => {
      watchCb?.("D:\\ws-main");
    });
    expect(apiMocks.reloadWorkspace).toHaveBeenCalledTimes(1);

    // Copy AI context triggers IPC + clipboard write
    await act(async () => {
      fireEvent.click(screen.getByText(lang.detail.copyAiContext));
    });
    expect(apiMocks.buildAiContext).toHaveBeenCalled();
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
});
