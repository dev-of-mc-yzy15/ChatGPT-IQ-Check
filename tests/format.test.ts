import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fmtScore,
  fmtDelta,
  fmtMoney,
  fmtPercent,
  fmtSeconds,
  fmtDateTime,
  fmtRelativeTime,
  fmtEffort,
} from "../src/lib/format";

const DASH = "—";

// 固定 UTC 时刻做相对时间夹具：now 显式传入，绝不依赖真实时钟。
const NOW = new Date("2026-07-15T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const later = (ms: number) => new Date(NOW + ms).toISOString();

afterEach(() => {
  vi.useRealTimers();
});

describe("format · 数值守卫：非有限值一律投降为破折号", () => {
  // 这些函数各自带 Number.isFinite 守卫。谁把守卫「简化」掉，NaN / Infinity 就会原样漏进 UI。
  it("fmtScore 把 NaN、Infinity、-Infinity 都输出为破折号", () => {
    expect(fmtScore(NaN)).toBe(DASH);
    expect(fmtScore(Infinity)).toBe(DASH);
    expect(fmtScore(-Infinity)).toBe(DASH);
  });

  it("fmtDelta 把 NaN、Infinity、-Infinity 都输出为破折号", () => {
    expect(fmtDelta(NaN)).toBe(DASH);
    expect(fmtDelta(Infinity)).toBe(DASH);
    expect(fmtDelta(-Infinity)).toBe(DASH);
  });

  it("fmtMoney 把 NaN、Infinity、-Infinity 都输出为破折号", () => {
    expect(fmtMoney(NaN)).toBe(DASH);
    expect(fmtMoney(Infinity)).toBe(DASH);
    expect(fmtMoney(-Infinity)).toBe(DASH);
  });

  it("fmtPercent 把 NaN、Infinity、-Infinity 都输出为破折号", () => {
    expect(fmtPercent(NaN)).toBe(DASH);
    expect(fmtPercent(Infinity)).toBe(DASH);
    expect(fmtPercent(-Infinity)).toBe(DASH);
  });

  it("fmtSeconds 把 NaN、Infinity、-Infinity 都输出为破折号", () => {
    expect(fmtSeconds(NaN)).toBe(DASH);
    expect(fmtSeconds(Infinity)).toBe(DASH);
    expect(fmtSeconds(-Infinity)).toBe(DASH);
  });
});

describe("format · 空值守卫", () => {
  it("fmtScore 把 null 与 undefined 输出为破折号而非 0.0", () => {
    expect(fmtScore(null)).toBe(DASH);
    expect(fmtScore(undefined)).toBe(DASH);
  });

  it("fmtDateTime 把 null、undefined、空串输出为破折号", () => {
    expect(fmtDateTime(null)).toBe(DASH);
    expect(fmtDateTime(undefined)).toBe(DASH);
    expect(fmtDateTime("")).toBe(DASH);
  });

  it("fmtEffort 把 null、undefined、空串输出为破折号", () => {
    expect(fmtEffort(null)).toBe(DASH);
    expect(fmtEffort(undefined)).toBe(DASH);
    expect(fmtEffort("")).toBe(DASH);
  });
});

describe("format · 分数舍入", () => {
  it("fmtScore 保留一位小数（104.56 → 104.6）", () => {
    expect(fmtScore(104.56)).toBe("104.6");
  });

  it("fmtScore(0) 输出保留一位小数的 0.0", () => {
    expect(fmtScore(0)).toBe("0.0");
  });

  it("fmtScore 对负数按其绝对值四舍五入并保留负号", () => {
    expect(fmtScore(-4.25)).toBe("-4.3");
    expect(fmtScore(-104.56)).toBe("-104.6");
  });

  it("fmtScore(120.04) 舍入为 120.0", () => {
    expect(fmtScore(120.04)).toBe("120.0");
  });

  it("fmtScore(120.05) 落到 120.0 —— 二进制近似让半个进位被吃掉", () => {
    // BUG: 120.05 的 double 实为 120.049999999999997，toFixed(1) 并非直觉的 120.1。
    // 现在按实现如实断言；将来若要修，这里就是语义变更点。
    expect(fmtScore(120.05)).toBe("120.0");
  });

  it("fmtDelta(0) 不带正号，负数保留负号", () => {
    expect(fmtDelta(0)).toBe("0.0");
    expect(fmtDelta(-4.2)).toBe("-4.2");
    expect(fmtDelta(2.4)).toBe("+2.4");
  });

  it("fmtPercent(0) 输出 0%", () => {
    expect(fmtPercent(0)).toBe("0%");
  });

  it("fmtPercent(0.7357) 四舍五入为 74%", () => {
    expect(fmtPercent(0.7357)).toBe("74%");
  });

  it("fmtPercent 对负比率输出带负号的百分比", () => {
    expect(fmtPercent(-0.5)).toBe("-50%");
  });

  it("fmtPercent(1.205) 因子积 120.50000000000001 进位为 121%", () => {
    // 浮点方向与直觉相反：1.205 * 100 略大于 120.5，Math.round 会进到 121。
    expect(fmtPercent(1.205)).toBe("121%");
  });

  it("fmtPercent(1.2005) 因子积 120.049999999999997 落到 120%", () => {
    // BUG: 1.2005 * 100 = 120.049999999999997，半个百分位被吃掉，显示 120% 而非 121%。
    expect(fmtPercent(1.2005)).toBe("120%");
  });

  it("fmtMoney 保留两位小数（3.5785 → $3.58）", () => {
    expect(fmtMoney(3.5785)).toBe("$3.58");
  });

  it("fmtMoney(0) 输出两位小数的 $0.00", () => {
    expect(fmtMoney(0)).toBe("$0.00");
  });

  it("fmtScore(-0.04) 输出负零 -0.0 而不是 0.0", () => {
    // BUG: toFixed 保留 -0 的符号，UI 上 -0.0 略显别扭（fmtDelta 同病）。
    expect(fmtScore(-0.04)).toBe("-0.0");
    expect(fmtDelta(-0.04)).toBe("-0.0");
  });
});

describe("format · 计数分组形态", () => {
  it("fmtScore 对七位数 1234567 不做千分位分组", () => {
    expect(fmtScore(1234567)).toBe("1234567.0");
  });

  it("fmtSeconds(1234567) 只折算到分钟，不升位成小时或天", () => {
    // BUG: 1234567 秒≈14.3 天，却渲染成 "20576 分 7 秒"，可读性差。
    expect(fmtSeconds(1234567)).toBe("20576 分 7 秒");
  });

  it("fmtSeconds(0) 输出 0 秒", () => {
    expect(fmtSeconds(0)).toBe("0 秒");
  });

  it("fmtSeconds 按 分/秒 拆分（835.9 → 13 分 56 秒）", () => {
    expect(fmtSeconds(835.9)).toBe("13 分 56 秒");
  });

  it("fmtSeconds(42) 不足一分钟只输出秒", () => {
    expect(fmtSeconds(42)).toBe("42 秒");
  });

  it("fmtSeconds(59.6) 先取整进位为 1 分 0 秒", () => {
    expect(fmtSeconds(59.6)).toBe("1 分 0 秒");
  });
});

describe("format · 日期", () => {
  // 夹具刻意选月中（7 月 / 1 月 15 日），避开月末与年初，不受本机时区影响。
  it("fmtDateTime 按模块级缓存的 Asia/Shanghai 时区渲染合法 ISO 串", () => {
    expect(fmtDateTime("2026-07-15T10:00:00Z")).toBe("2026-07-15 18:00");
  });

  it("fmtDateTime 输出带年份的 YYYY-MM-DD HH:mm 形态", () => {
    expect(fmtDateTime("2026-01-15T04:30:00Z")).toMatch(/^2026-01-15 \d{2}:\d{2}$/);
  });

  it("fmtDateTime 在跨越零点时给出 00:xx 而不是 24:xx", () => {
    expect(fmtDateTime("2026-07-15T16:00:00Z")).toBe("2026-07-16 00:00");
  });

  it("fmtDateTime 对 not-a-date 投降为破折号", () => {
    expect(fmtDateTime("not-a-date")).toBe(DASH);
  });
});

describe("format · 相对时间", () => {
  it("过去 30 秒显示 刚刚", () => {
    expect(fmtRelativeTime(ago(30_000), NOW)).toBe("刚刚");
  });

  it("过去 59 秒仍显示 刚刚", () => {
    expect(fmtRelativeTime(ago(59_000), NOW)).toBe("刚刚");
  });

  it("过去 60 秒切换为 1 分钟前", () => {
    expect(fmtRelativeTime(ago(60_000), NOW)).toBe("1 分钟前");
  });

  it("过去 30 分钟显示 30 分钟前", () => {
    expect(fmtRelativeTime("2026-07-15T11:30:00Z", NOW)).toBe("30 分钟前");
  });

  it("过去 3 天显示 3 天前", () => {
    expect(fmtRelativeTime(ago(3 * 86_400_000), NOW)).toBe("3 天前");
  });

  it("过去 24 小时切换为 1 天前", () => {
    expect(fmtRelativeTime(ago(86_400_000), NOW)).toBe("1 天前");
  });

  it("未来 1 小时显示 时间异常", () => {
    expect(fmtRelativeTime(later(3_600_000), NOW)).toBe("时间异常");
  });

  it("不传 now 时走 vi.setSystemTime 注入的时钟", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    expect(fmtRelativeTime("2026-07-15T11:59:30Z")).toBe("刚刚");
    expect(fmtRelativeTime("2026-07-12T12:00:00Z")).toBe("3 天前");
  });

  it("相对时间对 not-a-date 投降为破折号", () => {
    expect(fmtRelativeTime("not-a-date", NOW)).toBe(DASH);
  });

  it("相对时间对空串与 null 投降为破折号", () => {
    expect(fmtRelativeTime("", NOW)).toBe(DASH);
    expect(fmtRelativeTime(null, NOW)).toBe(DASH);
  });
});

describe("format · 档位标签", () => {
  it("fmtEffort 命中内置映射", () => {
    expect(fmtEffort("low")).toBe("低");
    expect(fmtEffort("xhigh")).toBe("极高");
    expect(fmtEffort("ultra")).toBe("极限");
  });

  it("fmtEffort 对未知档位回退为大写原文", () => {
    expect(fmtEffort("unknown")).toBe("UNKNOWN");
  });
});

describe("format · 无脏状态", () => {
  it("fmtDateTime 连续两次同参调用结果相等（缓存 formatter 不得残留状态）", () => {
    const first = fmtDateTime("2026-07-15T10:00:00Z");
    const second = fmtDateTime("2026-07-15T10:00:00Z");
    expect(second).toBe(first);
  });

  it("fmtRelativeTime 连续两次同参调用结果相等", () => {
    const first = fmtRelativeTime(ago(3 * 86_400_000), NOW);
    const second = fmtRelativeTime(ago(3 * 86_400_000), NOW);
    expect(second).toBe(first);
  });

  it("fmtScore 连续两次同参调用结果相等", () => {
    expect(fmtScore(104.56)).toBe(fmtScore(104.56));
  });
});
