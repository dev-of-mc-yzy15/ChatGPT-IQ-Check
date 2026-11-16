import type {
  FourTaskData,
  RadarBenchData,
  RatingsData,
  RoundData,
  StatusData,
} from "../types";
import {
  assertFourTaskShape,
  assertRadarBenchShape,
  assertRatingsShape,
  assertRoundShape,
  assertStatusShape,
} from "../../scripts/contract.mjs";

/** 单份数据的加载结果。失败只塌掉自己这一槽，不连坐整页。 */
export type Slot<T> = { data: T | null; error: string | null };

export type LoadedSlots = {
  radarBench: Slot<RadarBenchData>;
  round: Slot<RoundData>;
  status: Slot<StatusData>;
  /** 社区体感是 P1 可选源：这一槽失败只该让那张卡片显示不可用。 */
  ratings: Slot<RatingsData>;
  /** 四题协议（2026-10 起的现行口径）：与旧 RadarBench 并列，互不依赖。 */
  fourTask: Slot<FourTaskData>;
};

export function urlFor(rel: string, base = import.meta.env.BASE_URL || "/"): string {
  return base.endsWith("/") ? base + rel : base + "/" + rel;
}

async function getJson<T>(rel: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  // 只有定时器真的响过才认超时。用标志位而不是 res 的落地状态判断，
  // 是因为非 2xx 也可能恰好在 abort 之后才返回，那种情况仍该报 HTTP。
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(urlFor(rel), {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`加载 ${rel} 失败：HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (error) {
    // abort 抛的是英文 DOMException（"The operation was aborted."），不该漏给简体中文界面：
    // 翻译成中文并带上毫秒，原始 error 挂 cause 留证。真实网络错误则原样冒泡，两者仍可区分。
    if (timedOut) throw new Error(`加载 ${rel} 超时（${timeoutMs}ms）`, { cause: error });
    throw error;
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

export function validateRatings(data: RatingsData): void {
  guard("ratings.json", assertRatingsShape, data);
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

export function validateFourTask(data: FourTaskData): void {
  guard("four-task.json", assertFourTaskShape, data);
}

export async function loadFourTask(): Promise<FourTaskData> {
  const data = await getJson<FourTaskData>("data/four-task.json");
  validateFourTask(data);
  return data;
}

export async function loadRatings(): Promise<RatingsData> {
  const data = await getJson<RatingsData>("data/ratings.json");
  validateRatings(data);
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
export const slotRatings = () => toSlot(loadRatings());
export const slotFourTask = () => toSlot(loadFourTask());

/**
 * 五份数据各走各的：任何一份 404 / 结构异常，其余槽照常可用。
 * 用 Promise.all（不是 allSettled + 裸 Promise）是因为 toSlot 已经吃掉异常，
 * 这里不会 reject，顺序也稳定。
 */
export async function loadAll(): Promise<LoadedSlots> {
  const [radarBench, round, status, ratings, fourTask] = await Promise.all([
    slotRadarBench(),
    slotRound(),
    slotStatus(),
    slotRatings(),
    slotFourTask(),
  ]);
  return { radarBench, round, status, ratings, fourTask };
}
