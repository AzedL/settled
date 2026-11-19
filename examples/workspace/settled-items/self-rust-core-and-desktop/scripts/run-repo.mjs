import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "../../../..");
const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  console.error("缺少要执行的仓库命令");
  process.exit(2);
}

const isWin = process.platform === "win32";
const result = spawnSync(cmd, args, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: isWin,
});

if (result.error) {
  console.error(`执行失败 (${cmd}): ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
