// @ts-check
// 双端共用的数据契约：刷新管道（build 前生成）与浏览器（load 后校验）都从这里取，
// 避免"管道严、浏览器松"的双实现漂移。
//
// 分两层：
//   assert*Shape      —— 结构与类型，不含数量下限（浏览器侧不该因候选变少就整页失败）
//   assertMinCandidates —— 数量下限，只有管道侧用（浏览器不做阈值判断）

export const SCORE_MAX_FALLBACK = 150;
export const SCORE_STATUS = ["complete", "provisional"];
export const ROUND_SCORE_STATUS = ["complete", "partial"];

/** 候选身份串。管道与前端共用，避免各处手拼。 */
/**
 * @param {string} model
 * @param {string} effort
 * @returns {string}
 */
export function candidateKey(model, effort) {
  return model + "|" + effort;
}

/** 身份串反解。effort 不含 "|"，用 lastIndexOf 让 model 允许含 "|"。 */
/**
 * @param {string} key
 * @returns {{ model: string, effort: string }}
 */
export function parseCandidateKey(key) {
  const at = key.lastIndexOf("|");
  if (at <= 0 || at === key.length - 1) {
    throw new Error("bad candidate key: " + JSON.stringify(key));
  }
  return { model: key.slice(0, at), effort: key.slice(at + 1) };
}

/** @returns {never} 抛出而不是返回，校验函数才能收窄返回类型。 */
/**
 * @param {string} path
 * @param {string} expectation
 * @param {unknown} value
 * @returns {never}
 */
function fail(path, expectation, value) {
  const shown = value === "" ? '""' : JSON.stringify(value);
  throw new Error(path + ": expected " + expectation + ", got " + (shown ?? String(value)));
}

/**
 * 严格数字。空串、null、NaN 都不再静默变 0。
 * @returns {number | null}
 */
/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ nullable?: boolean, min?: number }} [options]
 * @returns {number | null}
 */
export function strictNumber(value, path, { nullable = false, min = /** @type {number | undefined} */ (undefined) } = {}) {
  if (value == null || value === "") {
    if (nullable) return null;
    return fail(path, "number", value);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return fail(path, "finite number", value);
  if (min != null && n < min) return fail(path, "number >= " + min, value);
  return n;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ nullable?: boolean }} [options]
 * @returns {string | null}
 */
export function strictString(value, path, { nullable = false } = {}) {
  if (value == null) {
    if (nullable) return null;
    return fail(path, "string", value);
  }
  if (typeof value !== "string" || !value.trim()) return fail(path, "non-empty string", value);
  return value;
}

/** ISO 时间串；解析不出来直接抛，避免 NaN 比较一路静默。 */
/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ nullable?: boolean }} [options]
 * @returns {string | null}
 */
export function strictIso(value, path, { nullable = false } = {}) {
  const s = strictString(value, path, { nullable });
  if (s == null) return null;
  if (!Number.isFinite(Date.parse(s))) return fail(path, "ISO timestamp", value);
  return s;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {boolean}
 */
export function strictBool(value, path) {
  if (typeof value !== "boolean") return fail(path, "boolean", value);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {readonly string[]} allowed
 * @returns {any}
 */
export function strictEnum(value, path, allowed) {
  if (!allowed.includes(/** @type {string} */ (value))) {
    return fail(path, "one of " + allowed.join("/"), value);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ minLength?: number }} [options]
 * @returns {any[]}
 */
export function strictArray(value, path, { minLength = 0 } = {}) {
  if (!Array.isArray(value)) return fail(path, "array", value);
  if (value.length < minLength) return fail(path, "array of >= " + minLength, value.length);
  return value;
}

/**
 * @param {any} stats
 * @param {string} path
 */
function assertStatistics(stats, path) {
  if (!stats || typeof stats !== "object") fail(path, "object", stats);
  strictNumber(stats.sample_count, path + ".sample_count", { min: 0 });
  strictNumber(stats.elapsed_ms_mean, path + ".elapsed_ms_mean", { nullable: true, min: 0 });
  strictNumber(stats.api_equivalent_usd_mean, path + ".api_equivalent_usd_mean", {
    nullable: true,
    min: 0,
  });
}

/**
 * @param {any} point
 * @param {string} path
 */
function assertHistoryPoint(point, path) {
  if (!point || typeof point !== "object") fail(path, "object", point);
  strictIso(point.at, path + ".at");
  strictNumber(point.score, path + ".score", { min: 0 });
  strictNumber(point.coverage, path + ".coverage", { min: 0 });
  strictNumber(point.required_tasks, path + ".required_tasks", { min: 0 });
  strictEnum(point.score_status, path + ".score_status", SCORE_STATUS);
}

/**
 * @param {any} candidate
 * @param {number} index
 * @param {number} scoreMax
 */
function assertRadarCandidate(candidate, index, scoreMax) {
  const path = "candidates[" + index + "]";
  if (!candidate || typeof candidate !== "object") fail(path, "object", candidate);
  strictString(candidate.model, path + ".model");
  strictString(candidate.effort, path + ".effort");
  strictNumber(candidate.score, path + ".score", { min: 0 });
  if (candidate.score > scoreMax) fail(path + ".score", "<= score_max " + scoreMax, candidate.score);
  strictNumber(candidate.coverage, path + ".coverage", { min: 0 });
  strictNumber(candidate.required_tasks, path + ".required_tasks", { min: 0 });
  strictEnum(candidate.score_status, path + ".score_status", SCORE_STATUS);
  strictNumber(candidate.graded_runs_count, path + ".graded_runs_count", { min: 0 });
  strictIso(candidate.latest_graded_at, path + ".latest_graded_at", { nullable: true });
  assertStatistics(candidate.statistics, path + ".statistics");
  if (!candidate.source_scores || typeof candidate.source_scores !== "object") {
    fail(path + ".source_scores", "object", candidate.source_scores);
  }
  for (const [source, score] of Object.entries(candidate.source_scores)) {
    if (!score || typeof score !== "object") fail(path + ".source_scores." + source, "object", score);
    strictNumber(score.score, path + ".source_scores." + source + ".score", { min: 0 });
    strictNumber(score.coverage, path + ".source_scores." + source + ".coverage", { min: 0 });
    strictNumber(score.required_tasks, path + ".source_scores." + source + ".required_tasks", {
      min: 0,
    });
    strictNumber(
      score.graded_runs_count,
      path + ".source_scores." + source + ".graded_runs_count",
      { min: 0 },
    );
  }
  // 缺失即空；给了 points 就逐点严校验。
  if (candidate.history != null) {
    strictArray(candidate.history, path + ".history").forEach((point, i) =>
      assertHistoryPoint(point, path + ".history[" + i + "]"),
    );
  }
}

/**
 * @param {any} data
 * @returns {any}
 */
export function assertRadarBenchShape(data) {
  if (!data || typeof data !== "object") fail("radar-bench", "object", data);
  if (data.schema_version !== 1) fail("radar-bench.schema_version", "1", data.schema_version);
  strictString(data.fetch_id, "radar-bench.fetch_id");
  strictIso(data.generated_at, "radar-bench.generated_at");
  strictIso(data.checked_at, "radar-bench.checked_at");
  strictString(data.benchmark, "radar-bench.benchmark");
  strictString(data.score_version, "radar-bench.score_version");
  strictString(data.catalog_version, "radar-bench.catalog_version");
  strictString(data.task_set_sha256, "radar-bench.task_set_sha256");
  const scoreMax = strictNumber(data.score_max, "radar-bench.score_max", { min: 1 }) ?? SCORE_MAX_FALLBACK;
  const candidates = strictArray(data.candidates, "radar-bench.candidates", { minLength: 1 });
  const seen = new Set();
  candidates.forEach((candidate, index) => {
    assertRadarCandidate(candidate, index, scoreMax);
    const key = candidateKey(candidate.model, candidate.effort);
    if (seen.has(key)) fail("radar-bench.candidates", "unique " + key, "duplicate");
    seen.add(key);
  });
  return data;
}

/**
 * @param {any} row
 * @param {string} path
 */
function assertRoundTaskResult(row, path) {
  if (!row || typeof row !== "object") fail(path, "object", row);
  strictString(row.task_id, path + ".task_id");
  strictString(row.status, path + ".status");
  strictNumber(row.reward, path + ".reward", { nullable: true });
  strictNumber(row.seconds, path + ".seconds", { nullable: true, min: 0 });
  strictNumber(row.cost_usd, path + ".cost_usd", { nullable: true, min: 0 });
}

/**
 * @param {any} animation
 * @param {string} path
 */
function assertRoundAnimation(animation, path) {
  if (animation == null) return;
  if (typeof animation !== "object") fail(path, "object or null", animation);
  strictString(animation.status, path + ".status");
  strictNumber(animation.score, path + ".score", { nullable: true });
  strictString(animation.reason, path + ".reason", { nullable: true });
  strictNumber(animation.seconds, path + ".seconds", { nullable: true, min: 0 });
  strictNumber(animation.cost_usd, path + ".cost_usd", { nullable: true, min: 0 });
  strictString(animation.asset_url, path + ".asset_url", { nullable: true });
  if (!animation.scores || typeof animation.scores !== "object") {
    fail(path + ".scores", "object", animation.scores);
  }
}

/**
 * @param {any} candidate
 * @param {number} index
 */
function assertRoundCandidate(candidate, index) {
  const path = "round.candidates[" + index + "]";
  if (!candidate || typeof candidate !== "object") fail(path, "object", candidate);
  strictString(candidate.model, path + ".model");
  strictString(candidate.effort, path + ".effort");
  // 一个任务都没打分时 score 合法为 null，不能一刀切要求数字。
  strictNumber(candidate.score, path + ".score", { nullable: true, min: 0 });
  strictNumber(candidate.score_max, path + ".score_max", { min: 1 });
  strictEnum(candidate.score_status, path + ".score_status", ROUND_SCORE_STATUS);
  strictNumber(candidate.scored_tasks, path + ".scored_tasks", { min: 0 });
  strictNumber(candidate.total_tasks, path + ".total_tasks", { min: 0 });
  const tasks = strictArray(candidate.tasks, path + ".tasks", { minLength: 1 });
  tasks.forEach((row, i) => assertRoundTaskResult(row, path + ".tasks[" + i + "]"));
  if (!candidate.totals || typeof candidate.totals !== "object") {
    fail(path + ".totals", "object", candidate.totals);
  }
  strictNumber(candidate.totals.seconds, path + ".totals.seconds", { min: 0 });
  strictNumber(candidate.totals.cost_usd, path + ".totals.cost_usd", { min: 0 });
  strictNumber(candidate.totals.cost_known_tasks, path + ".totals.cost_known_tasks", { min: 0 });
  strictNumber(candidate.totals.cost_unknown_tasks, path + ".totals.cost_unknown_tasks", { min: 0 });
  assertRoundAnimation(candidate.animation, path + ".animation");
}

/**
 * @param {any} data
 * @returns {any}
 */
export function assertRoundShape(data) {
  if (!data || typeof data !== "object") fail("round", "object", data);
  if (data.schema_version !== 1) fail("round.schema_version", "1", data.schema_version);
  strictString(data.fetch_id, "round.fetch_id");
  strictIso(data.generated_at, "round.generated_at");
  strictIso(data.checked_at, "round.checked_at");
  strictString(data.source_schema, "round.source_schema");
  const round = data.round;
  if (!round || typeof round !== "object") fail("round.round", "object", round);
  strictString(round.id, "round.round.id");
  strictString(round.status, "round.round.status");
  strictIso(round.started_at, "round.round.started_at");
  strictIso(round.completed_at, "round.round.completed_at");
  strictIso(round.updated_at, "round.round.updated_at");
  strictString(round.taskset_version, "round.round.taskset_version");
  strictNumber(round.task_count, "round.round.task_count", { min: 1 });
  if (!round.timings || typeof round.timings !== "object") {
    fail("round.round.timings", "object", round.timings);
  }
  const tasks = strictArray(data.tasks, "round.tasks", { minLength: 1 });
  tasks.forEach((task, i) => {
    const path = "round.tasks[" + i + "]";
    if (!task || typeof task !== "object") fail(path, "object", task);
    strictString(task.id, path + ".id");
    strictString(task.category, path + ".category");
    strictString(task.title_zh, path + ".title_zh");
    strictString(task.title_en, path + ".title_en");
    strictNumber(task.weight, path + ".weight", { min: 0 });
    strictBool(task.required, path + ".required");
  });
  const candidates = strictArray(data.candidates, "round.candidates", { minLength: 1 });
  const seen = new Set();
  candidates.forEach((candidate, index) => {
    assertRoundCandidate(candidate, index);
    const key = candidateKey(candidate.model, candidate.effort);
    if (seen.has(key)) fail("round.candidates", "unique " + key, "duplicate");
    seen.add(key);
  });
  return data;
}

/**
 * @param {any} data
 * @returns {any}
 */
export function assertStatusShape(data) {
  if (!data || typeof data !== "object") fail("status", "object", data);
  strictIso(data.checked_at, "status.checked_at");
  strictBool(data.ok, "status.ok");
  strictString(data.benchmark, "status.benchmark");
  strictNumber(data.candidates_ok, "status.candidates_ok", { min: 0 });
  strictNumber(data.candidates_total, "status.candidates_total", { min: 0 });
  strictBool(data.round_ok, "status.round_ok");
  strictIso(data.latest_graded_at, "status.latest_graded_at", { nullable: true });
  strictIso(data.round_updated_at, "status.round_updated_at", { nullable: true });
  // 时间缺失时 stale 未知，允许 null（前端按"未知即告警"处理）。
  strictNumber(data.stale_days, "status.stale_days", { nullable: true, min: 0 });
  strictArray(data.errors, "status.errors").forEach((error, i) =>
    strictString(error, "status.errors[" + i + "]"),
  );
  return data;
}

/**
 * @param {any} data
 * @param {number} minimum
 * @param {string} [label]
 * @returns {any}
 */
export function assertMinCandidates(data, minimum, label = "data") {
  const count = Array.isArray(data?.candidates) ? data.candidates.length : 0;
  if (count < minimum) throw new Error(label + ": too few candidates (" + count + " < " + minimum + ")");
  return data;
}
