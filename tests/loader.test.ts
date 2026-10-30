import { describe, it, expect, vi, afterEach } from "vitest";
import {
  loadAll,
  loadRadarBench,
  loadRound,
  slotRadarBench,
  slotStatus,
  urlFor,
} from "../src/data/loader";

afterEach(() => vi.unstubAllGlobals());

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
