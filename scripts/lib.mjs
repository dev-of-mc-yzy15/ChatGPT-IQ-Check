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
  return {
    benchmark: String(raw?.benchmark ?? ""),
    score_version: String(raw?.score_version ?? ""),
    score_max: Number(raw?.score_max ?? SCORE_MAX),
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
  const score = Number(raw.score);
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
      elapsed_ms_mean: Number.isFinite(Number(raw.statistics?.metrics?.elapsed_ms?.mean))
        ? Number(raw.statistics.metrics.elapsed_ms.mean)
        : null,
      api_equivalent_usd_mean: Number.isFinite(Number(raw.statistics?.metrics?.api_equivalent_usd?.mean))
        ? Number(raw.statistics.metrics.api_equivalent_usd.mean)
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
