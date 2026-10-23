import { describe, it, expect, vi, afterEach } from "vitest";
import { loadRadarBench, loadRound, urlFor } from "../src/data/loader";

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
