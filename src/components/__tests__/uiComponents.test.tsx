import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { lang } from "../../lang";
import { makeCommand, makeGroup, makeRuntime } from "../../test/fixtures";

const { openExternalUrlMock } = vi.hoisted(() => ({
  openExternalUrlMock: vi.fn(),
}));

vi.mock("../../api/tauri", () => ({
  openExternalUrl: openExternalUrlMock,
}));

import { Button } from "../Button";
import { CommandRow } from "../CommandRow";
import { ConfirmModal } from "../ConfirmModal";
import { MarkdownView } from "../MarkdownView";
import { ScriptGroupCard } from "../ScriptGroupCard";
import { SearchTagToken, TagChip } from "../TagChip";
import { TrafficLed } from "../TrafficLed";

describe("primitive and command UI components", () => {
  it("renders Button variants, sizes, iconOnly, and active panel class", () => {
    render(
      <>
        <Button variant="primary" size="md">
          主按钮
        </Button>
        <Button variant="panel" size="sm" active iconOnly aria-label="图标">
          X
        </Button>
      </>
    );
    expect(screen.getByText("主按钮").closest("button")).toHaveClass(
      "st-btn-primary"
    );
    expect(screen.getByLabelText("图标")).toHaveClass("st-btn-panel--active");
  });

  it("renders TrafficLed statuses including disabled and running pulse", () => {
    render(
      <>
        <TrafficLed status="idle" size="sm" />
        <TrafficLed status="running" />
        <TrafficLed status="pass" />
        <TrafficLed status="fail" />
        <TrafficLed status="canceled" />
        <TrafficLed status="disabled" title="自定义禁用" />
      </>
    );
    expect(screen.getByLabelText(lang.status.label("running"))).toHaveClass(
      "animate-pulse"
    );
    expect(screen.getByLabelText("自定义禁用")).toBeInTheDocument();
    expect(screen.getByLabelText(lang.status.label("pass"))).toBeInTheDocument();
  });

  it("renders TagChip and SearchTagToken interactions", () => {
    const onFocusToken = vi.fn();
    const onKeyDown = vi.fn();
    const onRemove = vi.fn();

    render(
      <div>
        <TagChip label="git" muted />
        <SearchTagToken
          label="node"
          active
          tokenRef={() => {}}
          onFocusToken={onFocusToken}
          onKeyDown={onKeyDown}
          onRemove={onRemove}
        />
      </div>
    );

    expect(screen.getByText("git").parentElement).toHaveClass("st-tag--muted");
    const token = screen.getByTitle("node");
    expect(token).toHaveAttribute("data-active", "true");
    fireEvent.click(token);
    expect(onFocusToken).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(token, { key: "Backspace" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(lang.filters.removeTagAria("node")));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onFocusToken).toHaveBeenCalledTimes(1);
  });

  it("renders MarkdownView only when content is non-empty and intercepts links safely", () => {
    openExternalUrlMock.mockReset();
    openExternalUrlMock.mockResolvedValue(undefined);

    const { container, rerender } = render(<MarkdownView content={"   \n"} />);
    expect(container.firstChild).toBeNull();

    rerender(
      <MarkdownView
        content={"# 标题\n\n- 条目 A\n\n[官网](https://example.com) [本地](./local.md)"}
      />
    );
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(screen.getByText("条目 A")).toBeInTheDocument();

    const extLink = screen.getByRole("link", { name: "官网" });
    const extClick = fireEvent.click(extLink);
    expect(extClick).toBe(false);
    expect(openExternalUrlMock).toHaveBeenCalledWith("https://example.com");

    openExternalUrlMock.mockClear();
    const localLink = screen.getByRole("link", { name: "本地" });
    const localClick = fireEvent.click(localLink);
    expect(localClick).toBe(false);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("handles ConfirmModal actions, Escape key, and backdrop clicks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const cmdSame = makeCommand({
      commandId: "c1",
      name: "echo fix",
      rawRun: "echo fix",
    });
    const cmdNamed = makeCommand({
      commandId: "c2",
      name: "修复路径",
      rawRun: "node @script/fix.mjs",
    });

    render(
      <ConfirmModal
        title="Fix"
        commands={[cmdSame, cmdNamed]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText(lang.confirmModal.subtitle)).toBeInTheDocument();
    expect(screen.getByText("修复路径")).toBeInTheDocument();
    expect(screen.getByText("node @script/fix.mjs")).toBeInTheDocument();

    fireEvent.click(screen.getByText(lang.confirmModal.confirmBtn));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText(lang.confirmModal.cancelBtn));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it("toggles CommandRow diagnostics and auto-expands on failure", () => {
    const onRun = vi.fn();
    const onStop = vi.fn();
    const cmd = makeCommand({
      name: "Node 检查",
      description: "检查主版本 >= 20",
      rawRun: "node -v",
      platforms: ["windows"],
      applicable: true,
    });

    const { rerender } = render(
      <CommandRow
        command={cmd}
        runtime={makeRuntime({ status: "running" })}
        isActiveStop={false}
        onRun={onRun}
        onStop={onStop}
      />
    );

    fireEvent.click(screen.getByText(lang.scripts.runSingle));
    expect(onRun).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(lang.scripts.logsShow));
    expect(screen.getByText(lang.scripts.logsWaiting)).toBeInTheDocument();
    expect(screen.getByText("检查主版本 >= 20")).toBeInTheDocument();

    rerender(
      <CommandRow
        command={cmd}
        runtime={makeRuntime({
          status: "pass",
          exitCode: 0,
          durationMs: 25,
          logs: [
            { stream: "stdout", text: "v24.0.0" },
            { stream: "stdout", text: "\x1b[2K\x1b[32m✓\x1b[39m passed" },
            { stream: "stdout", text: "" },
          ],
        })}
        isActiveStop={true}
        onRun={onRun}
        onStop={onStop}
      />
    );
    expect(screen.getByText("exit 0")).toBeInTheDocument();
    expect(screen.getByText("25 ms")).toBeInTheDocument();
    expect(screen.getByText("v24.0.0")).toBeInTheDocument();
    expect(screen.getByText("✓").style.color).toBe("var(--st-ansi-fg-green)");

    fireEvent.click(screen.getByText(lang.scripts.stopSingle));
    expect(onStop).toHaveBeenCalledTimes(1);

    rerender(
      <CommandRow
        command={makeCommand({ applicable: false })}
        runtime={makeRuntime({
          status: "fail",
          exitCode: 1,
          error: "执行出错",
          logs: [
            { stream: "stderr", text: "err line" },
            { stream: "system", text: "sys line" },
          ],
        })}
        isActiveStop={false}
        onRun={onRun}
        onStop={onStop}
      />
    );
    expect(screen.queryByText(lang.scripts.runSingle)).not.toBeInTheDocument();
    expect(screen.getByText("执行出错")).toBeInTheDocument();
    expect(screen.getByText("err line")).toBeInTheDocument();
    expect(screen.getByText("sys line")).toBeInTheDocument();
  });

  it("auto-scrolls streaming logs while pinned to bottom and pauses when scrolled up", () => {
    const cmd = makeCommand({ name: "流式日志", applicable: true });
    const { container, rerender } = render(
      <CommandRow
        command={cmd}
        runtime={makeRuntime({
          status: "running",
          logs: [{ stream: "stdout", text: "line-1" }],
        })}
        isActiveStop={false}
        onRun={() => {}}
        onStop={() => {}}
      />
    );

    fireEvent.click(screen.getByText(lang.scripts.logsShow));
    const logBox = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    expect(logBox).toBeTruthy();

    let scrollHeight = 400;
    Object.defineProperty(logBox, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(logBox, "clientHeight", {
      configurable: true,
      get: () => 200,
    });

    // While pinned at bottom, incoming log lines snap scrollTop to latest scrollHeight
    scrollHeight = 520;
    rerender(
      <CommandRow
        command={cmd}
        runtime={makeRuntime({
          status: "running",
          logs: [
            { stream: "stdout", text: "line-1" },
            { stream: "stdout", text: "line-2" },
          ],
        })}
        isActiveStop={false}
        onRun={() => {}}
        onStop={() => {}}
      />
    );
    expect(logBox.scrollTop).toBe(520);

    // User scrolls up to read earlier logs -> smart auto-scroll pauses
    logBox.scrollTop = 40;
    fireEvent.scroll(logBox);
    scrollHeight = 680;
    rerender(
      <CommandRow
        command={cmd}
        runtime={makeRuntime({
          status: "running",
          logs: [
            { stream: "stdout", text: "line-1" },
            { stream: "stdout", text: "line-2" },
            { stream: "stdout", text: "line-3" },
          ],
        })}
        isActiveStop={false}
        onRun={() => {}}
        onStop={() => {}}
      />
    );
    expect(logBox.scrollTop).toBe(40);

    // User scrolls back near bottom -> smart auto-scroll resumes
    logBox.scrollTop = 470;
    fireEvent.scroll(logBox);
    scrollHeight = 760;
    rerender(
      <CommandRow
        command={cmd}
        runtime={makeRuntime({
          status: "running",
          logs: [
            { stream: "stdout", text: "line-1" },
            { stream: "stdout", text: "line-2" },
            { stream: "stdout", text: "line-3" },
            { stream: "stdout", text: "line-4" },
          ],
        })}
        isActiveStop={false}
        onRun={() => {}}
        onStop={() => {}}
      />
    );
    expect(logBox.scrollTop).toBe(760);
  });

  it("handles ScriptGroupCard scoping, highlighting, and stop state", () => {
    const onRunGroup = vi.fn();
    const onRunCommand = vi.fn();
    const onStopActiveRun = vi.fn();
    const fixCmd = makeCommand({
      key: "fix",
      commandId: "a::fix::0",
      name: "修复配置",
      applicable: true,
    });
    const fixGroup = makeGroup({ key: "fix", role: "fix", commands: [fixCmd] });

    const { container, rerender } = render(
      <ScriptGroupCard
        itemId="a"
        group={makeGroup({
          key: "check",
          role: "check",
          commands: [makeCommand({ applicable: false })],
        })}
        itemApplicable={true}
        scope="current"
        runtimeMap={{}}
        activeAction={null}
        hasFailingCheck={false}
        onRunGroup={onRunGroup}
        onRunCommand={onRunCommand}
        onStopActiveRun={onStopActiveRun}
      />
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <ScriptGroupCard
        itemId="a"
        group={fixGroup}
        itemApplicable={true}
        scope="current"
        runtimeMap={{}}
        activeAction={null}
        hasFailingCheck={true}
        onRunGroup={onRunGroup}
        onRunCommand={onRunCommand}
        onStopActiveRun={onStopActiveRun}
      />
    );
    fireEvent.click(screen.getByText(lang.scripts.runGroup("Fix")));
    expect(onRunGroup).toHaveBeenCalledWith(fixGroup);

    rerender(
      <ScriptGroupCard
        itemId="a"
        group={fixGroup}
        itemApplicable={true}
        scope="all"
        runtimeMap={{}}
        activeAction={{ kind: "group", itemId: "a", groupKey: "fix" }}
        hasFailingCheck={true}
        onRunGroup={onRunGroup}
        onRunCommand={onRunCommand}
        onStopActiveRun={onStopActiveRun}
      />
    );
    fireEvent.click(screen.getByText(lang.scripts.stopGroup("Fix")));
    expect(onStopActiveRun).toHaveBeenCalledTimes(1);
  });
});
