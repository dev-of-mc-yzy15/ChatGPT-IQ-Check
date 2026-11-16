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
export function strictNumber(
  value,
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
 * @param {number} scoreMax
 */
function assertHistoryPoint(point, path, scoreMax) {
  if (!point || typeof point !== "object") fail(path, "object", point);
  strictIso(point.at, path + ".at");
  const score = strictNumber(point.score, path + ".score", { min: 0 });
  // 与候选级 score 同一句判法：历史点也不许超过文档级 score_max。
  // 不卡的话前端照越界分值算 y，点被甩出绘图区、折线被 overflow 裁掉，delta 也跟着发虚。
  // 与 round 侧一致，比较用上面规范化后的数字，别回头读原始字段（可能是字符串）。
  // score != null 只是类型收窄（非 nullable 时 strictNumber 遇 null 已抛）。
  if (score != null && score > scoreMax) fail(path + ".score", "<= score_max " + scoreMax, score);
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
  // 缺失即空；给了 points 就逐点严校验。历史点与候选级 score 共用同一个 score_max。
  if (candidate.history != null) {
    strictArray(candidate.history, path + ".history").forEach((point, i) =>
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
  // 可选：已落盘的旧 round.json 没有这个字段，缺省放过；给了就必须是字符串或 null。
  if (animation.asset_sha256 !== undefined) {
    strictString(animation.asset_sha256, path + ".asset_sha256", { nullable: true });
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
  strictString(candidate.model, path + ".model");
  strictString(candidate.effort, path + ".effort");
  // 一个任务都没打分时 score 合法为 null，不能一刀切要求数字。
  const score = strictNumber(candidate.score, path + ".score", { nullable: true, min: 0 });
  const scoreMax = strictNumber(candidate.score_max, path + ".score_max", { min: 1 });
  // 与雷达侧对齐：分数不得超过它自报的上限，否则前端照 999/150 把进度条和环形图
  // 画出去。比较用上面规范化后的数字，别回头读原始字段（可能是字符串）。
  // score 为 null 时 null > x 恒假，必须显式 != null 守卫，不能只靠比较。
  if (score != null && scoreMax != null && score > scoreMax) {
    fail(path + ".score", "<= score_max " + scoreMax, score);
  }
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
  // 分类计数与最旧时间：本轮新增，旧 status.json 没有这些键。
  // optional + 类型严格 —— 缺了放行（历史数据），写歪了照样打红。
  strictNumber(data.binding_total, "status.binding_total", { optional: true, min: 0 });
  strictNumber(data.reused_count, "status.reused_count", { optional: true, min: 0 });
  strictNumber(data.missing_count, "status.missing_count", { optional: true, min: 0 });
  strictIso(data.min_latest, "status.min_latest", { nullable: true, optional: true });
  strictNumber(data.stale_count, "status.stale_count", { optional: true, min: 0 });
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

/** 社区体感是 1–10 星，与 RadarBench 的 0–150 是两套刻度，别混算。 */
export const RATING_MIN = 1;
export const RATING_MAX = 10;

/**
 * 单条体感记录。
 * 只收「有票」的档位：count >= 1 且 average 落在 1–10，无票的在上游就是 null + 0，
 * 落盘只会变成几十行空白，交给 transformRatings 直接丢掉。
 * @param {any} row
 * @param {number} index
 */
function assertRatingRow(row, index) {
  const path = "ratings[" + index + "]";
  if (!row || typeof row !== "object") fail(path, "object", row);
  strictString(row.id, path + ".id");
  strictString(row.model, path + ".model");
  strictString(row.effort, path + ".effort");
  strictString(row.label, path + ".label");
  // strictNumber 只有 min 没有 max，上界自己判：10 是刻度上限，越界说明上游换了刻度，
  // 前端按 average / 10 画条会直接溢出，必须在落盘前拦住。
  const average = strictNumber(row.average, path + ".average", { min: 0 });
  if (average != null && average > RATING_MAX) {
    fail(path + ".average", "number <= " + RATING_MAX, row.average);
  }
  strictNumber(row.count, path + ".count", { min: 1 });
}

/**
 * 社区体感契约（第三份可选数据）。浏览器侧与管道侧共用。
 * 与另外三份不同，这份**允许 ratings 为空数组**：上游可能 24 小时内无人投票，
 * 那是"没有体感"而不是"数据坏了"，前端据此显示空态而不是整卡报错。
 * @param {any} data
 * @returns {any}
 */
export function assertRatingsShape(data) {
  if (!data || typeof data !== "object") fail("ratings", "object", data);
  if (data.schema_version !== 1) fail("ratings.schema_version", "1", data.schema_version);
  strictIso(data.generated_at, "ratings.generated_at");
  strictIso(data.checked_at, "ratings.checked_at");
  // window 不枚举：上游目前是 rolling_24h，将来换窗口名不该让整份文件变非法。
  strictString(data.window, "ratings.window");
  strictNumber(data.window_hours, "ratings.window_hours", { min: 1 });
  strictIso(data.source_updated_at, "ratings.source_updated_at", { nullable: true });
  strictString(data.timezone, "ratings.timezone", { nullable: true });
  const totalSlots = strictNumber(data.total_slots, "ratings.total_slots", { min: 0 });
  const rows = strictArray(data.ratings, "ratings.ratings");
  const seen = new Set();
  rows.forEach((row, index) => {
    assertRatingRow(row, index);
    // 同一档位出现两次，前端按 id 做 key 会重复渲染、合计票数也会翻倍。
    if (seen.has(row.id)) fail("ratings.ratings", "unique id " + row.id, "duplicate");
    seen.add(row.id);
  });
  // 有票档位不可能多于上游档位总数；倒挂说明 transform 把不该收的行收了进来。
  if (totalSlots != null && rows.length > totalSlots) {
    fail("ratings.ratings", "<= total_slots " + totalSlots, rows.length);
  }
  return data;
}

/**
 * 四题协议固定就这四个任务，顺序即上游 tab 顺序。
 * 不是"当前已知的子集"而是"完整定义"：上游增删任务必然改变总分口径
 * （权重和必须等于 score_max），静默放行会让「分数跳变」被误读成「模型降智」。
 */
export const FOUR_TASK_IDS = ["combined", "pompeii", "pelican", "candy"];

/**
 * @param {unknown} value
 * @param {string} path
 * @param {number} scoreMax
 * @returns {number}
 */
function strictScoreIn(value, path, scoreMax) {
  // strictNumber 未开 nullable 时只会返回数字或直接抛错，Number() 仅用于窄化类型。
  const n = Number(strictNumber(value, path, { min: 0 }));
  if (n > scoreMax) fail(path, "number <= " + scoreMax, value);
  return n;
}

/**
 * @param {any} data
 * @returns {any}
 */
export function assertFourTaskShape(data) {
  if (!data || typeof data !== "object") fail("four-task", "object", data);
  if (data.schema_version !== 1) fail("four-task.schema_version", "1", data.schema_version);
  strictIso(data.generated_at, "four-task.generated_at");
  strictIso(data.checked_at, "four-task.checked_at");
  strictString(data.protocol, "four-task.protocol");
  const scoreMax = Number(strictNumber(data.score_max, "four-task.score_max", { min: 1 }));

  const round = data.round;
  if (!round || typeof round !== "object") fail("four-task.round", "object", round);
  strictString(round.id, "four-task.round.id");
  strictString(round.label, "four-task.round.label");
  strictIso(round.completed_at, "four-task.round.completed_at");
  const expected = Number(strictNumber(round.expected, "four-task.round.expected", { min: 0 }));
  const graded = Number(strictNumber(round.graded, "four-task.round.graded", { min: 0 }));
  if (graded > expected) fail("four-task.round.graded", "<= expected " + expected, graded);

  const tasks = strictArray(data.tasks, "four-task.tasks", { minLength: 1 });
  const ids = tasks.map((t, i) => String(strictString(t?.id, "four-task.tasks[" + i + "].id")));
  // 集合相等而非包含：少一个说明上游换了协议，多一个说明 transform 混进了别的视图。
  if (ids.length !== FOUR_TASK_IDS.length || FOUR_TASK_IDS.some((id) => !ids.includes(id))) {
    fail("four-task.tasks", "exactly " + FOUR_TASK_IDS.join("+"), ids.join(","));
  }
  let weightSum = 0;
  tasks.forEach((t, i) => {
    weightSum += Number(strictNumber(t.weight, "four-task.tasks[" + i + "].weight", { min: 0 }));
    strictString(t.title_zh, "four-task.tasks[" + i + "].title_zh");
  });
  // 权重和 = 满分，是「分数可比」的唯一保证。差一点都说明口径变了。
  if (Math.abs(weightSum - scoreMax) > 1e-6) {
    fail("four-task.tasks[].weight", "sum === score_max " + scoreMax, weightSum);
  }

  const candidates = strictArray(data.candidates, "four-task.candidates", { minLength: 1 });
  const seen = new Set();
  candidates.forEach((c, i) => {
    const path = "four-task.candidates[" + i + "]";
    const model = String(strictString(c?.model, path + ".model"));
    const effort = String(strictString(c?.effort, path + ".effort"));
    const key = candidateKey(model, effort);
    // 重复 key 会让趋势图同色双线、表格行 key 冲突。
    if (seen.has(key)) fail("four-task.candidates", "unique " + key, "duplicate");
    seen.add(key);
    strictScoreIn(c.score, path + ".score", scoreMax);
    strictString(c.score_status, path + ".score_status");
    strictIso(c.latest_at, path + ".latest_at");
    const cells = strictArray(c.tasks, path + ".tasks", { minLength: 1 });
    if (cells.length !== FOUR_TASK_IDS.length) {
      fail(path + ".tasks", FOUR_TASK_IDS.length + " items", cells.length);
    }
    const cellIds = new Set();
    cells.forEach((cell, j) => {
      const cpath = path + ".tasks[" + j + "]";
      const id = String(strictString(cell?.id, cpath + ".id"));
      if (!FOUR_TASK_IDS.includes(/** @type {any} */ (id))) fail(cpath + ".id", "known task id", id);
      if (cellIds.has(id)) fail(path + ".tasks", "unique id " + id, "duplicate");
      cellIds.add(id);
      strictNumber(cell.seconds, cpath + ".seconds", { min: 0, nullable: true });
      strictNumber(cell.cost_usd, cpath + ".cost_usd", { min: 0, nullable: true });
    });
    const history = strictArray(c.history, path + ".history", { minLength: 1 });
    let prev = -Infinity;
    history.forEach((p, j) => {
      const hpath = path + ".history[" + j + "]";
      strictIso(p?.at, hpath + ".at");
      strictScoreIn(p.score, hpath + ".score", scoreMax);
      // 趋势图按数组顺序连线，乱序会画出折返的锯齿。
      const t = new Date(p.at).getTime();
      if (t < prev) fail(hpath + ".at", "ascending", p.at);
      prev = t;
    });
    // 最后一刻必须等于当前分，否则表格与曲线讲的不是同一件事。
    const last = history[history.length - 1];
    if (Math.abs(last.score - c.score) > 1e-6) {
      fail(path + ".score", "=== last history point " + last.score, c.score);
    }
  });

  const batches = strictArray(data.batches, "four-task.batches", { minLength: 1 });
  const batchIds = new Set();
  batches.forEach((b, i) => {
    const path = "four-task.batches[" + i + "]";
    const id = String(strictString(b?.id, path + ".id"));
    if (batchIds.has(id)) fail("four-task.batches", "unique id " + id, "duplicate");
    batchIds.add(id);
    strictString(b.label, path + ".label");
    strictIso(b.completed_at, path + ".completed_at");
    Number(strictNumber(b.points, path + ".points", { min: 1 }));
  });
  return data;
}
