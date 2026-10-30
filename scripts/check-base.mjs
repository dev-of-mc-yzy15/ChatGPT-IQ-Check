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
// 引号形态三种都认：vite 对源 HTML 里的属性引号是**原样保留**的，产物里同时可能存在
// 双引号、单引号、无引号三种写法。只认双引号的话，`href='/assets/x.css'` 会静默过闸门。
// srcset 是多值（逗号分隔的候选串），逐个候选都要看，只看第一段会漏掉逗号后面的。
// 内联 style 的 url(/…) 同样会去域名根，一并判。
//
// 已知未覆盖（本版有意不贪）：dist/assets/*.css 里经 vite 处理后的 url(/…)。
// 找不到 dist/index.html 一律红，不允许静默通过（否则 CI 忘跑 build 就成了空闸门）。

import { readFile } from "node:fs/promises";

/** 部署子路径，必须与 vite.config.ts 的 base 保持一致；那里改了这里要同步。 */
const BASE = "/ChatGPT-IQ-Check/";
/** `BASE` 去掉前导斜杠，供正则的负向先行断言内联（正则会吃掉那个 `/`）。 */
const BASE_BARE = BASE.slice(1);
const TARGET = "dist/index.html";

/**
 * 单值属性与 srcset 的首个候选。
 * `\/(?!\/)` 放行协议相对 //host；负向先行断言放行已带 base 前缀的引用。
 * 值字符类停在引号/空白/`>`，无引号属性才能正确收尾。
 */
const ATTR_PATTERN = new RegExp(
  String.raw`(?:src|href|srcset|poster)\s*=\s*(["']?)\/(?!\/)(?!${BASE_BARE})[^"'\s>]*`,
  "g",
);

/** srcset 的整段值（到引号或 `>` 为止），用来逐个检查逗号分隔的候选。 */
const SRCSET_PATTERN = /srcset\s*=\s*(["']?)([^"'>]*)/g;

/** 内联 style 的 url(/…)；判据与属性一致，`\s*` 容忍 url( 与斜杠之间的空白。 */
const URL_PATTERN = new RegExp(String.raw`url\(\s*\/(?!\/)(?!${BASE_BARE})`, "g");

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
 * srcset 里从第二个候选起逐个判：只有首段由 ATTR_PATTERN 负责，这里不重复报。
 * 首段带 base 时 ATTR_PATTERN 整条匹配不上，得靠这里兜住逗号后的候选——
 * 那正是「只看第一个候选」会漏掉的那一半。
 * @param {string} line
 * @param {(index: number) => void} onHit
 * @returns {void}
 */
function findSrcsetViolations(line, onHit) {
  SRCSET_PATTERN.lastIndex = 0;
  /** @type {RegExpExecArray | null} */
  let m = SRCSET_PATTERN.exec(line);
  while (m !== null) {
    const value = m[2] ?? "";
    const valueStart = m.index + m[0].length - value.length;
    let offset = 0;
    const parts = value.split(",");
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] ?? "";
      const token = part.trim().split(/\s+/)[0] ?? "";
      const at = valueStart + offset + (part.length - part.trimStart().length);
      offset += part.length + 1;
      if (i === 0) continue;
      if (!token.startsWith("/") || token.startsWith("//") || token.startsWith(BASE)) continue;
      onHit(at);
    }
    m = SRCSET_PATTERN.exec(line);
  }
}

/**
 * 逐行收集命中位置，行内按列升序返回。同一条 srcset 可能由属性与候选两路各自命中，
 * 位置不同、都要保留。
 * @param {string} html
 * @returns {{ line: number, column: number, snippet: string }[]}
 */
function findViolations(html) {
  /** @type {{ line: number, column: number, snippet: string }[]} */
  const hits = [];
  const lines = html.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    /** @type {number[]} */
    const indexes = [];
    for (const pattern of [ATTR_PATTERN, URL_PATTERN]) {
      pattern.lastIndex = 0;
      /** @type {RegExpExecArray | null} */
      let m = pattern.exec(line);
      while (m !== null) {
        indexes.push(m.index);
        m = pattern.exec(line);
      }
    }
    findSrcsetViolations(line, (index) => indexes.push(index));
    indexes.sort((a, b) => a - b);
    let previous = -1;
    for (const index of indexes) {
      if (index === previous) continue;
      previous = index;
      const start = Math.max(0, index - PAD);
      const end = Math.min(line.length, index + PAD);
      hits.push({ line: i + 1, column: index + 1, snippet: squeeze(line.slice(start, end)) });
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
