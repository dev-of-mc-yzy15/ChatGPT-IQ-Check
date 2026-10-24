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

const rowTexts = () => screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");

describe("CandidateTable", () => {
  it("defaults to score descending and toggles to ascending on click", async () => {
    const rows = [mk({ model: "A", score: 90 }), mk({ model: "B", score: 110 })];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(rowTexts()[0]).toContain("B");
    await userEvent.click(screen.getByRole("button", { name: /分数/ }));
    expect(rowTexts()[0]).toContain("A");
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

  it("renders complete and provisional status labels", () => {
    const rows = [
      mk({ model: "A", score: 110, score_status: "complete" }),
      mk({ model: "B", score: 90, score_status: "provisional" }),
    ];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    expect(screen.getByText("完整")).toBeInTheDocument();
    const provisional = screen.getByText("临时");
    expect(provisional).toBeInTheDocument();
    expect(provisional).toHaveClass("muted");
  });

  it("shows 暂无候选 when there are no rows", () => {
    render(<CandidateTable rows={[]} selectedKeys={[]} onToggle={() => {}} />);
    expect(screen.getByText("暂无候选")).toBeInTheDocument();
    expect(screen.queryByText("没有匹配的候选")).not.toBeInTheDocument();
  });

  it("shows 没有匹配的候选 when the filter matches nothing", async () => {
    const rows = [mk({ model: "A" }), mk({ model: "B" })];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    await userEvent.type(screen.getByLabelText(/搜索模型/), "Z");
    expect(screen.getByText("没有匹配的候选")).toBeInTheDocument();
    expect(screen.queryByText("暂无候选")).not.toBeInTheDocument();
  });

  it("orders efforts low before high before ultra", async () => {
    const rows = [
      mk({ model: "C", effort: "ultra" }),
      mk({ model: "A", effort: "low" }),
      mk({ model: "B", effort: "high" }),
    ];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /档位/ }));
    const order = rowTexts();
    expect(order[0]).toContain("A");
    expect(order[1]).toContain("B");
    expect(order[2]).toContain("C");
  });

  it("places null latest_graded_at last when sorting by latest", async () => {
    const rows = [
      mk({ model: "A", latest_graded_at: null }),
      mk({ model: "B", latest_graded_at: "2026-10-23T00:00:00Z" }),
    ];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /最近评分/ }));
    const order = rowTexts();
    expect(order[0]).toContain("B");
    expect(order[1]).toContain("A");
  });

  it("reflects sort direction in aria-sort", async () => {
    render(<CandidateTable rows={[mk({ model: "A" })]} selectedKeys={[]} onToggle={() => {}} />);
    const scoreHeader = screen.getByRole("columnheader", { name: /分数/ });
    expect(scoreHeader).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /模型/ })).toHaveAttribute("aria-sort", "none");
    await userEvent.click(screen.getByRole("button", { name: /分数/ }));
    expect(scoreHeader).toHaveAttribute("aria-sort", "ascending");
  });

  it("wraps the model name in lang=en for screen readers", () => {
    render(<CandidateTable rows={[mk({ model: "A" })]} selectedKeys={[]} onToggle={() => {}} />);
    expect(screen.getByText("A").closest("[lang='en']")).toHaveAttribute("lang", "en");
  });

  it("renders a negative delta with the down class and window days", () => {
    render(<CandidateTable rows={[mk({ model: "A" })]} selectedKeys={[]} onToggle={() => {}} />);
    const cell = screen.getByText(/-5\.0/).closest("td");
    expect(cell).toHaveClass("down");
    expect(cell).toHaveTextContent("1 天");
  });
});
