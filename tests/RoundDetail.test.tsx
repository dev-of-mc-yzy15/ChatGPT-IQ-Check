import { describe, it, expect } from "vitest";
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
  /** 本地落盘名：`.html.txt` 去掉 `.txt`，iframe 用 src 加载的就是它。 */
  const LOCAL = "degradation-codex-205416a78068-6a72489e707c-gpt-6.1-sol-low-69d67bc51db3.html";
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

  it("默认折叠，展开前不挂 iframe", () => {
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    // 一轮 34 个候选各有几十 KB，折叠时不进 DOM，别让首屏替全部候选买单。
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("展开后用 src 指向本地 .html，不再走 srcDoc", async () => {
    // 关键契约：srcDoc 的子文档继承父文档 CSP，index.html 的 script-src 只放行主题脚本
    // 那一个 hash，产物自带的内联 script 会被 script-src-elem 全挡掉，动画只剩静帧。
    // 改用 src 后子文档是独立文档、不继承父 CSP；前提是产物按 .html 落盘（托管回 text/html）。
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expand(container);
    const frame = await screen.findByTitle(/降智动画/);
    expect(frame).toHaveAttribute("src", `${import.meta.env.BASE_URL}assets/${LOCAL}`);
    // src 必须落成本地 .html：留着上游的 .html.txt 会拿到 text/plain，屏上是源码。
    expect(frame.getAttribute("src")).not.toContain(".html.txt");
    // 两条路只能留一条：src 和 srcDoc 同时挂会以 srcDoc 为准，等于白改。
    expect(frame).not.toHaveAttribute("srcDoc");
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

  it("展开即挂 iframe，失败交给浏览器兜底，不留空的取回中间态", async () => {
    // 改成 src 之后组件不再 fetch：没有「正在加载动画…」这种自己维护的中间态，
    // 也不再需要自己渲染 HTTP 错误文案（jsdom 不加载 iframe，断言不到真实错误页，
    // 真实取回失败由 tests/e2e 覆盖）。这里钉住的是「展开后必定有 iframe」。
    const { container } = render(<RoundDetail candidate={withAsset()} tasks={tasks} />);
    expand(container);
    const frame = await screen.findByTitle(/降智动画/);
    expect(frame.tagName).toBe("IFRAME");
    expect(screen.queryByText(/正在加载动画/)).not.toBeInTheDocument();
    expect(screen.queryByText(/动画加载失败/)).not.toBeInTheDocument();
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
