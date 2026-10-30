import {
  assertMinCandidates,
  assertRadarBenchShape,
  assertRoundShape,
  candidateKey,
  parseCandidateKey,
  strictNumber,
  strictString,
} from "./contract.mjs";

export const SCORE_MAX = 150;
export const ROUND_MULTIPLIER = 1.5;

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

export function transformSummary(raw) {
  if (!raw || typeof raw !== "object") throw new Error("summary: invalid payload");
  const model = String(raw.model ?? "").trim();
  const effort = String(raw.effort ?? "").trim();
  if (!model || !effort) throw new Error("summary: missing model/effort");
  const score = strictNumber(raw.score, "summary.score", { min: 0 });
  const points = Array.isArray(raw?.history?.points) ? raw.history.points : [];
  const history = points
    .map((p, i) => ({
      at: strictString(p?.at, "summary.history[" + i + "].at"),
      score: strictNumber(p?.score, "summary.history[" + i + "].score", { min: 0 }),
      coverage: strictNumber(p?.coverage ?? 0, "summary.history[" + i + "].coverage", { min: 0 }),
      required_tasks: strictNumber(p?.required_tasks ?? 0, "summary.history[" + i + "].required_tasks", {
        min: 0,
      }),
      score_status: p?.score_status === "complete" ? "complete" : "provisional",
    }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const elapsedMsMean = raw.statistics?.metrics?.elapsed_ms?.mean;
  const apiEquivalentUsdMean = raw.statistics?.metrics?.api_equivalent_usd?.mean;
  return {
    model,
    effort,
    score,
    coverage: strictNumber(raw.coverage ?? 0, "summary.coverage", { min: 0 }),
    required_tasks: strictNumber(raw.required_tasks ?? 0, "summary.required_tasks", { min: 0 }),
    score_status: raw.score_status === "complete" ? "complete" : "provisional",
    graded_runs_count: strictNumber(raw.graded_runs_count ?? 0, "summary.graded_runs_count", { min: 0 }),
    source_scores: Object.fromEntries(
      Object.entries(raw.source_scores ?? {}).map(([key, value]) => [
        key,
        {
          score: strictNumber(value?.score ?? 0, "summary.source_scores." + key + ".score", { min: 0 }),
          coverage: strictNumber(value?.coverage ?? 0, "summary.source_scores." + key + ".coverage", {
            min: 0,
          }),
          required_tasks: strictNumber(
            value?.required_tasks ?? 0,
            "summary.source_scores." + key + ".required_tasks",
            { min: 0 },
          ),
          graded_runs_count: strictNumber(
            value?.graded_runs_count ?? 0,
            "summary.source_scores." + key + ".graded_runs_count",
            { min: 0 },
          ),
        },
      ]),
    ),
    statistics: {
      sample_count: strictNumber(raw.statistics?.sample_count ?? 0, "summary.statistics.sample_count", {
        min: 0,
      }),
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
    latest_graded_at: raw.detail_metrics?.latest_graded_at ?? null,
    history,
  };
}

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

export function validateRadarBench(data, { minCandidates = 30 } = {}) {
  assertRadarBenchShape(data);
  assertMinCandidates(data, minCandidates, "radar-bench");
  return data;
}

function finiteOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function computeRoundScore(results, tasks) {
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

export function transformRound(raw) {
  const tasks = Array.isArray(raw?.tasks)
    ? raw.tasks
        .map((t) => ({
          id: String(t?.id ?? ""),
          category: String(t?.category ?? ""),
          title_zh: String(t?.title_zh ?? ""),
          title_en: String(t?.title_en ?? ""),
          weight: strictNumber(t?.weight ?? 0, "round.tasks[" + (t?.id ?? "?") + "].weight", {
            min: 0,
          }),
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
        }
      : null;
    return {
      model,
      effort,
      score: score.score,
      score_max: SCORE_MAX,
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

export function validateRound(data, { minCandidates = 30 } = {}) {
  assertRoundShape(data);
  assertMinCandidates(data, minCandidates, "round");
  return data;
}