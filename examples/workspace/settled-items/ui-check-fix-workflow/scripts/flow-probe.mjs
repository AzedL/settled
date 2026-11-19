import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const baseDir = process.env.SETTLED_DEMO_DIR || os.tmpdir();
const MARKERS = {
  alpha: path.join(baseDir, "settled-ui-alpha.flag"),
  beta: path.join(baseDir, "settled-ui-beta.flag"),
};

function parseDelayMs(args) {
  const flag = args.find((arg) => arg.startsWith("--delay="));
  if (!flag) return 0;
  const value = Number(flag.slice("--delay=".length));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sleep(ms) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function resolveTargets(args) {
  const names = args.filter((arg) => !arg.startsWith("--"));
  return names.length > 0 ? names : Object.keys(MARKERS);
}

async function main() {
  const [, , action = "check", ...rest] = process.argv;
  const delayMs = parseDelayMs(rest);
  const targets = resolveTargets(rest);

  if (delayMs > 0) {
    console.log(`等待 ${delayMs}ms (${action}: ${targets.join(", ")})...`);
    await sleep(delayMs);
  }

  if (action === "pass") {
    console.log(`[基线通过] 工作目录 ${process.cwd()} 状态正常`);
    process.exit(0);
  }

  if (action === "check") {
    let missing = false;
    for (const key of targets) {
      const file = MARKERS[key];
      if (!file) {
        console.error(`未知标记: ${key}`);
        process.exit(2);
      }
      if (fs.existsSync(file)) {
        console.log(`[通过] ${key}: ${file}`);
      } else {
        console.error(`[缺失] ${key}: ${file}`);
        missing = true;
      }
    }
    process.exit(missing ? 1 : 0);
  }

  if (action === "fix") {
    fs.mkdirSync(baseDir, { recursive: true });
    for (const key of targets) {
      const file = MARKERS[key];
      if (!file) {
        console.error(`未知标记: ${key}`);
        process.exit(2);
      }
      fs.writeFileSync(file, `fixed_at=${new Date().toISOString()}\n`, "utf8");
      console.log(`[已修复] ${key}: ${file}`);
    }
    process.exit(0);
  }

  if (action === "reset") {
    for (const key of targets) {
      const file = MARKERS[key];
      if (!file) {
        console.error(`未知标记: ${key}`);
        process.exit(2);
      }
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[已清理] ${key}: ${file}`);
      } else {
        console.log(`[已不存在] ${key}`);
      }
    }
    process.exit(0);
  }

  if (action === "inspect") {
    console.log(`baseDir=${baseDir}`);
    for (const [key, file] of Object.entries(MARKERS)) {
      const exists = fs.existsSync(file);
      const detail = exists ? fs.readFileSync(file, "utf8").trim() : "missing";
      console.log(`${key}: ${exists ? "present" : "missing"} (${detail})`);
    }
    process.exit(0);
  }

  if (action === "env") {
    console.log(`node=${process.version} platform=${process.platform} arch=${process.arch}`);
    console.log(`cwd=${process.cwd()}`);
    process.exit(0);
  }

  if (action === "fail-sample") {
    console.error("[模拟失败] 第 1 行错误：环境依赖缺失");
    console.error("[模拟失败] 第 2 行提示：请检查 PATH 或手动配置");
    process.exit(1);
  }

  console.error(`未知操作: ${action}`);
  process.exit(2);
}

await main();
