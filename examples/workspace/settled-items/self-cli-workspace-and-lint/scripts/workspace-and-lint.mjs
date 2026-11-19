import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "../../../..");
const exampleWorkspace = path.join(repoRoot, "examples", "workspace");

function resolveCli() {
  if (process.env.SETTLED_BIN) {
    return { bin: process.env.SETTLED_BIN, prefixArgs: [] };
  }
  const exe = process.platform === "win32" ? "settled.exe" : "settled";
  const debugBin = path.join(repoRoot, "target", "debug", exe);
  if (fs.existsSync(debugBin)) {
    return { bin: debugBin, prefixArgs: [] };
  }
  const covBin = path.join(repoRoot, "target", "llvm-cov-target", "debug", exe);
  if (fs.existsSync(covBin)) {
    return { bin: covBin, prefixArgs: [] };
  }
  return {
    bin: "cargo",
    prefixArgs: [
      "run",
      "-q",
      "--manifest-path",
      path.join(repoRoot, "Cargo.toml"),
      "-p",
      "settled-cli",
      "--",
    ],
  };
}

function runSettled(args, cwd, cliConfigPath, title) {
  const { bin, prefixArgs } = resolveCli();
  const env = { ...process.env, SETTLED_CLI_CONFIG: cliConfigPath };
  delete env.SETTLED_WORKSPACE;

  const res = spawnSync(bin, [...prefixArgs, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  if (res.error) {
    throw res.error;
  }
  const code = res.status ?? -1;
  const stdout = (res.stdout || "").trimEnd();
  const stderr = (res.stderr || "").trimEnd();

  console.log(`\n=== ${title} (settled ${args.join(" ")}) -> exit=${code} ===`);
  if (stdout) console.log(stdout);
  if (stderr) console.log(`[stderr]\n${stderr}`);
  return { code, stdout, stderr };
}

function writeMeta(dir, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(obj, null, 2), "utf8");
}

function testWorkspace(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const blank = path.join(sandbox, "blank-ws");
  const nested = path.join(blank, "settled-items", "child");
  fs.mkdirSync(blank, { recursive: true });

  const r1 = runSettled(["workspace", "use", blank], sandbox, cfg, "未初始化目录 use 报错");
  assert.equal(r1.code, 2);
  assert.match(r1.stderr, /--init/);

  const r2 = runSettled(["workspace", "use", blank, "--init"], sandbox, cfg, "使用 --init 初始化工作区");
  assert.equal(r2.code, 0);
  assert.equal(fs.existsSync(path.join(blank, "settled-items")), true);

  const r3 = runSettled(["workspace", "use", exampleWorkspace], sandbox, cfg, "切换第二工作区");
  assert.equal(r3.code, 0);

  const r4 = runSettled(["workspace", "list"], sandbox, cfg, "列出已注册工作区（带 * 标示）");
  assert.equal(r4.code, 0);
  assert.ok(r4.stdout.split(/\r?\n/).some((l) => l.startsWith("* ") && l.includes("workspace")));

  assert.equal(runSettled(["workspace", "use", blank], sandbox, cfg, "切回 blank-ws").code, 0);
  fs.mkdirSync(nested, { recursive: true });
  fs.rmSync(blank, { recursive: true, force: true });

  const r5 = runSettled(["workspace", "current"], exampleWorkspace, cfg, "全局目录不存在时警告并回退当前目录");
  assert.equal(r5.code, 0);
  assert.match(r5.stderr, /warning:/);
  assert.ok(r5.stdout.toLowerCase().includes("workspace"));

  const r6 = runSettled(["workspace", "current"], sandbox, cfg, "全局失效且 cwd 非工作区时告警并退出 2");
  assert.equal(r6.code, 2);
  assert.match(r6.stderr, /warning:/);
  assert.match(r6.stderr, /error:/);

  const r7 = runSettled(["workspace", "remove", blank], sandbox, cfg, "移除已失效激活工作区");
  assert.equal(r7.code, 0);
  assert.match(r7.stdout, /Removed active workspace/);

  const noParentWalk = path.join(exampleWorkspace, "settled-items");
  const r8 = runSettled(["workspace", "current"], noParentWalk, cfg, "子目录不向上查找工作区");
  assert.equal(r8.code, 2);
}

function testList(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const cur = runSettled(["list", "-w", exampleWorkspace], sandbox, cfg, "list 默认仅输出当前平台条目");
  assert.equal(cur.code, 0);
  const curData = JSON.parse(cur.stdout);
  assert.ok(Array.isArray(curData.items) && curData.items.length >= 6);
  const first = curData.items[0];
  assert.ok(first.id && first.path && typeof first.applicable === "boolean");
  assert.equal("metaPath" in first, false);
  assert.equal("readmePath" in first, false);
  assert.equal("readme" in first, false);
  assert.equal("rawMeta" in first, false);

  const all = runSettled(
    ["list", "--all-platforms", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "list --all-platforms 包含其他平台禁用条目"
  );
  assert.equal(all.code, 0);
  const allData = JSON.parse(all.stdout);
  assert.equal(allData.items.length, 9);
  assert.ok(allData.items.some((it) => it.applicable === false));
}

function testNew(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const ws = path.join(sandbox, "new-ws");
  fs.mkdirSync(path.join(ws, "settled-items"), { recursive: true });

  for (const badId of [".hidden-id", "UpperCase", "../bad"]) {
    const bad = runSettled(["new", badId, "-w", ws], sandbox, cfg, `拒绝非法 ID (${badId})`);
    assert.equal(bad.code, 2);
  }

  const ok = runSettled(["new", "sample-env-check", "-w", ws], sandbox, cfg, "生成标准条目骨架");
  assert.equal(ok.code, 0);
  const itemDir = path.join(ws, "settled-items", "sample-env-check");
  const meta = JSON.parse(fs.readFileSync(path.join(itemDir, "meta.json"), "utf8"));
  assert.equal(meta.name, "Sample Env Check");
  assert.equal(meta.description, "");
  assert.equal(typeof meta.createAt, "number");
  assert.ok(Array.isArray(meta.scripts?.check));
  assert.equal(fs.readFileSync(path.join(itemDir, "README.md"), "utf8"), "");

  const dup = runSettled(["new", "sample-env-check", "-w", ws], sandbox, cfg, "拒绝重名创建");
  assert.equal(dup.code, 2);
}

function testLintErrors(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const ws = path.join(sandbox, "lint-err-ws");
  const items = path.join(ws, "settled-items");

  const missingMeta = path.join(items, "missing-meta");
  fs.mkdirSync(missingMeta, { recursive: true });
  fs.writeFileSync(path.join(missingMeta, "README.md"), "有文档但缺 meta");

  const badJson = path.join(items, "bad-json");
  fs.mkdirSync(badJson, { recursive: true });
  fs.writeFileSync(path.join(badJson, "meta.json"), "{ bad json");
  fs.writeFileSync(path.join(badJson, "README.md"), "语法损坏");

  const badTags = path.join(items, "string-tags");
  writeMeta(badTags, { name: "字符串 tags", tags: "git" });
  fs.writeFileSync(path.join(badTags, "README.md"), "tags 类型错误");

  const badPlatform = path.join(items, "invalid-platform");
  writeMeta(badPlatform, { name: "非法平台", platforms: ["win32"] });
  fs.writeFileSync(path.join(badPlatform, "README.md"), "平台枚举错误");

  const nullPlatforms = path.join(items, "null-platforms");
  writeMeta(nullPlatforms, { name: "空值平台", platforms: null });
  fs.writeFileSync(path.join(nullPlatforms, "README.md"), "null 平台");

  const res = runSettled(["lint", "-w", ws], sandbox, cfg, "lint 检查全部会被忽略的非法 meta");
  assert.equal(res.code, 1);
  assert.match(res.stdout, /5 error\(s\)/);
  assert.match(res.stdout, /\[ERROR\] meta\.json is missing/);
  assert.match(res.stdout, /\[ERROR\] invalid meta\.json/);
}

function testLintWarnings(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const ws = path.join(sandbox, "lint-warn-ws");
  const items = path.join(ws, "settled-items");

  // 1. 缺 README + 未知字段 + 一级脚本不存在 + 平台无交集 -> 全部为 WARN，退出码 0
  const warnItem = path.join(items, "warn-matrix");
  writeMeta(warnItem, {
    name: "警告全覆盖",
    platforms: ["windows"],
    platform: ["windows"],
    scripts: {
      check: [
        {
          name: "缺失一级脚本且平台冲突",
          run: "node @script/not-found.mjs",
          platforms: ["macos"],
          extraField: true,
        },
      ],
    },
  });

  // 2. 存在的一级脚本内部 source 不存在路径（不应继续递归告警）+ 空 README
  const noRecurse = path.join(items, "empty-readme-and-first-level");
  writeMeta(noRecurse, {
    name: "不递归内部脚本",
    scripts: { check: "bash @script/entry.sh" },
  });
  fs.mkdirSync(path.join(noRecurse, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(noRecurse, "scripts", "entry.sh"), "source ./nonexistent-inner.sh\n");
  fs.writeFileSync(path.join(noRecurse, "README.md"), "   \n");

  const res = runSettled(["lint", "-w", ws], sandbox, cfg, "lint 全部警告场景（退出码 0）");
  assert.equal(res.code, 0);
  assert.match(res.stdout, /0 error\(s\)/);
  assert.match(res.stdout, /unexpected field 'platform'/);
  assert.match(res.stdout, /unexpected field 'extraField'/);
  assert.match(res.stdout, /README\.md does not exist/);
  assert.match(res.stdout, /README\.md is empty/);
  assert.match(res.stdout, /references missing script 'scripts\/not-found\.mjs'/);
  assert.match(res.stdout, /never overlap item platforms/);
  assert.doesNotMatch(res.stdout, /nonexistent-inner\.sh/);

  const single = runSettled(
    ["lint", "empty-readme-and-first-level", "-w", ws],
    sandbox,
    cfg,
    "lint 指定单个条目"
  );
  assert.equal(single.code, 0);
  assert.match(single.stdout, /Linted 1 item\(s\): 0 error\(s\), 1 warning\(s\)/);

  const missingItem = runSettled(
    ["lint", "does-not-exist", "-w", ws],
    sandbox,
    cfg,
    "lint 不存在条目报错退出码 2"
  );
  assert.equal(missingItem.code, 2);
}

const mode = process.argv[2];
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "settled-cli-test-"));
try {
  if (mode === "workspace") testWorkspace(sandbox);
  else if (mode === "list") testList(sandbox);
  else if (mode === "new") testNew(sandbox);
  else if (mode === "lint-errors") testLintErrors(sandbox);
  else if (mode === "lint-warnings") testLintWarnings(sandbox);
  else {
    console.error(`未知测试子项: ${mode}`);
    process.exit(2);
  }
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
