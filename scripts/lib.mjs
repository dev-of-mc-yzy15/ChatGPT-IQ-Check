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
    const key = model + "|" + effort;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ model, effort });
  }
  if (!candidates.length) throw new Error("binding: model_efforts is empty");
  const rawScoreMax = raw?.score_max;
  const scoreMax = rawScoreMax == null ? NaN : Number(rawScoreMax);
  return {
    benchmark: String(raw?.benchmark ?? ""),
    score_version: String(raw?.score_version ?? ""),
    score_max: Number.isFinite(scoreMax) ? scoreMax : SCORE_MAX,
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
  const score = raw.score == null ? NaN : Number(raw.score);
  if (!Number.isFinite(score)) throw new Error("summary: invalid score");
  const points = Array.isArray(raw?.history?.points) ? raw.history.points : [];
  const history = points
    .map((p) => ({
      at: String(p?.at ?? ""),
      score: Number(p?.score),
      coverage: Number(p?.coverage ?? 0),
      required_tasks: Number(p?.required_tasks ?? 0),
      score_status: p?.score_status === "complete" ? "complete" : "provisional",
    }))
    .filter((p) => p.at && Number.isFinite(p.score))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  const elapsedMsMean = raw.statistics?.metrics?.elapsed_ms?.mean;
  const apiEquivalentUsdMean = raw.statistics?.metrics?.api_equivalent_usd?.mean;
  return {
    model,
    effort,
    score,
    coverage: Number(raw.coverage ?? 0),
    required_tasks: Number(raw.required_tasks ?? 0),
    score_status: raw.score_status === "complete" ? "complete" : "provisional",
    graded_runs_count: Number(raw.graded_runs_count ?? 0),
    source_scores: Object.fromEntries(
      Object.entries(raw.source_scores ?? {}).map(([key, value]) => [
        key,
        {
          score: Number(value?.score ?? 0),
          coverage: Number(value?.coverage ?? 0),
          required_tasks: Number(value?.required_tasks ?? 0),
          graded_runs_count: Number(value?.graded_runs_count ?? 0),
        },
      ]),
    ),
    statistics: {
      sample_count: Number(raw.statistics?.sample_count ?? 0),
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
  const byKey = new Map(summaries.map((s) => [s.model + "|" + s.effort, s]));
  const candidates = b.candidates.map((c) => {
    const s = byKey.get(c.model + "|" + c.effort);
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
  if (!data || data.schema_version !== 1) throw new Error("radar-bench: bad schema_version");
  if (!Array.isArray(data.candidates) || data.candidates.length < minCandidates) {
    throw new Error("radar-bench: too few candidates");
  }
  const seen = new Set();
  for (const c of data.candidates) {
    const key = c.model + "|" + c.effort;
    if (seen.has(key)) throw new Error("radar-bench: duplicate candidate " + key);
    seen.add(key);
    if (!Number.isFinite(c.score) || c.score < 0 || c.score > 150) {
      throw new Error("radar-bench: bad score for " + key);
    }
    if (!Array.isArray(c.history)) throw new Error("radar-bench: missing history for " + key);
  }
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
          weight: Number(t?.weight ?? 0),
          required: Boolean(t?.required),
        }))
        .filter((t) => t.id)
    : [];
  if (tasks.length !== 7) throw new Error("round: expected 7 tasks, got " + tasks.length);
  const results = raw?.round?.results ?? {};
  const animations = raw?.round?.animations ?? {};
  const candidates = Object.entries(results).map(([key, taskResults]) => {
    const [model, effort] = key.split("|");
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
      task_count: Number(raw?.round?.task_count ?? tasks.length),
      timings: raw?.round?.timings ?? {},
    },
    tasks,
    candidates,
  };
}

export function validateRound(data, { minCandidates = 30 } = {}) {
  if (!data || data.schema_version !== 1) throw new Error("round: bad schema_version");
  if (!data.round || !data.round.updated_at) throw new Error("round: missing updated_at");
  if (!Array.isArray(data.tasks) || data.tasks.length !== 7) throw new Error("round: expected 7 tasks");
  if (!Array.isArray(data.candidates) || data.candidates.length < minCandidates) {
    throw new Error("round: too few candidates");
  }
  return data;
}
