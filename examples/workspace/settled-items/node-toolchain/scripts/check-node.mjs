const major = Number(process.versions.node.split(".")[0]);
console.log(`检测到 Node.js ${process.version} (${process.platform}/${process.arch})`);
console.log(`当前工作目录 (cwd): ${process.cwd()}`);

if (Number.isNaN(major) || major < 20) {
  console.error(`需要 Node.js >= 20，当前版本为 ${process.version}`);
  process.exit(1);
}
