const DASH = "—";

// 位移取整：先把小数点挪开再取整，别让 toFixed 直接吃掉 120.05 这类半格。
// 取整走绝对值再补符号，与 toFixed 远离零的语义一致；舍成零的负数归一为正零。
// String(n) 在 |n| >= 1e21 或 < 1e-6 时本身就是指数形式，拼出的是非法串，退回原值。
const roundTo = (n: number, digits: number): number => {
  const shifted = Number(`${Math.abs(n)}e${digits}`);
  if (Number.isNaN(shifted)) return Math.abs(n) < 1 ? 0 : n;
  const rounded = Math.sign(n) * Math.round(shifted);
  return Object.is(rounded, -0) ? 0 : Number(`${rounded}e-${digits}`);
};

export const fmtScore = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : roundTo(n, 1).toFixed(1);

export const fmtDelta = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return DASH;
  const rounded = roundTo(n, 1);
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
};

export const fmtMoney = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `$${roundTo(n, 2).toFixed(2)}`;

export const fmtPercent = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `${roundTo(n * 100, 0)}%`;

export function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return DASH;
  const total = Math.round(seconds);
  const abs = Math.abs(total);
  const minutes = Math.floor(abs / 60);
  const rest = abs % 60;
  const body = minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
  return total < 0 ? `-${body}` : body;
}

// 每次调用都新建 Intl.DateTimeFormat 不便宜：列表里几百行就是几百次构造。
// 模块级只建一次，参数与原先逐次传入的完全一致。
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  const parts = DATE_TIME_FORMAT.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function fmtRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return DASH;
  const diff = now - time;
  if (diff < 0) return "时间异常";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export const EFFORT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "极限",
};

export const fmtEffort = (effort: string | null | undefined): string =>
  effort ? EFFORT_LABELS[effort] ?? effort.toUpperCase() : DASH;
