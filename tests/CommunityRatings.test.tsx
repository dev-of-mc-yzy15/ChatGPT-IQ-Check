import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CommunityRatings } from "../src/components/CommunityRatings";
import type { RatingRow, RatingsData } from "../src/types";

const row = (o: Partial<RatingRow>): RatingRow => ({
  id: "A|high",
  model: "A",
  effort: "high",
  label: "A high",
  average: 8.5,
  count: 3,
  ...o,
});

const mk = (o: Partial<RatingsData> = {}): RatingsData => ({
  schema_version: 1,
  generated_at: "2026-11-17T00:00:00Z",
  checked_at: "2026-11-17T00:00:00Z",
  window: "rolling_24h",
  window_hours: 24,
  source_updated_at: "2026-11-16T17:44:18Z",
  timezone: "Asia/Shanghai",
  total_slots: 56,
  ratings: [row({}), row({ id: "B|low", model: "B", effort: "low", average: 4, count: 1 })],
  ...o,
});

const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("CommunityRatings", () => {
  it("标题写明有票档位比例与窗口，且强调与 RadarBench 不是一套刻度", () => {
    render(<CommunityRatings data={mk()} />);
    expect(screen.getByRole("heading", { name: "社区体感" })).toBeInTheDocument();
    expect(screen.getByText(/2\/56 个档位有投票/)).toBeInTheDocument();
    expect(screen.getByText(/近 24 小时/)).toBeInTheDocument();
    expect(screen.getByText(/不参与排序/)).toBeInTheDocument();
  });

  it("按传入顺序渲染，星级保留一位小数、票数原样", () => {
    render(<CommunityRatings data={mk()} />);
    const rows = bodyRows();
    expect(rows[0]).toHaveTextContent("A");
    expect(rows[0]).toHaveTextContent("8.5");
    expect(rows[0]).toHaveTextContent("3");
    expect(rows[1]).toHaveTextContent("4.0");
  });

  it("条形宽度按 1–10 归一，且对读屏隐藏（数值本身是文本）", () => {
    const { container } = render(<CommunityRatings data={mk()} />);
    const bars = container.querySelectorAll(".rating-bar > span");
    expect(bars[0]).toHaveStyle({ width: "85%" });
    expect(bars[1]).toHaveStyle({ width: "40%" });
    // 条形是 aria-hidden 的装饰，可访问树里只该有数字
    expect(container.querySelector(".rating-bar")).toHaveAttribute("aria-hidden", "true");
  });

  it("空列表给出空态，不渲染表格", () => {
    render(<CommunityRatings data={mk({ ratings: [], total_slots: 56 })} />);
    expect(screen.getByText(/还没有人打分/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/0\/56 个档位有投票/)).toBeInTheDocument();
  });

  it("off 档显示中文「关闭」而不是 OFF", () => {
    render(<CommunityRatings data={mk({ ratings: [row({ effort: "off", average: 5.5 })] })} />);
    expect(within(bodyRows()[0]).getByText("关闭")).toBeInTheDocument();
  });

  it("上游没给 updated_at 时退回 checked_at，不显示破折号", () => {
    render(<CommunityRatings data={mk({ source_updated_at: null })} />);
    expect(screen.getByText(/2026-11-17 08:00/)).toBeInTheDocument();
  });
});
