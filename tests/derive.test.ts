import { describe, it, expect } from "vitest";
import {
  sortCandidates, computeDelta, findDegradationPoints, topCandidates, buildDailyGrid, lastPerDay, roundMatrix,
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

describe("sortCandidates", () => {
  it("sorts by score desc and keeps nulls last", () => {
    const rows = [mk({ score: 90 }), mk({ score: 110 }), mk({ score: 0 })];
    expect(sortCandidates(rows, "score", "desc").map((r) => r.score)).toEqual([110, 90, 0]);
  });
  it("sorts effort by reasoning order", () => {
    const rows = [mk({ effort: "ultra" }), mk({ effort: "low" }), mk({ effort: "high" })];
    expect(sortCandidates(rows, "effort", "asc").map((r) => r.effort)).toEqual(["low", "high", "ultra"]);
  });
});

describe("computeDelta / findDegradationPoints", () => {
  it("computes delta and window days", () => {
    const h = [hp("2026-10-17T00:00:00Z", 107.33), hp("2026-10-23T00:00:00Z", 104.56)];
    expect(computeDelta(h)).toEqual({ delta: -2.8, days: 6 });
  });
  it("marks a degradation point only when complete and covered", () => {
    const h = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100)];
    expect(findDegradationPoints(h)).toHaveLength(1);
    const provisional = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100, "provisional")];
    expect(findDegradationPoints(provisional)).toHaveLength(0);
  });

  // P0-4：required_tasks 为 0 时右边是 0，coverage < 0 恒假，闸门曾经形同不存在
  it("does not treat a zero required_tasks point as covered", () => {
    const h = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100, "complete", 0, 0)];
    expect(findDegradationPoints(h)).toHaveLength(0);
  });

  it("rejects a point whose coverage is not a number", () => {
    const h = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100, "complete", Number.NaN, 64)];
    expect(findDegradationPoints(h)).toHaveLength(0);
  });

  it("still marks a fully covered drop", () => {
    const h = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100, "complete", 60, 64)];
    expect(findDegradationPoints(h)).toHaveLength(1);
  });

  it("drops a point below the 90% coverage gate", () => {
    const h = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100, "complete", 50, 64)];
    expect(findDegradationPoints(h)).toHaveLength(0);
  });

  // P0-5：降智点曾按原始 history 相邻两行判断，同一天两次评分会被当成两天
  it("compares day buckets, not raw adjacent rows", () => {
    const h = [
      hp("2026-10-17T00:00:00Z", 110),
      hp("2026-10-23T08:00:00Z", 108),
      hp("2026-10-23T09:00:00Z", 100),
    ];
    const found = findDegradationPoints(h);
    expect(found).toHaveLength(1);
    expect(found[0].point.at).toBe("2026-10-23T09:00:00Z");
    expect(found[0].delta).toBe(-10);
    expect(found[0].days).toBe(6);
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
});

describe("buildDailyGrid", () => {
  it("fills missing days with null", () => {
    const grid = buildDailyGrid([hp("2026-10-20T00:00:00Z", 100), hp("2026-10-22T00:00:00Z", 90)]);
    expect(grid.map((p) => p.score)).toEqual([100, null, 90]);
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
});
