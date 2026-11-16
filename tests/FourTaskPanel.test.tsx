import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FourTaskPanel } from "../src/components/FourTaskPanel";
import { makeFourTask } from "./fixtures/fourTask";

const renderPanel = () => render(<FourTaskPanel data={makeFourTask()} />);

describe("FourTaskPanel", () => {
  it("标题与协议说明来自数据，不写死", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "四题竞技场" })).toBeInTheDocument();
    // 轮次与题数取 data.round，上游换轮次时文案要跟着动
    expect(screen.getAllByText(/2026-11-16/).length).toBeGreaterThan(0);
    expect(screen.getByText(/184\/184 题全部评分/)).toBeInTheDocument();
  });

  it("四个任务的中文名与权重都渲染出来", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: /四题排名/ });
    for (const title of ["秦始皇", "庞贝", "鹈鹕", "糖果"]) {
      expect(within(table).getAllByRole("columnheader", { name: title }).length).toBeGreaterThan(0);
    }
    // 权重和写在概览里，是读者判断「总分怎么来的」的唯一线索
    expect(screen.getByText(/秦始皇 60/)).toBeInTheDocument();
    expect(screen.getByText(/糖果 22.5/)).toBeInTheDocument();
  });

  it("排名表按总分降序，而不是按数据里的原始顺序", () => {
    renderPanel();
    const rows = within(screen.getByRole("table", { name: /四题排名/ })).getAllByRole("row").slice(1);
    // fixture 里 A=120、B=90，A 必须在前
    expect(rows[0]).toHaveTextContent("A");
    expect(rows[0]).toHaveTextContent("120");
    expect(rows[1]).toHaveTextContent("B");
    expect(rows[1]).toHaveTextContent("90");
  });

  it("封顶的行标出「封顶」，不把被规则压过的分当成本事", () => {
    renderPanel();
    const rows = within(screen.getByRole("table", { name: /四题排名/ })).getAllByRole("row").slice(1);
    expect(rows[1]).toHaveTextContent("封顶");
    expect(rows[0]).not.toHaveTextContent("封顶");
  });

  it("糖果列在明细里显示对/错，不是 100/0", () => {
    renderPanel();
    return userEvent.click(screen.getByText("A", { selector: "td *" })).then(() => {
      const detail = screen.getByRole("table", { name: "任务明细" });
      const candyRow = within(detail).getAllByRole("row").find((r) => r.textContent?.includes("糖果"))!;
      expect(candyRow).toHaveTextContent("对");
    });
  });

  it("点行展开明细，再点一次收起", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.queryByRole("table", { name: "任务明细" })).not.toBeInTheDocument();

    const rows = within(screen.getByRole("table", { name: /四题排名/ })).getAllByRole("row").slice(1);
    await user.click(rows[0]);
    const detail = screen.getByRole("table", { name: "任务明细" });
    // 单项得分 + 计入总分的加权值都要在
    expect(within(detail).getAllByRole("row").length).toBe(5);

    await user.click(rows[0]);
    expect(screen.queryByRole("table", { name: "任务明细" })).not.toBeInTheDocument();
  });

  it("图例按模型分组：每个模型一个开关加它的档位按钮", () => {
    renderPanel();
    const modelToggle = screen.getByRole("button", { name: /^A$/ });
    expect(modelToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("明细里的加权分与总分刻度一致（得分 × 权重 ÷ 100）", async () => {
    const user = userEvent.setup();
    renderPanel();
    const rows = within(screen.getByRole("table", { name: /四题排名/ })).getAllByRole("row").slice(1);
    await user.click(rows[0]);
    const detail = screen.getByRole("table", { name: "任务明细" });
    // A 的 combined = 80 分 × 60% = 48.000
    const combinedRow = within(detail).getAllByRole("row").find((r) => r.textContent?.includes("秦始皇"))!;
    expect(combinedRow).toHaveTextContent("48.000");
  });
});
