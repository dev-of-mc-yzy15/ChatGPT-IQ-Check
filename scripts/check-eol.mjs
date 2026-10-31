// @ts-check
// EOL 闸门：每一个已跟踪的文本文件都必须以换行结尾。
//
// `.editorconfig:6` 早就写着 `insert_final_newline = true`，但仓库既没有 prettier 也没有
// eslint，这条约定此前全靠自觉。于是 refresh.mjs 被 ec60fe3 改成以 `}` 收尾、末尾换行
// 没了，diff 里挂着 `\ No newline at end of file`——CI 全程绿灯，因为根本没有任何东西
// 在读这件事。这个脚本把那条纸面约定固化成机器闸门。
//
// 只看「已跟踪」的文件（git ls-files），不扫工作区里没进版本控制的产物：dist/、
// node_modules/ 不在其中，也就不会被噪音淹掉。
//
// 二进制取下限判定：文件内容前 8000 字节里出现 NUL 就跳过。LICENSE / NOTICE 这类纯文本
// 虽然不带扩展名，但不含 NUL，照样要过闸门，不按扩展名放行。
//
// 已知刻意不管（本版不贪）：行尾是 LF 还是 CRLF（.gitattributes 的 eol=lf 管着）、
// 文件里有没有连续空行。这里只判一件事——最后一字节是不是 LF。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** 二进制嗅探窗口。够覆盖各类魔数区，又不至于把大文件整个读进来只为判型。 */
const SNIFF = 8000;
/** LF。 */
const LF = 0x0a;
/** NUL，二进制判据。 */
const NUL = 0x00;

/**
 * 取全部已跟踪文件。
 * `-z` 用 NUL 分隔，路径含空格也不会被拆开。
 * stderr 一律透传：git 自己出错（不在仓库里、git 不在 PATH）要能看见，而不是被吞成
 * 一张空清单——空清单会让下面的循环一次都不跑，脚本照样打出「均以换行结尾」过闸。
 * 那正是空闸门，必须留 stderr。
 * @returns {string[]}
 */
function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return out.split("\0").filter((path) => path !== "");
}

/**
 * 判一份文件末尾是否缺换行。返回 null 表示合格或是二进制、不用管。
 * 读不到（已跟踪但工作区被删）也算违规：文件没了闸门就无从判断，静默跳过等于漏一格。
 * @param {string} path
 * @returns {string | null}
 */
function checkFile(path) {
  /** @type {Buffer} */
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    return `${path}: 读取失败（${code ?? "unknown"}）`;
  }
  if (bytes.subarray(0, SNIFF).includes(NUL)) return null;
  if (bytes.length > 0 && bytes[bytes.length - 1] === LF) return null;
  return `${path}: 缺文件末尾换行`;
}

function main() {
  const files = listTrackedFiles();
  /** @type {string[]} */
  const violations = [];
  for (const path of files) {
    const violation = checkFile(path);
    if (violation !== null) violations.push(violation);
  }

  if (violations.length === 0) {
    console.log("所有已跟踪文本文件均以换行结尾");
    return;
  }

  // 逐行 console.error 在 stderr 接管道、整包并发负载下会丢首条违规行（退出码仍是 1，
  // 只是点名消失，测试与 CI 日志都跟着瞎）。合并成单次写入，只走一次 flush。
  console.error(
    `${violations.join("\n")}\n${violations.length} 个已跟踪文件末尾缺换行，补一个 \\n 再提交`,
  );
  process.exitCode = 1;
}

main();
