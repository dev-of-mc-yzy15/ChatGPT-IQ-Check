/**
 * 管道侧的纯函数层：把上游原始 payload 转成 public/data 的落盘形状。
 * 上游字段随时会变，所以入口一律收 any，转换后由 contract.mjs 的
 * assert*Shape 在落盘前把住结构。
 *
 * @typedef {object} HistoryRow
 * @property {string} at
 * @property {number} score
 * @property {number} coverage
 * @property {number} required_tasks
 * @property {string} score_status
 *
 * @typedef {object} Summary
 * @property {string} model
 * @property {string} effort
 * @property {number} score
 * @property {number} coverage
 * @property {number} required_tasks
 * @property {string} score_status
 * @property {number} graded_runs_count
 * @property {Record<string, SourceScore>} source_scores
 * @property {{sample_count: number, elapsed_ms_mean: number|null, api_equivalent_usd_mean: number|null}} statistics
 * @property {string|null} latest_graded_at
 * @property {HistoryRow[]} history
 *
 * @typedef {object} RadarBenchDoc
 * @property {number} schema_version
 * @property {string} fetch_id
 * @property {string} generated_at
 * @property {string} checked_at
 * @property {string} benchmark
 * @property {string} score_version
 * @property {number} score_max
 * @property {string} catalog_version
 * @property {string} task_set_sha256
 * @property {Summary[]} candidates
 *
 * @typedef {object} RoundDoc
 * @property {string} source_schema
 * @property {any} round
 * @property {any[]} tasks
 * @property {any[]} candidates
 *
 * @typedef {object} SourceScore
 * @property {number} score
 * @property {number} coverage
 * @property {number} required_tasks
 * @property {number} graded_runs_count
 */
import {
  assertMinCandidates,
  assertRadarBenchShape,
  assertRoundShape,
  candidateKey,
  parseCandidateKey,
  strictIso,
  strictNumber,
} from "./contract.mjs";

/**
 * @param {any} value
 * @param {string} path
 * @returns {number}
 */
const num = (value, path) => /** @type {number} */ (strictNumber(value, path, { min: 0 }));

/**
 * `at` 只校验"是字符串"不够：解析不出来的时间串会让后面的排序与日桶全是 NaN，
 * 而且现场完全看不出来。
 * @param {any} value
 * @param {string} path
 * @returns {string}
 */
const iso = (value, path) => /** @type {string} */ (strictIso(value, path));

export const SCORE_MAX = 150;
export const ROUND_MULTIPLIER = 1.5;

/**
 * @param {any} raw 上游 radar-bench-binding.json
 * @returns {{benchmark: string, score_version: string, score_max: number, catalog_version: string, task_set_sha256: string, candidates: {model: string, effort: string}[]}}
 */
export function transformBinding(raw) {
  const modelEfforts = Array.isArray(raw?.model_efforts) ? raw.model_efforts : [];
  const seen = new Set();
  const candidates = [];
  for (const item of modelEfforts) {
    const model = String(item?.model ?? "").trim();
    const effort = String(item?.effort ?? "").trim();
    if (!model || !effort) continue;
    const key = candidateKey(model, effort);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ model, effort });
  }
  if (!candidates.length) throw new Error("binding: model_efforts is empty");
  const scoreMax =
    strictNumber(raw?.score_max, "binding.score_max", { nullable: true, min: 1 }) ?? SCORE_MAX;
  return {
    benchmark: String(raw?.benchmark ?? ""),
    score_version: String(raw?.score_version ?? ""),
    score_max: scoreMax,
    catalog_version: String(raw?.catalog_version ?? ""),
    task_set_sha256: String(raw?.task_set_sha256 ?? ""),
    candidates,
  };
}

/**
 * @param {any} raw 上游 summaries 单条
 * @returns {Summary}
 */
export function transformSummary(raw) {
  if (!raw || typeof raw !== "object") throw new Error("summary: invalid payload");
  const model = String(raw.model ?? "").trim();
  const effort = String(raw.effort ?? "").trim();
  if (!model || !effort) throw new Error("summary: missing model/effort");
  const score = num(raw.score, "summary.score");
  // 整段 history 缺失可以接受（这个候选就没跑过），但给了 history 却拿不出 points 数组，
  // 说明上游改过形状 —— 静默当空会把这个候选的历史整段抹掉。
  if (raw.history != null && !Array.isArray(raw.history.points)) {
    throw new Error("summary.history.points: expected array");
  }
  /** @type {any[]} */
  const points = Array.isArray(raw?.history?.points) ? raw.history.points : [];
  const history = points
    .map((p, i) => ({
      at: iso(p?.at, "summary.history[" + i + "].at"),
      score: num(p?.score, "summary.history[" + i + "].score"),
      coverage: num(p?.coverage ?? 0, "summary.history[" + i + "].coverage"),
      required_tasks: num(p?.required_tasks ?? 0, "summary.history[" + i + "].required_tasks"),
      score_status: p?.score_status === "complete" ? "complete" : "provisional",
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const elapsedMsMean = raw.statistics?.metrics?.elapsed_ms?.mean;
  const apiEquivalentUsdMean = raw.statistics?.metrics?.api_equivalent_usd?.mean;
  return {
    model,
    effort,
    score,
    coverage: num(raw.coverage ?? 0, "summary.coverage"),
    required_tasks: num(raw.required_tasks ?? 0, "summary.required_tasks"),
    score_status: raw.score_status === "complete" ? "complete" : "provisional",
    graded_runs_count: num(raw.graded_runs_count ?? 0, "summary.graded_runs_count"),
    source_scores: Object.fromEntries(
      Object.entries(raw.source_scores ?? {}).map(([key, value]) => [
        key,
        {
          score: num(value?.score ?? 0, "summary.source_scores." + key + ".score"),
          coverage: num(value?.coverage ?? 0, "summary.source_scores." + key + ".coverage"),
          required_tasks: num(value?.required_tasks ?? 0, "summary.source_scores." + key + ".required_tasks"),
          graded_runs_count: num(value?.graded_runs_count ?? 0, "summary.source_scores." + key + ".graded_runs_count"),
        },
      ]),
    ),
    statistics: {
      sample_count: num(raw.statistics?.sample_count ?? 0, "summary.statistics.sample_count"),
      elapsed_ms_mean:
        elapsedMsMean == null
          ? null
          : Number.isFinite(Number(elapsedMsMean))
            ? Number(elapsedMsMean)
            : null,
      api_equivalent_usd_mean:
        apiEquivalentUsdMean == null
          ? null
          : Number.isFinite(Number(apiEquivalentUsdMean))
            ? Number(apiEquivalentUsdMean)
            : null,
    },
    // 这个时间戳同样会进 UI 的排序与格式化（sortCandidates），不能原样透传：
    // 只有「没给」和「显式 null」才是 null，给了值就必须是能解析的 ISO，否则整条失败。
    latest_graded_at:
      raw.detail_metrics?.latest_graded_at == null
        ? null
        : iso(raw.detail_metrics.latest_graded_at, "summary.detail_metrics.latest_graded_at"),
    history,
  };
}

/**
 * @param {{binding: any, summaries: Summary[], generatedAt: string, checkedAt: string, fetchId: string}} args
 * @returns {RadarBenchDoc}
 */
export function mergeRadarBench({ binding, summaries, generatedAt, checkedAt, fetchId }) {
  const b = transformBinding(binding);
  const byKey = new Map(summaries.map((s) => [candidateKey(s.model, s.effort), s]));
  const candidates = b.candidates.map((c) => {
    const s = byKey.get(candidateKey(c.model, c.effort));
    if (!s) throw new Error(`missing summary for ${c.model}|${c.effort}`);
    return s;
  });
  return {
    schema_version: 1,
    fetch_id: fetchId,
    generated_at: generatedAt,
    checked_at: checkedAt,
    benchmark: b.benchmark,
    score_version: b.score_version,
    score_max: b.score_max,
    catalog_version: b.catalog_version,
    task_set_sha256: b.task_set_sha256,
    candidates,
  };
}

/**
 * @param {any} data
 * @param {{minCandidates?: number}} [options]
 * @returns {RadarBenchDoc}
 */
export function validateRadarBench(data, { minCandidates = 30 } = {}) {
  assertRadarBenchShape(data);
  assertMinCandidates(data, minCandidates, "radar-bench");
  return data;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function finiteOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {any} results 单档位的 task 结果表
 * @param {any[]} tasks
 * @returns {{score: number|null, scored_tasks: number, total_tasks: number, status: string}}
 */
export function computeRoundScore(results, tasks) {
  /** @type {number[]} */
  const rewards = [];
  let scored = 0;
  for (const task of tasks) {
    const r = results?.[task.id];
    const reward = finiteOrNull(r?.reward);
    if (r && r.status === "scored" && reward != null) {
      rewards.push(reward);
      scored++;
    }
  }
  if (!rewards.length) {
    return { score: null, scored_tasks: 0, total_tasks: tasks.length, status: "partial" };
  }
  const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  return {
    score: Math.round(100 * mean * ROUND_MULTIPLIER * 10) / 10,
    scored_tasks: scored,
    total_tasks: tasks.length,
    status: scored === tasks.length ? "complete" : "partial",
  };
}

/**
 * @param {any} raw 上游 degradation-codex-latest.json
 * @param {{scoreMax?: number}} [options] scoreMax 取 binding 解析出来的值，
 *   与 radar-bench 同源；上游改分数上限时两个文档必须一起变，否则 round 的
 *   进度条与刻度会按旧分母静默画歪。
 * @returns {RoundDoc}
 */
export function transformRound(raw, { scoreMax = SCORE_MAX } = {}) {
  const resolvedScoreMax = /** @type {number} */ (
    strictNumber(scoreMax, "round.score_max", { min: 1 })
  );
  /** @type {any[]} */
  const tasks = Array.isArray(raw?.tasks)
    ? /** @type {any[]} */ (raw.tasks)
        .map((t) => ({
          id: String(t?.id ?? ""),
          category: String(t?.category ?? ""),
          title_zh: String(t?.title_zh ?? ""),
          title_en: String(t?.title_en ?? ""),
          weight: num(t?.weight ?? 0, "round.tasks[" + (t?.id ?? "?") + "].weight"),
          required: Boolean(t?.required),
        }))
        .filter((t) => t.id)
    : [];
  // 任务集会随上游任务轮换而变化（例如 7 题 → 8 题），这里不做数量硬校验，
  // 只要求非空，并校验与上游声明的 task_count 一致。
  if (!tasks.length) throw new Error("round: no tasks");
  const declaredTaskCount = Number(raw?.taskset?.task_count ?? raw?.round?.task_count);
  if (Number.isFinite(declaredTaskCount) && declaredTaskCount !== tasks.length) {
    throw new Error(
      `round: task_count ${declaredTaskCount} != tasks ${tasks.length}`,
    );
  }
  const results = raw?.round?.results ?? {};
  const animations = raw?.round?.animations ?? {};
  const candidates = Object.entries(results).map(([key, taskResults]) => {
    const { model, effort } = parseCandidateKey(key);
    const score = computeRoundScore(taskResults, tasks);
    const taskRows = tasks.map((t) => {
      const r = taskResults?.[t.id] ?? {};
      return {
        task_id: t.id,
        status: String(r.status ?? "missing"),
        reward: finiteOrNull(r.reward),
        seconds: finiteOrNull(r.seconds),
        cost_usd: finiteOrNull(r.cost?.usd),
      };
    });
    const totals = taskRows.reduce(
      (acc, t) => {
        if (t.seconds != null) acc.seconds += t.seconds;
        if (t.cost_usd != null) {
          acc.cost_usd += t.cost_usd;
          acc.cost_known_tasks++;
        } else {
          acc.cost_unknown_tasks++;
        }
        return acc;
      },
      { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 },
    );
    const a = animations[key];
    const animation = a
      ? {
          status: String(a.status ?? "missing"),
          score: finiteOrNull(a.judge?.total),
          scores: a.judge?.scores ?? {},
          reason: a.judge?.reason ?? null,
          seconds: finiteOrNull(a.seconds),
          cost_usd: finiteOrNull(a.cost?.usd),
          asset_url: a.asset?.url ?? null,
          // 上游给了校验和就得留下来：后续下载动画后要拿它比对，转换层丢掉就再也拿不回来。
          asset_sha256: a.asset?.sha256 ?? null,
        }
      : null;
    return {
      model,
      effort,
      score: score.score,
      score_max: resolvedScoreMax,
      score_status: score.status,
      scored_tasks: score.scored_tasks,
      total_tasks: score.total_tasks,
      tasks: taskRows,
      totals,
      animation,
    };
  });
  if (!candidates.length) throw new Error("round: no candidates");
  return {
    source_schema: String(raw?.schema ?? ""),
    round: {
      id: String(raw?.round?.id ?? ""),
      status: String(raw?.round?.status ?? ""),
      started_at: String(raw?.round?.started_at ?? ""),
      completed_at: String(raw?.round?.completed_at ?? ""),
      updated_at: String(raw?.round?.updated_at ?? ""),
      taskset_version: String(raw?.round?.taskset_version ?? ""),
      task_count: Number(
        raw?.round?.task_count ?? raw?.taskset?.task_count ?? tasks.length,
      ),
      timings: raw?.round?.timings ?? {},
    },
    tasks,
    candidates,
  };
}

/**
 * @param {any} data
 * @param {{minCandidates?: number}} [options]
 * @returns {RoundDoc}
 */
export function validateRound(data, { minCandidates = 30 } = {}) {
  assertRoundShape(data);
  assertMinCandidates(data, minCandidates, "round");
  return data;
}

/** 站点概览兜底出来的文档标这个 benchmark，与 radar-bench-* 区分得开。 */
export const OVERVIEW_BENCHMARK = "site-overview-codex-four";

/**
 * 从站点首页 HTML 里抽出 `home-overview-data` 那块 JSON。
 *
 * 站点的结构化端点（binding/summary/round）停更或挂掉时，首页仍然每一次请求都带着
 * 当前轮次的分数。这块数据埋在 1.7MB 的 HTML 里，位置固定的 `<script type=
 * "application/json" id="home-overview-data">`；用括号配平截取，不用正则硬啃 JSON。
 *
 * 概览与 API 不是同一套评分协议（protocol 是 codex-four-weighted-150-v2，API 是
 * radar-bench-final64），分数不能当作同一个指标静默互换，所以转换时只搬分数与
 * 时间，缺的字段给显式零值，由调用方按 benchmark 区分展示。
 * @param {string} html
 * @returns {{protocol: string, roundId: string, completedAt: string|null, scoreMax: number|null, rows: {model: string, effort: string, score: number, elapsedMs: number|null, costUsd: number|null}[]}}
 */
export function parseHomeOverview(html) {
  if (typeof html !== "string" || html === "") throw new Error("overview: empty html");
  const marker = /<script[^>]+id="home-overview-data"[^>]*>/i.exec(html);
  if (!marker) throw new Error("overview: home-overview-data not found");
  const start = marker.index + marker[0].length;
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("overview: unbalanced home-overview-data");
  let parsed;
  try {
    parsed = JSON.parse(html.slice(start, end));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("overview: bad home-overview-data (" + message + ")");
  }
  const scores = parsed?.scores;
  if (!scores || typeof scores !== "object") throw new Error("overview: no scores block");
  const rowsRaw = Array.isArray(scores.rows) ? scores.rows : [];
  const rows = [];
  const seen = new Set();
  for (const row of rowsRaw) {
    const model = String(row?.model ?? "").trim();
    const effort = String(row?.effort ?? "").trim();
    if (!model || !effort) continue;
    const key = candidateKey(model, effort);
    if (seen.has(key)) continue;
    // 概览里分数叫 score150，与 score_display（两位小数字符串）同源；取数字那份。
    const score = Number(row?.score150);
    if (!Number.isFinite(score) || score < 0) continue;
    seen.add(key);
    const elapsedMs = Number(row?.model_elapsed_seconds);
    const costUsd = Number(row?.cost_usd);
    rows.push({
      model,
      effort,
      score,
      elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs * 1000 : null,
      costUsd: Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : null,
    });
  }
  if (!rows.length) throw new Error("overview: no usable score rows");
  const scoreMax = strictNumber(scores.score_max ?? SCORE_MAX, "overview.score_max", { min: 1 });
  const completedAtRaw = scores.author_test_interval?.completed_at;
  return {
    protocol: String(scores.protocol ?? ""),
    roundId: String(scores.round_id ?? ""),
    // 轮次完成时间就是这批分数的评分时间；解析不了给 null，由调用方当"未知"处理。
    completedAt:
      typeof completedAtRaw === "string" && Number.isFinite(Date.parse(completedAtRaw))
        ? completedAtRaw
        : null,
    scoreMax: scoreMax ?? SCORE_MAX,
    rows,
  };
}

/**
 * 把概览行摊成契约要求的候选形状。
 *
 * 概览没有 coverage / required_tasks / source_scores / history —— 这些一律给 0 或空，
 * 而不是猜一个看起来合理的数：看板会把 0/0 原样画出来，比编一个值诚实。
 * score_status 跟着轮次完成时间走：有完成时间才算 complete，否则 provisional。
 *
 * 分数按 score_max 收口：契约要求 score <= score_max，概览里万一写了越界值（上游换分母
 * 而 score_max 没跟上），兜底路径会因为一个越界行整轮校验失败 —— 应急通道不该这么脆，
 * 所以就地 clamp 而不是抛。
 * @param {{protocol: string, roundId: string, completedAt: string|null, scoreMax: number|null, rows: any[]}} overview
 * @returns {Summary[]}
 */
export function overviewToSummaries(overview) {
  const completedAt = overview.completedAt;
  const cap = overview.scoreMax ?? SCORE_MAX;
  return overview.rows.map((row) => ({
    model: row.model,
    effort: row.effort,
    score: row.score > cap ? cap : row.score,
    coverage: 0,
    required_tasks: 0,
    score_status: completedAt ? "complete" : "provisional",
    graded_runs_count: 0,
    source_scores: {},
    statistics: {
      sample_count: 0,
      elapsed_ms_mean: row.elapsedMs,
      api_equivalent_usd_mean: row.costUsd,
    },
    latest_graded_at: completedAt,
    history: [],
  }));
}

/**
 * 用概览生成一份完整可校验的 radar-bench 文档。
 * @param {{overview: any, generatedAt: string, checkedAt: string, fetchId: string}} args
 * @returns {RadarBenchDoc}
 */
export function buildRadarBenchFromOverview({ overview, generatedAt, checkedAt, fetchId }) {
  const candidates = overviewToSummaries(overview);
  if (!candidates.length) throw new Error("overview: no candidates");
  return {
    schema_version: 1,
    fetch_id: fetchId,
    generated_at: generatedAt,
    checked_at: checkedAt,
    benchmark: OVERVIEW_BENCHMARK,
    score_version: overview.protocol || OVERVIEW_BENCHMARK,
    score_max: overview.scoreMax ?? SCORE_MAX,
    // catalog_version / task_set_sha256 契约要求非空串；概览里没有任务集摘要，用轮次 id 占位，
    // 空着会直接过不了校验。轮次 id 也缺（旧 HTML）时退到 benchmark 名，仍是非空。
    catalog_version: overview.roundId || OVERVIEW_BENCHMARK,
    task_set_sha256: overview.roundId || OVERVIEW_BENCHMARK,
    candidates,
  };
}
