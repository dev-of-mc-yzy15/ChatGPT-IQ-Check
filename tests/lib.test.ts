import { describe, it, expect } from "vitest";
import bindingRaw from "./fixtures/binding.sample.json";
import summaryRaw from "./fixtures/summary.sample.json";
import {
  transformBinding,
  transformSummary,
  mergeRadarBench,
  splitRatingId,
  transformFourTask,
  transformRatings,
  validateRadarBench,
} from "../scripts/lib.mjs";
import ratingsRaw from "./fixtures/ratings.sample.json";

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

  // 这个时间戳也会进前端的排序与格式化，原样透传等于把垃圾值放进 UI。
  it("throws on an unparseable detail_metrics.latest_graded_at", () => {
    const broken = {
      ...summaryRaw,
      detail_metrics: { ...summaryRaw.detail_metrics, latest_graded_at: "not-a-date" },
    };
    expect(() => transformSummary(broken)).toThrow(/summary\.detail_metrics\.latest_graded_at/);
  });

  // 没给就是真的没有评分时间，保持 null，不能被上面的严格校验误伤。
  it("keeps latest_graded_at null when detail_metrics omits it", () => {
    expect(transformSummary({ ...summaryRaw, detail_metrics: undefined }).latest_graded_at).toBeNull();
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
  // 后续要拿这个值校验下载下来的动画资产，转换层丢了就再也拿不回来。
  it("keeps the upstream asset sha256", () => {
    const r = transformRound(roundRaw);
    const high = r.candidates.find((c) => c.effort === "high")!;
    expect(high.animation?.asset_sha256).toBe("941fa56cdad0ab9adf2be43a9cf8bb8731f4044443972d7e0032cac74bb2683a");
  });
  // UI 用 score_max 画刻度和档位，硬编码会让上游改分数上限时 round 板默默画歪。
  it("honours a passed scoreMax instead of the hardcoded one", () => {
    const r = transformRound(roundRaw, { scoreMax: 200 });
    expect(r.candidates.map((c) => c.score_max)).toEqual([200, 200]);
    expect(() => validateRound(withEnvelope(r), { minCandidates: 2 })).not.toThrow();
  });
  it("defaults scoreMax to 150 when the caller omits it", () => {
    expect(transformRound(roundRaw).candidates.map((c) => c.score_max)).toEqual([150, 150]);
  });
});

describe("splitRatingId", () => {
  it("从右往左切出档位，模型名里的连字符/点号原样保留", () => {
    expect(splitRatingId("gpt-6-astra-xhigh")).toEqual({ model: "gpt-6-astra", effort: "xhigh" });
    expect(splitRatingId("gpt-6.1-sol-off")).toEqual({ model: "gpt-6.1-sol", effort: "off" });
    expect(splitRatingId("dsv4-pro-high")).toEqual({ model: "dsv4-pro", effort: "high" });
  });

  it("未知档位退回最后一个连字符，不把整条丢掉", () => {
    // 上游将来加 nano 之类的新档，后缀表认不出也得拿到 effort，否则整个新档位会消失
    expect(splitRatingId("gpt-7-nano")).toEqual({ model: "gpt-7", effort: "nano" });
  });

  it("拆不开的串返回 null（没有连字符 / 连字符在首尾）", () => {
    expect(splitRatingId("gpt6")).toBeNull();
    expect(splitRatingId("-high")).toBeNull();
    expect(splitRatingId("gpt-6-")).toBeNull();
    expect(splitRatingId("")).toBeNull();
  });
});

describe("transformRatings", () => {
  const stamps = { generatedAt: "2026-11-17T00:00:00Z", checkedAt: "2026-11-17T00:00:00Z" };

  it("只留有票档位，按星级降序、同分按票数降序", () => {
    const doc = transformRatings(ratingsRaw, stamps);
    expect(doc.total_slots).toBe(6);
    expect(doc.ratings.map((r) => r.id)).toEqual([
      "gpt-6-astra-xhigh", // 10
      "gpt-6-astra-max", // 8.4
      "dsv4-pro-high", // 7.25 → 7.3
      "gpt-6.1-sol-off", // 5.5
      "gpt-5.6-luna-low", // 2
    ]);
    expect(doc.window).toBe("rolling_24h");
    expect(doc.window_hours).toBe(24);
    expect(doc.timezone).toBe("Asia/Shanghai");
    expect(doc.source_updated_at).toBe("2026-11-16T17:44:18.712Z");
    expect(doc.schema_version).toBe(1);
  });

  it("平均分收口到一位小数，identity 三个字段都来自上游", () => {
    const doc = transformRatings(ratingsRaw, stamps);
    const dsv4 = doc.ratings.find((r) => r.id === "dsv4-pro-high");
    expect(dsv4).toMatchObject({ model: "dsv4-pro", effort: "high", average: 7.3, count: 2 });
  });

  it("count>0 但 average=null 的中间态也丢掉：落盘会让契约打红", () => {
    const raw = {
      ...ratingsRaw,
      models: [{ id: "gpt-6-astra-max", label: "x", average: null, count: 3 }],
    };
    expect(transformRatings(raw, stamps).ratings).toEqual([]);
  });

  it("重复 id 只收一次", () => {
    const raw = {
      ...ratingsRaw,
      models: [
        { id: "a-high", label: "a", average: 5, count: 1 },
        { id: "a-high", label: "a", average: 5, count: 1 },
      ],
    };
    expect(transformRatings(raw, stamps).ratings).toHaveLength(1);
  });

  it("models 为空 / 非对象直接抛，不落一份空文件顶替", () => {
    expect(() => transformRatings({ models: [] }, stamps)).toThrow(/models is empty/);
    expect(() => transformRatings(null, stamps)).toThrow(/invalid payload/);
  });

  it("缺 updated_at / timezone 时落 null，不编造时间", () => {
    const doc = transformRatings({ models: [{ id: "a-high", label: "a", average: 5, count: 1 }] }, stamps);
    expect(doc.source_updated_at).toBeNull();
    expect(doc.timezone).toBeNull();
    expect(doc.window).toBe("rolling_24h"); // 缺 window 用默认值
  });
});

describe("transformFourTask", () => {
  const W = { combined: 60, pompeii: 45, pelican: 22.5, candy: 22.5 };
  const stamps = { generatedAt: "2026-11-16T02:00:00Z", checkedAt: "2026-11-16T02:00:00Z" };

  const trendsStub = (scores: (number | null)[] = [120, 133.5]) => ({
    score_max: 150,
    batches: scores.map((score, i) => ({
      id: "b" + (i + 1),
      label: "2026-11-1" + (4 + i * 2),
      completed_at: `2026-11-${14 + i * 2}T00:00:00Z`,
      protocol: "codex-four-weighted-150-v2",
      task_weights: W,
      points: score == null ? [] : [{ model: "A", effort: "high", score }],
    })),
  });

  const fourStub = (over: Record<string, unknown> = {}) => ({
    round_id: "r1",
    protocol: "codex-four-weighted-150-v2",
    verified_at: "2026-11-16T01:42:05Z",
    expected: 4,
    graded: 4,
    all_graded: true,
    score_max: 150,
    task_weights: W,
    rows: [
      {
        model: "A",
        effort: "high",
        combined: {
          score: 80,
          raw_score_total: 84.5,
          applied_caps: [{ id: "CORE_COMPLETENESS", limit: 69 }],
          model_elapsed_seconds: 100,
          cost_usd: 0.1,
          model_completed_at: "2026-11-16T00:30:00Z",
        },
        pompeii: {
          score100: 90,
          reward: 0.9,
          model_elapsed_seconds: 200,
          cost_usd: 0.2,
          model_completed_at: "2026-11-16T00:10:00Z",
        },
        pelican: {
          score: 100,
          raw_score_total: 100,
          applied_caps: [],
          model_elapsed_seconds: 300,
          cost_usd: 0.3,
          model_completed_at: "2026-11-16T00:20:00Z",
        },
        candy: {
          correct: true,
          model_elapsed_seconds: 50,
          cost_usd: 0.05,
          model_completed_at: "2026-11-16T00:40:00Z",
        },
      },
    ],
    ...over,
  });

  it("四个任务按权重合成总分，且与上游给的 score 对得上", () => {
    const doc = transformFourTask(trendsStub(), fourStub(), stamps);
    const c = doc.candidates[0];
    // 80×0.6 + 90×0.45 + 100×0.225 + 100×0.225 = 133.5
    const weighted = c.tasks.reduce((acc: number, t: any) => {
      const w = doc.tasks.find((x: any) => x.id === t.id).weight;
      return acc + (t.score * w) / 100;
    }, 0);
    expect(Math.round(weighted * 1000) / 1000).toBe(133.5);
    expect(c.score).toBe(133.5);
    expect(c.history.map((p: any) => p.score)).toEqual([120, 133.5]);
  });

  it("糖果只出对错，映射成 100 / 0", () => {
    const ok = transformFourTask(trendsStub(), fourStub(), stamps).candidates[0];
    expect(ok.tasks.find((t: any) => t.id === "candy")).toMatchObject({ score: 100, correct: true });

    const row = fourStub().rows[0];
    row.candy.correct = false;
    const bad = transformFourTask(trendsStub([120, 87]), fourStub({ rows: [row] }), stamps).candidates[0];
    expect(bad.tasks.find((t: any) => t.id === "candy")).toMatchObject({ score: 0, correct: false });
  });

  it("封顶要留痕：原始分高于计入分时 capped=true", () => {
    const c = transformFourTask(trendsStub(), fourStub(), stamps).candidates[0];
    const combined = c.tasks.find((t: any) => t.id === "combined");
    expect(combined).toMatchObject({ score: 80, raw_total: 84.5, capped: true });
    expect(c.tasks.find((t: any) => t.id === "pelican").capped).toBe(false);
  });

  it("耗时与成本按四个任务求和，latest_at 取最晚的那个任务", () => {
    const c = transformFourTask(trendsStub(), fourStub(), stamps).candidates[0];
    expect(c.totals.seconds).toBe(650);
    expect(c.totals.cost_usd).toBe(0.65);
    expect(c.latest_at).toBe("2026-11-16T00:40:00Z");
  });

  it("未全评的轮次直接拒绝：缺题时总分是「不完整」而不是「低」", () => {
    expect(() => transformFourTask(trendsStub(), fourStub({ all_graded: false }), stamps)).toThrow(
      /not fully graded/,
    );
  });

  it("趋势里没有该组合的历史直接抛：不补点，补出来的测量是伪造", () => {
    const orphan = trendsStub([120, 133.5]);
    for (const b of orphan.batches) b.points = [{ model: "Z", effort: "low", score: 100 }];
    expect(() => transformFourTask(orphan, fourStub(), stamps)).toThrow(/no history/);
  });

  it("无批次的趋势源拒绝", () => {
    expect(() => transformFourTask({ batches: [] }, fourStub(), stamps)).toThrow(/no batches/);
  });

  it("缺 correct 的糖果行拒绝：布尔值才能决定 100 还是 0", () => {
    const row = fourStub().rows[0];
    delete (row.candy as any).correct;
    expect(() => transformFourTask(trendsStub(), fourStub({ rows: [row] }), stamps)).toThrow(
      /candy\.correct/,
    );
  });

  it("score 为 null 的批次被跳过，不向前补点", () => {
    const doc = transformFourTask(trendsStub([120, null, 133.5]), fourStub(), stamps);
    expect(doc.candidates[0].history).toHaveLength(2);
    expect(doc.batches).toHaveLength(3);
  });
});
