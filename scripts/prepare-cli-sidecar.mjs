import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  let release = false;
  let target = process.env.TAURI_ENV_TARGET_TRIPLE || "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--release") {
      release = true;
    } else if (arg === "--target" && i + 1 < argv.length) {
      target = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
    }
  }

  return { release, target: target.trim() };
}

function detectHostTriple() {
  const out = execFileSync("rustc", ["-vV"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const hostLine = out
    .split(/\r?\n/)
    .find((line) => line.startsWith("host:"));
  if (!hostLine) {
    throw new Error("Unable to determine Rust host target triple from `rustc -vV`.");
  }
  return hostLine.slice("host:".length).trim();
}

function main() {
  const { release, target: explicitTarget } = parseArgs(process.argv.slice(2));
  const hostTriple = detectHostTriple();
  const triple = explicitTarget || hostTriple;
  const crossCompiling = Boolean(explicitTarget && explicitTarget !== hostTriple);

  const cargoArgs = ["build", "-p", "settled-cli"];
  if (release) {
    cargoArgs.push("--release");
  }
  if (crossCompiling) {
    cargoArgs.push("--target", triple);
  }

  console.log(
    `[prepare-cli-sidecar] Building settled-cli (${release ? "release" : "debug"}, target=${triple})...`
  );
  const build = spawnSync("cargo", cargoArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (build.error) {
    throw build.error;
  }
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const isWindowsTarget = triple.includes("windows");
  const exeSuffix = isWindowsTarget ? ".exe" : "";
  const profileDir = release ? "release" : "debug";
  const builtBinary = crossCompiling
    ? path.join(repoRoot, "target", triple, profileDir, `settled${exeSuffix}`)
    : path.join(repoRoot, "target", profileDir, `settled${exeSuffix}`);

  if (!fs.existsSync(builtBinary)) {
    throw new Error(`Expected built CLI binary at '${builtBinary}', but it was not found.`);
  }

  const binariesDir = path.join(repoRoot, "src-tauri", "binaries");
  fs.mkdirSync(binariesDir, { recursive: true });
  const sidecarDest = path.join(binariesDir, `settled-${triple}${exeSuffix}`);

  fs.copyFileSync(builtBinary, sidecarDest);
  if (!isWindowsTarget) {
    fs.chmodSync(sidecarDest, 0o755);
  }

  console.log(`[prepare-cli-sidecar] Staged bundled CLI -> ${path.relative(repoRoot, sidecarDest)}`);
}

main();
