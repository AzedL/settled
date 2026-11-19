import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lang } from "../../lang";
import {
  makeCommand,
  makeGroup,
  makeItem,
  makeRuntime,
  makeSnapshot,
} from "../../test/fixtures";
import { DetailPanel } from "../DetailPanel";
import { HeaderBar } from "../HeaderBar";
import { Sidebar } from "../Sidebar";
import { TagFilterInput } from "../TagFilterInput";
import { TagOverflowList } from "../TagOverflowList";

describe("HeaderBar, Sidebar, DetailPanel, TagFilterInput, and TagOverflowList", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders HeaderBar controls, recent workspaces menu, and theme switcher", () => {
    const onOpenWorkspace = vi.fn();
    const onOpenRecent = vi.fn();
    const onChangeThemeMode = vi.fn();
    const onRunChecks = vi.fn();
    const onStopChecks = vi.fn();
    const onReload = vi.fn();

    const { rerender } = render(
      <HeaderBar
        workspace={null}
        recentWorkspaces={[]}
        themeMode="system"
        isCheckingActive={false}
        onChangeThemeMode={onChangeThemeMode}
        onOpenWorkspace={onOpenWorkspace}
        onOpenRecent={onOpenRecent}
        onReload={onReload}
        onRunChecks={onRunChecks}
        onStopChecks={onStopChecks}
      />
    );

    expect(screen.getByText(lang.header.noWorkspaceLoaded)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(lang.header.recentWorkspacesAria));
    expect(screen.getByText(lang.header.recentWorkspacesEmpty)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const snap = makeSnapshot({ rootPath: "D:\\my\\settled-ws" });
    rerender(
      <HeaderBar
        workspace={snap}
        recentWorkspaces={["D:\\my\\settled-ws", "D:\\other"]}
        themeMode="light"
        isCheckingActive={true}
        onChangeThemeMode={onChangeThemeMode}
        onOpenWorkspace={onOpenWorkspace}
        onOpenRecent={onOpenRecent}
        onReload={onReload}
        onRunChecks={onRunChecks}
        onStopChecks={onStopChecks}
      />
    );

    expect(screen.getByText("D:\\my\\settled-ws")).toBeInTheDocument();
    fireEvent.click(screen.getByText(lang.header.stopChecks));
    expect(onStopChecks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(lang.header.reload));
    expect(onReload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText(lang.header.themeDark));
    expect(onChangeThemeMode).toHaveBeenCalledWith("dark");

    fireEvent.click(screen.getByLabelText(lang.header.recentWorkspacesAria));
    const otherBtn = screen.getByTitle("D:\\other");
    fireEvent.click(otherBtn);
    expect(onOpenRecent).toHaveBeenCalledWith("D:\\other");

    // Open menu again then click outside to verify outside-click close
    fireEvent.click(screen.getByLabelText(lang.header.recentWorkspacesAria));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("handles Sidebar filtering, scope toggle, and item selection", () => {
    const onChangeScope = vi.fn();
    const onSearchChange = vi.fn();
    const onChangeSelectedTags = vi.fn();
    const onSelectItem = vi.fn();

    const item1 = makeItem({
      id: "git-config",
      name: "Git 基础配置",
      applicable: true,
      scriptGroups: [
        makeGroup({
          role: "check",
          commands: [makeCommand({ commandId: "git::0", name: "Git" })],
        }),
      ],
    });
    const item2 = makeItem({
      id: "macos-only",
      name: "macOS 工具",
      applicable: false,
      tags: ["macos"],
      scriptGroups: [
        makeGroup({
          role: "check",
          commands: [
            makeCommand({
              commandId: "mac::0",
              name: "Brew",
              applicable: false,
            }),
          ],
        }),
      ],
    });
    const snap = makeSnapshot({ items: [item1, item2] });

    const { rerender } = render(
      <Sidebar
        workspace={snap}
        filteredItems={[]}
        scopedCount={2}
        scope="current"
        search="abc"
        selectedTags={[]}
        selectedItemId={null}
        runtimeMap={{}}
        onChangeScope={onChangeScope}
        onSearchChange={onSearchChange}
        onChangeSelectedTags={onChangeSelectedTags}
        onSelectItem={onSelectItem}
      />
    );

    expect(screen.getByText(lang.sidebar.noItemsMatch)).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(lang.filters.clearSearchAria));
    expect(onSearchChange).toHaveBeenCalledWith("");

    fireEvent.click(screen.getByText(lang.header.scopeAll));
    expect(onChangeScope).toHaveBeenCalledWith("all");

    rerender(
      <Sidebar
        workspace={snap}
        filteredItems={[item1, item2]}
        scopedCount={2}
        scope="all"
        search=""
        selectedTags={[]}
        selectedItemId="git-config"
        runtimeMap={{ "git::0": makeRuntime({ status: "pass" }) }}
        onChangeScope={onChangeScope}
        onSearchChange={onSearchChange}
        onChangeSelectedTags={onChangeSelectedTags}
        onSelectItem={onSelectItem}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(lang.filters.searchPlaceholder), {
      target: { value: "mac" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("mac");

    fireEvent.click(screen.getByText("macOS 工具"));
    expect(onSelectItem).toHaveBeenCalledWith("macos-only");
  });

  it("renders DetailPanel empty/filled states, accordions, and clipboard feedback", async () => {
    vi.useFakeTimers();
    const onRunGroup = vi.fn();
    const onRunCommand = vi.fn();
    const onStopActiveRun = vi.fn();
    const onOpenInVscode = vi.fn();
    const onRevealInExplorer = vi.fn();
    const onCopyAiContext = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <DetailPanel
        item={null}
        scope="current"
        runtimeMap={{}}
        activeAction={null}
        onRunGroup={onRunGroup}
        onRunCommand={onRunCommand}
        onStopActiveRun={onStopActiveRun}
        onOpenInVscode={onOpenInVscode}
        onRevealInExplorer={onRevealInExplorer}
        onCopyAiContext={onCopyAiContext}
      />
    );
    expect(screen.getByText(lang.detail.selectItemPrompt)).toBeInTheDocument();

    const item = makeItem({
      id: "manual",
      name: "手动清单",
      description: null,
      createAt: null,
      tags: [],
      readme: "# 说明\n内容正文",
      rawMeta: '{"name":"手动清单"}',
      scriptGroups: [],
    });

    rerender(
      <DetailPanel
        item={item}
        scope="current"
        runtimeMap={{}}
        activeAction={null}
        onRunGroup={onRunGroup}
        onRunCommand={onRunCommand}
        onStopActiveRun={onStopActiveRun}
        onOpenInVscode={onOpenInVscode}
        onRevealInExplorer={onRevealInExplorer}
        onCopyAiContext={onCopyAiContext}
      />
    );

    expect(screen.getByText(lang.detail.createdAtEmpty)).toBeInTheDocument();
    expect(screen.getByText(lang.detail.noTagsValue)).toBeInTheDocument();
    expect(screen.getByText(lang.detail.noScriptsNotice)).toBeInTheDocument();

    fireEvent.click(screen.getByText(lang.detail.openInVscode));
    expect(onOpenInVscode).toHaveBeenCalledWith(item.path);

    fireEvent.click(screen.getByText(lang.detail.revealInExplorer));
    expect(onRevealInExplorer).toHaveBeenCalledWith(item.metaPath);

    fireEvent.click(screen.getByText(lang.detail.readmeTitle));
    expect(screen.getByText("内容正文")).toBeInTheDocument();

    fireEvent.click(screen.getByText(lang.detail.rawMetaTitle));
    expect(screen.getByText('{"name":"手动清单"}')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText(lang.detail.copyAiContext));
      await Promise.resolve();
    });
    expect(screen.getByText(lang.detail.copiedAiContext)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(lang.detail.copyAiContext)).toBeInTheDocument();
  });

  it("drives TagFilterInput keyboard navigation, dropdown filtering, and token deletion", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TagFilterInput
        allTags={["alpha-tag", "git", "beta-git", "zeta"]}
        selectedTags={[]}
        onChangeSelectedTags={onChange}
      />
    );

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "git" } });
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("git"); // prefix match sorted first
    expect(options[1]).toHaveTextContent("beta-git");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["git"]);

    rerender(
      <TagFilterInput
        allTags={["alpha-tag", "git", "beta-git", "zeta"]}
        selectedTags={["git", "zeta"]}
        onChangeSelectedTags={onChange}
      />
    );

    const nextInput = screen.getByRole("combobox") as HTMLInputElement;
    nextInput.setSelectionRange(0, 0);
    fireEvent.keyDown(nextInput, { key: "ArrowLeft" });
    const zetaToken = screen.getByTitle("zeta");
    fireEvent.keyDown(zetaToken, { key: "ArrowLeft" });
    const gitToken = screen.getByTitle("git");
    fireEvent.keyDown(gitToken, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith(["zeta"]);

    fireEvent.keyDown(zetaToken, { key: "Delete" });
    expect(onChange).toHaveBeenCalledWith(["git"]);

    fireEvent.keyDown(zetaToken, { key: "a" });
    expect(screen.getByRole("combobox")).toHaveValue("a");

    fireEvent.keyDown(nextInput, { key: "Escape" }); // closes dropdown or clears query
    fireEvent.keyDown(nextInput, { key: "Escape" });
  });

  it("handles TagOverflowList truncation, +N collapse, and hover popover", () => {
    const { container, rerender } = render(<TagOverflowList tags={[]} />);
    expect(container.firstChild).toBeNull();

    // Simulate narrow 110px container where three 60px tags overflow
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 110;
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const text = this.textContent ?? "";
        const width = text.startsWith("+")
          ? 32
          : text.includes("extremely-long")
            ? 220
            : 60;
        return {
          width,
          height: 20,
          top: 10,
          left: 10,
          bottom: 30,
          right: 10 + width,
          x: 10,
          y: 10,
          toJSON: () => {},
        } as DOMRect;
      }
    );

    rerender(
      <TagOverflowList tags={["tag-one", "tag-two", "tag-three"]} focusableBadge />
    );

    const badge = screen.getByText("+2");
    expect(badge).toBeInTheDocument();
    fireEvent.mouseEnter(badge.parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(badge.parentElement!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.focus(badge.parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.resize(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Single oversized tag triggers truncated head with hover popover
    rerender(<TagOverflowList tags={["extremely-long-single-tag"]} />);
    const single = screen.getAllByText("extremely-long-single-tag")[1];
    fireEvent.mouseEnter(single.parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
