import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoundDetail } from "../src/components/RoundDetail";
import type { RoundCandidate, RoundData, RoundTaskDef } from "../src/types";

const tasks: RoundTaskDef[] = [
  { id: "t1", category: "deepswe", title_zh: "任务一", title_en: "Task one", weight: 1, required: true },
  { id: "t2", category: "tb4", title_zh: "任务二", title_en: "Task two", weight: 1, required: true },
];
const round: RoundData["round"] = {
  id: "r", status: "completed",
  started_at: "2026-10-23T08:29:34Z",
  completed_at: "2026-10-23T10:43:22Z",
  updated_at: "2026-10-23T10:43:22Z",
  taskset_version: "t", task_count: 7, timings: { wall_seconds: 8028.01 },
};
const candidate: RoundCandidate = {
  model: "A", effort: "high", score: 120, score_max: 150, score_status: "complete", scored_tasks: 2, total_tasks: 2,
  tasks: [
    { task_id: "t1", status: "scored", reward: 1, seconds: 60, cost_usd: 0.5 },
    { task_id: "t2", status: "scored", reward: 0.5, seconds: 120, cost_usd: null },
  ],
  totals: { seconds: 180, cost_usd: 0.5, cost_known_tasks: 1, cost_unknown_tasks: 1 },
  animation: { status: "available", score: 91, scores: { pelican: 24, cycling: 23, motion: 25, finish: 19 }, reason: "不错", seconds: 400, cost_usd: 0.84, asset_url: "/a" },
};

describe("RoundDetail", () => {
  it("renders tasks, totals, rewards and animation", () => {
    render(<RoundDetail candidate={candidate} tasks={tasks} />);
    expect(screen.getByText("任务一")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /120\.0/ })).toBeInTheDocument();
    const totals = screen.getByText(/全部题已评分/, { selector: "p" });
    expect(totals).toHaveTextContent("用时 3 分 0 秒");
    expect(totals).toHaveTextContent("已知成本 $0.50（1 题成本未知）");
    expect(screen.getByText("1.000")).toBeInTheDocument();
    expect(screen.getByText("0.500")).toBeInTheDocument();
    expect(screen.getByText(/91/)).toBeInTheDocument();
    expect(screen.getByText(/不错/)).toBeInTheDocument();
  });

  it("renders the round timestamps when round is provided", () => {
    render(<RoundDetail candidate={candidate} tasks={tasks} round={round} />);
    const line = screen.getByText(/开始 2026-10-23 16:29/, { selector: "p" });
    expect(line).toHaveTextContent("完成 2026-10-23 18:43 · 更新 2026-10-23 18:43");
  });

  it("omits the round timestamps when round is not provided", () => {
    render(<RoundDetail candidate={candidate} tasks={tasks} />);
    expect(screen.queryByText(/开始 2026/)).not.toBeInTheDocument();
  });

  it("shows the null-candidate prompt", () => {
    render(<RoundDetail candidate={null} tasks={tasks} />);
    expect(screen.getByText("选择上方格子查看逐题详情。")).toBeInTheDocument();
  });

  it("shows a muted fallback when the animation is unavailable", () => {
    render(
      <RoundDetail
        candidate={{ ...candidate, animation: { ...candidate.animation!, status: "unavailable" } }}
        tasks={tasks}
      />,
    );
    expect(screen.getByText("动画不可用")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /动画盲评/ })).not.toBeInTheDocument();
  });
});
