import { readFile, open, rename, mkdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  transformBinding,
  transformSummary,
  transformRound,
  transformRatings,
  transformFourTask,
  transformRoundProgress,
  mergeRadarBench,
  validateRadarBench,
  validateRound,
  validateRatings,
  parseHomeOverview,
  buildRadarBenchFromOverview,
} from "./lib.mjs";
import {
  assertFourTaskShape,
  assertRadarBenchShape,
  assertRoundShape,
  candidateKey,
} from "./contract.mjs";

export const BINDING_URL = "https://codexradar.com/data/radar-bench-binding.json";
export const SUMMARY_URL = "https://codexradar.com/api/radar-bench-score";
export const ROUND_URL = "https://codexradar.com/degradation-codex-latest.json";
/** 活动评测执行进度；只展示运行态，不拿它冒充已完成的降智轮次。 */
export const ROUND_PROGRESS_URL = "https://codexradar.com/api/iq-progress/current";
/** 兜底源：站点首页内嵌的 home-overview-data（结构化端点挂掉时用它取当前轮分数）。 */
export const SITE_URL = "https://codexradar.com/";
/**
 * 概览抓取自己那点配额：它是 best-effort 的第二源，绝不许拖住主流程。
 * 上限必须自成一个很小的常数，而不是借主 deadline —— 首页挂住 20s 时，
 * 主路径（binding + 34 个 summary + round）的预算会凭空少掉 20s。
 */
export const OVERVIEW_TIMEOUT_MS = 8000;
/** 概览最多试两次：一次 5xx/网络抖动就丢掉整条兜底路太脆，再多就又变成拖累。 */
const OVERVIEW_TRIES = 2;
/** 社区体感：1–10 星人工打分，24h 滚动窗口。P1 可选源，抓不到不影响主流程。 */
export const RATINGS_URL = "https://codexradar.com/api/model-ratings?view=public&window=24h";
/**
 * 四题协议（codex-four-weighted-150-v2）取代了 10 月底之前的 10/64 题口径。
 * 这两个是静态文件，不在挂掉的那批 /api/* 里——旧接口 410/502 时它们照常 200。
 */
export const TRENDS_URL = "https://codexradar.com/data/intelligence-trends.json";
export const FOUR_TASK_URL = "https://codexradar.com/data/codex-four-task-results.json";
function defaultDataDir() {
  try {
    return fileURLToPath(new URL("../public/data/", import.meta.url));
  } catch {
    // Vitest serves modules over http://, so import.meta.url is not a file URL.
    return join(process.cwd(), "public", "data");
  }
}
const DATA_DIR = defaultDataDir();

class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} url
   */
  constructor(status, url, detail = "") {
    super(`HTTP ${status} for ${url}${detail ? ` (${detail})` : ""}`);
    this.status = status;
  }
}

/** 命令行用法错误：单独分类，好让 main 用不同的退出码收尾。 */
class UsageError extends Error {}

/**
 * CLI 参数。只认 --force。
 *
 * 以前用 new Set(process.argv.slice(2)) 收集、未知参数静默忽略：`--forse` 会按非 force
 * 跑，contentEqual 命中时连 checked_at 都不重写，用户以为强制刷新过了。未知参数一律直接红，
 * 与 verify-assets.mjs 的做法一致。
 * @param {string[]} argv
 * @returns {{force: boolean}}
 */
export function parseArgs(argv) {
  /** @type {{force: boolean}} */
  const options = { force: false };
  for (const arg of argv) {
    if (arg === "--force") options.force = true;
    else throw new UsageError(`未知参数：${arg}`);
  }
  return options;
}

/**
 * @param {string} url
 * @param {{tries?: number, timeoutMs?: number, headers?: Record<string, string>, deadline?: number}} [options]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<any>}
 */
export async function fetchJson(
  url,
  { tries = 3, timeoutMs = 20000, headers = {}, deadline } = {},
  fetchImpl = fetch,
) {
  for (let i = 0; i < tries; i++) {
    // 预算只有外部传 deadline 时才有：不传就是 Infinity，行为与加预算前逐字一致
    // （fetchJson 是导出函数，已有用例直接调它，默认路径不能漂移）。
    const budgetLeft = deadline === undefined ? Infinity : deadline - Date.now();
    // 重试一律看总预算，而不是看"还剩几次"：整轮有硬上限，重试把落盘窗口挤没
    // 就等于整轮白跑。首次即使已过线仍放行一次——拿到的是真实错误，比合成一个
    // 预算错误更有信息量，而且不再往下重试，耗时仍然受控。
    if (budgetLeft <= 0 && i > 0) {
      throw new Error(`预算耗尽：${url} 已尝试 ${i} 次，不再重试`);
    }
    // 超时按剩余预算收窄，最后一次尝试不会白等满 20s 冲过线；
    // 预算已经见底时留 1s 下限，避免 0/负数的 timeout 立刻 abort。
    const attemptTimeout = Math.min(timeoutMs, Math.max(budgetLeft, 1000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), attemptTimeout);
    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { "user-agent": "iq-radar/2.0", accept: "application/json", ...headers },
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          const code = typeof body?.error?.code === "string" ? body.error.code : "";
          const message = typeof body?.error?.message === "string" ? body.error.message : "";
          detail = [code, message].filter(Boolean).join(": ").slice(0, 240);
        } catch {
          // HTML gateway errors (e.g. Cloudflare) may not be JSON; status and URL remain diagnostic.
        }
        throw new HttpError(res.status, url, detail);
      }
      return await res.json();
    } catch (error) {
      const retryable =
        !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
      if (!retryable || i === tries - 1) throw error;
      const backoff = 2 ** i * 1000;
      // 退避同样不许睡过 deadline，否则终点前最后 2s 纯粹是空转。
      const sleep = deadline === undefined ? backoff : Math.min(backoff, Math.max(0, deadline - Date.now()));
      await new Promise((r) => setTimeout(r, sleep));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("unreachable");
}

/**
 * 抓纯文本（首页 HTML）。只在兜底路径上用，所以重试次数与退避都由调用方给，
 * 预算也由调用方单独夹住（见 OVERVIEW_TIMEOUT_MS）：上游首页卡住时只烧它自己那点
 * 配额，主流程的 deadline 一点不被它拖累。
 *
 * 可重试判定与 fetchJson 同源：4xx（除 429）不是暂时性错误，重试只是白等。
 * @param {string} url
 * @param {{timeoutMs?: number, deadline?: number, tries?: number, backoffMs?: number}} [options]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function fetchText(
  url,
  { timeoutMs = 20000, deadline, tries = 1, backoffMs = 500 } = {},
  fetchImpl = fetch,
) {
  for (let i = 0; i < tries; i++) {
    const budgetLeft = deadline === undefined ? Infinity : deadline - Date.now();
    // 与 fetchJson 同一条纪律：预算没了就不再排队重试；首次已过线仍放行一次，
    // 拿到的是真实错误而不是合成一个"预算耗尽"。
    if (budgetLeft <= 0 && i > 0) {
      throw new Error(`预算耗尽：${url} 已尝试 ${i} 次，不再重试`);
    }
    const attemptTimeout = Math.min(timeoutMs, Math.max(budgetLeft, 1000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), attemptTimeout);
    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { "user-agent": "iq-radar/2.0", accept: "text/html" },
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.text();
    } catch (error) {
      const retryable =
        !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
      if (!retryable || i === tries - 1) throw error;
      const backoff = backoffMs * (i + 1);
      const sleep =
        deadline === undefined ? backoff : Math.min(backoff, Math.max(0, deadline - Date.now()));
      await new Promise((r) => setTimeout(r, sleep));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("unreachable");
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * round 侧的候选下限。radar 侧早就不再把 30 钉死了（见 refreshAll 里的 minimum），
 * round 却还在硬判 30 —— 上游一旦发得少就是永久失败。这里按同构思路收口：
 * 上限仍是 30（今天 34 个候选时取值不变，行为不漂移），候选不足 30 时按实际数收，
 * 且永远不低于 1，避免空数组把下限算成 0 反而全放过。
 * @param {number} candidateCount
 * @returns {number}
 */
export function roundCandidateFloor(candidateCount) {
  return Math.max(1, Math.min(candidateCount, 30));
}

/**
 * @param {string} model
 * @param {string} effort
 * @param {string} [endpoint]
 * @returns {string}
 */
export function summaryUrl(model, effort, endpoint = SUMMARY_URL) {
  const query = new URLSearchParams({
    model,
    effort,
    view: "summary",
    selection: "user-selected-v1",
  });
  return `${endpoint}?${query.toString()}`;
}

/**
 * 不存在 → null（正常冷启动）。存在但读不出/解析不了 → 同样 null，但会把
 * "文件名: 坏数据" 记进 errors：损坏的旧数据会让下游静默降级，不能和"没有旧数据"
 * 混成同一个 null 分支。
 * @param {string} file
 * @param {string[]} [errors]
 * @returns {Promise<any|null>}
 */
async function readJsonIfExists(file, errors) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (/** @type {any} */ (error)?.code === "ENOENT") return null;
    const message = error instanceof Error ? error.message : String(error);
    errors?.push(`${basename(file)}: 读取失败（${message}）`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors?.push(`${basename(file)}: 坏数据（${message}）`);
    return null;
  }
}

/**
 * 形状探针用的固定时间戳：单候选文档只过一遍结构校验、不落盘，
 * 时间戳本身不参与任何比较，读一次时钟是白花的。
 */
const SHAPE_PROBE_STAMP = "1970-01-01T00:00:00.000Z";

/**
 * 旧数据能不能原样复用。
 *
 * 复用是"抓不到就吐旧值"，可旧值当初落盘是否合法从没人回头看：文件可能被手改过，
 * 也可能来自更早的契约版本。只过 JSON.parse 就复用，形状一旦坏掉就会永久固化 ——
 * 每轮都"复用成功"、永远轮不到重新抓取修正，直到坏到过不了顶层校验，整轮刷新直接抛。
 * 所以复用前用与新鲜数据同一把尺子（contract 里那套 assert*Shape）独立校验一次，
 * 不再在 refresh.mjs 里另写一套形状判断。
 * @param {any} old 旧 radar-bench.json 里的该候选对象
 * @param {{benchmark: string, score_version: string, score_max: number, catalog_version: string, task_set_sha256: string}} binding 只借顶层字段凑文档骨架
 * @returns {void}
 */
function assertReusableSummary(old, binding) {
  assertRadarBenchShape({
    schema_version: 1,
    fetch_id: "reused-check",
    generated_at: SHAPE_PROBE_STAMP,
    checked_at: SHAPE_PROBE_STAMP,
    benchmark: binding.benchmark,
    score_version: binding.score_version,
    score_max: binding.score_max,
    catalog_version: binding.catalog_version,
    task_set_sha256: binding.task_set_sha256,
    // 只放这一个候选：校验失败时抛出的路径就是 candidates[0].xxx，够读到坏在哪。
    candidates: [old],
  });
}

/**
 * 旧 round 能不能顶这一轮的空缺。
 *
 * round 上游挂掉时不能把 radar 侧已经拿到的成果一起陪葬，但也不能把坏形状或不同分母的
 * 旧刻度硬塞给前端 —— 那比没有 round 更糟（进度条和环形图会按错上限画出去）。所以
 * 复用前过三关：形状过 contract、每个候选的 score_max 都与当前分母一致、易变字段
 * 一律用本轮的合法值覆盖（旧值可能早就脏了）。
 * @param {any} old 旧 round.json
 * @param {number} scoreMax 本轮的分数上限（与 radar 同源）
 * @param {{fetchId: string, stamp: string}} envelope 本轮合法的易变字段
 * @returns {any|null} 可复用则返回补好信封的对象，否则 null
 */
function assertReusableRound(old, scoreMax, { fetchId, stamp }) {
  if (!old || typeof old !== "object") return null;
  const candidates = /** @type {any[]} */ (Array.isArray(old.candidates) ? old.candidates : []);
  // 分母逐个对齐：上游改过 score_max 时，旧刻度留在错分母上就是静默画歪。
  if (!candidates.length || !candidates.every((c) => c?.score_max === scoreMax)) return null;
  const carried = {
    ...old,
    schema_version: 1,
    fetch_id: fetchId,
    generated_at: stamp,
    checked_at: stamp,
  };
  try {
    assertRoundShape(carried);
  } catch {
    return null;
  }
  return carried;
}

/**
 * 旧 radar 的候选索引。
 *
 * readJsonIfExists 只保证「JSON 可解析」，形状一概不管：candidates 可能是对象、字符串，
 * 元素也可能是 null。直接 .map 的话坏文件抛在 writeJson 之前 —— status.json 不重写、
 * errors 里也没有记录，整轮刷新静默崩掉，正好和「旧数据坏了要降级、要记 errors、本轮照常
 * 跑完」的设计相反。所以进表前先过形状关：整块不是数组就当空，坏元素单独跳过，原因一律
 * 写进 errors。跳过而不是猜 —— 坏的绝不能被当成可用而走进 reused。
 * @param {any} oldRadar readJsonIfExists 的返回值
 * @param {string[]} errors
 * @returns {Map<string, any>}
 */
function indexOldCandidates(oldRadar, errors) {
  /** @type {Map<string, any>} */
  const byKey = new Map();
  // 不存在或整个文件不是对象时不必再报一次：readJsonIfExists 已经记过了。
  if (!oldRadar || typeof oldRadar !== "object") return byKey;
  if (!Array.isArray(oldRadar.candidates)) {
    errors.push("radar-bench.json: 旧数据不可用（candidates 不是数组）");
    return byKey;
  }
  // 局部断言一次：oldRadar 是 any，narrowing 传不到回调参数，直接写在回调上是隐式 any。
  /** @type {any[]} */
  const list = oldRadar.candidates;
  list.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(`radar-bench.json: 旧数据不可用（candidates[${index}] 不是对象）`);
      return;
    }
    byKey.set(candidateKey(candidate.model, candidate.effort), candidate);
  });
  return byKey;
}

/**
 * @param {any} data
 * @returns {any}
 */
function stripVolatile(data) {
  if (!data || typeof data !== "object") return data;
  const copy = { ...data };
  delete copy.checked_at;
  delete copy.generated_at;
  delete copy.fetch_id;
  return copy;
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function contentEqual(a, b) {
  return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
}

// 易变字段的「能不能从旧文件抄回来」判据，刻意与 contract 同源：
// strictIso = strictString（非空 string）再要 Date.parse 有穷（"" 解析成 NaN，自然拦得住），
// strictString = 非空 string。两个判据不能合并，因为契约对它们的约束本来就不同。
/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isCarriableIso(value) {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isCarriableId(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** radar-bench 与 round 的易变字段完全同构（契约 :253-255 / :347-349 同款）。 */
const VOLATILE_FIELDS = /** @type {Array<[string, (value: unknown) => boolean]>} */ ([
  ["generated_at", isCarriableIso],
  ["checked_at", isCarriableIso],
  ["fetch_id", isCarriableId],
]);

const STATUS_VOLATILE_FIELDS = /** @type {Array<[string, (value: unknown) => boolean]>} */ ([
  ["checked_at", isCarriableIso],
]);

/**
 * 逐个字段判据通过才回填，不通过就保留本次新生成的值（新值一定合法，刚过完校验）。
 * 返回「是否全部回填成功」，调用方用它决定这次算不算未变：
 * contentEqual 比的是 stripVolatile 之后的对象，被 strip 的正是这几个字段，它们从不
 * 参与相等判断。只要有一个字段没抄成，旧的不合法值就会留在盘上——而形状校验在回填
 * 之前就跑完了，不重写就等于落盘契约非法数据、管道却报成功。所以回填不全是「算变」。
 * @param {any} target 本次新生成的数据
 * @param {any} old 盘上的旧数据
 * @param {Array<[string, (value: unknown) => boolean]>} fields 字段名与对应判据
 * @returns {boolean} 是否全部回填成功
 */
function carryVolatile(target, old, fields) {
  let carried = true;
  for (const [key, acceptable] of fields) {
    if (acceptable(old[key])) target[key] = old[key];
    else carried = false;
  }
  return carried;
}

/**
 * @param {string} file
 * @param {any} data
 * @returns {Promise<void>}
 */
async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    // 只 rename 不 sync：进程或断电在这中间挂掉，目录项指向的可能是还没落盘的空文件。
    // 显式 fsync 之后再 rename，rename 的原子性才真正等于「要么旧内容、要么完整新内容」。
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(JSON.stringify(data, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

const STALE_MS = 7 * 86400000;
/** 分数陈旧到这个天数就主动切兜底源：与横幅的告警阈值同一个数，别各说各的。 */
const STALE_SWITCH_DAYS = 7;

/**
 * 一次遍历同时拿到最新/最旧评分时间与陈旧计数。
 * 只看最新会把整体新鲜度说好：34 个候选里 1 个刚评分、33 个停在两个月前，
 * 单看 maxLatest 仍是"今天更新过"。
 * @param {any[]} summaries 只传真正参与输出（available）的候选。
 * @param {Date} now
 * @returns {{latest: string|null, earliest: string|null, staleCount: number}}
 */
function scanLatest(summaries, now) {
  const nowMs = now.getTime();
  let latest = null;
  let latestMs = -Infinity;
  let earliest = null;
  let earliestMs = Infinity;
  let staleCount = 0;
  for (const summary of summaries) {
    const iso = summary?.latest_graded_at;
    const ms = iso ? Date.parse(iso) : Number.NaN;
    if (!Number.isFinite(ms)) {
      // 没时间或时间解析不了 = 新鲜度未知，按陈旧计，未知不冒充新鲜。
      staleCount++;
      continue;
    }
    if (ms > latestMs) {
      latestMs = ms;
      latest = iso;
    }
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = iso;
    }
    if (nowMs - ms > STALE_MS) staleCount++;
  }
  return { latest, earliest, staleCount };
}

/**
 * @param {string|null} iso
 * @param {Date} now
 * @returns {number|null}
 */
function staleDays(iso, now) {
  if (!iso) return null;
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   outDir?: string,
 *   now?: () => Date,
 *   nowMs?: () => number,
 *   budgetMs?: number,
 *   force?: boolean,
 *   fallbackWhenStale?: boolean,
 *   minRadarCandidates?: number,
 *   minRoundCandidates?: number,
 *   timestamp?: string,
 * }} [opts]
 */
export async function refreshAll({
  fetchImpl = fetch,
  outDir = DATA_DIR,
  now = () => new Date(),
  nowMs = Date.now,
  budgetMs = 7 * 60 * 1000,
  force = false,
  fallbackWhenStale = true,
  minRadarCandidates,
  minRoundCandidates,
  timestamp,
} = {}) {
  // 整轮抓取有硬上限：spawn 侧 workflow 的 timeout-minutes 是 10，没有总时限时最坏
  // 耗时 ≈ 34 候选 / 并发 4 × 单 URL 63s + binding 与 round 各 63s ≈ 11.6 分钟，
  // job 会被砍在 writeJson 之前——跑满整轮却一个字都没落盘。留 3 分钟给校验与落盘。
  //
  // 时钟单独注入（nowMs）而不是复用上面的 now：now 服务于落盘时间戳、测试会把它钉在
  // 任意日期，而 deadline 必须与 fetchJson 内部比较用的 Date.now() 同基准。
  const deadline = nowMs() + budgetMs;

  // 站点概览是第二源：与 binding 并行发起，成败都不阻断主流程（有就更好，没有照旧）。
  // 真需要它的时候（结构化端点挂了）只在下面 await，正常路径上它早就跑完了。
  //
  // 它拿的是自己那份 deadline（min(主 deadline, 现在 + OVERVIEW_TIMEOUT_MS)），
  // timeoutMs 也调到同一个量级：上游首页卡住时最多陪跑 OVERVIEW_TIMEOUT_MS，
  // 主流程的抓取窗口一分不少。超时/5xx 允许再试一次，4xx 不试。
  const overviewDeadline = Math.min(deadline, nowMs() + OVERVIEW_TIMEOUT_MS);
  const overviewPromise = fetchText(
    SITE_URL,
    { deadline: overviewDeadline, timeoutMs: OVERVIEW_TIMEOUT_MS, tries: OVERVIEW_TRIES },
    fetchImpl,
  )
    .then((html) => parseHomeOverview(html))
    .catch(() => null);

  /** @type {any} */
  let bindingRaw = null;
  /** @type {any} */
  let binding = null;
  /** @type {any} */
  let bindingError = null;
  try {
    bindingRaw = await fetchJson(BINDING_URL, { deadline }, fetchImpl);
    binding = transformBinding(bindingRaw);
  } catch (error) {
    // 不在这里抛：binding 挂掉还有站点概览这条兜底路，撑不住再抛原始错误。
    bindingError = error;
  }

  /** @type {string[]} 旧数据自身损坏的告警，最终并入 status.errors */
  const loadErrors = [];
  const oldRadar = await readJsonIfExists(join(outDir, "radar-bench.json"), loadErrors);
  const oldByKey = indexOldCandidates(oldRadar, loadErrors);

  /** @type {string[]} */
  const errors = [];
  errors.push(...loadErrors);
  /** @type {any[]} */
  let summaries = [];
  let radarBench;
  let bindingTotal = 0;
  let freshCount = 0;
  let reusedCount = 0;
  let missingCount = 0;
  let minimum = 0;
  /** radar-bench-api = 走结构化端点；site-overview = 兜底到站点概览。 */
  let scoreSource = "radar-bench-api";
  // 整轮共用一个落盘时间戳：两个分支各取一次会让 generated_at 与 checked_at 差出
  // 几十毫秒，contentEqual 又特意 strip 掉它们，白留噪声。调用方可以传进来一份，
  // 让四题与五份雷达数据共用同一秒（重试时尤其不该各漂一次）。
  const stamp = timestamp ?? now().toISOString();

  // 主源成功数不足时的报错要用的分母（只在内层赋值，外层按它判），故提前声明。
  /** @type {any[]} */
  let results = [];
  if (binding) {
    results = await mapLimit(binding.candidates, 4, async (/** @type {any} */ candidate) => {
      const key = candidateKey(candidate.model, candidate.effort);
      try {
        const raw = await fetchJson(
          summaryUrl(candidate.model, candidate.effort, binding.score_endpoint),
          { headers: { "x-radar-bench-selection": "user-selected-v1" }, deadline },
          fetchImpl,
        );
        return { key, candidate, summary: transformSummary(raw), outcome: "fresh", error: null };
      } catch (error) {
        const old = oldByKey.get(key);
        const message = error instanceof Error ? error.message : String(error);
        // "复用旧数据"与"没有旧数据只能丢弃"是两种结局，混在一个 errors 里会让
        // candidates_ok/candidates_total 的文案说谎，这里用 outcome 分开。
        if (old) {
          try {
            assertReusableSummary(old, binding);
            return {
              key,
              candidate,
              summary: old,
              outcome: "reused",
              error: `reused: ${key}: ${message}`,
            };
          } catch (invalid) {
            // 旧对象自己就不合法：宁可这轮丢掉、下轮重新抓，也不能把坏形状继续固化下去。
            // 丢掉只是少一个候选，硬复用会把整轮拖进顶层校验失败。
            const why = invalid instanceof Error ? invalid.message : String(invalid);
            return {
              key,
              candidate,
              summary: null,
              outcome: "missing",
              error: `missing: ${key}: 旧数据不可用（${why}）`,
            };
          }
        }
        return {
          key,
          candidate,
          summary: null,
          outcome: "missing",
          error: `missing: ${key}: ${message}`,
        };
      }
    });

    // 用 typeof 守卫而不是 filter(Boolean)：后者不窄化类型，下游 string[] 会拒收。
    errors.push(...results.map((r) => r.error).filter((e) => typeof e === "string"));
    freshCount = results.filter((r) => r.outcome === "fresh").length;
    reusedCount = results.filter((r) => r.outcome === "reused").length;
    missingCount = results.filter((r) => r.outcome === "missing").length;
    // binding_total 是上游声明的候选数（含被丢弃的）；minimum 按它算，语义不变。
    bindingTotal = binding.candidates.length;
    // 上限别超过实际候选数：n=20 时 max(30, 16)=30 > 20，刷新会被永久判失败。
    minimum =
      minRadarCandidates ??
      Math.max(1, Math.min(bindingTotal, Math.max(30, Math.ceil(bindingTotal * 0.8))));
    if (freshCount >= minimum) {
      const available = results.filter((r) => r.summary);
      summaries = available.map((r) => r.summary);
      const availableBinding = { ...bindingRaw, model_efforts: available.map((r) => r.candidate) };
      radarBench = mergeRadarBench({
        binding: availableBinding,
        summaries,
        generatedAt: stamp,
        checkedAt: stamp,
        fetchId: randomUUID(),
      });
      validateRadarBench(radarBench, { minCandidates: minimum });
    } else {
      // binding 仍可访问但 summary 已整体/大面积失效时，也走首页兜底；只在 binding
      // 挂掉时回退会让这类 502 固化旧数据，status.checked_at 却看似在正常前进。
      // 诊断必须带真实上游错误：复用旧数据的候选也算主源失败，不能因为 summary 被
      // 旧值填上就把 HTTP 502/404 的细节吃掉——那样 status 只会说"0 条成功"，看不出原因。
      const failedSummaries = results
        .filter((r) => r.outcome !== "fresh" && typeof r.error === "string")
        .slice(0, 3)
        .map((r) => r.error);
      const summaryError = new Error(
        `only ${freshCount}/${bindingTotal} summaries succeeded (minimum ${minimum})` +
          (failedSummaries.length ? `; ${failedSummaries.join("; ")}` : ""),
      );
      const overview = await overviewPromise;
      if (!overview) throw summaryError;
      scoreSource = "site-overview";
      bindingTotal = overview.rows.length;
      freshCount = 0;
      reusedCount = 0;
      missingCount = 0;
      // 不把主源部分成功/失败明细当作兜底候选缺失；保留早先读旧文件时的诊断。
      errors.length = loadErrors.length;
      radarBench = buildRadarBenchFromOverview({
        overview,
        generatedAt: stamp,
        checkedAt: stamp,
        fetchId: randomUUID(),
      });
      minimum = minRadarCandidates ?? Math.max(1, Math.min(bindingTotal, Math.ceil(bindingTotal * 0.8)));
      validateRadarBench(radarBench, { minCandidates: minimum });
      summaries = radarBench.candidates;
      errors.push(
        `overview: 主摘要端点失败（${summaryError.message}），已回落到站点概览 ${bindingTotal} 条`,
      );
    }
  } else {
    // binding 挂了：回落到站点概览。概览与 API 不是同一评分协议，benchmark 会标成
    // site-overview-codex-four，看板据此区分；缺的字段在 lib 侧一律给 0，不编值。
    const overview = await overviewPromise;
    if (!overview) throw bindingError ?? new Error("binding 与站点概览都不可用");
    scoreSource = "site-overview";
    bindingTotal = overview.rows.length;
    // candidates_ok 只数主源成功数：概览兜底一律记 0，与 ok=false 的口径一致。
    // 兜底到底拿到了多少条，由 binding_total 与上面 errors 里那句话交代，不在这里冒充成功。
    freshCount = 0;
    radarBench = buildRadarBenchFromOverview({
      overview,
      generatedAt: stamp,
      checkedAt: stamp,
      fetchId: randomUUID(),
    });
    // 兜底路径的候选下限：概览行数就是事实声明数，同样按 80% 且不超过实际数收。
    minimum = minRadarCandidates ?? Math.max(1, Math.min(bindingTotal, Math.ceil(bindingTotal * 0.8)));
    validateRadarBench(radarBench, { minCandidates: minimum });
    summaries = radarBench.candidates;
    errors.push(
      `overview: radar-bench 端点不可用（${
        bindingError instanceof Error ? bindingError.message : String(bindingError)
      }），已回落到站点概览 ${bindingTotal} 条`,
    );
  }

  // radarBench 在 if/else 里都已赋值。API 分支只用成功的候选重建，避免把被丢弃项占位；
  // 兜底分支直接沿用概览文档。此处不再重复合并（会生成第二个 fetch_id），也不对
  // overview 分支用主源 freshCount 再校验一次——该分支按定义 freshCount 为 0。

  // 社区体感是 P1 可选源：任何失败都只降级成「这张卡片这一轮没有新数据」。
  // 刻意不写进 status.errors —— errors 会让 status.ok 变 false，进而让顶部横幅
  // 为一张「不参与主排序」的卡片变黄，等于把可选功能的故障升格成全站告警。
  /** @type {import("./lib.mjs").RatingsDoc | null} */
  let ratings = null;
  try {
    const ratingsRaw = await fetchJson(RATINGS_URL, { deadline }, fetchImpl);
    ratings = transformRatings(ratingsRaw, { generatedAt: stamp, checkedAt: stamp });
    validateRatings(ratings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`社区体感抓取失败（不影响主数据）：${message}`);
  }

  // 旧文件先读完再定 status：损坏的旧数据要计入 errors，不能等 status 定格后才发现。
  // oldRound 同时是 round 抓取失败时的兜底候选，所以提前到 round 之前读。
  const oldRound = await readJsonIfExists(join(outDir, "round.json"), errors);

  // round 上游挂掉不能把 radar 侧已经拿到的成果一起陪葬（写盘在最后，一抛就全丢）：
  // 优先用本轮真数据，其次用形状与分母都对得上的旧数据，实在没有就留 null，
  // 由 status.round_ok 说真话。
  //
  // score_max 主路径取 binding 已解析出的值（含缺失时的 SCORE_MAX 兜底），兜底路径取
  // radarBench 自己那份（同源）：round 与 radar-bench 必须同分母，否则上游改分数上限时
  // round 的刻度会按旧上限静默画错。
  const roundScoreMax = /** @type {number} */ (binding?.score_max ?? radarBench.score_max);
  /** @type {any} */
  let roundData = null;
  try {
    const roundRaw = await fetchJson(ROUND_URL, { deadline }, fetchImpl);
    const round = transformRound(roundRaw, { scoreMax: roundScoreMax });
    const next = {
      schema_version: 1,
      fetch_id: radarBench.fetch_id,
      generated_at: stamp,
      checked_at: stamp,
      ...round,
    };
    // 下限跟着实际候选数走：上游少于 30 个候选时不再被钉死的 30 判失败；
    // minRoundCandidates 仍然是显式覆盖。形状或下限不合格，就当这一轮没拿到。
    validateRound(next, {
      minCandidates: minRoundCandidates ?? roundCandidateFloor(next.candidates.length),
    });
    roundData = next;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    roundData = assertReusableRound(oldRound, roundScoreMax, {
      fetchId: radarBench.fetch_id,
      stamp,
    });
    errors.push(
      roundData
        ? `round: 本轮抓取失败（${message}），沿用上一轮数据`
        : `round: 本轮抓取失败（${message}），且没有可复用的上一轮数据`,
    );
  }

  let roundProgress = null;
  let roundProgressError = null;
  try {
    const progressRaw = await fetchJson(ROUND_PROGRESS_URL, { deadline, tries: 1, timeoutMs: 4000 }, fetchImpl);
    if (progressRaw != null) roundProgress = transformRoundProgress(progressRaw, now());
  } catch (error) {
    roundProgressError = error instanceof Error ? error.message : String(error);
    console.warn(`站点活动评测进度不可用（不影响已完成数据）：${roundProgressError}`);
  }

  const nowDate = now();
  let latestInfo = scanLatest(summaries, nowDate);
  // 时间解析失败是「未知」，不能落 0 冒充刚刷新过。
  //
  // 分数与轮次是两条独立时间线：分数看候选评分时间，轮次看 degradation 轮的 updated_at。
  // 以前只有一个 stale_days = max(两者)，只要轮次久不更新就足以让整页打成「数据可能已过期」，
  // 而分数可能隔天还在涨 —— 横幅于是在说谎。这里拆成两个各自归位的口径；stale_days 仍取较大值，
  // 保持既有语义（外部与用例已依赖它），拆出的两个值供横幅分别定性。
  let scoreStaleDays = staleDays(latestInfo.latest, nowDate);
  const statusRoundUpdatedAt = roundData?.round?.updated_at ?? null;
  const roundStaleDays = staleDays(statusRoundUpdatedAt, nowDate);
  const knownStale = [scoreStaleDays, roundStaleDays].filter((d) => d !== null);

  // 结构化端点"活着但不再新鲜"，其实和挂掉一样不可用：分数停在 ≥7 天前，站点首页却可能
  // 早就在跑新轮。这时继续写旧分数就是把"过期"固化下来，所以要主动切到概览兜底。
  if (fallbackWhenStale && scoreSource === "radar-bench-api" && scoreStaleDays !== null) {
    if (scoreStaleDays >= STALE_SWITCH_DAYS) {
      const overview = await overviewPromise;
      // 分母必须一致：round 已按 binding 的 score_max 建好，概览换了上限会让两侧刻度错位。
      if (overview && overview.scoreMax === radarBench.score_max) {
        const fresh = buildRadarBenchFromOverview({
          overview,
          generatedAt: stamp,
          checkedAt: stamp,
          fetchId: radarBench.fetch_id,
        });
        validateRadarBench(fresh, {
          minCandidates:
            minRadarCandidates ?? Math.max(1, Math.min(overview.rows.length, Math.ceil(overview.rows.length * 0.8))),
        });
        radarBench = fresh;
        summaries = radarBench.candidates;
        latestInfo = scanLatest(summaries, nowDate);
        scoreStaleDays = staleDays(latestInfo.latest, nowDate);
        // 走的是兜底源，这一轮的"新鲜"不算主源成功；ok 由 errors 一并压成 false。
        scoreSource = "site-overview";
        freshCount = 0;
        bindingTotal = overview.rows.length;
        errors.push(
          `overview: radar-bench 分数已停更 ${scoreStaleDays} 天以上，` +
            `已回落到站点概览 ${overview.rows.length} 条（轮次 ${overview.roundId || "未知"}）`,
        );
      }
    }
  }

  // round.json 已在上面读过（它兼作抓取失败的兜底候选），这里只补 status。
  const oldStatus = force ? null : await readJsonIfExists(join(outDir, "status.json"), errors);

  const status = {
    checked_at: stamp,
    // ok 是真值：有候选复用旧数据、有候选被丢弃、旧数据本身坏了，或者整批改用了兜底源
    // （兜底路径 freshCount 恒为 0，所以它天然落在 false），都不是 ok。
    ok: errors.length === 0 && freshCount === bindingTotal && missingCount === 0,
    benchmark: radarBench.benchmark,
    /** 本轮分数取自哪条路：radar-bench-api（结构化端点）或 site-overview（站点概览兜底）。 */
    score_source: scoreSource,
    candidates_ok: freshCount,
    // 只数真正参与输出的候选；被丢弃的靠 binding_total - candidates_total 体现。
    // 取文档里的实际条数而不是 available（兜底路径没有 available，且两分支下二者等价）。
    candidates_total: radarBench.candidates.length,
    binding_total: bindingTotal,
    reused_count: reusedCount,
    missing_count: missingCount,
    // round 这一轮到底有没有拿到（含兜底复用）：没有就是 false，不冒充成功。
    round_ok: roundData != null,
    latest_graded_at: latestInfo.latest,
    /** 最旧的评分时间：单看 latest 会被 1 个新鲜候选骗过去。 */
    min_latest: latestInfo.earliest,
    stale_count: latestInfo.staleCount,
    round_updated_at: statusRoundUpdatedAt,
    round_progress: roundProgress,
    round_progress_error: roundProgressError,
    stale_days: knownStale.length ? Math.max(...knownStale) : null,
    /** 只看分数（候选最新评分）的陈旧天数：横幅「分数已超过 7 天未更新」按它判。 */
    score_stale_days: scoreStaleDays,
    /** 只看降智轮次 updated_at 的陈旧天数：轮次久未更新是另一回事，单独说。 */
    round_stale_days: roundStaleDays,
    errors,
  };

  let radarChanged = true;
  let roundChanged = true;
  if (!force) {
    // 内容一致还不够，易变字段必须全部回填成功才算未变：没收全就得重写，
    // 否则 contentEqual strip 掉的那几个字段会把不合法的旧值原样留在盘上。
    if (oldRadar && contentEqual(oldRadar, radarBench)) {
      radarChanged = !carryVolatile(radarBench, oldRadar, VOLATILE_FIELDS);
    }
    if (oldRound && contentEqual(oldRound, roundData)) {
      roundChanged = !carryVolatile(roundData, oldRound, VOLATILE_FIELDS);
    }
  }

  let statusChanged = true;
  // 同上：status 只回填 checked_at，它抄不成时也必须重写。
  if (!force && oldStatus && contentEqual(oldStatus, status)) {
    statusChanged = !carryVolatile(status, oldStatus, STATUS_VOLATILE_FIELDS);
  }

  // 可选源单独判定：抓不到就一个字节都不动，盘上留上一轮的结果，
  // 前端靠它自己的 checked_at 显示陈旧，而不是突然变成 404 白卡。
  let ratingsChanged = false;
  if (ratings) {
    ratingsChanged = true;
    if (!force) {
      // 这里的 errors 数组是临时的一次性容器：旧体感文件损坏只该当作「没有旧数据」，
      // 不能混进 status.errors（理由同上面的 try/catch）。
      const oldRatings = await readJsonIfExists(join(outDir, "ratings.json"), []);
      if (oldRatings && contentEqual(oldRatings, ratings)) {
        ratingsChanged = !carryVolatile(ratings, oldRatings, VOLATILE_FIELDS);
      }
    }
    if (ratingsChanged) await writeJson(join(outDir, "ratings.json"), ratings);
  }

  if (radarChanged) await writeJson(join(outDir, "radar-bench.json"), radarBench);
  // roundData 为 null 说明这一轮既抓不到也没有旧数据可复用：不写盘，留旧的（如果有）。
  if (roundData && roundChanged) await writeJson(join(outDir, "round.json"), roundData);
  // status 以前是无条件写，checked_at 每次都变，git diff 恒脏 → 每天一条空提交。
  if (statusChanged) await writeJson(join(outDir, "status.json"), status);
  return { radarBench, round: roundData, status, ratings };
}

/**
 * 四题协议刷新：一条与 refreshAll 完全独立的管道。
 *
 * 独立的原因不是洁癖，是上游真的换协议了：旧的 `/api/radar-bench-score`
 * 从 2026-11-16 起 502（不带 view 是 410 score_full_view_retired），
 * 全量测试页 `/iq/full/` 直接写着「还没有发布过全量测试结果」。
 * 把新源塞进 refreshAll 会让它被旧链的「候选不足」异常挡住，一天都落不了盘。
 *
 * 落盘仍然走幂等路径：内容没变就只回填 checked_at，不做无意义的提交。
 *
 * @param {{ fetchImpl?: typeof fetch, outDir?: string, now?: () => Date, nowMs?: () => number, budgetMs?: number, force?: boolean, timestamp?: string }} [options]
 * @returns {Promise<any>}
 */
export async function refreshFourTask({
  fetchImpl = fetch,
  outDir = DATA_DIR,
  now = () => new Date(),
  nowMs = Date.now,
  budgetMs = 3 * 60 * 1000,
  force = false,
  timestamp,
} = {}) {
  // 两个文件加起来约 1.1MB，给 3 分钟足够；单独设预算是因为它不该吃主链的 7 分钟额度。
  const deadline = nowMs() + budgetMs;
  const trendsRaw = await fetchJson(TRENDS_URL, { deadline }, fetchImpl);
  const fourRaw = await fetchJson(FOUR_TASK_URL, { deadline }, fetchImpl);
  const stamp = timestamp ?? now().toISOString();
  const doc = transformFourTask(trendsRaw, fourRaw, { generatedAt: stamp, checkedAt: stamp });
  assertFourTaskShape(doc);

  let changed = true;
  if (!force) {
    // 旧文件损坏只该当作「没有旧数据」，不升级成失败：坏文件本来就要被覆盖。
    const old = await readJsonIfExists(join(outDir, "four-task.json"), []);
    if (old && contentEqual(old, doc)) {
      changed = !carryVolatile(doc, old, VOLATILE_FIELDS);
    }
  }
  if (changed) await writeJson(join(outDir, "four-task.json"), doc);
  return doc;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // 四题先跑，且单独兜错。旧雷达链在上游换协议后是必然失败（34/34 候选全 502），
  // 让它先抛会把四题数据一起挡在门外——那样每天都是「跑了但一个字都没写」。
  /** @type {any} */
  let fourTask = null;
  /** @type {any} */
  let fourTaskError = null;
  // 重试时沿用同一份时间戳：四题与四份雷达数据放在同一秒里，看得出是同一次运行。
  const stamp = new Date().toISOString();
  try {
    fourTask = await refreshFourTask({ force: options.force, timestamp: stamp });
    console.log(
      `wrote four-task: ${fourTask.candidates.length} candidates x ${fourTask.batches.length} batches ` +
        `(${fourTask.protocol}, round ${fourTask.round.label})`,
    );
  } catch (error) {
    fourTaskError = error;
    console.warn("四题协议刷新失败：" + (error instanceof Error ? error.message : String(error)));
  }

  /** @type {any} */
  let result = null;
  /** @type {any} */
  let radarError = null;
  try {
    result = await refreshAll({
      force: options.force,
      timestamp: stamp,
    });
  } catch (error) {
    radarError = error;
    console.warn("旧雷达链刷新失败：" + (error instanceof Error ? error.message : String(error)));
  }

  if (result) {
    console.log(
      `wrote ${result.radarBench.candidates.length} candidates, ${result.round.candidates.length} round candidates`,
    );
    if (result.ratings) {
      console.log(`wrote ${result.ratings.ratings.length}/${result.ratings.total_slots} rated slots`);
    } else {
      console.warn("社区体感本轮未更新（沿用盘上已有的 ratings.json）");
    }
    if (result.status.reused_count) {
      console.warn(`${result.status.reused_count} candidate(s) reused previous data`);
    }
    if (result.status.missing_count) {
      console.warn(
        `${result.status.missing_count} candidate(s) dropped (no previous data), ` +
          `${result.status.candidates_ok}/${result.status.binding_total} still fresh`,
      );
    }
  }

  // 两条链都挂才算整轮失败。只剩旧链挂时按成功退出：它已经确定性地死了
  // （上游删了接口，不是抖动），继续 exit 1 只会每天开一张无人能修的 issue。
  if (radarError && !fourTask) throw radarError;
  if (radarError && fourTask) {
    console.warn("旧雷达链仍未恢复（上游已换协议），本轮按新协议成功处理。");
  }
  if (fourTaskError && !result) throw fourTaskError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // 用法错给一句原因就够、不必铺 stack（对齐 verify-assets 的输出）；其余是真失败，全量打。
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(error);
    process.exit(1);
  });
}
