import type { FourTaskData } from "../../src/types";

/**
 * 四题协议的最小可用样本：2 个候选 × 2 个批次。
 * 刻意保持小：组件测试关心的是「能不能渲染」，不是「数据够不够多」。
 * 不变量与真实数据一致——tasks 权重和 = score_max，history 末点 = 当前分。
 */
export function makeFourTask(): FourTaskData {
  const at = "2026-11-15T00:00:00.000Z";
  return {
    schema_version: 1,
    generated_at: "2026-11-16T01:42:05.976Z",
    checked_at: "2026-11-16T01:42:05.976Z",
    protocol: "codex-four-weighted-150-v2",
    score_max: 150,
    round: {
      id: "codex-four-test",
      label: "2026-11-16",
      completed_at: "2026-11-16T01:42:05.976Z",
      expected: 184,
      graded: 184,
      asset_prefix: null,
    },
    tasks: [
      { id: "combined", title_zh: "秦始皇", weight: 60, max: 100 },
      { id: "pompeii", title_zh: "庞贝", weight: 45, max: 100 },
      { id: "pelican", title_zh: "鹈鹕", weight: 22.5, max: 100 },
      { id: "candy", title_zh: "糖果", weight: 22.5, max: 100 },
    ],
    candidates: [
      {
        model: "A",
        effort: "high",
        score: 120,
        score_status: "complete",
        latest_at: at,
        tasks: [
          { id: "combined", score: 80, raw_total: 80, capped: false, seconds: 120, cost_usd: 0.02 },
          { id: "pompeii", score: 90, raw_total: 90, capped: false, seconds: 120, cost_usd: 0.02 },
          { id: "pelican", score: 100, raw_total: 100, capped: false, seconds: 120, cost_usd: 0.02 },
          { id: "candy", score: 100, raw_total: 100, capped: false, seconds: 60, cost_usd: 0.01, correct: true },
        ],
        totals: { seconds: 420, cost_usd: 0.07 },
        history: [
          { at: "2026-11-14T00:00:00.000Z", score: 110 },
          { at, score: 120 },
        ],
      },
      {
        model: "B",
        effort: "high",
        score: 90,
        score_status: "complete",
        latest_at: at,
        tasks: [
          { id: "combined", score: 60, raw_total: 75, capped: true, seconds: 90, cost_usd: 0.01 },
          { id: "pompeii", score: 70, raw_total: 70, capped: false, seconds: 90, cost_usd: 0.01 },
          { id: "pelican", score: 80, raw_total: 80, capped: false, seconds: 90, cost_usd: 0.01 },
          { id: "candy", score: 0, raw_total: 0, capped: false, seconds: 30, cost_usd: 0.005, correct: false },
        ],
        totals: { seconds: 300, cost_usd: 0.035 },
        history: [
          { at: "2026-11-14T00:00:00.000Z", score: 95 },
          { at, score: 90 },
        ],
      },
    ],
    batches: [
      { id: "b1", label: "2026-11-14", completed_at: "2026-11-14T00:00:00.000Z", points: 2 },
      { id: "b2", label: "2026-11-16", completed_at: at, points: 2 },
    ],
  };
}
