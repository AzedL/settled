import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const flagPath = path.join(os.tmpdir(), "settled-demo-verified.flag");
const action = process.argv[2] ?? "check";

if (action === "check") {
  if (fs.existsSync(flagPath)) {
    console.log(`Marker file present: ${flagPath}`);
    process.exit(0);
  }
  console.error(`Marker file missing: ${flagPath}`);
  console.error("Run the 'fix' script to create it and watch Settled re-verify automatically.");
  process.exit(1);
}

if (action === "fix") {
  fs.writeFileSync(flagPath, `verified_at=${new Date().toISOString()}\n`, "utf8");
  console.log(`Created marker file: ${flagPath}`);
  process.exit(0);
}

if (action === "reset") {
  if (fs.existsSync(flagPath)) {
    fs.unlinkSync(flagPath);
    console.log(`Removed marker file: ${flagPath}`);
  } else {
    console.log("Marker file was already absent.");
  }
  process.exit(0);
}

console.error(`Unknown action: ${action}`);
process.exit(2);
