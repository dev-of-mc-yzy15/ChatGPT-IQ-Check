import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import summaryRaw from "./fixtures/summary.sample.json";
import { CandidateTable } from "../src/components/CandidateTable";
import {
  DEGRADE_THRESHOLD,
  EFFORT_ORDER,
  MAX_GRID_DAYS,
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
 * 同一 UTC 日的两个跨时区时刻：字面小时 10 < 23，带偏移之后真实时间却是 22:00Z > 09:00Z。
 * 按原始 at 字符串比（localeCompare 实测返回 -1）会把更晚的排到更早，整列跨时区倒挂。
 */
const AT_REAL_EARLY = "2026-10-23T23:00:00+14:00"; // → 2026-10-23T09:00:00Z
const AT_REAL_LATE = "2026-10-23T10:00:00-12:00"; // → 2026-10-23T22:00:00Z

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

  // 排序的基准必须是解析后的毫秒值，不能是原始 at 字符串。
  // 混时区时本地日期文本可能和真实先后相反，返回序列一旦倒挂：
  // 下游 computeDelta 把跌算成涨、把 days 算成负数，findDegradationPoints 直接**漏报降智**。
  it("按解析时间排序，混合时区不再倒挂也不再漏报降智", () => {
    const earlier = hp("2026-10-25T00:00:00+14:00", 110); // UTC 10-24T10:00
    const later = hp("2026-10-24T23:59:00-12:00", 100); // UTC 10-25T11:59，真实是跌了 10 分
    expect(Date.parse(earlier.at)).toBeLessThan(Date.parse(later.at));
    // 真实先后是 earlier → later，两种入参顺序都必须排成同一结果。
    expect(lastPerDay([earlier, later]).map((r) => r.at)).toEqual([earlier.at, later.at]);
    expect(lastPerDay([later, earlier]).map((r) => r.at)).toEqual([earlier.at, later.at]);
    // 跌 10 就是跌 10，days 是正的 1。
    expect(computeDelta(lastPerDay([later, earlier]))).toEqual({ delta: -10, days: 1 });
    // findDegradationPoints 内部自己再排一次，调用方把入参排成什么样都要报出来。
    for (const input of [[earlier, later], [later, earlier]]) {
      const found = findDegradationPoints(input);
      expect(found).toHaveLength(1);
      expect(found[0].point.score).toBe(100);
      expect(found[0].delta).toBe(-10);
      expect(found[0].days).toBe(1);
    }
  });

  // 坏日期解析成 NaN，排序时垫到末尾，不能因为 NaN 比较恒假就卡在队首。
  it("解不出时间的点排在末尾，好点仍按时间升序", () => {
    const rows = lastPerDay([
      hp("garbage", 1),
      hp("2026-10-23T09:00:00Z", 100),
      hp("2026-10-21T00:00:00Z", 105),
    ]);
    expect(rows.map((r) => r.at)).toEqual(["2026-10-21T00:00:00Z", "2026-10-23T09:00:00Z", "garbage"]);
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

  // 同分 tie-break 也必须按毫秒，不是按 latest_graded_at 的字面串。
  // App 用它选默认 6 条趋势曲线（App.tsx:130），排错就是默认选中的那几条错了。
  it("breaks a score tie on real elapsed time across time zones, not on the literal string", () => {
    const rows = [
      mk({ model: "earlier", score: 100, latest_graded_at: AT_REAL_EARLY }),
      mk({ model: "later", score: 100, latest_graded_at: AT_REAL_LATE }),
    ];
    expect(topCandidates(rows, 1).map((r) => r.model)).toEqual(["later"]);
  });

  it("sinks unparseable grading times on a tie and does not throw", () => {
    const rows = [
      mk({ model: "garbage", score: 100, latest_graded_at: "x" }),
      mk({ model: "blank", score: 100, latest_graded_at: "" }),
      mk({ model: "parsed", score: 100, latest_graded_at: AT_REAL_LATE }),
    ];
    expect(() => topCandidates(rows, 3)).not.toThrow();
    expect(topCandidates(rows, 3).map((r) => r.model)[0]).toBe("parsed");
    // 两个坏值的相对次序不承诺，但都必须落在可解析值之后。
    expect(topCandidates(rows, 3).map((r) => r.model).slice(1).sort()).toEqual(["blank", "garbage"]);
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

  // 缺陷一：时间键原本走 av.localeCompare(String(bv), "en")，比的是字面串。
  // 这对方括号里的两个时刻真实顺序与字典序相反，整列按「最近评分」排序会跨时区倒挂。
  it("orders latest_graded_at ascending by real instant across time zones", () => {
    const rows = [mk({ model: "later", latest_graded_at: AT_REAL_LATE }), mk({ model: "earlier", latest_graded_at: AT_REAL_EARLY })];
    expect(sortCandidates(rows, "latest_graded_at", "asc").map((r) => r.model)).toEqual(["earlier", "later"]);
  });

  it("orders latest_graded_at descending by real instant across time zones", () => {
    const rows = [mk({ model: "earlier", latest_graded_at: AT_REAL_EARLY }), mk({ model: "later", latest_graded_at: AT_REAL_LATE })];
    expect(sortCandidates(rows, "latest_graded_at", "desc").map((r) => r.model)).toEqual(["later", "earlier"]);
  });

  // 坏日期与 null 同待遇：恒垫底、两个方向都不翻到前面、且不抛。
  it("sinks unparseable grading times in both directions without throwing", () => {
    const rows = [
      mk({ model: "garbage", latest_graded_at: "x" }),
      mk({ model: "blank", latest_graded_at: "" }),
      mk({ model: "parsed", latest_graded_at: AT_REAL_LATE }),
    ];
    for (const dir of ["asc", "desc"] as const) {
      expect(() => sortCandidates(rows, "latest_graded_at", dir)).not.toThrow();
      const order = sortCandidates(rows, "latest_graded_at", dir).map((r) => r.model);
      expect(order[0]).toBe("parsed");
      expect(order.slice(1).sort()).toEqual(["blank", "garbage"]);
    }
  });

  // 契约：模型名走自然序（numeric-aware）——数字段按数值比。gpt-6 必须排在 gpt-10 前面。
  // 纯字典序逐字符比，"1" < "6"，点一下「按模型排序」看到的就是 gpt-10 在前这种反直觉顺序。
  it("sorts model strings in natural (numeric-aware) order", () => {
    const rows = [mk({ model: "gpt-6" }), mk({ model: "gpt-10" }), mk({ model: "claude" })];
    expect(sortCandidates(rows, "model", "asc").map((r) => r.model)).toEqual(["claude", "gpt-6", "gpt-10"]);
    expect(sortCandidates(rows, "model", "desc").map((r) => r.model)).toEqual(["gpt-10", "gpt-6", "claude"]);
  });

  it("puts gpt-6 before gpt-10 on asc — numeric, not lexicographic", () => {
    const rows = [mk({ model: "gpt-10" }), mk({ model: "gpt-6" })];
    expect(sortCandidates(rows, "model", "asc").map((r) => r.model)).toEqual(["gpt-6", "gpt-10"]);
  });

  it("puts gpt-10 before gpt-6 on desc — the direction flips, the numeric reading does not", () => {
    const rows = [mk({ model: "gpt-6" }), mk({ model: "gpt-10" })];
    expect(sortCandidates(rows, "model", "desc").map((r) => r.model)).toEqual(["gpt-10", "gpt-6"]);
  });

  it("compares the o-series numerically too: o3-mini before o10-mini", () => {
    const rows = [mk({ model: "o10-mini" }), mk({ model: "o3-mini" })];
    expect(sortCandidates(rows, "model", "asc").map((r) => r.model)).toEqual(["o3-mini", "o10-mini"]);
    expect(sortCandidates(rows, "model", "desc").map((r) => r.model)).toEqual(["o10-mini", "o3-mini"]);
  });

  // 规则：数字段相等时短名在前（gpt-6 → gpt-6-mini）。-mini 是同一版本的降档，不该排到主版本前面。
  it("puts the shorter name first when numeric segments tie: gpt-6 before gpt-6-mini", () => {
    const rows = [mk({ model: "gpt-6-mini" }), mk({ model: "gpt-6" })];
    expect(sortCandidates(rows, "model", "asc").map((r) => r.model)).toEqual(["gpt-6", "gpt-6-mini"]);
  });

  // 只差大小写：不抛，且两次调用必须是同一个顺序（确定性，不靠运气）。
  it("keeps case-only variants deterministic: gpt-6 before GPT-6, identical across calls", () => {
    const rows = [mk({ model: "GPT-6" }), mk({ model: "gpt-6" })];
    const asc = () => sortCandidates(rows, "model", "asc").map((r) => r.model);
    expect(asc()).toEqual(["gpt-6", "GPT-6"]);
    expect(asc()).toEqual(asc());
    expect(sortCandidates(rows, "model", "desc").map((r) => r.model)).toEqual(["GPT-6", "gpt-6"]);
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

  // 同日取值必须和 lastPerDay 同口径：比的是时间，不是数组位置。
  // 两条序列一旦各留一个值，折线和红点就会指着同一天的两个不同分数。
  it("同一天多条时取时间最晚的一条，与 lastPerDay 同口径", () => {
    const rows = [hp("2026-10-20T09:00:00Z", 100), hp("2026-10-20T08:00:00Z", 108)];
    // 09:00 更晚，两处都必须留 100。
    expect(lastPerDay(rows)[0].score).toBe(100);
    expect(buildDailyGrid(rows)[0].score).toBe(100);
    // 把数组顺序反过来，两处也都不许变。
    const reversed = [...rows].reverse();
    expect(lastPerDay(reversed)[0].score).toBe(100);
    expect(buildDailyGrid(reversed)[0].score).toBe(100);
  });

  // 跨度必须封顶。一个 1970 的坏点（epoch 哨兵/上游默认值）能把网格铺出两万多个桶，
  // 其中只有一两个有值，横轴被拉成一条线，其他正常曲线全被压平。
  it("一个 1970 的坏点不再把网格撑到两万多个空桶", () => {
    const grid = buildDailyGrid([hp("1970-01-01T00:00:00Z", 0), hp("2026-10-24T00:00:00Z", 100)]);
    const uncapped = Math.round(
      (Date.parse("2026-10-24T00:00:00Z") - Date.parse("1970-01-01T00:00:00Z")) / 86400000,
    ) + 1;
    // 不受限时本会是 20751 个桶（列出来是为了盯住封顶到底压掉了多少）。
    expect(uncapped).toBe(20751);
    // 封顶后正好是「最近 MAX_GRID_DAYS 天」，坏点被挤出窗口。
    expect(grid).toHaveLength(MAX_GRID_DAYS);
    expect(grid[0]).toEqual({ at: "2023-10-21T00:00:00.000Z", score: null });
    expect(grid[grid.length - 1]).toEqual({ at: "2026-10-24T00:00:00.000Z", score: 100 });
    // 窗口里只剩最近那个点：不再有两万个 null 陪跑。
    expect(grid.filter((g) => g.score != null)).toHaveLength(1);
  });

  // 边界：跨度正好等于上限时不截，多一天才截掉最老的一天。上限只能截、不能吞正常数据。
  it("跨度正好在上限上时不截断，超一天才挤掉最老的一天", () => {
    const day = 86400000;
    const lastMs = Date.parse("2026-10-24T00:00:00Z");
    const atDaysAgo = (n: number) => new Date(lastMs - (n - 1) * day).toISOString();
    const onLimit = buildDailyGrid([hp(atDaysAgo(MAX_GRID_DAYS), 1), hp(atDaysAgo(1), 2)]);
    expect(onLimit).toHaveLength(MAX_GRID_DAYS);
    expect(onLimit[0].score).toBe(1);
    const overLimit = buildDailyGrid([hp(atDaysAgo(MAX_GRID_DAYS + 1), 1), hp(atDaysAgo(1), 2)]);
    expect(overLimit).toHaveLength(MAX_GRID_DAYS);
    expect(overLimit[0].score).toBeNull();
    expect(overLimit[overLimit.length - 1].score).toBe(2);
  });

  // 判据用例：正常数据是 1~2 年历史，两年（731 天）必须一个字都不变——逐日完整、不被截。
  it("两年历史仍在上限内，网格逐日完整不被截断", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const rows = Array.from({ length: 731 }, (_, i) =>
      hp(new Date(start + i * 86400000).toISOString(), i % 100),
    );
    const grid = buildDailyGrid(rows);
    expect(grid).toHaveLength(731);
    expect(grid.filter((g) => g.score == null)).toHaveLength(0);
    expect(grid[0].score).toBe(0);
    expect(grid[730].score).toBe(730 % 100);
  });

  // `Math.min(...times)` 把整段历史摊成实参，V8 的实参上限撑不住 13 万：
  // 抛 RangeError: Maximum call stack size exceeded，整张图直接白屏（TrendChart 外层没有 try）。
  // 断言不锁定桶数：跨度上限（MAX_GRID_DAYS）落地后网格会被截短，但「不炸」必须成立。
  it("13 万个点不再把 min/max 摊成实参，网格照常产出", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const huge = Array.from({ length: 130000 }, (_, i) =>
      hp(new Date(start + i * 86400000).toISOString(), i % 150),
    );
    expect(huge).toHaveLength(130000);
    const lastMs = start + 129999 * 86400000;
    const lastDay = new Date(lastMs).toISOString();
    let grid: { at: string; score: number | null }[] = [];
    expect(() => {
      grid = buildDailyGrid(huge);
    }).not.toThrow();
    // 真跑完全程：末桶是最后一天且带着最后一条的分值，不是半路截断的空壳。
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.length).toBeLessThanOrEqual(130000);
    expect(grid[grid.length - 1]).toEqual({ at: lastDay, score: 129999 % 150 });
  });
});

describe("TrendChart 聚合：grids.flat() 后再 spread", () => {
  // 组件侧原本是 `grids.flat()` 之后 `Math.min(...times)`：按**日桶**摊，不是按原始点数。
  // 未封顶时一条带 1970 坏点的曲线就是 20751 个桶，MAX_TREND_SERIES 条叠起来 124506 个实参
  // （实测 124000 还能过、124506 就抛 RangeError），六条各沾一个坏点首页整张图白屏。
  // 跨度封顶（MAX_GRID_DAYS）落地后总实参降到 6 × MAX_GRID_DAYS，spread 又扛得住了；
  // 组件侧仍改成单趟循环，不让「上限哪天被调大或去掉就重新白屏」由运气决定。
  it("六条曲线各带一个 1970 坏点：封顶后总桶数受控，首尾仍算得出来", () => {
    const bad = () => [hp("1970-01-01T00:00:00Z", 0), hp("2026-10-24T00:00:00Z", 100)];
    const candidates = Array.from({ length: MAX_TREND_SERIES }, () => mk({ history: bad() }));
    const grids = candidates.map((c) => buildDailyGrid(c.history));
    const times = grids.flat().map((p) => new Date(p.at).getTime());
    expect(grids).toHaveLength(MAX_TREND_SERIES);
    expect(times).toHaveLength(MAX_TREND_SERIES * MAX_GRID_DAYS);

    expect(() => Math.min(...times)).not.toThrow();
    // 封顶把 1970 挤出窗口：横轴首日是窗口首日，不再是 1970。
    expect(Math.min(...times)).toBe(Date.parse("2023-10-21T00:00:00.000Z"));
    expect(Math.max(...times)).toBe(Date.parse("2026-10-24T00:00:00Z"));
  });

  // 桶数按 MAX_GRID_DAYS 线性增长，两条都远在上限内。
  it("封顶后五条、六条都在实参上限内，桶数线性增长", () => {
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
    expect(probe(5)).toEqual({ len: 5 * MAX_GRID_DAYS, error: null });
    expect(probe(6)).toEqual({ len: 6 * MAX_GRID_DAYS, error: null });
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

describe("CandidateTable 的 Δ 单元格：days 为 NaN 时不上屏", () => {
  // computeDelta 对解不出的 at 会给出 NaN 的 days，这个 derive 侧行为已被上面的用例钉死、不改成 null。
  // UI 侧原本只判 `days != null`——NaN != null 为真，于是单元格里写成了 "/ NaN 天"。
  it("omits the day suffix instead of printing NaN", () => {
    const bad = mk({ model: "A", history: [hp("not-a-date", 105), hp("2026-10-23T00:00:00Z", 100)] });
    render(createElement(CandidateTable, { rows: [bad], selectedKeys: [], onToggle: () => {}, scoreMax: 150 }));
    const cell = screen.getByText(/-5\.0/).closest("td") as HTMLElement;
    expect(cell).not.toBeNull();
    expect(cell.textContent).not.toContain("NaN");
    // delta 本身照旧上屏，只是不再拼天数。
    expect(cell).toHaveTextContent("▼ -5.0");
  });

  // 有限天数不能被这次收紧顺手删掉。
  it("still prints the day suffix for a finite day count", () => {
    // mk 的默认 history 是空数组（delta 为 null，单元格只剩破折号），这里必须自带两天数据。
    const ok = mk({ model: "B", history: [hp("2026-10-22T00:00:00Z", 105), hp("2026-10-23T00:00:00Z", 100)] });
    render(createElement(CandidateTable, { rows: [ok], selectedKeys: [], onToggle: () => {}, scoreMax: 150 }));
    const cell = screen.getByText(/-5\.0/).closest("td") as HTMLElement;
    expect(cell).toHaveTextContent("1 天");
  });
});
