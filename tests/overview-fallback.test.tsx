import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildRadarBenchFromOverview } from "../scripts/lib.mjs";
import roundRaw from "./fixtures/round.sample.json";
import { transformRound } from "../scripts/lib.mjs";

const overview = {
  protocol: "codex-four-weighted-150-v2",
  roundId: "codex-four-279-probe",
  completedAt: "2026-10-31T08:53:42.839890+00:00",
  scoreMax: 150,
  rows: [
    { model: "gpt-6.1-sol", effort: "low", score: 114.375, elapsedMs: 530577, costUsd: 0.36 },
    { model: "gpt-6-luna", effort: "max", score: 84.189, elapsedMs: 971400, costUsd: 0.09 },
    { model: "gpt-5.6-sol", effort: "high", score: 110.25, elapsedMs: 1005657, costUsd: 3.04 },
  ],
};
const radarDoc = buildRadarBenchFromOverview({
  overview,
  generatedAt: "2026-11-01T00:00:00Z",
  checkedAt: "2026-11-01T00:00:00Z",
  fetchId: "f",
});
const roundDoc = {
  schema_version: 1,
  fetch_id: "f",
  generated_at: "2026-11-01T00:00:00Z",
  checked_at: "2026-11-01T00:00:00Z",
  ...transformRound(roundRaw),
};
const statusDoc = {
  checked_at: "2026-11-01T00:00:00Z",
  ok: false,
  benchmark: radarDoc.benchmark,
  score_source: "site-overview",
  candidates_ok: 0,
  candidates_total: radarDoc.candidates.length,
  binding_total: radarDoc.candidates.length,
  reused_count: 0,
  missing_count: 0,
  round_ok: true,
  latest_graded_at: overview.completedAt,
  min_latest: overview.completedAt,
  stale_count: 0,
  round_updated_at: roundDoc.round.updated_at,
  stale_days: 7,
  score_stale_days: 0,
  round_stale_days: 7,
  errors: ["overview: probe"],
};

vi.mock("../src/data/loader", () => {
  const ok = (data: unknown) => ({ data, error: null });
  return {
    slotRadarBench: async () => ok(radarDoc),
    slotRound: async () => ok(roundDoc),
    slotStatus: async () => ok(statusDoc),
    slotRatings: async () => ({ data: null, error: "ratings.json unavailable" }),
    slotFourTask: async () => ({ data: null, error: "four-task.json unavailable" }),
  };
});

it("冒烟：兜底文档能渲染，且横幅讲清来源", async () => {
  const App = (await import("../src/App")).default;
  render(<App />);
  const fatal = screen.queryByText(/出错了|Error/i);
  expect(fatal).toBeNull();
  const banner = await screen.findByRole("status");
  expect(banner.textContent).toContain("降智轮次已 7 天未更新");
});
