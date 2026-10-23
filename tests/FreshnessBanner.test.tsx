import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FreshnessBanner } from "../src/components/FreshnessBanner";
import type { StatusData } from "../src/types";

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

describe("FreshnessBanner", () => {
  it("shows fresh state", () => {
    render(<FreshnessBanner status={status} roundUpdatedAt={status.round_updated_at!} now={new Date("2026-10-24T02:00:00Z").getTime()} />);
    expect(screen.getByRole("status")).toHaveTextContent("数据检查于");
    expect(screen.queryByText(/数据可能已过期/)).not.toBeInTheDocument();
  });

  it("warns when data is stale", () => {
    render(<FreshnessBanner status={{ ...status, stale_days: 9 }} roundUpdatedAt={status.round_updated_at!} now={new Date("2026-10-24T02:00:00Z").getTime()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/数据可能已过期/);
  });
});
