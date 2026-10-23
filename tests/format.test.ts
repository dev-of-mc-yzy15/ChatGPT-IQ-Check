import { describe, it, expect } from "vitest";
import {
  fmtScore, fmtDelta, fmtMoney, fmtPercent, fmtSeconds, fmtDateTime, fmtRelativeTime, fmtEffort,
} from "../src/lib/format";

describe("format", () => {
  it("formats numbers with null safety", () => {
    expect(fmtScore(104.56)).toBe("104.6");
    expect(fmtScore(null)).toBe("—");
    expect(fmtDelta(-4.2)).toBe("-4.2");
    expect(fmtDelta(2.4)).toBe("+2.4");
    expect(fmtMoney(3.5785)).toBe("$3.58");
    expect(fmtPercent(0.7357)).toBe("74%");
    expect(fmtSeconds(835.9)).toBe("13 分 56 秒");
    expect(fmtSeconds(42)).toBe("42 秒");
  });
  it("formats Beijing time and relative time", () => {
    expect(fmtDateTime("2026-10-23T10:43:22Z")).toBe("2026-10-23 18:43");
    const now = new Date("2026-10-24T00:00:00Z").getTime();
    expect(fmtRelativeTime("2026-10-23T23:30:00Z", now)).toBe("30 分钟前");
    expect(fmtRelativeTime("2026-10-25T00:00:00Z", now)).toBe("时间异常");
  });
  it("formats effort labels", () => {
    expect(fmtEffort("low")).toBe("低");
    expect(fmtEffort("xhigh")).toBe("极高");
    expect(fmtEffort("unknown")).toBe("UNKNOWN");
    expect(fmtEffort(null)).toBe("—");
  });
});
