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
  round_ok: true,
  latest_graded_at: "2026-10-23T01:19:00Z",
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

  it("does not warn when stale_days is exactly 7", () => {
    renderBanner({ stale_days: 7 });
    expect(screen.getByRole("status")).not.toHaveTextContent("数据可能已过期");
  });

  it("warns when stale_days is greater than 7", () => {
    renderBanner({ stale_days: 8 });
    expect(screen.getByRole("status")).toHaveTextContent("数据可能已过期（超过 7 天）");
  });

  it("shows the reused-data line when errors are present", () => {
    renderBanner({ errors: ["fetch failed", "timeout"] });
    expect(screen.getByRole("status")).toHaveTextContent("部分候选复用旧数据：2 条");
  });
});

describe("FreshnessBanner 未知态", () => {
  it("warns when stale_days is null instead of silently taking the fresh path", () => {
    renderBanner({ stale_days: null });
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
