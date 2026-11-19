import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  invokeMock,
  isTauriMock,
  listenMock,
  writeTextMock,
  openDialogMock,
  openPathMock,
  revealItemInDirMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  listenMock: vi.fn(),
  writeTextMock: vi.fn(),
  openDialogMock: vi.fn(),
  openPathMock: vi.fn(),
  revealItemInDirMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: writeTextMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialogMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: openPathMock,
  revealItemInDir: revealItemInDirMock,
}));

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
} from "../tauri";

describe("tauri api wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);
  });

  it("gates showMainWindow and syncWindowTheme behind isTauri()", async () => {
    isTauriMock.mockReturnValue(false);
    await showMainWindow("dark");
    await syncWindowTheme("light");
    expect(invokeMock).not.toHaveBeenCalled();

    isTauriMock.mockReturnValue(true);
    await showMainWindow("dark");
    await syncWindowTheme("light");
    expect(invokeMock).toHaveBeenCalledWith("show_main_window", {
      resolvedTheme: "dark",
    });
    expect(invokeMock).toHaveBeenCalledWith("sync_window_theme", {
      resolvedTheme: "light",
    });
  });

  it("delegates workspace and command invocations accurately", async () => {
    await getInitialState();
    await openWorkspace("D:\\ws");
    await reloadWorkspace();
    await runCommands("run-1", []);
    await cancelRun("run-1");
    await buildAiContext("git-config", []);
    await openInVscode("D:\\ws\\item");

    expect(invokeMock).toHaveBeenCalledWith("get_initial_state");
    expect(invokeMock).toHaveBeenCalledWith("open_workspace", { path: "D:\\ws" });
    expect(invokeMock).toHaveBeenCalledWith("reload_workspace");
    expect(invokeMock).toHaveBeenCalledWith("run_commands", {
      runId: "run-1",
      targets: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("cancel_run", { runId: "run-1" });
    expect(invokeMock).toHaveBeenCalledWith("build_ai_context", {
      itemId: "git-config",
      latestResults: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("open_in_vscode", {
      path: "D:\\ws\\item",
    });
  });

  it("handles folder dialog, explorer reveal fallback, clipboard, and event listeners", async () => {
    openDialogMock.mockResolvedValueOnce("D:\\picked").mockResolvedValueOnce(null);
    expect(await pickWorkspaceFolder("选择")).toBe("D:\\picked");
    expect(await pickWorkspaceFolder("选择")).toBeNull();

    revealItemInDirMock.mockResolvedValueOnce(undefined);
    await revealPathInExplorer("D:\\ws\\meta.json");
    expect(openPathMock).not.toHaveBeenCalled();

    revealItemInDirMock.mockRejectedValueOnce(new Error("fallback"));
    await revealPathInExplorer("D:\\ws\\dir");
    expect(openPathMock).toHaveBeenCalledWith("D:\\ws\\dir");

    await copyTextToClipboard("hello");
    expect(writeTextMock).toHaveBeenCalledWith("hello");

    const runHandler = vi.fn();
    const watchHandler = vi.fn();
    listenMock.mockImplementation(async (_name, cb) => {
      cb({ payload: { kind: "started" } });
      return () => {};
    });

    await subscribeRunEvents(runHandler);
    expect(listenMock).toHaveBeenCalledWith("settled://run-event", expect.any(Function));
    expect(runHandler).toHaveBeenCalledTimes(1);

    await subscribeWorkspaceChanges(watchHandler);
    expect(listenMock).toHaveBeenCalledWith(
      "settled://workspace-changed",
      expect.any(Function)
    );
    expect(watchHandler).toHaveBeenCalledTimes(1);
  });
});
