import type { RadarBenchData, RoundData, StatusData } from "../types";
import { assertRadarBenchShape, assertRoundShape, assertStatusShape } from "../../scripts/contract.mjs";

/** 单份数据的加载结果。失败只塌掉自己这一槽，不连坐整页。 */
export type Slot<T> = { data: T | null; error: string | null };

export type LoadedSlots = {
  radarBench: Slot<RadarBenchData>;
  round: Slot<RoundData>;
  status: Slot<StatusData>;
};

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

/** 把一次加载压成槽结果：成功留 data，失败留 message，绝不抛。 */
export async function toSlot<T>(pending: Promise<T>): Promise<Slot<T>> {
  try {
    return { data: await pending, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export const slotRadarBench = () => toSlot(loadRadarBench());
export const slotRound = () => toSlot(loadRound());
export const slotStatus = () => toSlot(loadStatus());

/**
 * 三份数据各走各的：任何一份 404 / 结构异常，其余两槽照常可用。
 * 用 Promise.all（不是 allSettled + 裸 Promise）是因为 toSlot 已经吃掉异常，
 * 这里不会 reject，顺序也稳定。
 */
export async function loadAll(): Promise<LoadedSlots> {
  const [radarBench, round, status] = await Promise.all([
    slotRadarBench(),
    slotRound(),
    slotStatus(),
  ]);
  return { radarBench, round, status };
}
