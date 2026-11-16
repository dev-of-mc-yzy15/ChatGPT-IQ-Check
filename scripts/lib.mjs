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
 *
 * @typedef {object} RatingRow
 * @property {string} id
 * @property {string} model
 * @property {string} effort
 * @property {string} label
 * @property {number} average
 * @property {number} count
 *
 * @typedef {object} RatingsDoc
 * @property {number} schema_version
 * @property {string} generated_at
 * @property {string} checked_at
 * @property {string} window
 * @property {number} window_hours
 * @property {string|null} source_updated_at
 * @property {string|null} timezone
 * @property {number} total_slots
 * @property {RatingRow[]} ratings
 */
import {
  FOUR_TASK_IDS,
  assertMinCandidates,
  assertRadarBenchShape,
  assertRatingsShape,
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

/** 上游 id 是 `model-effort` 的扁平串，档位从右往左取——model 自己带连字符，不能用 split 取第二段。 */
const KNOWN_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra", "off"];

/**
 * 把 `gpt-6-astra-xhigh` 拆成 `{ model: "gpt-6-astra", effort: "xhigh" }`。
 *
 * 优先按已知档位后缀匹配，命中不了才退回「最后一个连字符」。两条路都必要：
 * 上游将来加 `nano` 这类新档时，后缀表认不出，退回切分仍能拿到 effort（`gpt-7-nano` → model `gpt-7`），
 * 只是模型名恰好以档位词结尾时（虚构：`gpt-6-max`）第一种匹配更准。
 * 整个串没有连字符就没法拆，返回 null 交给调用方丢弃。
 * @param {string} id
 * @returns {{model: string, effort: string} | null}
 */
export function splitRatingId(id) {
  const text = String(id ?? "").trim();
  if (!text) return null;
  for (const effort of KNOWN_EFFORTS) {
    const suffix = "-" + effort;
    if (text.length > suffix.length && text.endsWith(suffix)) {
      return { model: text.slice(0, -suffix.length), effort };
    }
  }
  const at = text.lastIndexOf("-");
  if (at <= 0 || at === text.length - 1) return null;
  return { model: text.slice(0, at), effort: text.slice(at + 1) };
}

/**
 * 上游 `api/model-ratings?view=public&window=24h` → 内部 ratings.json。
 *
 * 只保留有票的档位。上游对每个 model-effort 都发一行，56 行里通常只有十几个有票，
 * 其余是 `average: null, count: 0`——全量落盘等于让前端画几十行「—」，
 * 还会把 `rated/total` 的真实比例埋掉。无票不是坏数据，是「还没人体感过」。
 *
 * @param {any} raw
 * @param {{generatedAt: string, checkedAt: string}} stamps
 * @returns {RatingsDoc}
 */
export function transformRatings(raw, { generatedAt, checkedAt }) {
  if (!raw || typeof raw !== "object") throw new Error("ratings: invalid payload");
  const models = Array.isArray(raw.models) ? raw.models : [];
  if (!models.length) throw new Error("ratings: models is empty");
  const seen = new Set();
  const ratings = [];
  for (const item of models) {
    const id = String(item?.id ?? "").trim();
    const parsed = splitRatingId(id);
    // 有票的判定同时看 count 与 average：上游出现过 count>0 但 average=null 的中间态
    // （票在统计窗口里还没结算），那种行落盘会让契约的 average 非空断言直接红。
    const count = Number(item?.count);
    const average = item?.average == null ? null : Number(item?.average);
    if (!parsed || !Number.isFinite(count) || count < 1) continue;
    if (average == null || !Number.isFinite(average) || average <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    ratings.push({
      id,
      model: parsed.model,
      effort: parsed.effort,
      label: String(item?.label ?? id),
      // 一位小数就够：1–10 的刻度上再细也读不出来，落盘统一收口也便于比对幂等。
      average: Math.round(average * 10) / 10,
      count,
    });
  }
  // 平均分高的在前；同分按票数多的在前，票数少的高分不该压住有共识的。
  ratings.sort((a, b) => b.average - a.average || b.count - a.count);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    checked_at: checkedAt,
    window: String(raw.window ?? "rolling_24h"),
    window_hours: Number(raw.window_hours ?? 24),
    source_updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null,
    timezone: typeof raw.timezone === "string" ? raw.timezone : null,
    total_slots: models.length,
    ratings,
  };
}

/**
 * @param {any} data
 * @returns {RatingsDoc}
 */
export function validateRatings(data) {
  assertRatingsShape(data);
  return data;
}

/** 上游没有结构化输出任务中文名，从首页 tab 取的展示名。 */
const FOUR_TASK_TITLES = /** @type {Record<string, string>} */ ({
  combined: "秦始皇",
  pompeii: "庞贝",
  pelican: "鹈鹕",
  candy: "糖果",
});

/**
 * 把四题的两个上游文件合成一份前端可直读的文档。
 *
 * 为什么是两个源：`intelligence-trends.json` 只有历史分数（每个点一个数），
 * `codex-four-task-results.json` 只有当前轮的逐任务明细（含产物 sha256、判分模型、成本）。
 * 单看前者做不出「这一分是怎么来的」，单看后者画不出趋势。
 *
 * @param {any} trends
 * @param {any} fourTask
 * @param {{ generatedAt: string, checkedAt: string }} stamps
 * @returns {any}
 */
export function transformFourTask(trends, fourTask, { generatedAt, checkedAt }) {
  if (!trends || !Array.isArray(trends.batches) || trends.batches.length === 0) {
    throw new Error("four-task: intelligence-trends has no batches");
  }
  if (!fourTask || !Array.isArray(fourTask.rows) || fourTask.rows.length === 0) {
    throw new Error("four-task: codex-four-task-results has no rows");
  }
  // 只发布全评轮次：缺题时总分不是「低」而是「不完整」，落盘会让它和完整轮同图比较。
  if (fourTask.all_graded !== true) {
    throw new Error("four-task: round is not fully graded (graded=" + fourTask.graded + "/" + fourTask.expected + ")");
  }
  const scoreMax = Number(fourTask.score_max ?? trends.score_max);
  if (!Number.isFinite(scoreMax) || scoreMax <= 0) throw new Error("four-task: invalid score_max");

  const latest = trends.batches[trends.batches.length - 1];
  const weights = latest.task_weights ?? fourTask.task_weights ?? {};
  for (const id of FOUR_TASK_IDS) {
    const w = Number(weights[id]);
    if (!Number.isFinite(w)) throw new Error("four-task: missing weight for " + id);
  }

  // 历史：每个 (model, effort) 收集一条按时间升序的序列。score 为 null 的批次直接跳过，
  // 不补点——补一个「沿用上次」会伪造出上游根本没有的测量。
  /** @type {Map<string, { at: string, score: number }[]>} */
  const history = new Map();
  /** @type {any[]} */
  const batches = [];
  for (const batch of trends.batches) {
    const at = batch.completed_at ?? batch.started_at;
    if (!at) continue;
    let counted = 0;
    for (const point of batch.points ?? []) {
      const score = Number(point?.score);
      if (!Number.isFinite(score)) continue;
      counted += 1;
      const key = candidateKey(point.model, point.effort);
      const list = history.get(key) ?? [];
      list.push({ at, score });
      history.set(key, list);
    }
    batches.push({
      id: String(batch.id),
      label: String(batch.label ?? batch.id),
      completed_at: String(at),
      points: counted,
    });
  }
  // 上游批次顺序不保证升序；趋势图靠数组顺序连线，这里兜底排一次。
  for (const list of history.values()) {
    list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  /** @param {any} row */
  const at = (row) => {
    // 同一次执行里四个任务时间不同，取最晚的那个作为「这行完成于」。
    const times = FOUR_TASK_IDS.map((id) => row[id]?.model_completed_at).filter(Boolean);
    return times.length ? times.sort().at(-1) : null;
  };

  const candidates = fourTask.rows.map((/** @type {any} */ row) => {
    const key = candidateKey(row.model, row.effort);
    const series = history.get(key);
    if (!series || series.length === 0) {
      throw new Error("four-task: no history for " + key);
    }
    const cells = FOUR_TASK_IDS.map((id) => {
      const raw = row[id] ?? {};
      let score;
      let extra = {};
      if (id === "candy") {
        // 糖果只有对错，按满分/零分计；没有中间态。
        if (typeof raw.correct !== "boolean") throw new Error("four-task: " + key + " candy.correct missing");
        score = raw.correct ? 100 : 0;
        extra = { correct: raw.correct };
      } else if (id === "pompeii") {
        score = Number(raw.score100);
        extra = { reward: Number(raw.reward) };
      } else {
        score = Number(raw.score);
      }
      if (!Number.isFinite(score)) throw new Error("four-task: " + key + " " + id + " score missing");
      const caps = Array.isArray(raw.applied_caps) ? raw.applied_caps : [];
      return {
        id,
        score,
        raw_total: Number(raw.raw_score_total ?? score),
        // 有封顶说明原始分被规则压过，UI 要能看出来「这个分不是它自己拿的」。
        capped: caps.length > 0,
        seconds: Number(raw.model_elapsed_seconds ?? NaN),
        cost_usd: Number(raw.cost_usd ?? NaN),
        ...extra,
      };
    });
    /** @param {(cell: any) => number} pick */
    const sum = (pick) => cells.reduce((acc, c) => (Number.isFinite(pick(c)) ? acc + pick(c) : acc), 0);
    const last = series[series.length - 1];
    return {
      model: String(row.model),
      effort: String(row.effort),
      score: last.score,
      score_status: "complete",
      latest_at: at(row) ?? last.at,
      tasks: cells,
      totals: {
        seconds: sum((/** @type {any} */ c) => c.seconds),
        cost_usd: Math.round(sum((/** @type {any} */ c) => c.cost_usd) * 1e6) / 1e6,
      },
      history: series,
    };
  });

  if (candidates.length !== fourTask.rows.length) {
    throw new Error("four-task: candidate count mismatch");
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    checked_at: checkedAt,
    protocol: String(fourTask.protocol ?? latest.protocol ?? ""),
    score_max: scoreMax,
    round: {
      id: String(fourTask.round_id ?? latest.id),
      label: String(latest.label ?? ""),
      completed_at: String(fourTask.verified_at ?? latest.completed_at ?? ""),
      expected: Number(fourTask.expected),
      graded: Number(fourTask.graded),
      asset_prefix: fourTask.asset_prefix ? String(fourTask.asset_prefix) : null,
    },
    tasks: FOUR_TASK_IDS.map((id) => ({
      id,
      title_zh: FOUR_TASK_TITLES[id],
      weight: Number(weights[id]),
      max: 100,
    })),
    candidates,
    batches,
  };
}
