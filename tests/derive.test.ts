import { describe, it, expect } from "vitest";
import summaryRaw from "./fixtures/summary.sample.json";
import {
  DEGRADE_THRESHOLD,
  EFFORT_ORDER,
  MAX_TREND_SERIES,
  MIN_COVERAGE_RATIO,
  buildDailyGrid,
  computeDelta,
  deltaClass,
  deltaMark,
  findDegradationPoints,
  lastPerDay,
  roundMatrix,
  sortCandidates,
  topCandidates,
  utcDayKey,
  type SortKey,
} from "../src/lib/derive";
import type { HistoryPoint, RadarCandidate, RoundData } from "../src/types";

const mk = (o: Partial<RadarCandidate>): RadarCandidate => ({
  model: "m", effort: "high", score: 100, coverage: 64, required_tasks: 64,
  score_status: "complete", graded_runs_count: 10,
  source_scores: {}, statistics: { sample_count: 10, elapsed_ms_mean: 1000, api_equivalent_usd_mean: 1 },
  latest_graded_at: "2026-10-23T00:00:00Z", history: [], ...o,
});

const hp = (
  at: string,
  score: number,
  status: "complete" | "provisional" = "complete",
  coverage = 64,
  required_tasks = 64,
): HistoryPoint => ({ at, score, coverage, required_tasks, score_status: status });

/**
 * 真实上游样本（CodexRadar summary 接口，截断到 3 点）。用它兜一层"只有合成数据才成立"的风险：
 * 点位于 summaryRaw.history.points，字段类型与 HistoryPoint 一致，直接当 history 用。
 */
const realHistory = (summaryRaw as unknown as { history: { points: HistoryPoint[] } }).history.points;

describe("常量", () => {
  it("keeps the effort order used by every 档位 排序和矩阵列", () => {
    expect(EFFORT_ORDER).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  it("pins the degradation gate constants", () => {
    expect(DEGRADE_THRESHOLD).toBe(-5);
    expect(MIN_COVERAGE_RATIO).toBe(0.9);
  });

  it("pins the trend series cap to a single source of truth", () => {
    expect(MAX_TREND_SERIES).toBe(6);
  });
});

describe("computeDelta", () => {
  it("returns a positive delta for a rise", () => {
    expect(computeDelta([hp("2026-10-17T00:00:00Z", 100), hp("2026-10-23T00:00:00Z", 105.5)])).toEqual({
      delta: 5.5, days: 6,
    });
  });

  it("returns a negative delta for a drop, rounded to one decimal", () => {
    // 原始差值 -2.77 四舍五入到一位小数，与 UI 的 Δ 列一致。
    expect(computeDelta([hp("2026-10-17T00:00:00Z", 107.33), hp("2026-10-23T00:00:00Z", 104.56)])).toEqual({
      delta: -2.8, days: 6,
    });
  });

  it("returns 0 for two equal scores", () => {
    const r = computeDelta([hp("2026-10-17T00:00:00Z", 104.56), hp("2026-10-23T00:00:00Z", 104.56)]);
    expect(r.delta).toBe(0);
    expect(Object.is(r.delta, -0)).toBe(false);
  });

  it("reads the last two rows only, so the tail defines the delta", () => {
    const h = [hp("2026-10-01T00:00:00Z", 10), hp("2026-10-17T00:00:00Z", 100), hp("2026-10-23T00:00:00Z", 90)];
    expect(computeDelta(h)).toEqual({ delta: -10, days: 6 });
  });

  it("returns nulls for empty and single-point history", () => {
    expect(computeDelta([])).toEqual({ delta: null, days: null });
    expect(computeDelta([hp("2026-10-23T00:00:00Z", 100)])).toEqual({ delta: null, days: null });
  });

  it("塌在原地时返回 —— 没有方向可言", () => {
    expect(computeDelta([hp("2026-10-23T00:00:00Z", 100), hp("2026-10-23T00:00:00Z", 100)])).toEqual({
      delta: 0, days: 0,
    });
  });

  // 契约：只取末尾两项，不做排序。喂倒序数组时 delta 与 days 都会反过来。
  it("假设入参已按时间升序——倒序数组会算出正 delta 和负的 days", () => {
    const reversed = [hp("2026-10-23T00:00:00Z", 100), hp("2026-10-17T00:00:00Z", 110)];
    expect(computeDelta(reversed)).toEqual({ delta: 10, days: -6 });
  });

  it("日期解不出来时 days 退化成 NaN，delta 照旧", () => {
    const r = computeDelta([hp("not-a-date", 100), hp("2026-10-23T00:00:00Z", 90)]);
    expect(r.delta).toBe(-10);
    expect(Number.isNaN(r.days)).toBe(true);
  });
});

describe("utcDayKey", () => {
  it("buckets offset timestamps by UTC day, not by their local date text", () => {
    expect(utcDayKey("2026-10-24T23:30:00+08:00")).toBe("2026-10-24");
    expect(utcDayKey("2026-10-25T01:00:00+08:00")).toBe("2026-10-24");
  });

  it("passes a plain UTC timestamp through unchanged", () => {
    expect(utcDayKey("2026-10-23T00:00:00.000Z")).toBe("2026-10-23");
  });

  it("falls back to the literal prefix instead of throwing on a bad string", () => {
    expect(utcDayKey("2026-13-45T99:99:99Z")).toBe("2026-13-45");
    expect(utcDayKey("garbage")).toBe("garbage");
    expect(utcDayKey("")).toBe("");
  });
});

describe("deltaMark / deltaClass", () => {
  it("不给方向：null、0、非有限值都落破折号与空类名", () => {
    for (const v of [null, 0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(deltaMark(v)).toBe("—");
      expect(deltaClass(v)).toBe("");
    }
  });

  it("跌了给实心三角与 .down", () => {
    expect(deltaMark(-0.1)).toBe("▼");
    expect(deltaClass(-0.1)).toBe("down");
    expect(deltaMark(-5)).toBe("▼");
  });

  it("涨了给空心三角与 .up", () => {
    expect(deltaMark(0.1)).toBe("▲");
    expect(deltaClass(0.1)).toBe("up");
    expect(deltaMark(5)).toBe("▲");
  });
});

describe("lastPerDay", () => {
  it("keeps the last row of each day and sorts ascending", () => {
    const rows = lastPerDay([
      hp("2026-10-23T09:00:00Z", 100),
      hp("2026-10-21T00:00:00Z", 105),
      hp("2026-10-23T08:00:00Z", 108),
    ]);
    expect(rows.map((r) => r.at)).toEqual(["2026-10-21T00:00:00Z", "2026-10-23T09:00:00Z"]);
  });

  it("picks the latest row of a day regardless of array order", () => {
    const a = lastPerDay([hp("2026-10-23T09:00:00Z", 100), hp("2026-10-23T08:00:00Z", 108)]);
    const b = lastPerDay([hp("2026-10-23T08:00:00Z", 108), hp("2026-10-23T09:00:00Z", 100)]);
    expect(a.map((r) => r.score)).toEqual([100]);
    expect(b.map((r) => r.score)).toEqual([100]);
  });

  it("collapses offset timestamps that share one UTC day", () => {
    const series = lastPerDay([
      hp("2026-10-24T23:30:00+08:00", 100),
      hp("2026-10-25T01:00:00+08:00", 90),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].score).toBe(90);
  });

  it("returns [] for an empty history", () => {
    expect(lastPerDay([])).toEqual([]);
  });

  // BUG: 排序比的是原始 at 字符串（`a.at < b.at`），不是解析后的时间。
  // 混合时区时本地日期文本可能和真实先后相反，返回序列因此倒挂：
  // 下游 computeDelta 把跌算成涨、把 days 算成负数，findDegradationPoints 直接**漏报降智**。
  it("按字符串排序，混合时区时会把先后顺序倒挂并让降智漏报", () => {
    const earlier = hp("2026-10-25T00:00:00+14:00", 110); // UTC 10-24T10:00
    const later = hp("2026-10-24T23:59:00-12:00", 100); // UTC 10-25T11:59，真实是跌了 10 分
    expect(Date.parse(earlier.at)).toBeLessThan(Date.parse(later.at));
    // 真实先后是 earlier → later，返回的却是 later → earlier。
    expect(lastPerDay([earlier, later]).map((r) => r.at)).toEqual([later.at, earlier.at]);
    // 跌 10 被算成涨 10，days 变成负数。
    expect(computeDelta(lastPerDay([earlier, later]))).toEqual({ delta: 10, days: -1 });
    // findDegradationPoints 内部自己再排一次，调用方把入参排好也没用：真实的降智被漏掉。
    expect(findDegradationPoints([earlier, later])).toEqual([]);
    expect(findDegradationPoints([later, earlier])).toEqual([]);
    // 按解析时间重排才是对的，修复方向就是排序函数本身。
    const fixed = [...lastPerDay([earlier, later])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    expect(computeDelta(fixed)).toEqual({ delta: -10, days: 1 });
  });
});

describe("findDegradationPoints", () => {
  const prev = hp("2026-10-17T00:00:00Z", 110);

  it("flags a fully covered drop and reports delta/days", () => {
    const found = findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100)]);
    expect(found).toHaveLength(1);
    expect(found[0].point.score).toBe(100);
    expect(found[0].delta).toBe(-10);
    expect(found[0].days).toBe(6);
  });

  it("ignores a drop that is smaller than the threshold", () => {
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 105.1)])).toHaveLength(0);
  });

  it("includes a drop exactly on the threshold", () => {
    // 比较是 `delta > DEGRADE_THRESHOLD`，所以 -5 本身算降智。
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 105)])).toHaveLength(1);
  });

  it("flags a drop that is one tick past the threshold", () => {
    // -5.1 已经越过阈值，边界只在 -5 上含：这里必须报。
    const found = findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 104.9)]);
    expect(found).toHaveLength(1);
    expect(found[0].delta).toBe(-5.1);
  });

  it("drops a point below the 90% coverage gate", () => {
    // 50/64 = 78% < 90%
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "complete", 50, 64)])).toHaveLength(0);
  });

  it("keeps a point sitting exactly on the coverage gate", () => {
    // 57.6/64 = 恰好 90%
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "complete", 57.6, 64)])).toHaveLength(1);
  });

  it("ignores a provisional point", () => {
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "provisional")])).toHaveLength(0);
  });

  it("does not look at the previous point's status", () => {
    // 只有 current 的状态参与判断：上一次是 provisional，这一次**照样**能算降智。
    expect(findDegradationPoints([hp("2026-10-17T00:00:00Z", 110, "provisional"), hp("2026-10-23T00:00:00Z", 100)]))
      .toHaveLength(1);
  });

  // 覆盖率闸门要防的就是 0 分母：required_tasks 为 0 时 coverage / 0 = Infinity，
  // `coverage < 0 * 0.9` 恒为假，闸门等于不存在。
  it("required_tasks 为 0 时不靠除零通过闸门", () => {
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "complete", 0, 0)])).toHaveLength(0);
    // 即使 coverage 有值（0/0 之外的脏数据），也仍然跳过。
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "complete", 64, 0)])).toHaveLength(0);
  });

  it("skips a point whose coverage is not a finite number", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "complete", bad, 64)])).toHaveLength(0);
    }
  });

  it("returns [] for empty and single-point history", () => {
    expect(findDegradationPoints([])).toEqual([]);
    expect(findDegradationPoints([prev])).toEqual([]);
  });

  it("compares day buckets, not raw adjacent rows", () => {
    const h = [
      hp("2026-10-17T00:00:00Z", 110),
      hp("2026-10-23T08:00:00Z", 108),
      hp("2026-10-23T09:00:00Z", 100),
    ];
    const found = findDegradationPoints(h);
    expect(found).toHaveLength(1);
    expect(found[0].point.at).toBe("2026-10-23T09:00:00Z");
    expect(found[0].days).toBe(6);
  });

  it("rounds the reported delta to one decimal", () => {
    const found = findDegradationPoints([hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100.04)]);
    expect(found[0].delta).toBe(-10);
  });

  it("两次同天评分之间不产生假降智", () => {
    expect(findDegradationPoints([hp("2026-10-23T08:00:00Z", 110), hp("2026-10-23T09:00:00Z", 90)])).toHaveLength(0);
  });

  it("在真实 fixture 上保持沉默：两次下跌都还没到 -5", () => {
    // 111.97 → 107.33（-4.6）→ 104.56（-2.8），都没过阈值。
    expect(realHistory).toHaveLength(3);
    expect(findDegradationPoints(realHistory)).toEqual([]);
    // 同一批真实数据铺成日桶：10-09 到 10-23 共 15 天，只有 3 天有值。
    const grid = buildDailyGrid(realHistory);
    expect(grid).toHaveLength(15);
    expect(grid.filter((g) => g.score != null)).toHaveLength(3);
    expect(grid[0]).toEqual({ at: "2026-10-09T00:00:00.000Z", score: 111.97304941062372 });
  });
});

describe("topCandidates", () => {
  it("picks complete candidates by score, then recency", () => {
    const rows = [
      mk({ model: "A", score: 110, score_status: "complete" }),
      mk({ model: "B", score: 120, score_status: "provisional" }),
      mk({ model: "C", score: 105, score_status: "complete" }),
    ];
    expect(topCandidates(rows, 2).map((r) => r.model)).toEqual(["A", "C"]);
  });

  it("defaults to six rows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => mk({ model: `m${i}`, score: 100 + i }));
    const top = topCandidates(rows);
    expect(top).toHaveLength(MAX_TREND_SERIES);
    expect(top[0].score).toBe(109);
  });

  it("breaks a score tie by the more recent grading time", () => {
    const rows = [
      mk({ model: "old", score: 100, latest_graded_at: "2026-10-01T00:00:00Z" }),
      mk({ model: "new", score: 100, latest_graded_at: "2026-10-20T00:00:00Z" }),
    ];
    expect(topCandidates(rows, 1).map((r) => r.model)).toEqual(["new"]);
  });

  it("breaks a tie where both are null without throwing", () => {
    const rows = [mk({ model: "a", score: 50, latest_graded_at: null }), mk({ model: "b", score: 50, latest_graded_at: null })];
    expect(topCandidates(rows, 2).map((r) => r.model)).toEqual(["a", "b"]);
  });

  it("returns [] for no rows and for an all-provisional list", () => {
    expect(topCandidates([])).toEqual([]);
    expect(topCandidates([mk({ score_status: "provisional" })])).toEqual([]);
  });

  it("does not mutate the input order", () => {
    const rows = [mk({ model: "low", score: 1 }), mk({ model: "high", score: 2 })];
    topCandidates(rows, 1);
    expect(rows.map((r) => r.model)).toEqual(["low", "high"]);
  });
});

describe("sortCandidates", () => {
  it("sorts by score desc and keeps nulls last", () => {
    const rows = [mk({ score: 90 }), mk({ score: 110 }), mk({ score: 0 })];
    expect(sortCandidates(rows, "score", "desc").map((r) => r.score)).toEqual([110, 90, 0]);
  });

  it("sorts by score asc", () => {
    const rows = [mk({ score: 90 }), mk({ score: 110 }), mk({ score: 0 })];
    expect(sortCandidates(rows, "score", "asc").map((r) => r.score)).toEqual([0, 90, 110]);
  });

  it("keeps nulls last in both directions", () => {
    const rows = [mk({ model: "b", latest_graded_at: null }), mk({ model: "a", latest_graded_at: "2026-10-01T00:00:00Z" })];
    expect(sortCandidates(rows, "latest_graded_at", "asc").map((r) => r.model)).toEqual(["a", "b"]);
    expect(sortCandidates(rows, "latest_graded_at", "desc").map((r) => r.model)).toEqual(["a", "b"]);
  });

  // 契约：字符串走 localeCompare("en")，纯字典序——不认数字。
  // 所以 gpt-10 排在 gpt-6 前面；要按版本号排得换 numeric 比较。
  it("sorts model strings with localeCompare", () => {
    const rows = [mk({ model: "gpt-6" }), mk({ model: "gpt-10" }), mk({ model: "claude" })];
    expect(sortCandidates(rows, "model", "asc").map((r) => r.model)).toEqual(["claude", "gpt-10", "gpt-6"]);
    expect(sortCandidates(rows, "model", "desc").map((r) => r.model)).toEqual(["gpt-6", "gpt-10", "claude"]);
  });

  it("sorts graded_runs_count numerically, not as text", () => {
    const rows = [mk({ graded_runs_count: 9 }), mk({ graded_runs_count: 100 })];
    expect(sortCandidates(rows, "graded_runs_count", "asc").map((r) => r.graded_runs_count)).toEqual([9, 100]);
  });

  it("sorts effort by reasoning order", () => {
    const rows = [mk({ effort: "ultra" }), mk({ effort: "low" }), mk({ effort: "high" })];
    expect(sortCandidates(rows, "effort", "asc").map((r) => r.effort)).toEqual(["low", "high", "ultra"]);
    expect(sortCandidates(rows, "effort", "desc").map((r) => r.effort)).toEqual(["ultra", "high", "low"]);
  });

  it("puts an unknown effort after every known effort", () => {
    const rows = [mk({ effort: "gigantic" }), mk({ effort: "low" }), mk({ effort: "ultra" })];
    expect(sortCandidates(rows, "effort", "asc").map((r) => r.effort)).toEqual(["low", "ultra", "gigantic"]);
    expect(sortCandidates(rows, "effort", "desc").map((r) => r.effort)).toEqual(["gigantic", "ultra", "low"]);
  });

  it("returns a new array and leaves the input untouched", () => {
    const rows = [mk({ score: 1 }), mk({ score: 2 })];
    const sorted = sortCandidates(rows, "score", "desc");
    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.score)).toEqual([1, 2]);
  });

  it("sorts an empty list", () => {
    const keys: SortKey[] = ["model", "effort", "score", "coverage", "graded_runs_count", "latest_graded_at"];
    for (const k of keys) expect(sortCandidates([], k, "asc")).toEqual([]);
  });
});

describe("buildDailyGrid", () => {
  it("returns [] for empty history and for history with no parseable time", () => {
    expect(buildDailyGrid([])).toEqual([]);
    expect(buildDailyGrid([hp("garbage", 100), hp("also-garbage", 90)])).toEqual([]);
  });

  it("fills missing days with null across a month boundary", () => {
    const grid = buildDailyGrid([hp("2026-10-31T00:00:00Z", 100), hp("2026-11-02T00:00:00Z", 90)]);
    expect(grid.map((p) => p.at)).toEqual([
      "2026-10-31T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
      "2026-11-02T00:00:00.000Z",
    ]);
    expect(grid.map((p) => p.score)).toEqual([100, null, 90]);
  });

  it("emits UTC day keys that cover every input day", () => {
    const grid = buildDailyGrid([
      hp("2026-10-24T23:30:00+08:00", 100),
      hp("2026-10-26T01:00:00+08:00", 90),
    ]);
    // 10-26T01:00+08:00 其实是 UTC 10-25T17:00，所以只跨 24/25 两天。
    expect(grid.map((g) => g.at)).toEqual([
      "2026-10-24T00:00:00.000Z",
      "2026-10-25T00:00:00.000Z",
    ]);
    expect(grid[1].score).toBe(90);
  });

  it("does not return an empty grid when history arrives in descending order", () => {
    const grid = buildDailyGrid([hp("2026-10-26T00:00:00Z", 90), hp("2026-10-24T00:00:00Z", 100)]);
    expect(grid.map((g) => g.score)).toEqual([100, null, 90]);
  });

  it("emits one bucket for a single point", () => {
    expect(buildDailyGrid([hp("2026-10-23T12:34:56Z", 100)])).toEqual([
      { at: "2026-10-23T00:00:00.000Z", score: 100 },
    ]);
  });

  // BUG: 同日取值靠 Map 的**数组位置**后写覆盖，不是靠"当天最晚一条"。
  // lastPerDay 用 Date.parse 比时间取最晚，同一个 buildDailyGrid 却取最后出现的那个，
  // 两条序列因此可能给出两个不同的当天值，折线与红点对不上。
  it("同一天多条时取数组最后一个，而不是时间最晚的一条", () => {
    const rows = [hp("2026-10-20T09:00:00Z", 100), hp("2026-10-20T08:00:00Z", 108)];
    // 09:00 更晚，理应留下 100；实际留下的是数组末位的 108。
    expect(lastPerDay(rows)[0].score).toBe(100);
    expect(buildDailyGrid(rows)[0].score).toBe(108);
  });

  // BUG: 没有任何跨度上限。一个 1970 的坏点（epoch 哨兵/上游默认值）会把网格从 1970 铺到今天，
  // 两万个桶里只有两个有值，其余全是 null。
  it("一个 1970 的坏点会把网格撑到 2 万多个空桶", () => {
    const grid = buildDailyGrid([hp("1970-01-01T00:00:00Z", 0), hp("2026-10-24T00:00:00Z", 100)]);
    const expected = Math.round(
      (Date.parse("2026-10-24T00:00:00Z") - Date.parse("1970-01-01T00:00:00Z")) / 86400000,
    ) + 1;
    expect(expected).toBe(20751);
    expect(grid).toHaveLength(expected);
    expect(grid[0]).toEqual({ at: "1970-01-01T00:00:00.000Z", score: 0 });
    expect(grid[grid.length - 1]).toEqual({ at: "2026-10-24T00:00:00.000Z", score: 100 });
    expect(grid.filter((g) => g.score != null)).toHaveLength(2);
  });

  // BUG: `Math.min(...times)` 把整段历史摊成实参。V8 的实参上限撑不住 13 万：
  // 抛 RangeError: Maximum call stack size exceeded，整张图直接白屏（TrendChart 没有 try）。
  it("13 万个点时自带 spread 溢出，直接抛 RangeError", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const huge = Array.from({ length: 130000 }, (_, i) =>
      hp(new Date(start + i * 86400000).toISOString(), i % 150),
    );
    expect(huge).toHaveLength(130000);
    expect(() => buildDailyGrid(huge)).toThrow(RangeError);
    expect(() => buildDailyGrid(huge)).toThrow(/Maximum call stack size exceeded/);
  });
});

describe("TrendChart 聚合：grids.flat() 后再 spread", () => {
  // TrendChart.tsx:76-81 是 `const times = grids.flat().map(...)` 之后 `Math.min(...times)`。
  // 它不是按原始点数摊，而是按**日桶**摊：一条带 1970 坏点的曲线就是 20751 个桶。
  // MAX_TREND_SERIES 条曲线一起叠 = 124506 个实参，刚好越过 V8 实参上限
  // （实测 124000 还能过，124506 就抛）——也就是说六条曲线各沾一个坏点，首页整张图白屏。
  it("六条曲线各带一个 1970 坏点就够炸：flat 出 124506 个实参", () => {
    const bad = () => [hp("1970-01-01T00:00:00Z", 0), hp("2026-10-24T00:00:00Z", 100)];
    const candidates = Array.from({ length: MAX_TREND_SERIES }, () => mk({ history: bad() }));
    const grids = candidates.map((c) => buildDailyGrid(c.history));
    const times = grids.flat().map((p) => new Date(p.at).getTime());
    expect(grids).toHaveLength(MAX_TREND_SERIES);
    expect(times).toHaveLength(124506);

    expect(() => Math.min(...times)).toThrow(RangeError);
    expect(() => Math.max(...times)).toThrow(RangeError);

    // 不摊实参的等价写法，结果和 spread 一致，可以直接当修复方向。
    expect(times.reduce((m, t) => Math.min(m, t), Number.POSITIVE_INFINITY)).toBe(Date.parse("1970-01-01T00:00:00Z"));
    expect(times.reduce((m, t) => Math.max(m, t), Number.NEGATIVE_INFINITY)).toBe(Date.parse("2026-10-24T00:00:00Z"));
  });

  // 同一处上限的边界对照：五条还活着，第六条就死。整条链路都走真实函数，不手搓桶。
  it("第五条曲线还扛得住，第六条就越界", () => {
    const bad = () => [hp("1970-01-01T00:00:00Z", 0), hp("2026-10-24T00:00:00Z", 100)];
    const probe = (n: number) => {
      const times = Array.from({ length: n }, () => buildDailyGrid(bad())).flat().map((p) => new Date(p.at).getTime());
      try {
        Math.min(...times);
        return { len: times.length, error: null as Error | null };
      } catch (error) {
        return { len: times.length, error: error as Error };
      }
    };
    expect(probe(5)).toEqual({ len: 103755, error: null });
    const six = probe(6);
    expect(six.len).toBe(124506);
    expect(six.error).toBeInstanceOf(RangeError);
  });
});

describe("统计助手的空/单点/全等边界", () => {
  // derive 里没有 computeSummary：汇总口径分散在组件里（TrendChart 自己算 min/max 与 Δ 表）。
  // 这里用现有的等价助手把同一组边界兜住，别让"没有汇总函数"变成"没有边界测试"。
  it("空历史：delta、网格、降智点、top 全部是空值且不抛", () => {
    expect(computeDelta([])).toEqual({ delta: null, days: null });
    expect(buildDailyGrid([])).toEqual([]);
    expect(findDegradationPoints([])).toEqual([]);
    expect(topCandidates([])).toEqual([]);
    expect(lastPerDay([])).toEqual([]);
  });

  it("单点：delta 为 null，网格与降智点都是单元素/空", () => {
    const one = [hp("2026-10-23T00:00:00Z", 100)];
    expect(computeDelta(one)).toEqual({ delta: null, days: null });
    expect(buildDailyGrid(one)).toHaveLength(1);
    expect(findDegradationPoints(one)).toEqual([]);
  });

  it("全等值：delta 为 0、不产生降智点、网格逐日相同数", () => {
    const flat = [0, 1, 2].map((i) => hp(`2026-10-2${i}T00:00:00Z`, 100));
    expect(computeDelta(flat).delta).toBe(0);
    expect(findDegradationPoints(flat)).toEqual([]);
    expect(buildDailyGrid(flat).map((g) => g.score)).toEqual([100, 100, 100]);
  });
});

describe("覆盖率比值", () => {
  // 没有现成的 ratio 助手（CandidateTable 里内联 coverage / required_tasks），
  // 这里把"0 必做题"的除法行为钉死：不能因为 Infinity/NaN 被判成覆盖满。
  it("required_tasks 为 0 时 coverage/0 是 Infinity 或 NaN，闸门必须显式绕开", () => {
    expect(64 / 0).toBe(Number.POSITIVE_INFINITY);
    expect(0 / 0).toBeNaN();
    const prev = hp("2026-10-17T00:00:00Z", 110);
    // 0 必做题 + 0 覆盖：除法 NaN，闸门跳过。
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "complete", 0, 0)])).toHaveLength(0);
    // 0 必做题 + 有覆盖：除法 Infinity，比 0 大，如果只写 `coverage < required*0.9`
    // 会被当成"超额覆盖"放行——现状是显式跳过。
    expect(findDegradationPoints([prev, hp("2026-10-23T00:00:00Z", 100, "complete", 64, 0)])).toHaveLength(0);
  });
});

describe("roundMatrix", () => {
  it("builds model/effort matrix and missing cells", () => {
    const round = {
      candidates: [
        { model: "A", effort: "low", score: 10 },
        { model: "A", effort: "high", score: 20 },
        { model: "B", effort: "low", score: 30 },
      ],
    } as unknown as RoundData;
    const m = roundMatrix(round);
    expect(m.models).toEqual(["A", "B"]);
    expect(m.efforts).toEqual(["low", "high"]);
    expect(m.cells.get("A|high")?.score).toBe(20);
    expect(m.cells.get("B|high")).toBeUndefined();
  });

  it("keeps an unknown effort column instead of dropping it", () => {
    const round = {
      candidates: [mk({ model: "m", effort: "low" }), mk({ model: "m", effort: "gigantic" })],
    } as unknown as RoundData;
    expect(roundMatrix(round).efforts).toEqual(["low", "gigantic"]);
  });

  it("orders unknown effort columns alphabetically after the known ones", () => {
    const round = {
      candidates: [mk({ effort: "zebra" }), mk({ effort: "alpha" }), mk({ effort: "high" })],
    } as unknown as RoundData;
    expect(roundMatrix(round).efforts).toEqual(["high", "alpha", "zebra"]);
  });

  it("omits effort columns nobody uses", () => {
    expect(roundMatrix({ candidates: [mk({ effort: "low" })] } as unknown as RoundData).efforts).toEqual(["low"]);
  });

  // 契约：cells 是 Map，同 model|effort 重复时后写覆盖，不去重也不报警。
  it("同 model|effort 重复时后写覆盖", () => {
    const round = {
      candidates: [mk({ model: "m", effort: "low", score: 1 }), mk({ model: "m", effort: "low", score: 2 })],
    } as unknown as RoundData;
    const m = roundMatrix(round);
    expect(m.cells.size).toBe(1);
    expect(m.cells.get("m|low")?.score).toBe(2);
    expect(m.models).toEqual(["m"]);
  });

  it("handles an empty round", () => {
    const m = roundMatrix({ candidates: [] } as unknown as RoundData);
    expect(m.models).toEqual([]);
    expect(m.efforts).toEqual([]);
    expect(m.cells.size).toBe(0);
  });
});
