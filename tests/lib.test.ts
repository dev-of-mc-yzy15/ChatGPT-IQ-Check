import { describe, it, expect } from "vitest";
import bindingRaw from "./fixtures/binding.sample.json";
import summaryRaw from "./fixtures/summary.sample.json";
import {
  transformBinding,
  transformSummary,
  mergeRadarBench,
  validateRadarBench,
} from "../scripts/lib.mjs";

describe("transformBinding", () => {
  it("dedupes and keeps model/effort pairs", () => {
    const b = transformBinding(bindingRaw);
    expect(b.candidates).toEqual([
      { model: "gpt-6-astra", effort: "high" },
      { model: "gpt-6-astra", effort: "low" },
      { model: "gpt-6.1-sol", effort: "high" },
    ]);
    expect(b.benchmark).toBe("radar-bench-final64-20261004");
    expect(b.score_max).toBe(150);
  });

  it("drops duplicate model/effort pairs, keeping the first occurrence", () => {
    const b = transformBinding({
      model_efforts: [
        { model: "gpt-6-astra", effort: "high" },
        { model: "gpt-6-astra", effort: "high" },
        { model: "gpt-6-astra", effort: "low" },
        { model: "gpt-6-astra", effort: "high" },
      ],
    });
    expect(b.candidates).toEqual([
      { model: "gpt-6-astra", effort: "high" },
      { model: "gpt-6-astra", effort: "low" },
    ]);
  });

  it("falls back to SCORE_MAX only when score_max is absent", () => {
    const b = transformBinding({
      model_efforts: [{ model: "gpt-6-astra", effort: "high" }],
    });
    expect(b.score_max).toBe(150);
  });

  // 给了坏值就抛，不再静默回退成 150 掩盖上游变化。
  it("throws when score_max is present but not finite", () => {
    expect(() =>
      transformBinding({
        model_efforts: [{ model: "gpt-6-astra", effort: "high" }],
        score_max: "nope",
      }),
    ).toThrow(/binding\.score_max/);
  });

  it("throws when score_max is zero or negative", () => {
    expect(() =>
      transformBinding({
        model_efforts: [{ model: "gpt-6-astra", effort: "high" }],
        score_max: 0,
      }),
    ).toThrow(/binding\.score_max/);
  });

  it("throws on empty model_efforts", () => {
    expect(() => transformBinding({ model_efforts: [] })).toThrow(/empty/);
  });
});

describe("transformSummary", () => {
  it("normalizes score, coverage and sorted history", () => {
    const s = transformSummary(summaryRaw);
    expect(s.model).toBe("gpt-6-astra");
    expect(s.effort).toBe("high");
    expect(s.score).toBeCloseTo(104.5615, 4);
    expect(s.coverage).toBe(64);
    expect(s.score_status).toBe("complete");
    expect(s.history).toHaveLength(3);
    expect(s.history[0].at).toBe("2026-10-09T00:00:00.000Z");
    expect(s.history[2].score).toBeCloseTo(104.5615, 4);
  });

  it("throws on invalid score", () => {
    expect(() => transformSummary({ ...summaryRaw, score: "nope" })).toThrow(/summary\.score/);
  });

  it("throws on null score instead of coercing it to 0", () => {
    expect(() => transformSummary({ ...summaryRaw, score: null })).toThrow(/summary\.score/);
  });

  it("preserves null elapsed_ms.mean instead of coercing it to 0", () => {
    const s = transformSummary({
      model: "gpt-6-astra",
      effort: "high",
      score: 100,
      statistics: {
        sample_count: 1,
        metrics: {
          elapsed_ms: { mean: null },
          api_equivalent_usd: { mean: 3 },
        },
      },
    });
    expect(s.statistics.elapsed_ms_mean).toBeNull();
    expect(s.statistics.api_equivalent_usd_mean).toBe(3);
  });

  it("preserves null api_equivalent_usd.mean instead of coercing it to 0", () => {
    const s = transformSummary({
      model: "gpt-6-astra",
      effort: "high",
      score: 100,
      statistics: {
        sample_count: 1,
        metrics: {
          elapsed_ms: { mean: 1000 },
          api_equivalent_usd: { mean: null },
        },
      },
    });
    expect(s.statistics.elapsed_ms_mean).toBe(1000);
    expect(s.statistics.api_equivalent_usd_mean).toBeNull();
  });
});

describe("transformSummary 的静默归零", () => {
  it("throws on empty-string score", () => {
    expect(() => transformSummary({ ...summaryRaw, score: "" })).toThrow(/summary\.score/);
  });

  it("throws on empty-string coverage instead of writing 0", () => {
    expect(() => transformSummary({ ...summaryRaw, coverage: "" })).toThrow(/summary\.coverage/);
  });

  it("throws on a history point with an unparseable score", () => {
    const broken = {
      ...summaryRaw,
      history: { points: [{ at: "2026-10-09T00:00:00.000Z", score: "", coverage: 64 }] },
    };
    expect(() => transformSummary(broken)).toThrow(/summary\.history\[0\]\.score/);
  });

  it("throws on an unparseable history timestamp", () => {
    const broken = { ...summaryRaw, history: { points: [{ at: "not-a-date", score: 10 }] } };
    expect(() => transformSummary(broken)).toThrow(/summary\.history\[0\]\.at/);
  });

  // 整段 history 缺失是合法的（候选没跑过），但形状对了却给不出数组就不是"没有历史"。
  it("throws when history exists but carries no points array", () => {
    expect(() => transformSummary({ ...summaryRaw, history: {} })).toThrow(/summary\.history\.points/);
  });

  it("accepts a summary with no history at all", () => {
    expect(transformSummary({ ...summaryRaw, history: undefined }).history).toEqual([]);
  });

  it("still keeps an absent score nullable for elapsed/api means", () => {
    expect(transformSummary(summaryRaw).statistics.elapsed_ms_mean).not.toBeUndefined();
  });

  it("accepts numeric strings without changing their value", () => {
    const s2 = transformSummary({ ...summaryRaw, coverage: "64" });
    expect(s2.coverage).toBe(64);
  });
});

describe("round 身份串", () => {
  // A-5 回归：key 用 split("|") 切，model 自带管道符时 effort 会被切错。
  it("parses a model containing a pipe without losing the effort", () => {
    const round = transformRound({
      round: {
        id: "r",
        results: { "odd|model|high": { t1: { status: "ok", reward: 1 } } },
      },
      tasks: [{ id: "t1", weight: 1 }],
      taskset: { task_count: 1 },
    });
    expect(round.candidates[0].model).toBe("odd|model");
    expect(round.candidates[0].effort).toBe("high");
  });
});

describe("mergeRadarBench + validateRadarBench", () => {
  it("merges summaries in binding order", () => {
    const b = transformBinding(bindingRaw);
    const summaries = b.candidates.map((c) => ({
      ...transformSummary(summaryRaw),
      model: c.model,
      effort: c.effort,
    }));
    const data = mergeRadarBench({
      binding: bindingRaw,
      summaries,
      generatedAt: "2026-10-24T00:00:00.000Z",
      checkedAt: "2026-10-24T00:00:00.000Z",
      fetchId: "test-fetch",
    });
    expect(data.candidates.map((c) => c.model + "|" + c.effort)).toEqual([
      "gpt-6-astra|high",
      "gpt-6-astra|low",
      "gpt-6.1-sol|high",
    ]);
    expect(() => validateRadarBench(data, { minCandidates: 3 })).not.toThrow();
    expect(() => validateRadarBench(data, { minCandidates: 30 })).toThrow(/too few/);
  });

  it("throws when a summary is missing", () => {
    const summaries = [transformSummary(summaryRaw)];
    expect(() => mergeRadarBench({
      binding: bindingRaw,
      summaries,
      generatedAt: "2026-10-24T00:00:00.000Z",
      checkedAt: "2026-10-24T00:00:00.000Z",
      fetchId: "test-fetch",
    })).toThrow(/missing summary/);
  });
});

import roundRaw from "./fixtures/round.sample.json";
import { computeRoundScore, transformRound, validateRound } from "../scripts/lib.mjs";

describe("computeRoundScore", () => {
  const tasks = roundRaw.tasks;
  it("computes 100 * mean(reward) * 1.5", () => {
    const r = computeRoundScore(roundRaw.round.results["gpt-6-astra|high"], tasks);
    expect(r.score).toBeCloseTo(126.8, 1);
    expect(r.scored_tasks).toBe(7);
    expect(r.status).toBe("complete");
  });
  it("returns partial when a task is missing", () => {
    const partial = { ...roundRaw.round.results["gpt-6-astra|high"] };
    delete (partial as Record<string, unknown>)["tb4:sound-change-cascade"];
    const r = computeRoundScore(partial, tasks);
    expect(r.status).toBe("partial");
    expect(r.scored_tasks).toBe(6);
  });
  it("returns null score when nothing is scored", () => {
    const r = computeRoundScore({}, tasks);
    expect(r.score).toBeNull();
    expect(r.status).toBe("partial");
  });
});

describe("transformRound", () => {
  // validateRound 校验的是落盘产物（带信封字段），transformRound 只产出内层，
  // 信封由 refresh 补齐，所以这里补一个壳再验。
  const withEnvelope = (r: ReturnType<typeof transformRound>) => ({
    schema_version: 1 as const,
    fetch_id: "fixture-fetch",
    generated_at: "2026-10-24T00:00:00.000Z",
    checked_at: "2026-10-24T00:00:00.000Z",
    ...r,
  });

  it("normalizes tasks, candidates, totals and animation", () => {
    const r = transformRound(roundRaw);
    expect(r.tasks).toHaveLength(7);
    expect(r.candidates).toHaveLength(2);
    const high = r.candidates.find((c) => c.effort === "high")!;
    expect(high.score).toBeCloseTo(126.8, 1);
    expect(high.tasks).toHaveLength(7);
    expect(high.totals.cost_unknown_tasks).toBe(2);
    expect(high.animation?.score).toBe(91);
    expect(high.animation?.scores.pelican).toBe(24);
  });
  it("validates schema and task count", () => {
    const r = withEnvelope(transformRound(roundRaw));
    expect(() => validateRound(r, { minCandidates: 2 })).not.toThrow();
    expect(() => validateRound({ ...r, tasks: [] }, { minCandidates: 2 })).toThrow(/round\.tasks/);
  });
  // 回归：上游任务集会轮换（7 → 8 题），不能硬编码数量。
  it("accepts a task set whose size differs from the fixture", () => {
    const extra = {
      ...roundRaw,
      tasks: [
        ...roundRaw.tasks,
        { id: "extra-task", category: "x", title_zh: "额外", title_en: "extra", weight: 1, required: true },
      ],
      taskset: { ...roundRaw.taskset, task_count: 8 },
    };
    const r = transformRound(extra);
    expect(r.tasks).toHaveLength(8);
    expect(r.round.task_count).toBe(8);
    expect(() => validateRound(withEnvelope(r), { minCandidates: 2 })).not.toThrow();
  });
  it("rejects a task list that disagrees with the declared task_count", () => {
    const mismatched = { ...roundRaw, taskset: { ...roundRaw.taskset, task_count: 9 } };
    expect(() => transformRound(mismatched)).toThrow(/task_count 9 != tasks 7/);
  });
});
