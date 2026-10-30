import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FreshnessBanner } from "../src/components/FreshnessBanner";
import type { StatusData } from "../src/types";

const NOW = new Date("2026-10-24T02:00:00Z").getTime();

const status: StatusData = {
  checked_at: "2026-10-24T00:00:00Z",
  ok: true,
  benchmark: "radar-bench-final64-20261004",
  candidates_ok: 34,
  candidates_total: 34,
  binding_total: 34,
  reused_count: 0,
  missing_count: 0,
  round_ok: true,
  latest_graded_at: "2026-10-23T01:19:00Z",
  min_latest: "2026-10-23T01:19:00Z",
  stale_count: 0,
  round_updated_at: "2026-10-23T10:43:22Z",
  stale_days: 1,
  errors: [],
};

function renderBanner(overrides: Partial<StatusData> = {}, now = NOW) {
  const merged = { ...status, ...overrides };
  return render(
    <FreshnessBanner status={merged} roundUpdatedAt={merged.round_updated_at} now={now} />
  );
}

const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

describe("FreshnessBanner", () => {
  it("shows fresh state with timestamps and candidate counts", () => {
    renderBanner();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("数据检查于");
    expect(banner).toHaveTextContent("2026-10-24 08:00");
    expect(banner).toHaveTextContent("2 小时前");
    expect(banner).toHaveTextContent("2026-10-23 09:19");
    expect(banner).toHaveTextContent("2026-10-23 18:43");
    expect(banner).toHaveTextContent("34/34 候选");
    expect(banner).not.toHaveTextContent("数据可能已过期");
    expect(banner).not.toHaveTextContent("数据检查已超过 48 小时");
  });

  it("does not warn when checked_at is 47 hours old", () => {
    renderBanner({ checked_at: hoursAgo(47) });
    const banner = screen.getByRole("status");
    expect(banner).not.toHaveTextContent("数据检查已超过 48 小时");
    expect(banner).not.toHaveTextContent("数据可能已过期");
  });

  it("warns when checked_at is 49 hours old", () => {
    renderBanner({ checked_at: hoursAgo(49) });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("数据检查已超过 48 小时");
    expect(banner).not.toHaveTextContent("数据可能已过期");
  });

  // 授权的断言语义变更（P1-17）：边界由 > 改 >=，恰好 7 天也必须告警。
  it("warns when stale_days is exactly 7", () => {
    renderBanner({ stale_days: 7 });
    expect(screen.getByRole("status")).toHaveTextContent("数据可能已过期（超过 7 天）");
  });

  it("warns when stale_days is well past the 7 day limit", () => {
    renderBanner({ stale_days: 8 });
    expect(screen.getByRole("status")).toHaveTextContent("数据可能已过期（超过 7 天）");
  });

  it("counts unprefixed errors as broken data files", () => {
    renderBanner({ errors: ["fetch failed", "timeout"] });
    expect(screen.getByRole("status")).toHaveTextContent("数据文件异常：2 项");
  });

  it("separates reused, dropped and corrupt outcomes by prefix", () => {
    renderBanner({
      errors: ["reused: A|high: timeout", "missing: B|low: 500", "status.json: 坏数据（x）"],
    });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("复用旧数据：1 条");
    expect(banner).toHaveTextContent("候选被丢弃");
    expect(banner).toHaveTextContent("数据文件异常：1 项");
  });

  it("falls back to the counters when no error line carries a prefix", () => {
    // errors 被截断（一条前缀都没有）时，别静默成 0，用 status 的汇总数兜底。
    renderBanner({ errors: ["truncated"], reused_count: 7, missing_count: 2 });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("复用旧数据：7 条");
    expect(banner).toHaveTextContent("候选被丢弃（无旧数据可复用）：2 条");
  });

  it("prefers error-line detail over the counters when both exist", () => {
    renderBanner({ errors: ["reused: A|high: timeout"], reused_count: 7, missing_count: 2 });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("复用旧数据：1 条");
    expect(banner).not.toHaveTextContent("复用旧数据：7 条");
    // missing 一条前缀都没有，回落到 missing_count=2
    expect(banner).toHaveTextContent("候选被丢弃（无旧数据可复用）：2 条");
  });
});

describe("FreshnessBanner 未知态", () => {
  it("warns when stale_days is null instead of silently taking the fresh path", () => {
    renderBanner({ stale_days: null });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("数据新鲜度未知");
    expect(banner).not.toHaveTextContent("数据可能已过期");
  });

  // P1-17：NaN !== null，旧实现里 `NaN > 7` 恒 false，会静默走新鲜分支。
  it("warns when stale_days is NaN instead of silently taking the fresh path", () => {
    renderBanner({ stale_days: Number.NaN });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("数据新鲜度未知");
    expect(banner).not.toHaveTextContent("数据可能已过期");
  });

  it("warns when checked_at is unparsable", () => {
    renderBanner({ checked_at: "not-a-date" });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("数据检查时间未知");
  });

  it("warns when errors is missing", () => {
    renderBanner({ errors: undefined as unknown as string[] });
    expect(screen.getByRole("status")).toHaveTextContent("复用记录缺失");
  });
});

describe("FreshnessBanner ok 消费", () => {
  it("warns when the last refresh was not fully successful", () => {
    renderBanner({ ok: false, errors: ["a: reused previous data"] });
    expect(screen.getByRole("status")).toHaveTextContent("最近一次刷新未全部成功");
  });

  it("warns when the round data did not refresh", () => {
    renderBanner({ round_ok: false });
    expect(screen.getByRole("status")).toHaveTextContent("本轮数据未刷新成功");
  });

  it("stays quiet when both flags are true", () => {
    renderBanner({ ok: true, round_ok: true });
    const banner = screen.getByRole("status");
    expect(banner).not.toHaveTextContent("最近一次刷新未全部成功");
    expect(banner).not.toHaveTextContent("本轮数据未刷新成功");
  });
});

// 一条陈旧候选不能藏在整体新鲜的板后面（min_latest / stale_count），
// 同时覆盖数要和真正抓到的对上（binding_total）。
describe("FreshnessBanner 隐蔽的陈旧候选", () => {
  it("names how many candidates went stale and turns the card into a warning", () => {
    const { container } = renderBanner({ stale_count: 3 });
    expect(screen.getByRole("status")).toHaveTextContent("有 3 个候选已长时间未更新。");
    expect(container.querySelector(".card.warn")).not.toBeNull();
  });

  it("calls out the oldest score when min_latest is 3 days old", () => {
    renderBanner({ min_latest: hoursAgo(72) });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("最旧的最近评分停在");
    // 2026-10-24T02:00Z 往前 72 小时 = 2026-10-21T02:00Z，Asia/Shanghai 即 10:00
    expect(banner).toHaveTextContent("2026-10-21 10:00");
  });

  // 旧 status.json 一个字段都没有：三行都不能印、不能冒出 NaN 或 undefined。
  it("degrades silently when all three fields are absent", () => {
    renderBanner({
      stale_count: undefined as unknown as number,
      min_latest: undefined as unknown as string,
      binding_total: undefined as unknown as number,
    });
    const banner = screen.getByRole("status");
    expect(banner).not.toHaveTextContent("已长时间未更新");
    expect(banner).not.toHaveTextContent("最旧的最近评分");
    expect(banner.textContent).not.toContain("NaN");
    expect(banner.textContent).not.toContain("undefined");
    expect(screen.queryByText(/本次覆盖/)).toBeNull();
  });
});

describe("FreshnessBanner 覆盖行", () => {
  it("prints coverage outside the live region so alerts are not re-announced", () => {
    const { container } = renderBanner({ binding_total: 34, missing_count: 2, reused_count: 1 });
    const banner = screen.getByRole("status");
    const coverage = screen.getByText("本次覆盖 31/34 个候选。");
    expect(coverage).toBeInTheDocument();
    expect(banner).not.toContainElement(coverage);
    expect(banner).not.toHaveTextContent("本次覆盖");
    // 中性信息：不因为覆盖不全就把卡片升级成告警
    expect(container.querySelector(".card")).not.toHaveClass("warn");
    expect(container).toHaveTextContent("本次覆盖 31/34 个候选。");
  });
});
