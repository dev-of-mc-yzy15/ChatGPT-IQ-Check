import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";

vi.mock("../src/data/loader", () => ({
  loadAll: vi.fn(async () => ({
    round: {
      schema_version: 1,
      fetch_id: "f",
      generated_at: "2026-10-24T00:00:00Z",
      checked_at: "2026-10-24T00:00:00Z",
      source_schema: "degradation-codex-plan/2",
      round: {
        id: "r",
        status: "completed",
        started_at: "2026-10-23T08:29:34Z",
        completed_at: "2026-10-23T10:43:22Z",
        updated_at: "2026-10-23T10:43:22Z",
        taskset_version: "t",
        task_count: 7,
        timings: { wall_seconds: 8028 },
      },
      tasks: [],
      candidates: [
        {
          model: "A",
          effort: "high",
          score: 120,
          score_max: 150,
          score_status: "complete",
          scored_tasks: 7,
          total_tasks: 7,
          tasks: [],
          totals: {
            seconds: 0,
            cost_usd: 0,
            cost_known_tasks: 0,
            cost_unknown_tasks: 0,
          },
          animation: null,
        },
      ],
    },
    radarBench: {
      schema_version: 1,
      fetch_id: "f",
      generated_at: "2026-10-24T00:00:00Z",
      checked_at: "2026-10-24T00:00:00Z",
      benchmark: "b",
      score_version: "v",
      score_max: 150,
      catalog_version: "c",
      task_set_sha256: "s",
      candidates: [
        {
          model: "A",
          effort: "high",
          score: 100,
          coverage: 64,
          required_tasks: 64,
          score_status: "complete",
          graded_runs_count: 1,
          source_scores: {},
          statistics: {
            sample_count: 1,
            elapsed_ms_mean: 1,
            api_equivalent_usd_mean: 1,
          },
          latest_graded_at: "2026-10-23T00:00:00Z",
          history: [],
        },
      ],
    },
    status: {
      checked_at: "2026-10-24T00:00:00Z",
      ok: true,
      benchmark: "b",
      candidates_ok: 1,
      candidates_total: 1,
      round_ok: true,
      latest_graded_at: "2026-10-23T00:00:00Z",
      round_updated_at: "2026-10-23T10:43:22Z",
      stale_days: 0,
      errors: [],
    },
  })),
}));

describe("App", () => {
  it("renders the round tab and switches to trend", async () => {
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: /降智雷达/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /本轮雷达/ }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("tab", { name: /RadarBench 趋势/ }),
    );
    expect(
      screen.getByRole("heading", { name: /RadarBench 趋势/ }),
    ).toBeInTheDocument();
  });

  it("renders an error state when loading fails", async () => {
    const { loadAll } = await import("../src/data/loader");
    vi.mocked(loadAll).mockRejectedValueOnce(new Error("boom"));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/);
  });
});
