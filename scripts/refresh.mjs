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
import { candidateKey } from "./contract.mjs";

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

/**
 * @param {string} url
 * @param {{tries?: number, timeoutMs?: number, headers?: Record<string, string>}} [options]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<any>}
 */
export async function fetchJson(url, { tries = 3, timeoutMs = 20000, headers = {} } = {}, fetchImpl = fetch) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
      await new Promise((r) => setTimeout(r, 2 ** i * 1000));
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
 *   force?: boolean,
 *   minRadarCandidates?: number,
 *   minRoundCandidates?: number,
 * }} [opts]
 */
export async function refreshAll({
  fetchImpl = fetch,
  outDir = DATA_DIR,
  now = () => new Date(),
  force = false,
  minRadarCandidates,
  minRoundCandidates,
} = {}) {
  const bindingRaw = await fetchJson(BINDING_URL, {}, fetchImpl);
  const binding = transformBinding(bindingRaw);
  /** @type {string[]} 旧数据自身损坏的告警，最终并入 status.errors */
  const loadErrors = [];
  const oldRadar = await readJsonIfExists(join(outDir, "radar-bench.json"), loadErrors);
  const oldByKey = new Map(
    /** @type {any[]} */ (oldRadar?.candidates ?? []).map((c) => [candidateKey(c.model, c.effort), c]),
  );

  const results = await mapLimit(binding.candidates, 4, async (/** @type {any} */ candidate) => {
    const key = candidateKey(candidate.model, candidate.effort);
    try {
      const raw = await fetchJson(
        summaryUrl(candidate.model, candidate.effort),
        { headers: { "x-radar-bench-selection": "user-selected-v1" } },
        fetchImpl,
      );
      return { key, candidate, summary: transformSummary(raw), outcome: "fresh", error: null };
    } catch (error) {
      const old = oldByKey.get(key);
      const message = error instanceof Error ? error.message : String(error);
      // "复用旧数据"与"没有旧数据只能丢弃"是两种结局，混在一个 errors 里会让
      // candidates_ok/candidates_total 的文案说谎，这里用 outcome 分开。
      if (old) {
        return {
          key,
          candidate,
          summary: old,
          outcome: "reused",
          error: `reused: ${key}: ${message}`,
        };
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

  const roundRaw = await fetchJson(ROUND_URL, {}, fetchImpl);
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
    if (oldRadar && contentEqual(oldRadar, radarBench)) {
      radarBench.generated_at = oldRadar.generated_at;
      radarBench.checked_at = oldRadar.checked_at;
      radarBench.fetch_id = oldRadar.fetch_id;
      radarChanged = false;
    }
    if (oldRound && contentEqual(oldRound, roundData)) {
      roundData.generated_at = oldRound.generated_at;
      roundData.checked_at = oldRound.checked_at;
      roundData.fetch_id = oldRound.fetch_id;
      roundChanged = false;
    }
  }

  let statusChanged = true;
  if (!force) {
    if (oldStatus && contentEqual(oldStatus, status)) {
      status.checked_at = oldStatus.checked_at;
      statusChanged = false;
    }
  }

  if (radarChanged) await writeJson(join(outDir, "radar-bench.json"), radarBench);
  if (roundChanged) await writeJson(join(outDir, "round.json"), roundData);
  // status 以前是无条件写，checked_at 每次都变，git diff 恒脏 → 每天一条空提交。
  if (statusChanged) await writeJson(join(outDir, "status.json"), status);
  return { radarBench, round: roundData, status };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await refreshAll({ force: args.has("--force") });
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
    console.error(error);
    process.exit(1);
  });
}