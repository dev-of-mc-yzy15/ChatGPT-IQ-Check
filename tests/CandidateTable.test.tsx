import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandidateTable } from "../src/components/CandidateTable";
import type { RadarCandidate } from "../src/types";

const mk = (o: Partial<RadarCandidate>): RadarCandidate => ({
  model: "A", effort: "high", score: 100, coverage: 64, required_tasks: 64,
  score_status: "complete", graded_runs_count: 10, source_scores: {},
  statistics: { sample_count: 10, elapsed_ms_mean: 1000, api_equivalent_usd_mean: 1 },
  latest_graded_at: "2026-10-23T00:00:00Z",
  history: [{ at: "2026-10-22T00:00:00Z", score: 105, coverage: 64, required_tasks: 64, score_status: "complete" }, { at: "2026-10-23T00:00:00Z", score: 100, coverage: 64, required_tasks: 64, score_status: "complete" }],
  ...o,
});

describe("CandidateTable", () => {
  it("renders rows and sorts by score", async () => {
    const rows = [mk({ model: "A", score: 90 }), mk({ model: "B", score: 110 })];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /分数/ }));
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(cells[0]).toContain("B");
  });

  it("filters by model", async () => {
    const rows = [mk({ model: "A" }), mk({ model: "B" })];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    await userEvent.type(screen.getByLabelText(/搜索模型/), "B");
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("toggles selection", async () => {
    const onToggle = vi.fn();
    render(<CandidateTable rows={[mk({ model: "A" })]} selectedKeys={[]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /选择 A/ }));
    expect(onToggle).toHaveBeenCalledWith("A|high");
  });
});
