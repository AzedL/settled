import { describe, expect, it } from "vitest";
import {
  makeCommand,
  makeGroup,
  makeItem,
  makeRuntime,
  makeSnapshot,
} from "../../test/fixtures";
import {
  DEFAULT_COMMAND_RUNTIME,
  getApplicableCheckCommands,
  getCommandRuntime,
  matchesItemFilters,
  reconcileRuntimeWithSnapshot,
  toExecutionTarget,
} from "../itemStatus";

describe("itemStatus utilities", () => {
  it("builds execution targets from item and resolved command", () => {
    const item = makeItem({ id: "git-config", path: "D:\\ws\\git-config" });
    const cmd = makeCommand({
      index: 1,
      key: "check",
      commandId: "git-config::check::1",
      resolvedRun: "git config user.name",
      effectiveShell: "bash",
      encoding: "utf-8",
    });

    expect(toExecutionTarget(item, cmd)).toEqual({
      itemId: "git-config",
      itemDir: "D:\\ws\\git-config",
      groupKey: "check",
      commandIndex: 1,
      commandId: "git-config::check::1",
      commandName: cmd.name,
      resolvedRun: "git config user.name",
      shell: "bash",
      encoding: "utf-8",
    });
  });

  it("extracts applicable check commands cleanly", () => {
    const c1 = makeCommand({ index: 0, applicable: true });
    const c2 = makeCommand({ index: 1, applicable: false });
    const item = makeItem({
      applicable: true,
      scriptGroups: [makeGroup({ role: "check", commands: [c1, c2] })],
    });
    expect(getApplicableCheckCommands(item)).toEqual([c1]);

    expect(getApplicableCheckCommands(makeItem({ applicable: false }))).toEqual([]);
    expect(getApplicableCheckCommands(makeItem({ scriptGroups: [] }))).toEqual([]);
  });

  it("returns default idle state for unknown commands", () => {
    const passRuntime = makeRuntime({ status: "pass" });
    expect(getCommandRuntime({ a: passRuntime }, "a")).toBe(passRuntime);
    expect(getCommandRuntime({ a: passRuntime }, "missing")).toBe(
      DEFAULT_COMMAND_RUNTIME
    );
  });

  it("evaluates scope, tags, and search filters", () => {
    const item = makeItem({
      name: "Git 基础配置",
      description: "验证提交用户名",
      tags: ["git", "init"],
      applicable: false,
    });

    expect(
      matchesItemFilters(item, { scope: "current", search: "", selectedTags: [] })
    ).toBe(false);
    expect(
      matchesItemFilters(item, { scope: "all", search: "", selectedTags: [] })
    ).toBe(true);
    expect(
      matchesItemFilters(item, {
        scope: "all",
        search: "",
        selectedTags: ["node", "init"],
      })
    ).toBe(true);
    expect(
      matchesItemFilters(item, {
        scope: "all",
        search: "",
        selectedTags: ["node"],
      })
    ).toBe(false);
    expect(
      matchesItemFilters(item, {
        scope: "all",
        search: "用户名",
        selectedTags: [],
      })
    ).toBe(true);
    expect(
      matchesItemFilters(makeItem({ description: null }), {
        scope: "all",
        search: "not-found",
        selectedTags: [],
      })
    ).toBe(false);
  });

  it("reconciles runtime state by command fingerprint across insertions, deletions, and edits", () => {
    const c0 = makeCommand({ index: 0, commandId: "demo::check::0", name: "第一步", rawRun: "echo 1" });
    const c1 = makeCommand({ index: 1, commandId: "demo::check::1", name: "第二步", rawRun: "echo 2" });
    const c2 = makeCommand({ index: 2, commandId: "demo::check::2", name: "第三步", rawRun: "exit 1" });

    const prevSnapshot = makeSnapshot({
      items: [makeItem({ id: "demo", scriptGroups: [makeGroup({ commands: [c0, c1, c2] })] })],
    });

    const passState = makeRuntime({ status: "pass", exitCode: 0 });
    const failState = makeRuntime({ status: "fail", exitCode: 1 });
    const prevMap = {
      "demo::check::0": passState,
      "demo::check::1": passState,
      "demo::check::2": failState,
    };

    // Inserting a new command at index 2 pushes old index 2 -> index 3;
    // the newly inserted step 2 MUST stay unassigned (idle), while step 3 keeps old index 2's fail state.
    const inserted = makeCommand({ index: 2, commandId: "demo::check::2", name: "新增 ANSI 展示", rawRun: "node @script/ansi.mjs" });
    const shiftedC2 = makeCommand({ index: 3, commandId: "demo::check::3", name: "第三步", rawRun: "exit 1" });
    const insertedSnapshot = makeSnapshot({
      items: [makeItem({ id: "demo", scriptGroups: [makeGroup({ commands: [c0, c1, inserted, shiftedC2] })] })],
    });

    const afterInsert = reconcileRuntimeWithSnapshot(prevMap, prevSnapshot, insertedSnapshot);
    expect(afterInsert["demo::check::0"]).toBe(passState);
    expect(afterInsert["demo::check::1"]).toBe(passState);
    expect(afterInsert["demo::check::2"]).toBeUndefined();
    expect(afterInsert["demo::check::3"]).toBe(failState);

    // Modifying an existing command's script resets its stale status to idle
    const modifiedC1 = makeCommand({ index: 1, commandId: "demo::check::1", name: "第二步", rawRun: "echo changed" });
    const editedSnapshot = makeSnapshot({
      items: [makeItem({ id: "demo", scriptGroups: [makeGroup({ commands: [c0, modifiedC1, c2] })] })],
    });
    const afterEdit = reconcileRuntimeWithSnapshot(prevMap, prevSnapshot, editedSnapshot);
    expect(afterEdit["demo::check::0"]).toBe(passState);
    expect(afterEdit["demo::check::1"]).toBeUndefined();
    expect(afterEdit["demo::check::2"]).toBe(failState);

    // Reordering commands preserves each command's own runtime state
    const swapped0 = makeCommand({ index: 0, commandId: "demo::check::0", name: "第三步", rawRun: "exit 1" });
    const swapped1 = makeCommand({ index: 1, commandId: "demo::check::1", name: "第一步", rawRun: "echo 1" });
    const swappedSnapshot = makeSnapshot({
      items: [makeItem({ id: "demo", scriptGroups: [makeGroup({ commands: [swapped0, swapped1] })] })],
    });
    const afterSwap = reconcileRuntimeWithSnapshot(prevMap, prevSnapshot, swappedSnapshot);
    expect(afterSwap["demo::check::0"]).toBe(failState);
    expect(afterSwap["demo::check::1"]).toBe(passState);

    // Duplicate commands preserve per-slot idle vs non-idle isolation
    const dup0 = makeCommand({ index: 0, commandId: "demo::check::0", name: "重复", rawRun: "echo dup" });
    const dup1 = makeCommand({ index: 1, commandId: "demo::check::1", name: "重复", rawRun: "echo dup" });
    const dupSnapshot = makeSnapshot({
      items: [makeItem({ id: "demo", scriptGroups: [makeGroup({ commands: [dup0, dup1] })] })],
    });
    const afterDup = reconcileRuntimeWithSnapshot({ "demo::check::1": passState }, dupSnapshot, dupSnapshot);
    expect(afterDup["demo::check::0"]).toBeUndefined();
    expect(afterDup["demo::check::1"]).toBe(passState);
  });
});
