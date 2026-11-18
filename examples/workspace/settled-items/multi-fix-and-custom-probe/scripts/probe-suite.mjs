import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKERS = {
  alpha: path.join(os.tmpdir(), "settled-multi-probe-alpha.flag"),
  beta: path.join(os.tmpdir(), "settled-multi-probe-beta.flag"),
  gamma: path.join(os.tmpdir(), "settled-multi-probe-gamma.flag"),
};

function parseDelayMs(args) {
  const flag = args.find((arg) => arg.startsWith("--delay="));
  if (!flag) {
    return 0;
  }
  const value = Number(flag.slice("--delay=".length));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
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
    console.log(`Waiting ${delayMs}ms (${action}: ${targets.join(", ")})...`);
    await sleep(delayMs);
  }

  if (action === "check") {
    let missing = false;
    for (const key of targets) {
      const file = MARKERS[key];
      if (!file) {
        console.error(`Unknown marker target: ${key}`);
        process.exit(2);
      }
      if (fs.existsSync(file)) {
        console.log(`[ok] ${key}: ${file}`);
      } else {
        console.error(`[missing] ${key}: ${file}`);
        missing = true;
      }
    }
    process.exit(missing ? 1 : 0);
  }

  if (action === "fix") {
    for (const key of targets) {
      const file = MARKERS[key];
      if (!file) {
        console.error(`Unknown marker target: ${key}`);
        process.exit(2);
      }
      fs.writeFileSync(file, `fixed_at=${new Date().toISOString()}\n`, "utf8");
      console.log(`[fixed] ${key}: ${file}`);
    }
    process.exit(0);
  }

  if (action === "reset") {
    for (const key of targets) {
      const file = MARKERS[key];
      if (!file) {
        console.error(`Unknown marker target: ${key}`);
        process.exit(2);
      }
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[removed] ${key}: ${file}`);
      } else {
        console.log(`[absent] ${key}: already clean`);
      }
    }
    process.exit(0);
  }

  if (action === "inspect") {
    console.log(`tempDir=${os.tmpdir()}`);
    for (const [key, file] of Object.entries(MARKERS)) {
      const exists = fs.existsSync(file);
      const detail = exists ? fs.readFileSync(file, "utf8").trim() : "missing";
      console.log(`${key}: ${exists ? "present" : "missing"} (${detail})`);
    }
    process.exit(0);
  }

  if (action === "dump-runtime") {
    console.log(`node=${process.version} platform=${process.platform} arch=${process.arch}`);
    console.log(`cwd=${process.cwd()}`);
    process.exit(0);
  }

  if (action === "fail-sample") {
    console.log("Running custom diagnostic task...");
    console.error("Simulated warning/failure stderr line for UI log inspection.");
    process.exit(1);
  }

  console.error(`Unknown action: ${action}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
