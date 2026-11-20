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

function runSettled(args, cwd, cliConfigPath, title, extraEnv = {}) {
  const { bin, prefixArgs } = resolveCli();
  const env = { ...process.env, SETTLED_CLI_CONFIG: cliConfigPath };
  delete env.SETTLED_WORKSPACE;
  delete env.CLICOLOR_FORCE;

  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  const res = spawnSync(bin, [...prefixArgs, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  if (res.error) throw res.error;

  const code = res.status ?? -1;
  const stdout = (res.stdout || "").trimEnd();
  const stderr = (res.stderr || "").trimEnd();
  console.log(`\n=== ${title} (settled ${args.join(" ")}) -> exit=${code} ===`);
  if (stdout) console.log(stdout);
  if (stderr) console.log(`[stderr]\n${stderr}`);
  return { code, stdout, stderr };
}

function testCheckAndStep(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const demoDir = path.join(sandbox, "demo");
  fs.mkdirSync(demoDir, { recursive: true });

  // 初始混合 check（第 0 步基线 pass，第 1/2 步缺失 fail）
  const rFail = runSettled(
    ["check", "ui-check-fix-workflow", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "混合 Check（1 通过 + 2 失败）",
    { SETTLED_DEMO_DIR: demoDir }
  );
  assert.equal(rFail.code, 1);
  assert.match(rFail.stdout, /PASS  ui-check-fix-workflow \(1\/3 passed\)/);
  assert.match(rFail.stdout, /FAIL  ui-check-fix-workflow/);
  assert.match(rFail.stdout, /dir:/);
  assert.match(rFail.stdout, /cmd:/);
  assert.match(rFail.stdout, /\[缺失\]/);

  // 单步 --step 0 成功折叠
  const rStep0 = runSettled(
    ["check", "ui-check-fix-workflow", "--step", "0", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "单步 --step 0 通过输出",
    { SETTLED_DEMO_DIR: demoDir }
  );
  assert.equal(rStep0.code, 0);
  assert.match(rStep0.stdout, /PASS  ui-check-fix-workflow ::/);

  // -v 显示 PASS 步骤详细输出
  const rVerbose = runSettled(
    ["check", "ui-check-fix-workflow", "--step", "0", "-v", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "-v 显示通过命令输出",
    { SETTLED_DEMO_DIR: demoDir }
  );
  assert.equal(rVerbose.code, 0);
  assert.match(rVerbose.stdout, /\[基线通过\]/);
}

function testTruncation(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const ws = path.join(sandbox, "trunc-ws");
  const itemDir = path.join(ws, "settled-items", "flood-fail");
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(
    path.join(itemDir, "meta.json"),
    JSON.stringify({
      name: "超长日志截断验证",
      scripts: {
        check:
          "node -e \"for (let i = 0; i < 140; i++) console.log('line-' + i); process.exit(1)\"",
      },
    })
  );

  const quiet = runSettled(
    ["check", "flood-fail", "-w", ws],
    sandbox,
    cfg,
    "失败超过 120 行自动截断头部"
  );
  assert.equal(quiet.code, 1);
  assert.match(quiet.stdout, /earlier line\(s\) omitted; pass -v/);
  assert.doesNotMatch(quiet.stdout, /line-0\b/);
  assert.match(quiet.stdout, /line-139/);

  const full = runSettled(
    ["check", "flood-fail", "-v", "-w", ws],
    sandbox,
    cfg,
    "-v 完整输出首尾全部行"
  );
  assert.equal(full.code, 1);
  assert.match(full.stdout, /line-0\b/);
  assert.match(full.stdout, /line-139/);
}

function testFixAndRun(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const demoDir = path.join(sandbox, "demo-fix");
  fs.mkdirSync(demoDir, { recursive: true });

  // run <item> fix --step 0 单独执行，不触发复检
  const runFix0 = runSettled(
    ["run", "ui-check-fix-workflow", "fix", "--step", "0", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "run fix --step 0（无自动复检）",
    { SETTLED_DEMO_DIR: demoDir }
  );
  assert.equal(runFix0.code, 0);
  assert.match(runFix0.stdout, /\[已修复\] alpha/);
  assert.doesNotMatch(runFix0.stdout, /== Verify ==/);

  // run <item> check 允许像普通命令一样执行 check
  const runCheck0 = runSettled(
    ["run", "ui-check-fix-workflow", "check", "--step", "0", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "run 允许直接执行 check 分组",
    { SETTLED_DEMO_DIR: demoDir }
  );
  assert.equal(runCheck0.code, 0);
  assert.match(runCheck0.stdout, /\[基线通过\]/);

  // fix 自动触发全量 check 验收
  const fixAll = runSettled(
    ["fix", "ui-check-fix-workflow", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "fix 完成后自动触发 Verify 全通过",
    { SETTLED_DEMO_DIR: demoDir }
  );
  assert.equal(fixAll.code, 0);
  assert.match(fixAll.stdout, /== Fix ==/);
  assert.match(fixAll.stdout, /== Verify ==/);
  assert.match(fixAll.stdout, /Summary: 3 passed, 0 failed, 0 canceled/);

  // always-fail 返回退出码 1
  const failCustom = runSettled(
    ["run", "ui-check-fix-workflow", "always-fail", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "run 自定义失败命令退出码 1",
    { SETTLED_DEMO_DIR: demoDir }
  );
  assert.equal(failCustom.code, 1);
  assert.match(failCustom.stdout, /\[模拟失败\]/);
}

function testErrorExitCodes(sandbox) {
  const cfg = path.join(sandbox, "cli.json");

  const stepWithoutItem = runSettled(
    ["check", "--step", "0", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "--step 未配合 item 时拒绝"
  );
  assert.equal(stepWithoutItem.code, 2);

  const outOfRange = runSettled(
    ["check", "ui-check-fix-workflow", "--step", "99", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "--step 越界报错退出码 2"
  );
  assert.equal(outOfRange.code, 2);

  const crossOsItem =
    process.platform === "darwin" ? "ui-platform-windows" : "ui-platform-macos";
  const wrongOs = runSettled(
    ["check", crossOsItem, "-w", exampleWorkspace],
    sandbox,
    cfg,
    `非当前平台条目 (${crossOsItem}) 拒绝执行`
  );
  assert.equal(wrongOs.code, 2);

  const manual = runSettled(
    ["check", "ui-empty-and-defaults", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "无脚本条目 check 返回退出码 2"
  );
  assert.equal(manual.code, 2);

  // 损坏 meta 目录在 check 时引导 settled lint
  const brokenWs = path.join(sandbox, "broken-ws");
  const brokenDir = path.join(brokenWs, "settled-items", "bad-meta");
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, "meta.json"), "{ invalid");

  const brokenCheck = runSettled(
    ["check", "bad-meta", "-w", brokenWs],
    sandbox,
    cfg,
    "损坏 meta 条目提示运行 settled lint"
  );
  assert.equal(brokenCheck.code, 2);
  assert.match(brokenCheck.stderr, /settled lint bad-meta/);
}

function testColoredExecOutput(sandbox) {
  const cfg = path.join(sandbox, "cli.json");
  const demoDir = path.join(sandbox, "demo-color");
  fs.mkdirSync(demoDir, { recursive: true });

  const coloredCheck = runSettled(
    ["check", "ui-check-fix-workflow", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "CLICOLOR_FORCE=1 彩色 check（PASS/FAIL/Summary）",
    { SETTLED_DEMO_DIR: demoDir, CLICOLOR_FORCE: "1", NO_COLOR: undefined }
  );
  assert.equal(coloredCheck.code, 1);
  assert.match(coloredCheck.stdout, /\x1b\[.*PASS/);
  assert.match(coloredCheck.stdout, /\x1b\[.*FAIL/);
  assert.match(coloredCheck.stdout, /\x1b\[.*Summary:/);

  const coloredFix = runSettled(
    ["fix", "ui-check-fix-workflow", "-w", exampleWorkspace],
    sandbox,
    cfg,
    "CLICOLOR_FORCE=1 彩色 fix（== Fix == / == Verify ==）",
    { SETTLED_DEMO_DIR: demoDir, CLICOLOR_FORCE: "1", NO_COLOR: undefined }
  );
  assert.equal(coloredFix.code, 0);
  assert.match(coloredFix.stdout, /\x1b\[.*== Fix ==/);
  assert.match(coloredFix.stdout, /\x1b\[.*== Verify ==/);
}

const mode = process.argv[2];
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "settled-cli-exec-"));
try {
  if (mode === "check-and-step") testCheckAndStep(sandbox);
  else if (mode === "truncation") testTruncation(sandbox);
  else if (mode === "fix-and-run") testFixAndRun(sandbox);
  else if (mode === "errors") testErrorExitCodes(sandbox);
  else if (mode === "color") testColoredExecOutput(sandbox);
  else {
    console.error(`未知测试子项: ${mode}`);
    process.exit(2);
  }
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
