import { describe, it, expect, vi, afterEach } from "vitest";
import {
  loadAll,
  loadRadarBench,
  loadRound,
  loadStatus,
  slotRadarBench,
  slotStatus,
  urlFor,
} from "../src/data/loader";
import type { StatusData } from "../src/types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 走完整校验的最小合法 status.json，用来验证成功路径真的把 JSON 交回调用方。 */
const legalStatus: StatusData = {
  checked_at: "2026-10-24T00:00:00Z",
  ok: true,
  benchmark: "codexradar",
  candidates_ok: 3,
  candidates_total: 3,
  binding_total: 3,
  reused_count: 0,
  missing_count: 0,
  round_ok: true,
  latest_graded_at: null,
  min_latest: null,
  stale_count: 0,
  round_updated_at: null,
  stale_days: null,
  errors: [],
};

const okResponse = (payload: unknown) =>
  ({ ok: true, status: 200, json: async () => payload }) as Response;

/** 一直挂到 signal abort，再按真实 fetch 的姿势 reject signal.reason。 */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("getJson 没把 signal 传给 fetch"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
}

describe("urlFor", () => {
  it("joins base and relative path", () => {
    expect(urlFor("data/radar-bench.json", "/ChatGPT-IQ-Check/")).toBe(
      "/ChatGPT-IQ-Check/data/radar-bench.json",
    );
    expect(urlFor("data/radar-bench.json", "/")).toBe("/data/radar-bench.json");
  });
});

describe("loader", () => {
  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    await expect(loadRadarBench()).rejects.toThrow(/500/);
  });

  it("throws on malformed radar-bench payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    await expect(loadRadarBench()).rejects.toThrow(/结构异常/);
  });

  it("throws on malformed round payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    await expect(loadRound()).rejects.toThrow(/结构异常/);
  });
});

describe("slots", () => {
  it("wraps a failure into an error slot instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 }) as Response));
    const slot = await slotStatus();
    expect(slot.data).toBeNull();
    expect(slot.error).toMatch(/503/);
  });

  it("wraps a malformed payload into a structural error slot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    const slot = await slotRadarBench();
    expect(slot.data).toBeNull();
    expect(slot.error).toMatch(/结构异常/);
  });

  // P0-1：一份坏，其余两槽必须照常走完请求
  it("loadAll keeps the healthy slots when one file is broken", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("status.json")) return { ok: false, status: 404 };
        return { ok: true, json: async () => ({}) };
      }) as unknown as typeof fetch,
    );
    const slots = await loadAll();
    expect(slots.status.data).toBeNull();
    expect(slots.status.error).toMatch(/404/);
    // 另两槽走到了结构校验，说明它们的请求没被 404 连坐
    expect(slots.radarBench.error).toMatch(/结构异常/);
    expect(slots.round.error).toMatch(/结构异常/);
  });

  it("loadAll never rejects even when every slot fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    );
    const slots = await loadAll();
    expect(slots.radarBench.error).toMatch(/offline/);
    expect(slots.round.error).toMatch(/offline/);
    expect(slots.status.error).toMatch(/offline/);
  });
});

/**
 * getJson 是应用里唯一碰网络的地方，却一条专属用例都没有。
 * 这里只经公开的 loadStatus 打进去，不为了好测去改 loader 的导出面。
 */
describe("getJson（经 loadStatus）", () => {
  it("成功时解析 JSON 并原样交回", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(okResponse(legalStatus)),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadStatus()).resolves.toEqual(legalStatus);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(urlFor("data/status.json"));
    expect(init?.headers).toEqual({ accept: "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("非 2xx 抛错并把状态码带进文案", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 418 }) as Response));

    const error = await loadStatus().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("加载 data/status.json 失败：HTTP 418");
  });

  it("超时抛中文文案并带毫秒，不把英文 DOMException 漏给界面", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const pending = loadStatus();
    const settled = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await settled;

    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("加载 data/status.json 超时（15000ms）");
    expect((error as Error).message).not.toMatch(/aborted/i);
    // 原始 DOMException 没被丢掉，挂在 cause 上留证（跨 realm，只认 name/message）
    const cause = (error as Error & { cause?: Error }).cause;
    expect(cause?.name).toBe("AbortError");
    expect(cause?.message).toMatch(/aborted/i);
  });

  it("真实网络错误原样冒泡，不被误判成超时", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw networkError;
      }),
    );

    const error = await loadStatus().catch((caught: unknown) => caught);

    expect(error).toBe(networkError);
    expect((error as Error).message).not.toMatch(/超时/);
  });

  it("JSON 解析失败直接抛，不返回半截对象", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected end of JSON input");
            },
          }) as unknown as Response,
      ),
    );

    const error = await loadStatus().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SyntaxError);
    expect((error as Error).message).toMatch(/Unexpected end of JSON input/);
  });

  it("成功返回后不留 pending 定时器", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(legalStatus)));

    // getTimerCount 是整个假时钟宇宙的绝对计数，全量跑会被别处残留污染。
    // 改成基线增量：只问"本次调用有没有新增遗留定时器"，意图不变。
    const baseline = vi.getTimerCount();

    await loadStatus();

    expect(vi.getTimerCount()).toBe(baseline);
  });

  it("超时收尾后同样不留 pending 定时器", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const baseline = vi.getTimerCount();

    const pending = loadStatus().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(15000);
    await pending;

    expect(vi.getTimerCount()).toBe(baseline);
  });

  it("两次并发各持独立 signal，一次超时不牵连另一次", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        signals.push(signal);
        if (String(input).includes("radar-bench.json")) {
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
          });
        }
        return Promise.resolve(okResponse(legalStatus));
      }),
    );

    const slow = loadRadarBench();
    const slowSettled = expect(slow).rejects.toThrow(/超时/);
    const fast = loadStatus();
    const fastSettled = expect(fast).resolves.toEqual(legalStatus);
    await vi.advanceTimersByTimeAsync(15000);
    await Promise.all([slowSettled, fastSettled]);

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
