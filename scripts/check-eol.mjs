// @ts-check

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const bad = [];
for (const file of files) {
  let buf;
  try { buf = readFileSync(file); } catch { continue; }
  if (buf.subarray(0, 8000).includes(0)) continue; // 二进制
  if (buf.length === 0 || buf[buf.length - 1] !== 0x0a) bad.push(file);
}
for (const file of bad) console.log(`${file}: 缺文件末尾换行`);
if (bad.length > 0) { console.log(`\n${bad.length} 个文件缺文件末尾换行`); process.exit(1); }
console.log("所有已跟踪文本文件均以换行结尾");
