const DASH = "—";

export const fmtScore = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : n.toFixed(1);

export const fmtDelta = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

export const fmtMoney = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `$${n.toFixed(2)}`;

export const fmtPercent = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `${Math.round(n * 100)}%`;

export function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return DASH;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
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
