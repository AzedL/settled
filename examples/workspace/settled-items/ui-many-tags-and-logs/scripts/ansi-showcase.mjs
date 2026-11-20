// 覆盖前端终端日志解析器的全部视觉与边界特性：
// 1. Vitest 风格徽章 + 基础/高亮 16 色与修饰样式
// 2. 256 色与 24-bit TrueColor RGB
// 3. 跨行 SGR 延续 + stdout/stderr 双流状态互不串染
// 4. 非显示控制码过滤（光标移动、清行、OSC 超链接）+ \r 覆盖保留当前样式

console.log(
  "\x1b[1m\x1b[30m\x1b[46m RUN \x1b[49m\x1b[39m\x1b[22m " +
    "\x1b[32m✓\x1b[39m Vitest 风格彩色徽章 \x1b[2m(4ms)\x1b[22m " +
    "\x1b[90mD:/project1/settled\x1b[39m"
);

console.log(
  [
    "\x1b[1m粗体\x1b[22m",
    "\x1b[2m暗淡\x1b[22m",
    "\x1b[3m斜体\x1b[23m",
    "\x1b[4m下划线\x1b[24m",
    "\x1b[9m删除线\x1b[29m",
    "\x1b[7m 反色高亮 \x1b[27m",
  ].join("  ")
);

console.log(
  [
    "\x1b[31m红(31)\x1b[0m",
    "\x1b[32m绿(32)\x1b[0m",
    "\x1b[33m黄(33)\x1b[0m",
    "\x1b[34m蓝(34)\x1b[0m",
    "\x1b[35m紫(35)\x1b[0m",
    "\x1b[36m青(36)\x1b[0m",
    "\x1b[38;5;208m256色橙\x1b[0m",
    "\x1b[38;2;32;180;134mTrueColor翡翠绿\x1b[0m",
  ].join(" ")
);

// 跨行 SGR 延续 + stdout / stderr 流隔离验证
console.log("\x1b[36m[跨行 stdout 第1行：开启青色且未 reset]");
console.error("  [插入 stderr 行：应保持默认红色且不被 stdout 的青色污染]");
console.log("[跨行 stdout 第2行：自动延续青色并在此结束]\x1b[0m");

// 无关控制码（隐藏光标、清行、OSC 超链接）与 \r 进度覆盖（保留颜色）
console.log(
  "\x1b[?25l\x1b[2K\x1b[1A" +
    "\x1b]8;;https://github.com/AzedL/settled\x07OSC超链接文本(已去掉转义壳)\x1b]8;;\x07" +
    "\x1b[?25h"
);
console.log("\x1b[32m下载进度 10%\r下载进度 100% (\\r 覆盖旧文字但保留绿色)\x1b[0m");
