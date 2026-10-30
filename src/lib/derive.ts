import type { HistoryPoint, RadarCandidate, RoundCandidate, RoundData } from "../types";
import { candidateKey } from "../../scripts/contract.mjs";

export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];
export type SortKey = "model" | "effort" | "score" | "coverage" | "graded_runs_count" | "latest_graded_at";

/**
 * 模型名走自然序（numeric-aware）：数字段按数值比，`gpt-6` 必须排在 `gpt-10` 前面。
 * 纯 localeCompare 是逐字符字典序，"1" < "6"，点一下「按模型排序」看到的就是反直觉的顺序。
 * Collator 构造不便宜（同 fmtDateTime 的教训），提到模块级复用，比较函数里不再每次 new；
 * 数字段相等时 ICU 的 tie-break 已经是确定性的（gpt-6 → gpt-6-mini、gpt-6 → GPT-6），不必再手写。
 */
const MODEL_COLLATOR = new Intl.Collator("en", { numeric: true });

/** 未知档位（上游新加的档）排到已知档之后，而不是 indexOf 得 -1 挤到最前。 */
function effortRank(effort: string): number {
  const at = EFFORT_ORDER.indexOf(effort);
  return at === -1 ? EFFORT_ORDER.length : at;
}

export function sortCandidates(rows: RadarCandidate[], key: SortKey, dir: "asc" | "desc"): RadarCandidate[] {
  return [...rows].sort((a, b) => {
    if (key === "effort") {
      const order = effortRank(a.effort) - effortRank(b.effort);
      return dir === "asc" ? order : -order;
    }
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp =
      key === "model"
        ? MODEL_COLLATOR.compare(String(av), String(bv))
        : typeof av === "string"
          ? av.localeCompare(String(bv), "en")
          : Number(av) - Number(bv);
    return dir === "asc" ? cmp : -cmp;
  });
}

export function computeDelta(history: HistoryPoint[]): { delta: number | null; days: number | null } {
  if (!history || history.length < 2) return { delta: null, days: null };
  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  const days = Math.round((new Date(current.at).getTime() - new Date(previous.at).getTime()) / 86400000);
  return { delta: Math.round((current.score - previous.score) * 10) / 10, days };
}

/** UTC 日键：带时区偏移的 at 直接用 slice(0,10) 会落到本地日，跨日错桶。 */
export function utcDayKey(at: string): string {
  const ms = Date.parse(at);
  // 解不出来的串退回字面前缀，至少不抛 RangeError 把整页拖垮。
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : at.slice(0, 10);
}

export const DEGRADE_THRESHOLD = -5;
export const MIN_COVERAGE_RATIO = 0.9;
/** 趋势最多同时画几条曲线：默认选中、上限闸门、TrendControls 的默认 max 共用一个源，别再各自写 6。 */
export const MAX_TREND_SERIES = 6;
/**
 * 日桶网格的最大跨度（含首尾，单位天）。正常数据是 1~2 年历史，两年 731 天，这里留约 50% 冗余；
 * 再往上基本就是 1970 坏点（epoch 哨兵/上游默认值）撑出来的两万多桶，横轴会被拉成一条线。
 * 跨度不超上限时行为与不限幅完全一致，只有真正越界才截掉最老的那几天。
 */
export const MAX_GRID_DAYS = 1100;

/**
 * Δ 的方向符号——颜色之外的第二重编码，色觉障碍用户不靠红绿也能读出涨跌。
 * null / 非有限值 / 0 都给破折号：没有方向可言。
 */
export function deltaMark(delta: number | null): "▼" | "▲" | "—" {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return "—";
  return delta < 0 ? "▼" : "▲";
}

/** 与 deltaMark 配套的类名：跌了 .down，涨了 .up，没方向则不着色。 */
export function deltaClass(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return "";
  return delta < 0 ? "down" : "up";
}

/** 解析时间戳毫秒；坏日期回 null，比较时一律垫底。 */
function msOf(at: string): number | null {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 时间升序比较。基准是毫秒而不是原始 at 字符串：混时区时 `"…+14:00"` 的字典序
 * 会排在 `"…-12:00"` 之后，而真实时间相反，序列一旦倒挂下游就把跌算成涨。
 * 解不出来的坏日期垫到末尾，不因为 NaN 比较恒假就卡在队首。
 */
function byTimeAsc(a: HistoryPoint, b: HistoryPoint): number {
  const am = msOf(a.at);
  const bm = msOf(b.at);
  if (am === null || bm === null) return am === bm ? 0 : am === null ? 1 : -1;
  return am - bm;
}

/**
 * 按 UTC 日聚成「当天最晚一条」。折线（buildDailyGrid）与散点/降智红点（lastPerDay）
 * 必须共用这一份口径：各自实现过一次，一个按数组位置、一个按时间，同一天多次评分时
 * 点和线会各指一个值。比较基准与排序同口径（解析后的毫秒），坏日期不顶掉可用的点。
 */
function latestPerUtcDay(history: HistoryPoint[]): Map<string, HistoryPoint> {
  const byDay = new Map<string, HistoryPoint>();
  for (const p of history) {
    const day = utcDayKey(p.at);
    const seen = byDay.get(day);
    const pm = msOf(p.at);
    const seenMs = seen ? msOf(seen.at) : null;
    if (!seen || (pm !== null && (seenMs === null || pm > seenMs))) byDay.set(day, p);
  }
  return byDay;
}

/**
 * 按 UTC 日去重，同一天只留最晚一条，并按时间升序。
 * 折线、散点、降智红点必须共用这一条序列，否则点会飘在折线外。
 */
export function lastPerDay(history: HistoryPoint[]): HistoryPoint[] {
  return [...latestPerUtcDay(history).values()].sort(byTimeAsc);
}

export function findDegradationPoints(
  history: HistoryPoint[],
): { point: HistoryPoint; delta: number; days: number }[] {
  const out: { point: HistoryPoint; delta: number; days: number }[] = [];
  const series = lastPerDay(history);
  for (let i = 1; i < series.length; i++) {
    const current = series[i];
    const previous = series[i - 1];
    const delta = current.score - previous.score;
    if (delta > DEGRADE_THRESHOLD) continue;
    if (current.score_status !== "complete") continue;
    // required_tasks 为 0 时右边是 0，coverage < 0 恒假 —— 覆盖率闸门等于不存在。
    if (!(current.required_tasks > 0) || !Number.isFinite(current.coverage)) continue;
    if (current.coverage < current.required_tasks * MIN_COVERAGE_RATIO) continue;
    const days = Math.round((new Date(current.at).getTime() - new Date(previous.at).getTime()) / 86400000);
    out.push({ point: current, delta: Math.round(delta * 10) / 10, days });
  }
  return out;
}

export function topCandidates(rows: RadarCandidate[], n = 6): RadarCandidate[] {
  return [...rows]
    .filter((r) => r.score_status === "complete")
    .sort((a, b) => b.score - a.score || (b.latest_graded_at ?? "").localeCompare(a.latest_graded_at ?? ""))
    .slice(0, n);
}

export function buildDailyGrid(history: HistoryPoint[]): { at: string; score: number | null }[] {
  if (!history.length) return [];
  // 单趟循环求首尾，不摊成 `Math.min(...times)`：实参列表一过 V8 上限（十几万点）就
  // RangeError 白屏，而 TrendChart 外层没有 try。
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const h of history) {
    const ms = Date.parse(h.at);
    if (!Number.isFinite(ms)) continue;
    if (ms < lowest) lowest = ms;
    if (ms > highest) highest = ms;
  }
  // 一个能解析的时间都没有，别产出空网格还当成"没有降智"。
  if (lowest > highest) return [];
  // 从 UTC 零点起走，否则首尾当天会因取整被吞掉一天。
  const from = new Date(lowest);
  from.setUTCHours(0, 0, 0, 0);
  // 跨度封顶：只保留最近 MAX_GRID_DAYS 天，坏点被挤出窗口。
  // 起点往「最近 N 天」的方向前移，终点（最新的一天）始终保留；跨度本就 ≤ 上限时这里是空操作。
  const highestDay = new Date(highest);
  highestDay.setUTCHours(0, 0, 0, 0);
  const windowStart = highestDay.getTime() - (MAX_GRID_DAYS - 1) * 86400000;
  const start = Math.max(from.getTime(), windowStart);
  // 同日取值与 lastPerDay 共用 latestPerUtcDay：折线和散点必须是同一个数。
  const byDay = latestPerUtcDay(history);
  const out: { at: string; score: number | null }[] = [];
  for (let d = start; d <= highest; d += 86400000) {
    const key = new Date(d).toISOString().slice(0, 10);
    out.push({ at: key + "T00:00:00.000Z", score: byDay.get(key)?.score ?? null });
  }
  return out;
}

export function roundMatrix(round: RoundData): {
  models: string[];
  efforts: string[];
  cells: Map<string, RoundCandidate>;
} {
  const models = [...new Set(round.candidates.map((c) => c.model))];
  const knownEfforts = EFFORT_ORDER.filter((e) => round.candidates.some((c) => c.effort === e));
  // 上游新加的档位不能整列消失，追加到末尾。
  const unknownEfforts = [...new Set(round.candidates.map((c) => c.effort))]
    .filter((e) => !EFFORT_ORDER.includes(e))
    .sort();
  const efforts = [...knownEfforts, ...unknownEfforts];
  const cells = new Map(round.candidates.map((c) => [candidateKey(c.model, c.effort), c]));
  return { models, efforts, cells };
}