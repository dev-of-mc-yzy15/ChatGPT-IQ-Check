import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
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
 * @param {string} file
 * @returns {Promise<any|null>}
 */
async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
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
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/**
 * @param {any[]} summaries
 * @returns {string|null}
 */
function maxLatest(summaries) {
  let latest = null;
  let latestMs = -Infinity;
  for (const summary of summaries) {
    if (!summary?.latest_graded_at) continue;
    const ms = Date.parse(summary.latest_graded_at);
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = summary.latest_graded_at;
    }
  }
  return latest;
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
  const oldRadar = await readJsonIfExists(join(outDir, "radar-bench.json"));
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
      return { key, candidate, summary: transformSummary(raw), fresh: true, error: null };
    } catch (error) {
      const old = oldByKey.get(key);
      const message = error instanceof Error ? error.message : String(error);
      return {
        key,
        candidate,
        summary: old ?? null,
        fresh: false,
        error: old
          ? `${key}: reused previous data (${message})`
          : `${key}: ${message}`,
      };
    }
  });

  const errors = results.map((r) => r.error).filter(Boolean);
  const freshCount = results.filter((r) => r.fresh).length;
  const minimum = minRadarCandidates ?? Math.max(30, Math.ceil(binding.candidates.length * 0.8));
  if (freshCount < minimum) {
    throw new Error(
      `only ${freshCount}/${binding.candidates.length} summaries succeeded (minimum ${minimum})`,
    );
  }

  const available = results.filter((r) => r.summary);
  const availableBinding = { ...bindingRaw, model_efforts: available.map((r) => r.candidate) };

  const roundRaw = await fetchJson(ROUND_URL, {}, fetchImpl);
  const round = transformRound(roundRaw);
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
  validateRound(roundData, { minCandidates: minRoundCandidates ?? 30 });

  const latest = maxLatest(available.map((r) => r.summary));
  const latestStale = staleDays(latest, now()) ?? 0;
  const roundStale = staleDays(roundData.round.updated_at, now()) ?? 0;
  const status = {
    checked_at: stamp,
    ok: true,
    benchmark: radarBench.benchmark,
    candidates_ok: freshCount,
    candidates_total: binding.candidates.length,
    round_ok: true,
    latest_graded_at: latest,
    round_updated_at: roundData.round.updated_at,
    stale_days: Math.max(latestStale, roundStale),
    errors,
  };

  let radarChanged = true;
  let roundChanged = true;
  if (!force) {
    const oldRound = await readJsonIfExists(join(outDir, "round.json"));
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

  if (radarChanged) await writeJson(join(outDir, "radar-bench.json"), radarBench);
  if (roundChanged) await writeJson(join(outDir, "round.json"), roundData);
  await writeJson(join(outDir, "status.json"), status);
  return { radarBench, round: roundData, status };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await refreshAll({ force: args.has("--force") });
  console.log(
    `wrote ${result.radarBench.candidates.length} candidates, ${result.round.candidates.length} round candidates`,
  );
  if (result.status.errors.length) {
    console.warn(`${result.status.errors.length} candidate(s) reused previous data or failed`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}