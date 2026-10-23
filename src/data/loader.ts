import type { RadarBenchData, RoundData, StatusData } from "../types";

export function urlFor(rel: string, base = import.meta.env.BASE_URL || "/"): string {
  return base.endsWith("/") ? base + rel : base + "/" + rel;
}

async function getJson<T>(rel: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlFor(rel), {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`加载 ${rel} 失败：HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function validateRadarBench(data: RadarBenchData): void {
  if (!data || data.schema_version !== 1 || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new Error("radar-bench.json 结构异常");
  }
}

export function validateRound(data: RoundData): void {
  if (!data || data.schema_version !== 1 || !data.round || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new Error("round.json 结构异常");
  }
}

export async function loadRadarBench(): Promise<RadarBenchData> {
  const data = await getJson<RadarBenchData>("data/radar-bench.json");
  validateRadarBench(data);
  return data;
}

export async function loadRound(): Promise<RoundData> {
  const data = await getJson<RoundData>("data/round.json");
  validateRound(data);
  return data;
}

export const loadStatus = () => getJson<StatusData>("data/status.json");

export async function loadAll(): Promise<{
  radarBench: RadarBenchData;
  round: RoundData;
  status: StatusData;
}> {
  const [radarBench, round, status] = await Promise.all([
    loadRadarBench(),
    loadRound(),
    loadStatus(),
  ]);
  return { radarBench, round, status };
}
