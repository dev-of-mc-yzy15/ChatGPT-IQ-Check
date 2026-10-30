import { beforeAll, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import App from "../src/App";
import type { RadarBenchData, RoundData, StatusData } from "../src/types";

// 闸门目的：把「滚动容器可聚焦 / aria-labelledby / live region / Δ 符号 / tabs 键盘约定」
// 这些已经修过的 a11y 行为钉死在自动化里，回归不许静默溜过去。
// loader 的 mock 形状照抄 App.test.tsx：只在外层切一刀，组件树全用真的。

vi.mock("../src/data/loader", () => {
  const ok = <T,>(data: T) => ({ data, error: null });

  // 三个候选的 history 分别造出涨 / 平 / 跌的相邻两日，供 Δ 符号断言用。
  const history = (pair: readonly [number, number]) => [
    {
      at: "2026-10-22T00:00:00Z",
      score: pair[0],
      coverage: 64,
      required_tasks: 64,
      score_status: "complete" as const,
    },
    {
      at: "2026-10-23T00:00:00Z",
      score: pair[1],
      coverage: 64,
      required_tasks: 64,
      score_status: "complete" as const,
    },
  ];

  const radarCandidate = (model: string, score: number, pair: readonly [number, number]) => ({
    model,
    effort: "high",
    score,
    coverage: 64,
    required_tasks: 64,
    score_status: "complete" as const,
    graded_runs_count: 1,
    source_scores: {},
    statistics: { sample_count: 1, elapsed_ms_mean: 1200, api_equivalent_usd_mean: 0.02 },
    latest_graded_at: "2026-10-23T00:00:00Z",
    history: history(pair),
  });

  const roundCandidate = (model: string, score: number) => ({
    model,
    effort: "high",
    score,
    score_max: 150,
    score_status: "complete" as const,
    scored_tasks: 2,
    total_tasks: 2,
    tasks: [
      { task_id: "t1", status: "completed", reward: 0.8, seconds: 30, cost_usd: 0.01 },
      { task_id: "t2", status: "completed", reward: 0.6, seconds: 42, cost_usd: 0.01 },
    ],
    totals: { seconds: 72, cost_usd: 0.02, cost_known_tasks: 2, cost_unknown_tasks: 0 },
    animation: {
      status: "available",
      score: 72,
      scores: { layout: 70 },
      reason: "结构清楚",
      seconds: 12,
      cost_usd: 0.01,
      asset_url: null,
    },
  });

  const round: RoundData = {
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
      task_count: 2,
      timings: { wall_seconds: 8028 },
    },
    tasks: [
      { id: "t1", category: "c", title_zh: "任务一", title_en: "Task one", weight: 1, required: true },
      { id: "t2", category: "c", title_zh: "任务二", title_en: "Task two", weight: 1, required: true },
    ],
    candidates: [roundCandidate("Alpha", 120), roundCandidate("Beta", 90)],
  };

  // 分数与 history 末值一致，Δ 的三种方向都覆盖到：涨 / 平 / 跌。
  const radarBench: RadarBenchData = {
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
      radarCandidate("Alpha", 105, [100, 105]),
      radarCandidate("Beta", 100, [100, 100]),
      radarCandidate("Gamma", 95, [100, 95]),
    ],
  };

  const status: StatusData = {
    checked_at: "2026-10-24T00:00:00Z",
    ok: true,
    benchmark: "b",
    candidates_ok: 3,
    candidates_total: 3,
    binding_total: 3,
    reused_count: 0,
    missing_count: 0,
    round_ok: true,
    latest_graded_at: "2026-10-23T00:00:00Z",
    min_latest: "2026-10-23T00:00:00Z",
    stale_count: 0,
    round_updated_at: "2026-10-23T10:43:22Z",
    stale_days: 0,
    errors: [],
  };

  return {
    loadAll: vi.fn(async () => ({
      round: ok(round),
      radarBench: ok(radarBench),
      status: ok(status),
    })),
    slotRound: vi.fn(async () => ok(round)),
    slotRadarBench: vi.fn(async () => ok(radarBench)),
    slotStatus: vi.fn(async () => ok(status)),
    toSlot: vi.fn(),
  };
});

/**
 * jsdom 没有 canvas。axe 的 label-content-name-mismatch 会对每段文本调
 * `canvas.getContext("2d")` 做 icon-ligature 检测，jsdom 直接抛 "Not implemented"，
 * 每个节点往 stderr 刷一次堆栈。这里给一个够真实的假 2d context：measureText 按字数
 * 给宽度、像素缓冲填非零，让「宽度差 / 像素差」都算成 0，结论稳定落在「不是 ligature」。
 * 规则照常生效，只是不再吐栈。
 * （本项目图标是 emoji 文本和内联 SVG，没有 icon font，结论本就该是 false。）
 */
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => {
      const canvas = document.createElement("canvas");
      return {
        canvas,
        font: "",
        textAlign: "left",
        textBaseline: "top",
        measureText: (text: string) => ({ width: text.length * 10 }),
        clearRect: () => {},
        fillText: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint32Array(Math.max(1, Math.ceil(w) * Math.ceil(h))).fill(0xffffffff),
        }),
      };
    },
  });
});

/**
 * axe 的 options：这里只关掉 jsdom 环境下注定测不准的规则，真缺陷一律不关。
 *
 * - color-contrast：需要真实样式计算。测试进程不加载 theme.css，配色全是空的，
 *   开着只会拿默认色瞎算。对比度按构建产物人工核，不归这条闸门管。
 */
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } } as const;

/** 只看能上线的缺陷：critical / serious。moderate 以下噪音多，会让人习惯性忽略红线。 */
const blocking = (items: Awaited<ReturnType<typeof axe>>["violations"]) =>
  items.filter((v) => v.impact === "critical" || v.impact === "serious");

/**
 * violations 和 incomplete 都收。
 *
 * incomplete 是 axe「拿不准、建议人工看」的出口，但里面混着真实缺陷：aria-labelledby
 * 指向不存在的 id 就落在这里（aria-valid-attr-value），而它恰好是本闸门要守的东西之一。
 * 只认 violations 的话，引用断链能一路绿着过去。健康状态下这一栏是空的，收紧不冤。
 */
async function blockingFindings(container: HTMLElement) {
  const results = await axe(container, AXE_OPTIONS);
  return { violations: blocking(results.violations), incomplete: blocking(results.incomplete) };
}

/** 失败时把规则 id 和命中节点打出来，只报一句「有三处问题」等于没报。 */
function formatViolations(violations: Awaited<ReturnType<typeof blockingFindings>>["violations"]): string {
  return violations
    .map((v) => `${v.id} [${v.impact}] → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)
    .join("\n");
}

/** 渲染并等到本轮数据落地（RoundMatrix 标题出现即表示首屏槽已完成）。 */
async function renderReady() {
  const view = render(<App />);
  await screen.findByRole("heading", { name: /本轮雷达/ });
  return view;
}

/**
 * 触发跳过链接并返回它指向的目标。
 *
 * jsdom 不实现 fragment 导航的焦点转移（浏览器点击 #hash 链接后会 scroll 并聚焦 target），
 * 且 target 没有 tabindex 时 jsdom 的 focus() 也会被忽略。这里补上浏览器语义，
 * 让断言测到真实契约——焦点确实落到 #main，而不是停在链接上。
 */
function activateSkipLink(link: HTMLElement): HTMLElement {
  const href = link.getAttribute("href")!;
  const target = document.querySelector<HTMLElement>(href);
  if (!target) throw new Error(`跳过链接的 href="${href}" 找不到目标元素`);
  fireEvent.click(link);
  if (document.activeElement !== target) {
    if (target.tabIndex < 0) target.setAttribute("tabindex", "-1");
    target.focus();
  }
  return target;
}

describe("无障碍闸门", () => {
  // 首屏（本轮雷达 + 状态横幅）跑一遍 axe，切到趋势面板再跑一遍：
  // violations 与 incomplete 都要空——aria 引用断链只会掉进后者。
  // 两个 panel 的表格、按钮、live region 都要过，不能只扫当前可见那一屏。
  it("渲染完成的页面没有 critical / serious 的 axe 违规或待核项", async () => {
    const { container } = await renderReady();

    const roundFindings = await blockingFindings(container);
    expect(formatViolations(roundFindings.violations)).toBe("");
    expect(formatViolations(roundFindings.incomplete)).toBe("");

    await userEvent.click(screen.getByRole("tab", { name: /RadarBench 趋势/ }));
    await screen.findByRole("heading", { name: /RadarBench 候选/ });

    const trendFindings = await blockingFindings(container);
    expect(formatViolations(trendFindings.violations)).toBe("");
    expect(formatViolations(trendFindings.incomplete)).toBe("");
  });

  it("跳过链接是第一个可聚焦元素，激活后焦点落到 #main", async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.tab();
    const skipLink = screen.getByRole("link", { name: "跳到主要内容" });
    expect(document.activeElement).toBe(skipLink);

    // href 必须指向真实存在的唯一元素，且就是 main——指向 body 或重复 id 都等于没跳。
    const href = skipLink.getAttribute("href");
    expect(href).toBe("#main");
    expect(document.querySelectorAll(href!)).toHaveLength(1);

    const target = activateSkipLink(skipLink);
    expect(target.tagName).toBe("MAIN");
    expect(document.activeElement).toBe(target);
  });

  // 横向滚动容器不进焦点序列，键盘用户就够不到溢出部分（纯鼠标可用 = 假修）。
  it("每个横向滚动容器都能被 Tab 命中，且带 region 与非空可访问名", async () => {
    const user = userEvent.setup();
    await renderReady();

    const wrappers = Array.from(document.querySelectorAll<HTMLElement>(".table-wrap"));
    expect(wrappers.length).toBeGreaterThan(0);
    for (const wrapper of wrappers) {
      expect(wrapper.tabIndex).toBe(0);
      expect(wrapper).toHaveAttribute("role", "region");
      expect(wrapper.getAttribute("aria-label")?.trim()).toBeTruthy();
    }

    // 属性对不等于真能 Tab 到：从 panel 起点往下走，必须在 80 步内踩到第一个容器。
    screen.getByRole("tabpanel", { name: /本轮雷达/ }).focus();
    let steps = 0;
    while (!document.activeElement?.classList.contains("table-wrap") && steps < 80) {
      await user.tab();
      steps += 1;
    }
    expect(document.activeElement?.classList.contains("table-wrap")).toBe(true);
    expect(document.activeElement).toBe(wrappers[0]);
  });

  it("tablist 支持 End 跳最后一个 tab、Home 回第一个", async () => {
    await renderReady();

    const roundTab = screen.getByRole("tab", { name: /本轮雷达/ });
    const aboutTab = screen.getByRole("tab", { name: /关于/ });

    roundTab.focus();
    fireEvent.keyDown(roundTab, { key: "End" });
    expect(aboutTab).toHaveFocus();
    expect(aboutTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(aboutTab, { key: "Home" });
    expect(roundTab).toHaveFocus();
    expect(roundTab).toHaveAttribute("aria-selected", "true");
  });

  // 只靠颜色的涨跌对色觉障碍用户不存在，方向必须由符号承载。
  it("Δ 单元格用 ▲ / ▼ / — 表达方向", async () => {
    await renderReady();
    await userEvent.click(screen.getByRole("tab", { name: /RadarBench 趋势/ }));

    const panel = screen.getByRole("tabpanel", { name: /RadarBench 趋势/ });
    const deltaOf = (model: string) => {
      const row = within(panel).getByRole("rowheader", { name: model }).closest("tr")!;
      const cells = row.querySelectorAll("td");
      return cells[cells.length - 1].textContent ?? "";
    };

    const up = deltaOf("Alpha");
    const flat = deltaOf("Beta");
    const down = deltaOf("Gamma");

    expect(up).toContain("▲");
    expect(up).not.toContain("▼");

    expect(down).toContain("▼");
    expect(down).not.toContain("▲");

    expect(flat).toContain("—");
    expect(flat).not.toContain("▲");
    expect(flat).not.toContain("▼");
  });
});
