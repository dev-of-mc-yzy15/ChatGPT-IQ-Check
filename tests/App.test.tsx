import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { useTheme } from "../src/lib/useTheme";

vi.mock("../src/data/loader", () => {
  const ok = <T,>(data: T) => ({ data, error: null });
  const payload = {
    round: {
      schema_version: 1,
      fetch_id: "f",
      generated_at: "2026-10-24T00:00:00Z",
      checked_at: "2026-10-24T00:00:00Z",
      source_schema: "degradation-codex-plan/2",
      round: {
        id: "r",
        status: "completed",
        started_at: "2026-10-23T08:29:34Z",
        completed_at: "2026-10-23T10:43:22Z",
        updated_at: "2026-10-23T10:43:22Z",
        taskset_version: "t",
        // P1-15：夹具写 8，页面必须显示 8，证明题数取自数据而非常量。
        task_count: 8,
        timings: { wall_seconds: 8028 },
      },
      tasks: [],
      candidates: [
        {
          model: "A",
          effort: "high",
          score: 120,
          score_max: 150,
          score_status: "complete",
          scored_tasks: 7,
          total_tasks: 7,
          tasks: [],
          totals: {
            seconds: 0,
            cost_usd: 0,
            cost_known_tasks: 0,
            cost_unknown_tasks: 0,
          },
          animation: null,
        },
      ],
    },
    radarBench: {
      schema_version: 1,
      fetch_id: "f",
      generated_at: "2026-10-24T00:00:00Z",
      checked_at: "2026-10-24T00:00:00Z",
      benchmark: "b",
      score_version: "v",
      score_max: 150,
      catalog_version: "c",
      task_set_sha256: "s",
      candidates: [
        {
          model: "A",
          effort: "high",
          score: 100,
          coverage: 64,
          required_tasks: 64,
          score_status: "complete",
          graded_runs_count: 1,
          source_scores: {},
          statistics: {
            sample_count: 1,
            elapsed_ms_mean: 1,
            api_equivalent_usd_mean: 1,
          },
          latest_graded_at: "2026-10-23T00:00:00Z",
          history: [],
        },
      ],
    },
    status: {
      checked_at: "2026-10-24T00:00:00Z",
      ok: true,
      benchmark: "b",
      candidates_ok: 1,
      candidates_total: 1,
      round_ok: true,
      latest_graded_at: "2026-10-23T00:00:00Z",
      round_updated_at: "2026-10-23T10:43:22Z",
      stale_days: 0,
      errors: [],
    },
  };

  return {
    loadAll: vi.fn(async () => ({
      round: ok(payload.round),
      radarBench: ok(payload.radarBench),
      status: ok(payload.status),
    })),
    slotRound: vi.fn(async () => ok(payload.round)),
    slotRadarBench: vi.fn(async () => ok(payload.radarBench)),
    slotStatus: vi.fn(async () => ok(payload.status)),
    toSlot: vi.fn(),
  };
});

describe("App", () => {
  it("renders the round tab and switches to trend", async () => {
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: /降智雷达/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /本轮雷达/ }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("tab", { name: /RadarBench 趋势/ }),
    );
    expect(
      screen.getByRole("heading", { name: /RadarBench 趋势/ }),
    ).toBeInTheDocument();
  });

  it("keeps the other tab usable when one slot fails", async () => {
    const { slotRound } = await import("../src/data/loader");
    vi.mocked(slotRound).mockResolvedValueOnce({ data: null, error: "round.json 结构异常：boom" });
    render(<App />);

    expect(await screen.findByText(/本轮雷达加载失败/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();

    // 本轮槽塌了，趋势槽照常
    await userEvent.click(screen.getByRole("tab", { name: /RadarBench 趋势/ }));
    expect(await screen.findByRole("heading", { name: /RadarBench 趋势/ })).toBeInTheDocument();
    expect(screen.queryByText(/趋势加载失败/)).toBeNull();
  });

  it("retries only the failed slot", async () => {
    const { slotStatus } = await import("../src/data/loader");
    vi.mocked(slotStatus).mockResolvedValueOnce({ data: null, error: "status.json 加载失败：HTTP 500" });
    render(<App />);

    const alert = await screen.findByText(/数据状态加载失败/);
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /本轮雷达/ })).toHaveAttribute("aria-selected", "true");

    const retried = vi.mocked(slotStatus);
    const before = retried.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retried.mock.calls.length).toBe(before + 1);
    // 重试后状态槽恢复：横幅（role=status）重新出现
    expect(await screen.findByRole("status")).toHaveTextContent(/数据检查于/);
    expect(screen.queryByText(/数据状态加载失败/)).toBeNull();
  });

  // P1-13：role=tab 必须真的绑到一个 role=tabpanel 的节点，而不是光有个 role。
  it("binds every tab to an existing tabpanel", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: /降智雷达/ });

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      const controls = tab.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      const panel = document.getElementById(controls!);
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
      expect(tab.id).toBeTruthy();
      // 只有当前 tab 的 panel 可见，其余 hidden：面板不能全摊在页面上。
      expect(panel).toHaveProperty("hidden", tab.getAttribute("aria-selected") !== "true");
    }
  });

  // P1-13：左右方向键要能在 tab 之间切换，并把焦点带过去。
  it("switches tabs with ArrowLeft and ArrowRight", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: /降智雷达/ });

    const roundTab = screen.getByRole("tab", { name: /本轮雷达/ });
    const trendTab = screen.getByRole("tab", { name: /RadarBench 趋势/ });
    const aboutTab = screen.getByRole("tab", { name: /关于/ });

    roundTab.focus();
    fireEvent.keyDown(roundTab, { key: "ArrowRight" });
    expect(trendTab).toHaveAttribute("aria-selected", "true");
    expect(trendTab).toHaveFocus();

    fireEvent.keyDown(trendTab, { key: "ArrowRight" });
    expect(aboutTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(aboutTab, { key: "ArrowLeft" });
    expect(trendTab).toHaveAttribute("aria-selected", "true");
    expect(roundTab).toHaveAttribute("aria-selected", "false");
  });

  // P1-14：页脚不能再吐原始 ISO，必须走 fmtDateTime。
  it("renders the footer timestamp as YYYY-MM-DD HH:mm", async () => {
    render(<App />);
    await screen.findAllByText(/数据检查于/);
    const footer = document.querySelector("footer")!;
    expect(footer.textContent).toMatch(/数据检查于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(footer.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // P1-15：题数取 round.task_count（夹具 8），不是写死的 64。
  it("takes the task count from round data instead of a hardcoded number", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: /降智雷达/ });
    await userEvent.click(screen.getByRole("tab", { name: /关于/ }));
    const section = screen.getByRole("heading", { name: "关于" }).closest("section")!;
    expect(section).toHaveTextContent(/8 题基准测试/);
    expect(section).not.toHaveTextContent(/64 题/);
  });
});

// P1-18 / P1-19：主题切换要同步 meta[theme-color]，且连点两次必须回到原值。
describe("主题与 theme-color", () => {
  const meta = () => document.querySelector('meta[name="theme-color"]');

  beforeEach(() => {
    localStorage.clear();
    meta()?.remove();
    delete document.documentElement.dataset.theme;
  });

  // P1-19 的真回归形态：两次点击落在同一批更新里。闭包实现两次都读同一个 theme，
  // 只会翻转一次；userEvent 每次 click 会 flush，抓不到这个 bug，必须用 act 包一次。
  it("toggles twice inside one batch back to the original theme", () => {
    const { result } = renderHook(() => useTheme());
    const initial = result.current[0];

    act(() => {
      result.current[1]();
      result.current[1]();
    });

    expect(result.current[0]).toBe(initial);
    expect(document.documentElement.dataset.theme).toBe(initial);
    expect(meta()?.getAttribute("content")).toBe(initial === "dark" ? "#0f1115" : "#ffffff");
  });

  it("syncs meta[theme-color] with the active theme", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: /降智雷达/ });
    const toggle = screen.getByRole("button", { name: "切换主题" });

    const light = document.documentElement.dataset.theme;
    expect(meta()?.getAttribute("content")).toBeTruthy();

    await userEvent.click(toggle);
    const dark = document.documentElement.dataset.theme;
    expect(dark).not.toBe(light);
    expect(meta()?.getAttribute("content")).not.toBe("#ffffff");

    await userEvent.click(toggle);
    // 第二次点击必须真的翻回去：闭包持旧值的话这里会停在 dark。
    expect(document.documentElement.dataset.theme).toBe(light);
    expect(meta()?.getAttribute("content")).toBe("#ffffff");
  });
});
