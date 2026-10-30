import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrendChart } from "../src/components/TrendChart";
import { TrendControls } from "../src/components/TrendControls";
import type { RadarCandidate } from "../src/types";

const mk = (o: Partial<RadarCandidate> = {}): RadarCandidate => ({
  model: "A", effort: "high", score: 100, coverage: 64, required_tasks: 64,
  score_status: "complete", graded_runs_count: 10, source_scores: {},
  statistics: { sample_count: 10, elapsed_ms_mean: 1000, api_equivalent_usd_mean: 1 },
  latest_graded_at: "2026-10-23T00:00:00Z",
  history: [
    { at: "2026-10-17T00:00:00Z", score: 110, coverage: 64, required_tasks: 64, score_status: "complete" },
    { at: "2026-10-20T00:00:00Z", score: 108, coverage: 64, required_tasks: 64, score_status: "complete" },
    { at: "2026-10-23T00:00:00Z", score: 100, coverage: 64, required_tasks: 64, score_status: "complete" },
  ],
  ...o,
});

const candidate = mk();

describe("TrendChart", () => {
  it("renders a chart with a text alternative and data table", () => {
    render(<TrendChart candidates={[candidate]} scoreMax={150} />);
    expect(screen.getByRole("img", { name: /RadarBench 趋势/ })).toBeInTheDocument();
    expect(screen.getByText(/分数下降/)).toBeInTheDocument();
    expect(screen.getByText(/2026-10-23/)).toBeInTheDocument();
  });

  // A-4 回归：满分来自数据，换上限时刻度必须跟着变，不能死贴 150。
  it("scales y-axis ticks to the provided scoreMax", () => {
    render(<TrendChart candidates={[mk()]} scoreMax={300} />);
    const labels = screen.getAllByText(/^\d+$/).map((n) => n.textContent);
    expect(labels).toContain("100");
    expect(labels).toContain("300");
    expect(labels).not.toContain("50");
  });

  it("spells the real scoreMax in the description", () => {
    render(<TrendChart candidates={[mk()]} scoreMax={300} />);
    expect(screen.getByText(/0 到 300/)).toBeInTheDocument();
  });

  // P0-5 回归：散点与红点都必须走按天去重后的序列，同一天多次评分只能留最晚一条。
  it("draws one scatter point per day, using the last reading of the day", () => {
    const c = mk({
      history: [
        { at: "2026-10-17T00:00:00Z", score: 110, coverage: 64, required_tasks: 64, score_status: "complete" },
        { at: "2026-10-23T08:00:00Z", score: 108, coverage: 64, required_tasks: 64, score_status: "complete" },
        { at: "2026-10-23T09:00:00Z", score: 100, coverage: 64, required_tasks: 64, score_status: "complete" },
      ],
    });
    const { container } = render(<TrendChart candidates={[c]} scoreMax={150} />);
    const circles = [...container.querySelectorAll("circle")];
    const dots = circles.filter((el) => el.getAttribute("r") === "3");
    const reds = circles.filter((el) => el.getAttribute("fill") === "var(--down)");
    // 10-17 与 10-23 两天 → 两个散点，不是三个
    expect(dots).toHaveLength(2);
    // 红点只有一个，且落在 09:00 那一天的最后一条上
    expect(reds).toHaveLength(1);
    expect(reds[0].getAttribute("cx")).toBe(dots[1].getAttribute("cx"));
    const titles = [...container.querySelectorAll("title")].map((t) => t.textContent ?? "");
    expect(titles.some((t) => t.includes("分数下降"))).toBe(true);
    // 散点数量与数据表行数一致（表里仍是原始行，供核对）
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    // Δ 列首行为空、后续为相邻两点差值：预先算好的差值表必须与逐点前缀算法同值。
    const deltaCells = [...container.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild?.textContent);
    expect(deltaCells).toEqual(["—", "-2.0", "-8.0"]);
  });

  it("renders empty state", () => {
    render(<TrendChart candidates={[]} scoreMax={150} />);
    expect(screen.getByText(/暂无可展示的曲线/)).toBeInTheDocument();
  });

  it("renders 暂无历史数据 when candidates have no points", () => {
    render(<TrendChart candidates={[mk({ history: [] })]} scoreMax={150} />);
    expect(screen.getByText(/暂无历史数据/)).toBeInTheDocument();
  });

  it("breaks the line across missing daily buckets", () => {
    const withGap = mk({
      history: [
        { at: "2026-10-17T00:00:00Z", score: 100, coverage: 64, required_tasks: 64, score_status: "complete" },
        { at: "2026-10-19T00:00:00Z", score: 101, coverage: 64, required_tasks: 64, score_status: "complete" },
      ],
    });
    const { container } = render(<TrendChart candidates={[withGap]} scoreMax={150} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });

  it("renders complete points filled and provisional points hollow", () => {
    const mixed = mk({
      history: [
        { at: "2026-10-17T00:00:00Z", score: 100, coverage: 64, required_tasks: 64, score_status: "provisional" },
        { at: "2026-10-18T00:00:00Z", score: 101, coverage: 64, required_tasks: 64, score_status: "complete" },
      ],
    });
    const { container } = render(<TrendChart candidates={[mixed]} scoreMax={150} />);
    const circles = Array.from(container.querySelectorAll("circle"));
    expect(circles).toHaveLength(2);
    expect(circles[0]).toHaveAttribute("fill", "var(--bg)");
    expect(circles[1]).toHaveAttribute("fill", "#1d4ed8");
  });

  it("marks degradation points in red with an annotation", () => {
    const { container } = render(<TrendChart candidates={[candidate]} scoreMax={150} />);
    const degrade = Array.from(container.querySelectorAll("circle")).find(
      (c) => c.getAttribute("fill") === "var(--down)",
    );
    expect(degrade).toBeDefined();
    expect(degrade?.querySelector("title")?.textContent).toMatch(/分数下降 -8\.0/);
  });

  // P1-12：图例原本是静态 span，只能看不能点，读屏也拿不到开关状态。
  it("renders each legend entry as a pressed toggle button", () => {
    render(<TrendChart candidates={[mk()]} scoreMax={150} />);
    const legend = screen.getByRole("button", { name: /A/ });
    expect(legend).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles a series off and back on from the legend", async () => {
    const { container } = render(<TrendChart candidates={[mk()]} scoreMax={150} />);
    expect(container.querySelectorAll("polyline")).toHaveLength(3);
    const legend = screen.getByRole("button", { name: /A/ });

    await userEvent.click(legend);
    // 关：aria-pressed 翻转，曲线与散点一起从图里撤掉。
    expect(legend).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelectorAll("polyline")).toHaveLength(0);
    expect(container.querySelectorAll("circle")).toHaveLength(0);

    await userEvent.click(legend);
    // 开：回到按下态，曲线复原。
    expect(legend).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll("polyline")).toHaveLength(3);
  });

  // 关掉一条不影响另一条：两条曲线的开关是各自独立的。
  it("keeps the other series visible when one is toggled off", async () => {
    const { container } = render(<TrendChart candidates={[mk(), mk({ model: "B" })]} scoreMax={150} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    // 剩下的那条曲线还在：3 段折线仍在。
    expect(container.querySelectorAll("polyline")).toHaveLength(3);
  });

  it("labels the x axis in Asia/Shanghai MM-DD", () => {
    const { container } = render(<TrendChart candidates={[candidate]} scoreMax={150} />);
    const labels = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent ?? "");
    expect(labels).toContain("10-17");
    expect(labels).toContain("10-23");
    expect(labels.some((l) => /^\d{2}-\d{2}$/.test(l))).toBe(true);
  });
});

describe("TrendControls", () => {
  const rows = Array.from({ length: 7 }, (_, i) => mk({ model: `M${i}`, effort: "high" }));
  const keys = rows.slice(0, 6).map((r) => r.model + "|" + r.effort);

  it("shows selected / total and disables extra rows at the max", () => {
    render(<TrendControls rows={rows} selectedKeys={keys} onToggle={() => {}} />);
    expect(screen.getByText(/当前 6 \/ 7/)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(7);
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(6);
    expect(boxes[6]).toBeDisabled();
  });

  it("toggles a row", async () => {
    const onToggle = vi.fn();
    render(<TrendControls rows={rows.slice(0, 2)} selectedKeys={[]} onToggle={onToggle} />);
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("M0|high");
  });
});