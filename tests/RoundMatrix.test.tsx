import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // A-4 回归：分档按满分比例走。B/low 的 130 在 150 满分下是 high，在 300 满分下掉到 low。
  it("bands scores against the data's own score_max", () => {
    const scaled: RoundData = {
      ...round,
      candidates: round.candidates.map((c) => ({ ...c, score_max: 300 })),
    };
    render(<RoundMatrix round={scaled} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /^B 低/ })).toHaveAttribute("data-band", "low");
  });

  it("spells the scoreMax and factor in the summary line", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText(/满分 150/)).toBeInTheDocument();
    expect(screen.getByText(/× 1\.5/)).toBeInTheDocument();
  });

  it("renders models, efforts and the specific B|high missing cell", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    // 可访问名走 sr-only 后，模型名同时出现在行头与格子按钮里，存在性断言不再要求唯一。
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
    expect(screen.getByText("20.0")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /B 高/ })).not.toBeInTheDocument();
    const rowB = screen.getByRole("row", { name: /B/ });
    expect(within(rowB).getByText("—")).toBeInTheDocument();
  });

  it("renders the round header", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    const header = screen.getByText(/本轮已完成/, { selector: "p" });
    // P1-11：分母是必做题数（task_count / required 题数），不是候选数。
    expect(header).toHaveTextContent("7/7 题已核验（100%）");
    expect(header).toHaveTextContent("本轮用时 133 分 48 秒");
    // P1-8：费用必须带币种，USD 是本轮唯一的计价单位。
    expect(header).toHaveTextContent("已知测试费用（USD） $2.50（3 题成本未知）");
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
    // 行头和格子按钮里的模型名都必须落在 lang=en 里，读屏才会换英语语音。
    const names = [...screen.getAllByText("A"), ...screen.getAllByText("B")];
    expect(names.length).toBeGreaterThan(0);
    for (const el of names) expect(el.closest("[lang='en']")).toHaveAttribute("lang", "en");
  });

  it("calls onSelect with model|effort on click", async () => {
    const onSelect = vi.fn();
    render(<RoundMatrix round={round} selectedKey={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /A 高/ }));
    expect(onSelect).toHaveBeenCalledWith("A|high");
  });

  // P1-8：费用不带币种，跟别的美元数字混在一起没法判断单位。
  it("spells the USD currency on the cost figure", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText(/已知测试费用/, { selector: "p" })).toHaveTextContent("已知测试费用（USD）");
  });

  // P1-11：候选只有 2 个、必做 8 题时，按候选数算分母会得出 200%，按 required_tasks 算才是进度。
  it("uses required_tasks as the denominator of the verification progress", () => {
    const tasks: RoundData["tasks"] = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`, category: "deepswe", title_zh: `任务${i}`, title_en: `Task ${i}`, weight: 1, required: true,
    }));
    const partial: RoundData = {
      ...round,
      tasks,
      round: { ...round.round, task_count: 8 },
      candidates: [
        { ...round.candidates[0], scored_tasks: 4, total_tasks: 8 },
        { ...round.candidates[1], scored_tasks: 8, total_tasks: 8 },
      ],
    };
    render(<RoundMatrix round={partial} selectedKey={null} onSelect={() => {}} />);
    // 慢的那个档位只核验了 4 题 —— 进度必须按最慢的算，4/8 = 50%，不是 2/2 也不是 4/2。
    const header = screen.getByText(/本轮已完成/, { selector: "p" });
    expect(header).toHaveTextContent("4/8 题已核验（50%）");
  });

  // P1-9：aria-pressed 只给读屏看，没有样式等于选中状态不可见。
  it("gives the pressed cell a visible selected style in theme.css", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/theme.css"), "utf8");
    expect(css).toContain('[aria-pressed="true"]');
    // 必须作用在矩阵格子上，且要有真正能看见的描边或底色，不能只有颜色语义注释。
    // 必须挂在矩阵格子的选择器上，且要有真正能看见的描边或底色。
    const at = css.indexOf('.round-matrix button[aria-pressed="true"]');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toMatch(/border|background|box-shadow/);
  });

  // P1-10：aria-label 是纯文本带不上 lang，可访问名必须由真实文本节点承载。
  it("marks the model name inside the cell with lang=en", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    const cell = screen.getByRole("button", { name: /A 低/ });
    const marked = cell.querySelector("[lang='en']");
    expect(marked).not.toBeNull();
    expect(marked).toHaveTextContent("A");
    // 可访问名仍要能读出档位和分数，不能被 lang 包裹弄丢。
    // 必须精确相等：可见分数已 aria-hidden，名字里只能出现一次，不能是「A 低 10.0 分 10.0」。
    expect(cell).toHaveAccessibleName("A 低 10.0 分");
    expect(cell).toHaveAccessibleName(/^(?!.*\d\.\d.*\d\.\d)/);
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
