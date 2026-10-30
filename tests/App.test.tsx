import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";

vi.mock("../src/data/loader", () => {
  const ok = <T,>(data: T) => ({ data, error: null });
  const payload = {
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
  };

  return {
    loadAll: vi.fn(async () => ({
      round: ok(payload.round),
      radarBench: ok(payload.radarBench),
      status: ok(payload.status),
    })),
    slotRound: vi.fn(async () => ok(payload.round)),
    slotRadarBench: vi.fn(async () => ok(payload.radarBench)),
    slotStatus: vi.fn(async () => ok(payload.status)),
    toSlot: vi.fn(),
  };
});

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

  it("keeps the other tab usable when one slot fails", async () => {
    const { slotRound } = await import("../src/data/loader");
    vi.mocked(slotRound).mockResolvedValueOnce({ data: null, error: "round.json 结构异常：boom" });
    render(<App />);

    expect(await screen.findByText(/本轮雷达加载失败/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();

    // 本轮槽塌了，趋势槽照常
    await userEvent.click(screen.getByRole("tab", { name: /RadarBench 趋势/ }));
    expect(await screen.findByRole("heading", { name: /RadarBench 趋势/ })).toBeInTheDocument();
    expect(screen.queryByText(/趋势加载失败/)).toBeNull();
  });

  it("retries only the failed slot", async () => {
    const { slotStatus } = await import("../src/data/loader");
    vi.mocked(slotStatus).mockResolvedValueOnce({ data: null, error: "status.json 加载失败：HTTP 500" });
    render(<App />);

    const alert = await screen.findByText(/数据状态加载失败/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /本轮雷达/ })).toHaveAttribute("aria-selected", "true");

    const retried = vi.mocked(slotStatus);
    const before = retried.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retried.mock.calls.length).toBe(before + 1);
    // 重试后状态槽恢复：横幅（role=status）重新出现
    expect(await screen.findByRole("status")).toHaveTextContent(/数据检查于/);
    expect(screen.queryByText(/数据状态加载失败/)).toBeNull();
  });
});
