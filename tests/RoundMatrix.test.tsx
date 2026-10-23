import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoundMatrix } from "../src/components/RoundMatrix";
import type { RoundData } from "../src/types";

const round: RoundData = {
  schema_version: 1, fetch_id: "f", generated_at: "2026-10-24T00:00:00Z", checked_at: "2026-10-24T00:00:00Z",
  source_schema: "degradation-codex-plan/2",
  round: { id: "r", status: "completed", started_at: "", completed_at: "", updated_at: "2026-10-23T10:43:22Z", taskset_version: "t", task_count: 7, timings: {} },
  tasks: [],
  candidates: [
    { model: "A", effort: "low", score: 10, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 }, animation: null },
    { model: "A", effort: "high", score: 20, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 }, animation: null },
    { model: "B", effort: "low", score: 30, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 }, animation: null },
  ],
};

describe("RoundMatrix", () => {
  it("renders models, efforts and missing cells", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("20.0")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("calls onSelect with model|effort", async () => {
    const onSelect = vi.fn();
    render(<RoundMatrix round={round} selectedKey={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /A 高/ }));
    expect(onSelect).toHaveBeenCalledWith("A|high");
  });
});
