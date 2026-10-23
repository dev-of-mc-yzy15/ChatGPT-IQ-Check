import type { HistoryPoint, RadarCandidate, RoundCandidate, RoundData } from "../types";

export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];
export type SortKey = "model" | "effort" | "score" | "coverage" | "graded_runs_count" | "latest_graded_at";

export function sortCandidates(rows: RadarCandidate[], key: SortKey, dir: "asc" | "desc"): RadarCandidate[] {
  return [...rows].sort((a, b) => {
    if (key === "effort") {
      const order = EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort);
      return dir === "asc" ? order : -order;
    }
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(String(bv), "en") : Number(av) - Number(bv);
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

export const DEGRADE_THRESHOLD = -5;
export const MIN_COVERAGE_RATIO = 0.9;

export function findDegradationPoints(
  history: HistoryPoint[],
): { point: HistoryPoint; delta: number; days: number }[] {
  const out: { point: HistoryPoint; delta: number; days: number }[] = [];
  for (let i = 1; i < history.length; i++) {
    const current = history[i];
    const previous = history[i - 1];
    const delta = current.score - previous.score;
    if (delta > DEGRADE_THRESHOLD) continue;
    if (current.score_status !== "complete") continue;
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
  const start = new Date(history[0].at);
  const end = new Date(history[history.length - 1].at);
  const byDay = new Map(history.map((p) => [p.at.slice(0, 10), p.score]));
  const out: { at: string; score: number | null }[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ at: key + "T00:00:00.000Z", score: byDay.get(key) ?? null });
  }
  return out;
}

export function roundMatrix(round: RoundData): {
  models: string[];
  efforts: string[];
  cells: Map<string, RoundCandidate>;
} {
  const models = [...new Set(round.candidates.map((c) => c.model))];
  const efforts = EFFORT_ORDER.filter((e) => round.candidates.some((c) => c.effort === e));
  const cells = new Map(round.candidates.map((c) => [c.model + "|" + c.effort, c]));
  return { models, efforts, cells };
}
