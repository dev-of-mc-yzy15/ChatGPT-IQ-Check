// @ts-check
// 资产闸门：public/data/round.json 里每条 animation 声明的 asset_sha256，
// 都必须和 public/assets/<basename> 的真实内容对得上。
//
// README 有「已逐个比对上游 asset_sha256 后落在 public/assets/」这句话，但此前
// 没有任何可复跑的东西能证明它：资产被改、被删、上游换了内容、新条目漏钉哈希，
// 本地单测和 vite build 全绿，线上 iframe 才 404 或渲染出别的东西。这个脚本把
// 那条一次性的手工操作固化成机器闸门。
//
// 五类判据：
//   ok        —— 文件在，哈希一致（大小写不敏感）
//   missing   —— 文件不在
//   mismatch  —— 哈希不符，期望值与实际值都打出来
//   unpinned  —— 数据里有 asset_url 但没钉 asset_sha256（等于没校验）
//   orphan    —— assets/ 里存在但数据没引用（只报不判失败）
//
// 已知刻意不管（本版不贪）：资产的内容语义（是不是合法 HTML、上游是否还在线），
// assets/ 子目录里文件的归属。子目录不进 orphan 统计。
//
// 任何一条 missing / mismatch / unpinned 都红，不允许静默通过。

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 默认仓库根：脚本在 scripts/ 下，上两级就是仓库根。CI 与本地都不传 --root。 */
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 反斜杠用字符码构造，避开各层转义差异（与本仓库 assetUrl 同一做法）。 */
const BACKSLASH = String.fromCharCode(92);

/**
 * @typedef {{ name: string, expected: string }} Pin
 * @typedef {{ file: string, expected: string, actual: string }} Mismatch
 * @typedef {{ root: string, json: boolean }} Options
 * @typedef {{
 *   ok: string[],
 *   missing: string[],
 *   mismatch: Mismatch[],
 *   unpinned: string[],
 *   orphan: string[],
 * }} Report
 */

/**
 * 解析 --root <dir> 与 --json。
 * 未知参数直接红：拼错的开关静默被忽略，闸门就等于没开。
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  let root = DEFAULT_ROOT;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--root 缺少目录参数");
      }
      root = resolve(value);
      i += 1;
    } else {
      throw new Error("未知参数：" + arg);
    }
  }
  return { root, json };
}

/** 上游产物的扩展名；本地落盘时去掉那个 `.txt`，托管才会按 `text/html` 回。 */
const UPSTREAM_SUFFIX = ".html.txt";
const LOCAL_SUFFIX = ".html";

/**
 * 上游 basename → 本地 `public/assets/` 里的真实文件名。
 *
 * `src/lib/asset.ts` 的 `localAssetName` 是同规则副本（那条走 TS 构建，这条跑在 node 下
 * 无法直接 import），改一处必须同步改另一处，两侧各有测试钉住。
 * @param {string} name
 * @returns {string}
 */
function localAssetName(name) {
  return name.endsWith(UPSTREAM_SUFFIX) ? name.slice(0, -UPSTREAM_SUFFIX.length) + LOCAL_SUFFIX : name;
}

/**
 * 上游 `asset_url` 是站点根绝对路径（`/assets/x.html.txt`），也可能是完整 URL、
 * 带 query/fragment 的串。取 basename、映射成本地文件名，再拼到本项目自己的 assets/ 下。
 *
 * 映射是必须的：`round.json` 是上游快照，里面记的永远是上游的 `.html.txt`；
 * 本地按 `.html` 落盘才能让托管回 `text/html`、iframe 才敢用 `src`（见 lib/asset.ts）。
 * 少了这一步，闸门会拿上游名字去比本地文件，34 条全部 missing。
 * @param {unknown} url
 * @returns {string | null}
 */
function assetName(url) {
  if (typeof url !== "string") return null;
  const path = url.split(/[?#]/)[0] ?? "";
  const name = path.split(BACKSLASH).join("/").split("/").filter(Boolean).pop();
  return name === undefined ? null : localAssetName(name);
}

/**
 * 从 round.json 收集所有「数据声明的资产」。
 *
 * 候选下的动画字段两种形态都认：`animation`（单数对象，当前落盘结构）与
 * `animations`（数组，schema 演进后可能出现）。只认一种的话，上游一改形状
 * 整条闸门就变成空跑。
 *
 * 同一 basename 被多条引用时保留全部 pin：内容只可能有一个答案，但重复声明
 * 本身说明数据可疑，逐条打印比去重更好定位。
 * @param {unknown} data
 * @returns {Pin[]}
 */
function collectPins(data) {
  /** @type {Pin[]} */
  const pins = [];
  const root = /** @type {any} */ (data);
  const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    /** @type {any[]} */
    const slots = [];
    if (candidate.animation && typeof candidate.animation === "object") {
      slots.push(candidate.animation);
    }
    if (Array.isArray(candidate.animations)) slots.push(...candidate.animations);
    for (const slot of slots) {
      if (!slot || typeof slot !== "object") continue;
      const name = assetName(slot.asset_url);
      if (name === null) continue;
      const expected = typeof slot.asset_sha256 === "string" ? slot.asset_sha256 : "";
      pins.push({ name, expected });
    }
  }
  return pins;
}

/**
 * 文件内容的 sha256（小写十六进制）。
 * @param {string} path
 * @returns {Promise<string>}
 */
async function fileHash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/**
 * assets/ 下的普通文件名。子目录不计入 orphan，否则将来按类别分目录会一次报一片。
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listAssetFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

/**
 * 逐条判定。
 * @param {string} root
 * @param {Pin[]} pins
 * @returns {Promise<Report>}
 */
async function classify(root, pins) {
  /** @type {Report} */
  const report = { ok: [], missing: [], mismatch: [], unpinned: [], orphan: [] };
  for (const pin of pins) {
    const file = "public/assets/" + pin.name;
    const target = join(root, "public", "assets", pin.name);
    /** @type {string} */
    let actual;
    try {
      actual = await fileHash(target);
    } catch (error) {
      // 读失败（含不存在）一律算 missing 并留错误码：区分 ENOENT 与 EACCES 对
      // 修问题有帮助，但两者都是「拿不到内容」，不该再拆一类。
      const code = /** @type {NodeJS.ErrnoException} */ (error).code ?? "unknown";
      report.missing.push(file + "（" + code + "）");
      continue;
    }
    // sha256 没有大小写语义，逐字节比会在上游换个大小写时误红。
    if (pin.expected.trim() === "") {
      report.unpinned.push(file);
    } else if (pin.expected.toLowerCase() === actual) {
      report.ok.push(file);
    } else {
      report.mismatch.push({ file, expected: pin.expected.toLowerCase(), actual });
    }
  }
  return report;
}

/**
 * 反查数据没引用的多余文件。目录整体缺失时已单独红过，这里静默跳过。
 * @param {string} root
 * @param {Report} report
 * @param {Pin[]} pins
 * @returns {Promise<void>}
 */
async function findOrphans(root, report, pins) {
  const dir = join(root, "public", "assets");
  const info = await stat(dir).catch(() => null);
  if (info === null || !info.isDirectory()) return;
  const referenced = new Set(pins.map((pin) => pin.name));
  const files = await listAssetFiles(dir);
  for (const name of files) {
    if (!referenced.has(name)) report.orphan.push("public/assets/" + name);
  }
}

/**
 * @param {Report} report
 * @returns {void}
 */
function printReport(report) {
  for (const file of report.ok) console.log("ok        " + file);
  for (const item of report.mismatch) {
    console.log("mismatch  " + item.file + "  期望 " + item.expected + " 实际 " + item.actual);
  }
  for (const file of report.missing) console.log("missing   " + file);
  for (const file of report.unpinned) console.log("unpinned  " + file + "（数据缺 asset_sha256）");
  for (const file of report.orphan) console.log("orphan    " + file + "（数据未引用，不判失败）");
}

/**
 * --json 走纯 JSON 到 stdout，便于测试与外部消费；人看的汇总另走一路。
 * @param {Report} report
 * @param {boolean} json
 * @returns {void}
 */
function emit(report, json) {
  const counts = {
    ok: report.ok.length,
    missing: report.missing.length,
    mismatch: report.mismatch.length,
    unpinned: report.unpinned.length,
    orphan: report.orphan.length,
  };
  if (json) {
    console.log(JSON.stringify({ counts, ...report }, null, 2));
    return;
  }
  printReport(report);
  console.log(
    "ok=" +
      counts.ok +
      " missing=" +
      counts.missing +
      " mismatch=" +
      counts.mismatch +
      " unpinned=" +
      counts.unpinned +
      " orphan=" +
      counts.orphan,
  );
  if (counts.missing + counts.mismatch + counts.unpinned > 0) {
    console.log("资产与 round.json 声明的哈希不一致；改过资产要重算并更新 asset_sha256");
  }
}

async function main() {
  /** @type {Options} */
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(/** @type {Error} */ (error).message));
    process.exitCode = 2;
    return;
  }

  const dir = join(options.root, "public", "assets");
  const dirInfo = await stat(dir).catch(() => null);
  if (dirInfo === null || !dirInfo.isDirectory()) {
    // 空目录会让所有资产都变 missing，看起来像坏数据；直接点名更好定位。
    console.error(dir + ": assets 目录不存在，先按 README 下载资产的步骤补齐");
    process.exitCode = 1;
    return;
  }

  const dataPath = join(options.root, "public", "data", "round.json");
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(await readFile(dataPath, "utf8"));
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code ?? "unknown";
    console.error(dataPath + ": round.json 读不到或不是合法 JSON（" + code + "）");
    process.exitCode = 1;
    return;
  }

  const pins = collectPins(data);
  // 一条 asset_url 都没声明时，下面会输出一排 0 并退出 0——闸门空跑比报错更难发现，
  // 所以这里单独红一次。
  if (pins.length === 0) {
    console.error(dataPath + ": round.json 里没有声明任何 asset_url，闸门等于空跑");
    process.exitCode = 1;
    return;
  }

  const report = await classify(options.root, pins);
  await findOrphans(options.root, report, pins);
  emit(report, options.json);
  if (report.missing.length + report.mismatch.length + report.unpinned.length > 0) {
    process.exitCode = 1;
  }
}

await main();
