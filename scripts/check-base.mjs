// @ts-check
// 构建产物闸门：dist/index.html 里不许出现回退到根绝对路径的引用。
//
// 站点部署在 GitHub Pages 子路径 /ChatGPT-IQ-Check/ 下（见 vite.config.ts 的 base）。
// 一旦有人手写 src="/assets/x.js"，本地 vite dev 与全部单测照样全绿，线上却整页白屏——
// 因为浏览器会去域名根找 /assets/x.js。这个脚本把那条人工防线固化成机器闸门。
//
// 内部引用必须带 base 前缀。放行：data: URI（内联 favicon）、https:// 之类绝对外链、
// //host 协议相对外链。
//
// 已知未覆盖（本版有意不贪）：
//   - dist/assets/*.css 内的 url(/…)
//   - srcset 里未带引号的候选串
// 找不到 dist/index.html 一律红，不允许静默通过（否则 CI 忘跑 build 就成了空闸门）。

import { readFile } from "node:fs/promises";

/** 部署子路径，必须与 vite.config.ts 的 base 保持一致；那里改了这里要同步。 */
const BASE = "/ChatGPT-IQ-Check/";
const TARGET = "dist/index.html";

/**
 * 抓 (src|href)="/x"，也抓单独的 (src|href)="/"。
 * [^/] 天然排除协议相对 //host/x，负向先行断言排除已带 base 前缀的引用。
 */
const PATTERN = new RegExp(String.raw`(?:src|href)\s*=\s*"(\/(?!${BASE.slice(1)})[^"\s]*)?"`, "g");
/** 片段上下文宽度：够判断引到哪、又不至于刷屏。 */
const PAD = 40;

/**
 * 把一段原始上下文压成单行，避免打印时跨行断开。
 * @param {string} text
 * @returns {string}
 */
function squeeze(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} html
 * @returns {{ line: number, column: number, snippet: string }[]}
 */
function findViolations(html) {
  /** @type {{ line: number, column: number, snippet: string }[]} */
  const hits = [];
  const lines = html.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    PATTERN.lastIndex = 0;
    /** @type {RegExpExecArray | null} */
    let m = PATTERN.exec(line);
    while (m !== null) {
      const start = Math.max(0, m.index - PAD);
      const end = Math.min(line.length, m.index + m[0].length + PAD);
      hits.push({ line: i + 1, column: m.index + 1, snippet: squeeze(line.slice(start, end)) });
      m = PATTERN.exec(line);
    }
  }
  return hits;
}

async function main() {
  /** @type {string} */
  let html;
  try {
    html = await readFile(TARGET, "utf8");
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === "ENOENT") {
      console.error(`${TARGET}: 不存在，先跑 npm run build 再校验`);
    } else {
      console.error(`${TARGET}: 读取失败（${code ?? "unknown"}）`);
    }
    process.exitCode = 1;
    return;
  }

  const hits = findViolations(html);
  if (hits.length === 0) {
    console.log(`${TARGET}: 无根绝对路径引用`);
    return;
  }

  for (const hit of hits) {
    console.error(`${TARGET}: 第 ${hit.line} 行第 ${hit.column} 列 <- ${hit.snippet}`);
  }
  console.error(
    `${TARGET}: ${hits.length} 处根绝对路径引用，子路径部署会 404 白屏；改成 ${BASE}… 前缀`,
  );
  process.exitCode = 1;
}

await main();
