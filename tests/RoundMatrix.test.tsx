import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoundMatrix } from "../src/components/RoundMatrix";
import type { RoundData } from "../src/types";

const round: RoundData = {
  schema_version: 1, fetch_id: "f", generated_at: "2026-10-24T00:00:00Z", checked_at: "2026-10-24T00:00:00Z",
  source_schema: "degradation-codex-plan/2",
  round: {
    id: "r", status: "completed",
    started_at: "2026-10-23T08:29:34Z",
    completed_at: "2026-10-23T10:43:22Z",
    updated_at: "2026-10-23T10:43:22Z",
    taskset_version: "t", task_count: 7, timings: { wall_seconds: 8028.01 },
  },
  tasks: [],
  candidates: [
    { model: "A", effort: "low", score: 10, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0.5, cost_known_tasks: 7, cost_unknown_tasks: 0 }, animation: null },
    { model: "A", effort: "high", score: 20, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0.75, cost_known_tasks: 6, cost_unknown_tasks: 1 }, animation: null },
    { model: "B", effort: "low", score: 130, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 1.25, cost_known_tasks: 5, cost_unknown_tasks: 2 }, animation: null },
  ],
};

describe("RoundMatrix", () => {
  it("renders models, efforts and the specific B|high missing cell", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("20.0")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /B 高/ })).not.toBeInTheDocument();
    const rowB = screen.getByRole("row", { name: /B/ });
    expect(within(rowB).getByText("—")).toBeInTheDocument();
  });

  it("renders the round header", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    const header = screen.getByText(/本轮已完成/, { selector: "p" });
    expect(header).toHaveTextContent("3/3 档位核验");
    expect(header).toHaveTextContent("本轮用时 133 分 48 秒");
    expect(header).toHaveTextContent("已知测试费用 $2.50（3 题成本未知）");
    expect(screen.getByText(/数据更新 2026-10-23 18:43/, { selector: "p" })).toBeInTheDocument();
  });

  it("keeps effort columns in reasoning order", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["模型", "低", "高"]);
  });

  it("applies a score band to each present cell", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /A 低/ })).toHaveAttribute("data-band", "verylow");
    expect(screen.getByRole("button", { name: /B 低/ })).toHaveAttribute("data-band", "high");
  });

  it("reflects the selected cell with aria-pressed", () => {
    render(<RoundMatrix round={round} selectedKey="A|high" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /A 高/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /A 低/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("wraps model row headers in lang=en for screen readers", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText("A").closest("[lang='en']")).toHaveAttribute("lang", "en");
    expect(screen.getByText("B").closest("[lang='en']")).toHaveAttribute("lang", "en");
  });

  it("calls onSelect with model|effort on click", async () => {
    const onSelect = vi.fn();
    render(<RoundMatrix round={round} selectedKey={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /A 高/ }));
    expect(onSelect).toHaveBeenCalledWith("A|high");
  });

  it("activates cells from the keyboard with Enter and Space", async () => {
    const onSelect = vi.fn();
    render(<RoundMatrix round={round} selectedKey={null} onSelect={onSelect} />);
    const cell = screen.getByRole("button", { name: /A 高/ });
    cell.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("A|high");
    onSelect.mockClear();
    cell.focus();
    await userEvent.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith("A|high");
  });
});
