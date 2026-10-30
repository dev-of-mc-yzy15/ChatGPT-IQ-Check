import { readFile, open, rename, mkdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  transformBinding,
  transformSummary,
  transformRound,
  mergeRadarBench,
  validateRadarBench,
  validateRound,
} from "./lib.mjs";
import { assertRadarBenchShape, candidateKey } from "./contract.mjs";

export const BINDING_URL = "https://codexradar.com/data/radar-bench-binding.json";
export const SUMMARY_URL = "https://codexradar.com/api/radar-bench-score";
export const ROUND_URL = "https://codexradar.com/degradation-codex-latest.json";
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
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
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
      if (!res.ok) throw new HttpError(res.status, url);
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
 * @returns {string}
 */
export function summaryUrl(model, effort) {
  const query = new URLSearchParams({
    model,
    effort,
    view: "summary",
    selection: "user-selected-v1",
  });
  return `${SUMMARY_URL}?${query.toString()}`;
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
 *   minRadarCandidates?: number,
 *   minRoundCandidates?: number,
 * }} [opts]
 */
export async function refreshAll({
  fetchImpl = fetch,
  outDir = DATA_DIR,
  now = () => new Date(),
  nowMs = Date.now,
  budgetMs = 7 * 60 * 1000,
  force = false,
  minRadarCandidates,
  minRoundCandidates,
} = {}) {
  // 整轮抓取有硬上限：spawn 侧 workflow 的 timeout-minutes 是 10，没有总时限时最坏
  // 耗时 ≈ 34 候选 / 并发 4 × 单 URL 63s + binding 与 round 各 63s ≈ 11.6 分钟，
  // job 会被砍在 writeJson 之前——跑满整轮却一个字都没落盘。留 3 分钟给校验与落盘。
  //
  // 时钟单独注入（nowMs）而不是复用上面的 now：now 服务于落盘时间戳、测试会把它钉在
  // 任意日期，而 deadline 必须与 fetchJson 内部比较用的 Date.now() 同基准。
  const deadline = nowMs() + budgetMs;

  const bindingRaw = await fetchJson(BINDING_URL, { deadline }, fetchImpl);
  const binding = transformBinding(bindingRaw);
  /** @type {string[]} 旧数据自身损坏的告警，最终并入 status.errors */
  const loadErrors = [];
  const oldRadar = await readJsonIfExists(join(outDir, "radar-bench.json"), loadErrors);
  const oldByKey = indexOldCandidates(oldRadar, loadErrors);

  const results = await mapLimit(binding.candidates, 4, async (/** @type {any} */ candidate) => {
    const key = candidateKey(candidate.model, candidate.effort);
    try {
      const raw = await fetchJson(
        summaryUrl(candidate.model, candidate.effort),
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
  const errors = results.map((r) => r.error).filter((e) => typeof e === "string");
  // 同一个数组往后传：后面发现的损坏要实时进 errors，不能只拷贝一次。
  errors.push(...loadErrors);
  const freshCount = results.filter((r) => r.outcome === "fresh").length;
  const reusedCount = results.filter((r) => r.outcome === "reused").length;
  const missingCount = results.filter((r) => r.outcome === "missing").length;
  // binding_total 是上游声明的候选数（含被丢弃的）；minimum 按它算，语义不变。
  const bindingTotal = binding.candidates.length;
  // 上限别超过实际候选数：n=20 时 max(30, 16)=30 > 20，刷新会被永久判失败。
  const minimum =
    minRadarCandidates ??
    Math.max(1, Math.min(bindingTotal, Math.max(30, Math.ceil(bindingTotal * 0.8))));
  if (freshCount < minimum) {
    throw new Error(`only ${freshCount}/${bindingTotal} summaries succeeded (minimum ${minimum})`);
  }

  const available = results.filter((r) => r.summary);
  const availableBinding = { ...bindingRaw, model_efforts: available.map((r) => r.candidate) };

  const roundRaw = await fetchJson(ROUND_URL, { deadline }, fetchImpl);
  // score_max 用 binding 已解析出来的值（含缺失时的 SCORE_MAX 兜底）：round 与 radar-bench
  // 必须同分母，否则上游改分数上限时 round 的刻度会按旧上限静默画错。
  const round = transformRound(roundRaw, { scoreMax: binding.score_max });
  const stamp = now().toISOString();
  const fetchId = randomUUID();

  const radarBench = mergeRadarBench({
    binding: availableBinding,
    summaries: available.map((r) => r.summary),
    generatedAt: stamp,
    checkedAt: stamp,
    fetchId,
  });
  validateRadarBench(radarBench, { minCandidates: minimum });

  const roundData = {
    schema_version: 1,
    fetch_id: fetchId,
    generated_at: stamp,
    checked_at: stamp,
    ...round,
  };
  // 下限跟着实际候选数走：上游少于 30 个候选时不再被钉死的 30 判失败；
  // minRoundCandidates 仍然是显式覆盖。
  validateRound(roundData, {
    minCandidates: minRoundCandidates ?? roundCandidateFloor(roundData.candidates.length),
  });

  const summaries = available.map((r) => r.summary);
  const nowDate = now();
  const latestInfo = scanLatest(summaries, nowDate);
  // 时间解析失败是「未知」，不能落 0 冒充刚刷新过。
  const knownStale = [
    staleDays(latestInfo.latest, nowDate),
    staleDays(roundData.round.updated_at, nowDate),
  ].filter((d) => d !== null);

  // 旧文件先读完再定 status：损坏的旧数据要计入 errors，不能等 status 定格后才发现。
  const oldRound = force ? null : await readJsonIfExists(join(outDir, "round.json"), errors);
  const oldStatus = force ? null : await readJsonIfExists(join(outDir, "status.json"), errors);

  const status = {
    checked_at: stamp,
    // ok 是真值：有候选复用旧数据、有候选被丢弃、或旧数据本身坏了，都不是 ok。
    ok: errors.length === 0 && freshCount === bindingTotal && missingCount === 0,
    benchmark: radarBench.benchmark,
    candidates_ok: freshCount,
    // 只数真正参与输出的候选；被丢弃的靠 binding_total - candidates_total 体现。
    candidates_total: available.length,
    binding_total: bindingTotal,
    reused_count: reusedCount,
    missing_count: missingCount,
    round_ok: round.candidates.length > 0,
    latest_graded_at: latestInfo.latest,
    /** 最旧的评分时间：单看 latest 会被 1 个新鲜候选骗过去。 */
    min_latest: latestInfo.earliest,
    stale_count: latestInfo.staleCount,
    round_updated_at: roundData.round.updated_at,
    stale_days: knownStale.length ? Math.max(...knownStale) : null,
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

  if (radarChanged) await writeJson(join(outDir, "radar-bench.json"), radarBench);
  if (roundChanged) await writeJson(join(outDir, "round.json"), roundData);
  // status 以前是无条件写，checked_at 每次都变，git diff 恒脏 → 每天一条空提交。
  if (statusChanged) await writeJson(join(outDir, "status.json"), status);
  return { radarBench, round: roundData, status };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await refreshAll({ force: options.force });
  console.log(
    `wrote ${result.radarBench.candidates.length} candidates, ${result.round.candidates.length} round candidates`,
  );
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
