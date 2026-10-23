import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoundDetail } from "../src/components/RoundDetail";
import type { RoundCandidate, RoundTaskDef } from "../src/types";

const tasks: RoundTaskDef[] = [
  { id: "t1", category: "deepswe", title_zh: "任务一", title_en: "Task one", weight: 1, required: true },
  { id: "t2", category: "tb4", title_zh: "任务二", title_en: "Task two", weight: 1, required: true },
];
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
  it("renders tasks, totals and animation", () => {
    render(<RoundDetail candidate={candidate} tasks={tasks} />);
    expect(screen.getByText("任务一")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /120\.0/ })).toBeInTheDocument();
    expect(screen.getByText(/91/)).toBeInTheDocument();
    expect(screen.getByText(/不错/)).toBeInTheDocument();
  });
});
