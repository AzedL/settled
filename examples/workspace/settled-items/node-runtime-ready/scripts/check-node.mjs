const major = Number(process.versions.node.split(".")[0]);
console.log(`Detected Node.js ${process.version} on ${process.platform} (${process.arch})`);
console.log(`Working directory (cwd): ${process.cwd()}`);

if (Number.isNaN(major) || major < 20) {
  console.error(`Expected Node.js >= 20, got ${process.version}`);
  process.exit(1);
}
