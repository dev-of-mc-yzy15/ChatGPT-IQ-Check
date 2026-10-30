import type { RadarBenchData, RoundData, StatusData } from "../types";
import { assertRadarBenchShape, assertRoundShape, assertStatusShape } from "../../scripts/contract.mjs";

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

function guard<T>(label: string, assert: (data: T) => T, data: T): T {
  try {
    return assert(data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} 结构异常：${detail}`);
  }
}

export function validateRadarBench(data: RadarBenchData): void {
  guard("radar-bench.json", assertRadarBenchShape, data);
}

export function validateRound(data: RoundData): void {
  guard("round.json", assertRoundShape, data);
}

export function validateStatus(data: StatusData): void {
  guard("status.json", assertStatusShape, data);
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

export async function loadStatus(): Promise<StatusData> {
  const data = await getJson<StatusData>("data/status.json");
  validateStatus(data);
  return data;
}

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
