import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
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

  it("fmtScore(120.05) 进位为 120.1 —— 指数位移绕开二进制近似", () => {
    // 120.05 的 double 实为 120.049999999999997，裸 toFixed(1) 会吞掉半个进位。
    // 实现改成按 10 的幂位移后再取整，半个小数的语义得以保住。
    expect(fmtScore(120.05)).toBe("120.1");
  });

  it("fmtMoney(2.005) 进位为 $2.01 —— 两位小数同样不能交给裸 toFixed", () => {
    expect(fmtMoney(2.005)).toBe("$2.01");
  });

  it("fmtDelta(0.04) 舍成零之后不再补正号", () => {
    expect(fmtDelta(0.04)).toBe("0.0");
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

  it("fmtPercent(1.2005) 经位移取整仍为 120%", () => {
    // 1.2005 * 100 = 120.049999999999997。0 位小数下结果与裸 Math.round 相同，
    // 这里钉住的是「确实经由位移取整」而不是「结果凑巧相同」。
    expect(fmtPercent(1.2005)).toBe("120%");
  });

  it("fmtPercent(0.12345) 输出 12%", () => {
    expect(fmtPercent(0.12345)).toBe("12%");
  });

  it("fmtMoney 保留两位小数（3.5785 → $3.58）", () => {
    expect(fmtMoney(3.5785)).toBe("$3.58");
  });

  it("fmtMoney(0) 输出两位小数的 $0.00", () => {
    expect(fmtMoney(0)).toBe("$0.00");
  });

  it("舍入到零的负数归一为正零，不再输出 -0.0", () => {
    // toFixed 会把 -0 的符号原样带出来，UI 上 -0.0 读起来像仍有值。
    // 只归一「舍入后为零」的情形，-0.5 这类真有半格的值仍要保留负号。
    expect(fmtScore(-0.04)).toBe("0.0");
    expect(fmtDelta(-0.04)).toBe("0.0");
    expect(fmtMoney(-0.004)).toBe("$0.00");
    expect(fmtPercent(-0.004)).toBe("0%");
  });

  it("负半格仍保留负号（-0.5 不得被归一成 0.0）", () => {
    expect(fmtScore(-0.5)).toBe("-0.5");
    expect(fmtDelta(-0.5)).toBe("-0.5");
    expect(fmtMoney(-0.005)).toBe("$-0.01");
  });
});

describe("format · 位移取整的极端值边界", () => {
  // 位移取整要把数字拼成 "1e-21e1" 这样的指数串再解析。
  // |n| >= 1e21 或 < 1e-6 时 String(n) 本身就是指数形式，拼接会拼出非法串，
  // 守卫必须让这些值仍走 toFixed，不能漏成 NaN。
  it("小到 String(n) 变成指数形式的量仍舍成零，而不是 NaN", () => {
    expect(fmtScore(1e-21)).toBe("0.0");
    expect(fmtScore(-1e-21)).toBe("0.0");
    expect(fmtMoney(1e-21)).toBe("$0.00");
    expect(fmtPercent(1e-21)).toBe("0%");
    expect(fmtPercent(-1e-21)).toBe("0%");
  });

  it("大到 String(n) 变成指数形式的量按 toFixed 原有形态输出", () => {
    expect(fmtScore(1e21)).toBe("1e+21");
    expect(fmtScore(-1e308)).toBe("-1e+308");
  });
});

describe("format · 位移取整在 1e19～1e21 档位不得漏成 NaN", () => {
  // 位移取整最后要把 rounded 拼回 `e-${digits}`。rounded 自身一旦达到 1e21，
  // String() 就给出 "1e+21"，拼成 "1e+21e-1" 是非法指数串，走不到 toFixed 就已是 NaN。
  // 这个量级不是假想：derive 出来的分数本身没有上限。
  it.each([1e19, 1e20, 1e21])("fmtScore(%s) 不出现 NaN", (n) => {
    expect(fmtScore(n)).not.toMatch(/NaN/);
  });

  // fmtPercent 取 0 位小数，n*100 一旦到 1e21 就已是 String 指数形式，开头那条守卫先接住，
  // 走不到这里的二次位移；这几条钉的是开头守卫，不是下面的 1e21 回落。
  it.each([1e19, 1e20, 1e21])("fmtPercent(%s) 不出现 NaN", (n) => {
    expect(fmtPercent(n)).not.toMatch(/NaN/);
  });

  // fmtMoney 取两位小数，1e19 位移两位正好顶到 1e21，是真正踩到二次位移的那条路径。
  it.each([1e19, -1e19])("fmtMoney(%s) 不出现 NaN", (n) => {
    expect(fmtMoney(n)).not.toMatch(/NaN/);
  });

  it("负方向在同一档位同样不出现 NaN", () => {
    expect(fmtScore(-1e20)).not.toMatch(/NaN/);
    expect(fmtPercent(-1e20)).not.toMatch(/NaN/);
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

  it("fmtSeconds 负时长保留分钟位（-90 → -1 分 30 秒）", () => {
    // BUG: 分支用的是 minutes > 0，负时长下 minutes 为负永远进不了「分」分支，
    // 只剩 total % 60 这个负余数。-90 秒因此渲染成 "-30" 秒。
    expect(fmtSeconds(-90)).toBe("-1 分 30 秒");
    expect(fmtSeconds(-150)).toBe("-2 分 30 秒");
  });

  it("fmtSeconds(-60) 输出 -1 分 0 秒，整整一分钟不再显示成零", () => {
    expect(fmtSeconds(-60)).toBe("-1 分 0 秒");
  });

  it("fmtSeconds(-0.4) 舍成负零后输出 0 秒，不带负号", () => {
    expect(fmtSeconds(-0.4)).toBe("0 秒");
  });

  it("正数侧的 fmtSeconds 不受负时长改动影响", () => {
    expect(fmtSeconds(30)).toBe("30 秒");
    expect(fmtSeconds(60)).toBe("1 分 0 秒");
    expect(fmtSeconds(90)).toBe("1 分 30 秒");
  });

  it("fmtSeconds 对个位负秒仍输出负秒", () => {
    expect(fmtSeconds(-30)).toBe("-30 秒");
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

  it("fmtDateTime 把纯日期串按 UTC 午夜解析（跨时区稳定）", () => {
    // new Date("2026-07-15") 走 ECMAScript 的 date-only 分支，固定按 UTC 解释，
    // 所以 +8 时区下稳定落在 08:00，不随本机时区漂移。
    expect(fmtDateTime("2026-07-15")).toBe("2026-07-15 08:00");
  });

  it("fmtDateTime 对无时区后缀的 ISO 串按进程本地时区解释，只断形态", () => {
    // 注意："2026-07-15T00:00:00" 没有 Z，按本地时区解析，
    // 在 UTC 机器上和 +8 机器上钟点不同，因此这里只钉格式不钉钟点。
    expect(fmtDateTime("2026-07-15T00:00:00")).toMatch(/^2026-07-15 \d{2}:\d{2}$/);
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

describe("format · 落在原型链上的档位名", () => {
  // EFFORT_LABELS 是对象字面量，`obj[key] ?? 兜底` 只拦得住 null/undefined，
  // 拦不住继承来的 __proto__ / constructor / toString / hasOwnProperty：
  // __proto__ 拿到 Object.prototype（对象），另外三个是函数。
  // 对象进 JSX 直接让 renderToString 抛错、整块被 ErrorBoundary 吃掉；
  // 函数只留一条 warning，单元格渲染成空。上游为「新加档位」留了 unknownEfforts 通道，
  // 这些串是真会落进数据的。
  const PROTO_KEYS = ["__proto__", "constructor", "toString", "hasOwnProperty"];

  it.each(PROTO_KEYS)("fmtEffort(%s) 回退为大写原文，而不是原型的对象或函数", (key) => {
    const out = fmtEffort(key);
    expect(typeof out).toBe("string");
    expect(out).toBe(key.toUpperCase());
    expect(out).not.toBe(String(Object.prototype[key as keyof typeof Object.prototype]));
  });

  it("原型键的返回值经 React 真渲染不抛", () => {
    for (const key of PROTO_KEYS) {
      expect(() => renderToString(createElement("span", null, fmtEffort(key)))).not.toThrow();
    }
  });

  it("原型键拼进 aria-label 时不会带出函数源码", () => {
    for (const key of PROTO_KEYS) {
      expect(fmtEffort(key)).not.toMatch(/native code/);
    }
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
