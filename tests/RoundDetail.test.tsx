import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    // P1-16：盲评分 0–100，上屏必须先 /100 归一，分母写明，原始分留在括号里可核对。
    const judge = screen.getByRole("heading", { name: /动画盲评/ });
    expect(judge).toHaveTextContent("/ 100");
    expect(judge).toHaveTextContent("0.91");
    expect(judge).toHaveTextContent("原始 91");
    expect(screen.getByText(/不错/)).toBeInTheDocument();
  });

  // P1-16：分项 24 分也必须归一到 0.24，不能原始拼接冒充同一量纲。
  it("normalizes every animation sub-score and spells the denominator", () => {
    render(<RoundDetail candidate={candidate} tasks={tasks} />);
    const line = screen.getByText(/pelican/);
    expect(line).toHaveTextContent("pelican 0.24（24）");
    expect(line).toHaveTextContent("finish 0.19（19）");
    expect(line).toHaveTextContent("/100");
    // 原始值不能被归一抹掉。
    expect(line).toHaveTextContent("cycling 0.23（23）");
  });

  it("keeps an em dash when the animation total is missing", () => {
    render(
      <RoundDetail
        candidate={{ ...candidate, animation: { ...candidate.animation!, score: null } }}
        tasks={tasks}
      />,
    );
    const judge = screen.getByRole("heading", { name: /动画盲评/ });
    expect(judge).toHaveTextContent("— / 100");
    expect(judge).not.toHaveTextContent("NaN");
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

describe("RoundDetail 动画资产", () => {
  const SHA = "69d67bc51db3e2ee7826b9ae19b863bab200efee8359b5c72a1f676267b107b2";
  const UPSTREAM = "/assets/degradation-codex-205416a78068-6a72489e707c-gpt-6.1-sol-low-69d67bc51db3.html.txt";
  const NAME = UPSTREAM.split("/").pop()!;
  const BODY = "<html><body><svg id=\"a\"></svg></body></html>";
  const withAsset = (over: Partial<RoundCandidate> = {}): RoundCandidate => ({
    ...candidate,
    ...over,
    animation: { ...candidate.animation!, asset_url: UPSTREAM, asset_sha256: SHA },
  });

  /** details 的 toggle 事件 jsdom 不会自己派发，手动置位再派发，模拟用户展开。 */
  function expand(container: HTMLElement) {
    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(BODY, { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("默认折叠，展开前不加载、不挂 iframe", () => {
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector("iframe")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("展开后按 base 路径取回文本，走 srcDoc 而不是 src", async () => {
    // 产物是 *.html.txt，托管按扩展名回 text/plain；若用 src，iframe 里只会显示源码。
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expand(container);
    const frame = await screen.findByTitle(/降智动画/);
    expect(fetch).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}assets/${NAME}`, expect.anything());
    // 关键：不渲染 src，改用 srcDoc 强制按 HTML 解析。
    expect(frame).not.toHaveAttribute("src");
    expect(frame.getAttribute("srcDoc")).toContain("<svg");
  });

  it("沙箱恰好只放脚本，绝不放 allow-same-origin", async () => {
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expand(container);
    const frame = await screen.findByTitle(/降智动画/);
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("iframe 尺寸固定且带高度", async () => {
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expand(container);
    const frame = await screen.findByTitle(/降智动画/);
    expect(frame).toHaveAttribute("height", "220");
    expect(frame).toHaveAttribute("width", "100%");
  });

  it("取回失败时给出可读提示，不留空框", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expand(container);
    expect(await screen.findByText(/动画加载失败：HTTP 404/)).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("渲染 asset_sha256 的前 8 位供人肉核对", () => {
    render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    const code = screen.getByText(SHA.slice(0, 8));
    expect(code.tagName).toBe("CODE");
    // 悬停看全文。
    expect(code).toHaveAttribute("title", SHA);
  });

  it("不同候选的 iframe title 各不相同且可读", async () => {
    const a = withAsset({ model: "gpt-6.1-sol", effort: "low" });
    const b = withAsset({ model: "gpt-6-sol", effort: "high" });
    const first = render(<RoundDetail candidate={a} tasks={tasks} />);
    expand(first.container);
    const titleA = (await screen.findByTitle(/降智动画/)).getAttribute("title");
    first.unmount();
    const second = render(<RoundDetail candidate={b} tasks={tasks} />);
    expand(second.container);
    const titleB = (await screen.findByTitle(/降智动画/)).getAttribute("title");
    // 34 个候选若同名，读屏与标签页里就分不清是哪一格。
    expect(titleA).not.toBe(titleB);
    expect(titleA).toContain("gpt-6.1-sol");
    expect(titleA).toContain("低");
    expect(titleB).toContain("gpt-6-sol");
  });

  it("切换候选后折叠状态回落，不自动替新候选加载", async () => {
    const { container, rerender } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expand(container);
    await screen.findByTitle(/降智动画/);
    rerender(<RoundDetail candidate={withAsset({ model: "gpt-6-sol" })} tasks={tasks} />);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("没有 asset_url 时不渲染任何 iframe 或空占位框", () => {
    const bare = withAsset();
    bare.animation = { ...bare.animation!, asset_url: null, asset_sha256: null };
    const { container } = render(<RoundDetail candidate={bare} tasks={tasks} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    // 动画区仍在（摘要、理由都在），只是没有播放器。
    expect(screen.getByRole("heading", { name: /动画盲评/ })).toBeInTheDocument();
    expect(screen.queryByText(/校验和/)).not.toBeInTheDocument();
  });

  it("animation 整体为 null 时也不炸", () => {
    const { container } = render(<RoundDetail candidate={{ ...candidate, animation: null }} tasks={tasks} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("动画不可用")).toBeInTheDocument();
  });
});
