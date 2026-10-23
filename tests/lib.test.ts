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

  it("falls back to SCORE_MAX when score_max is not finite", () => {
    const b = transformBinding({
      model_efforts: [{ model: "gpt-6-astra", effort: "high" }],
      score_max: "nope",
    });
    expect(b.score_max).toBe(150);
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
    expect(() => transformSummary({ ...summaryRaw, score: "nope" })).toThrow(/invalid score/);
  });

  it("throws on null score instead of coercing it to 0", () => {
    expect(() => transformSummary({ ...summaryRaw, score: null })).toThrow(/invalid score/);
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
