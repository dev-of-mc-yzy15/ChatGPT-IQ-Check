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
  const shown = value === "" ? '""' : safeJson(value);
  throw new Error(path + ": expected " + expectation + ", got " + (shown ?? String(value)));
}

/**
 * 错误现场序列化。bigint 会让 JSON.stringify 直接抛 TypeError，循环引用同理；
 * 校验器不能因为"展示坏值"自己先炸掉，退回 String()。
 * @param {unknown} value
 * @returns {string | undefined}
 */
function safeJson(value) {
  if (typeof value === "bigint") return String(value) + "n";
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * 入参类型名，供错误文案定位。typeof 对数组和普通对象都给 "object"，
 * 光看 typeof 分不出是哪个，故显式点名数组。
 * @param {unknown} value
 * @returns {string}
 */
function describeType(value) {
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * 严格数字。空串、null、NaN 都不再静默变 0。
 * @returns {number | null}
 */
/**
 * @param {unknown} value
 * @param {string} path
 * @param {{ nullable?: boolean, optional?: boolean, min?: number }} [options]
 * @returns {number | null | undefined}
 */
export function strictNumber(value,
  path,
  { nullable = false, optional = false, min = /** @type {number | undefined} */ (undefined) } = {},
) {
  if (value === undefined && optional) return undefined;
  if (value == null || value === "") {
    if (nullable) return null;
    return fail(path, "number", value);
  }
  // 类型闸门。Number() 什么都硬转：true 变 1、false 变 0、[5] 变 5，转出来的数字
  // 会一路流到落盘数据和 UI，只看 isFinite 拦不住。仅放行 number 与非空字符串
  // （上游确有给数字字符串的字段）。
  if (typeof value !== "number" && typeof value !== "string") {
    return fail(path, "number (got " + describeType(value) + ")", value);
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
 * @param {{ nullable?: boolean, optional?: boolean }} [options]
 * @returns {string | null | undefined}
 */
export function strictIso(value, path, { nullable = false, optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  const s = value = strictString(value, path, { nullable });
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
  stats.sample_count = strictNumber(stats.sample_count, path + ".sample_count", { min: 0 });
  stats.elapsed_ms_mean = strictNumber(stats.elapsed_ms_mean, path + ".elapsed_ms_mean", { nullable: true, min: 0 });
  stats.api_equivalent_usd_mean = strictNumber(stats.api_equivalent_usd_mean, path + ".api_equivalent_usd_mean", {
    nullable: true,
    min: 0,
  });
}

/**
 * @param {any} point
 * @param {string} path
 * @param {number} scoreMax
 */
function assertHistoryPoint(point, path, scoreMax) {
  if (!point || typeof point !== "object") fail(path, "object", point);
  point.at = strictIso(point.at, path + ".at");
  const score = point.score = strictNumber(point.score, path + ".score", { min: 0 });
  // 与候选级 score 同一句判法：历史点也不许超过文档级 score_max。
  // 不卡的话前端照越界分值算 y，点被甩出绘图区、折线被 overflow 裁掉，delta 也跟着发虚。
  // 与 round 侧一致，比较用上面规范化后的数字，别回头读原始字段（可能是字符串）。
  // score != null 只是类型收窄（非 nullable 时 strictNumber 遇 null 已抛）。
  if (score != null && score > scoreMax) fail(path + ".score", "<= score_max " + scoreMax, score);
  point.coverage = strictNumber(point.coverage, path + ".coverage", { min: 0 });
  point.required_tasks = strictNumber(point.required_tasks, path + ".required_tasks", { min: 0 });
  point.score_status = strictEnum(point.score_status, path + ".score_status", SCORE_STATUS);
}

/**
 * @param {any} candidate
 * @param {number} index
 * @param {number} scoreMax
 */
function assertRadarCandidate(candidate, index, scoreMax) {
  const path = "candidates[" + index + "]";
  if (!candidate || typeof candidate !== "object") fail(path, "object", candidate);
  candidate.model = strictString(candidate.model, path + ".model");
  candidate.effort = strictString(candidate.effort, path + ".effort");
  candidate.score = strictNumber(candidate.score, path + ".score", { min: 0 });
  if (candidate.score > scoreMax) fail(path + ".score", "<= score_max " + scoreMax, candidate.score);
  candidate.coverage = strictNumber(candidate.coverage, path + ".coverage", { min: 0 });
  candidate.required_tasks = strictNumber(candidate.required_tasks, path + ".required_tasks", { min: 0 });
  candidate.score_status = strictEnum(candidate.score_status, path + ".score_status", SCORE_STATUS);
  candidate.graded_runs_count = strictNumber(candidate.graded_runs_count, path + ".graded_runs_count", { min: 0 });
  candidate.latest_graded_at = strictIso(candidate.latest_graded_at, path + ".latest_graded_at", { nullable: true });
  assertStatistics(candidate.statistics, path + ".statistics");
  if (!candidate.source_scores || typeof candidate.source_scores !== "object") {
    fail(path + ".source_scores", "object", candidate.source_scores);
  }
  for (const [source, score] of Object.entries(candidate.source_scores)) {
    if (!score || typeof score !== "object") fail(path + ".source_scores." + source, "object", score);
    score.score = strictNumber(score.score, path + ".source_scores." + source + ".score", { min: 0 });
    score.coverage = strictNumber(score.coverage, path + ".source_scores." + source + ".coverage", { min: 0 });
    score.required_tasks = strictNumber(score.required_tasks, path + ".source_scores." + source + ".required_tasks", {
      min: 0,
    });
    score.graded_runs_count = strictNumber(score.graded_runs_count,
      path + ".source_scores." + source + ".graded_runs_count",
      { min: 0 },
    );
  }
  // 缺失即补空数组，不只「非 null 才校验」：TrendChart 首步就 history.map，缺字段直接 TypeError。
  // 给了 points 则逐点严校验。历史点与候选级 score 共用同一个 score_max。
  if (candidate.history == null) {
    candidate.history = [];
  } else {
    // 先写回数组再逐点校验：forEach 返回 undefined，串写会把整个 history 写没。
    candidate.history = strictArray(candidate.history, path + ".history");
    candidate.history.forEach((/** @type {any} */ point, /** @type {number} */ i) =>
      assertHistoryPoint(point, path + ".history[" + i + "]", scoreMax),
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
  data.fetch_id = strictString(data.fetch_id, "radar-bench.fetch_id");
  data.generated_at = strictIso(data.generated_at, "radar-bench.generated_at");
  data.checked_at = strictIso(data.checked_at, "radar-bench.checked_at");
  data.benchmark = strictString(data.benchmark, "radar-bench.benchmark");
  data.score_version = strictString(data.score_version, "radar-bench.score_version");
  data.catalog_version = strictString(data.catalog_version, "radar-bench.catalog_version");
  data.task_set_sha256 = strictString(data.task_set_sha256, "radar-bench.task_set_sha256");
  const scoreMax = data.score_max = strictNumber(data.score_max, "radar-bench.score_max", { min: 1 }) ?? SCORE_MAX_FALLBACK;
  const candidates = data.candidates = strictArray(data.candidates, "radar-bench.candidates", { minLength: 1 });
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
  row.task_id = strictString(row.task_id, path + ".task_id");
  row.status = strictString(row.status, path + ".status");
  row.reward = strictNumber(row.reward, path + ".reward", { nullable: true });
  row.seconds = strictNumber(row.seconds, path + ".seconds", { nullable: true, min: 0 });
  row.cost_usd = strictNumber(row.cost_usd, path + ".cost_usd", { nullable: true, min: 0 });
}

/**
 * @param {any} animation
 * @param {string} path
 */
function assertRoundAnimation(animation, path) {
  if (animation == null) return;
  if (typeof animation !== "object") fail(path, "object or null", animation);
  animation.status = strictString(animation.status, path + ".status");
  animation.score = strictNumber(animation.score, path + ".score", { nullable: true });
  animation.reason = strictString(animation.reason, path + ".reason", { nullable: true });
  animation.seconds = strictNumber(animation.seconds, path + ".seconds", { nullable: true, min: 0 });
  animation.cost_usd = strictNumber(animation.cost_usd, path + ".cost_usd", { nullable: true, min: 0 });
  animation.asset_url = strictString(animation.asset_url, path + ".asset_url", { nullable: true });
  // 可选：已落盘的旧 round.json 没有这个字段，缺省放过；给了就必须是字符串或 null。
  if (animation.asset_sha256 !== undefined) {
    animation.asset_sha256 = strictString(animation.asset_sha256, path + ".asset_sha256", { nullable: true });
  }
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
  candidate.model = strictString(candidate.model, path + ".model");
  candidate.effort = strictString(candidate.effort, path + ".effort");
  // 一个任务都没打分时 score 合法为 null，不能一刀切要求数字。
  const score = candidate.score = strictNumber(candidate.score, path + ".score", { nullable: true, min: 0 });
  const scoreMax = candidate.score_max = strictNumber(candidate.score_max, path + ".score_max", { min: 1 });
  // 与雷达侧对齐：分数不得超过它自报的上限，否则前端照 999/150 把进度条和环形图
  // 画出去。比较用上面规范化后的数字，别回头读原始字段（可能是字符串）。
  // score 为 null 时 null > x 恒假，必须显式 != null 守卫，不能只靠比较。
  if (score != null && scoreMax != null && score > scoreMax) {
    fail(path + ".score", "<= score_max " + scoreMax, score);
  }
  candidate.score_status = strictEnum(candidate.score_status, path + ".score_status", ROUND_SCORE_STATUS);
  candidate.scored_tasks = strictNumber(candidate.scored_tasks, path + ".scored_tasks", { min: 0 });
  candidate.total_tasks = strictNumber(candidate.total_tasks, path + ".total_tasks", { min: 0 });
  const tasks = candidate.tasks = strictArray(candidate.tasks, path + ".tasks", { minLength: 1 });
  tasks.forEach((row, i) => assertRoundTaskResult(row, path + ".tasks[" + i + "]"));
  if (!candidate.totals || typeof candidate.totals !== "object") {
    fail(path + ".totals", "object", candidate.totals);
  }
  candidate.totals.seconds = strictNumber(candidate.totals.seconds, path + ".totals.seconds", { min: 0 });
  candidate.totals.cost_usd = strictNumber(candidate.totals.cost_usd, path + ".totals.cost_usd", { min: 0 });
  candidate.totals.cost_known_tasks = strictNumber(candidate.totals.cost_known_tasks, path + ".totals.cost_known_tasks", { min: 0 });
  candidate.totals.cost_unknown_tasks = strictNumber(candidate.totals.cost_unknown_tasks, path + ".totals.cost_unknown_tasks", { min: 0 });
  assertRoundAnimation(candidate.animation, path + ".animation");
}

/**
 * @param {any} data
 * @returns {any}
 */
export function assertRoundShape(data) {
  if (!data || typeof data !== "object") fail("round", "object", data);
  if (data.schema_version !== 1) fail("round.schema_version", "1", data.schema_version);
  data.fetch_id = strictString(data.fetch_id, "round.fetch_id");
  data.generated_at = strictIso(data.generated_at, "round.generated_at");
  data.checked_at = strictIso(data.checked_at, "round.checked_at");
  data.source_schema = strictString(data.source_schema, "round.source_schema");
  const round = data.round;
  if (!round || typeof round !== "object") fail("round.round", "object", round);
  round.id = strictString(round.id, "round.round.id");
  round.status = strictString(round.status, "round.round.status");
  round.started_at = strictIso(round.started_at, "round.round.started_at");
  round.completed_at = strictIso(round.completed_at, "round.round.completed_at");
  round.updated_at = strictIso(round.updated_at, "round.round.updated_at");
  round.taskset_version = strictString(round.taskset_version, "round.round.taskset_version");
  round.task_count = strictNumber(round.task_count, "round.round.task_count", { min: 1 });
  if (!round.timings || typeof round.timings !== "object") {
    fail("round.round.timings", "object", round.timings);
  }
  const tasks = data.tasks = strictArray(data.tasks, "round.tasks", { minLength: 1 });
  tasks.forEach((task, i) => {
    const path = "round.tasks[" + i + "]";
    if (!task || typeof task !== "object") fail(path, "object", task);
    task.id = strictString(task.id, path + ".id");
    task.category = strictString(task.category, path + ".category");
    task.title_zh = strictString(task.title_zh, path + ".title_zh");
    task.title_en = strictString(task.title_en, path + ".title_en");
    task.weight = strictNumber(task.weight, path + ".weight", { min: 0 });
    task.required = strictBool(task.required, path + ".required");
  });
  const candidates = data.candidates = strictArray(data.candidates, "round.candidates", { minLength: 1 });
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
  data.checked_at = strictIso(data.checked_at, "status.checked_at");
  data.ok = strictBool(data.ok, "status.ok");
  data.benchmark = strictString(data.benchmark, "status.benchmark");
  data.candidates_ok = strictNumber(data.candidates_ok, "status.candidates_ok", { min: 0 });
  data.candidates_total = strictNumber(data.candidates_total, "status.candidates_total", { min: 0 });
  data.round_ok = strictBool(data.round_ok, "status.round_ok");
  data.latest_graded_at = strictIso(data.latest_graded_at, "status.latest_graded_at", { nullable: true });
  data.round_updated_at = strictIso(data.round_updated_at, "status.round_updated_at", { nullable: true });
  // 时间缺失时 stale 未知，允许 null（前端按"未知即告警"处理）。
  data.stale_days = strictNumber(data.stale_days, "status.stale_days", { nullable: true, min: 0 });
  // 分类计数与最旧时间：本轮新增，旧 status.json 没有这些键。
  // optional + 类型严格 —— 缺了放行（历史数据），写歪了照样打红。
  data.binding_total = strictNumber(data.binding_total, "status.binding_total", { optional: true, min: 0 });
  data.reused_count = strictNumber(data.reused_count, "status.reused_count", { optional: true, min: 0 });
  data.missing_count = strictNumber(data.missing_count, "status.missing_count", { optional: true, min: 0 });
  data.min_latest = strictIso(data.min_latest, "status.min_latest", { nullable: true, optional: true });
  data.stale_count = strictNumber(data.stale_count, "status.stale_count", { optional: true, min: 0 });
  // 分数/轮次两条时间线各自归位：stale_days 是两者的较大值（兼容旧消费者），
  // 拆出来的两个口径同样是 optional（旧 status.json 里没有），但写歪了照样打红。
  data.score_stale_days = strictNumber(data.score_stale_days, "status.score_stale_days", { nullable: true, optional: true, min: 0 });
  data.round_stale_days = strictNumber(data.round_stale_days, "status.round_stale_days", { nullable: true, optional: true, min: 0 });
  // 分数来自哪条路：结构化端点，或站点概览兜底。旧 status.json 没有此键。
  if (data.score_source !== undefined) {
    data.score_source = strictEnum(data.score_source, "status.score_source", ["radar-bench-api", "site-overview"]);
  }
  // 先写回数组，再按索引写回每个元素：forEach 的参数赋值回不到数组。
  data.errors = strictArray(data.errors, "status.errors");
  data.errors.forEach((/** @type {any} */ error, /** @type {number} */ i) => {
    data.errors[i] = strictString(error, "status.errors[" + i + "]");
  });
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
