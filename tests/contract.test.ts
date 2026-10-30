import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  candidateKey,
  parseCandidateKey,
  strictNumber,
  assertRadarBenchShape,
  assertRoundShape,
} from "../scripts/contract.mjs";
import { validateRadarBench as loaderValidateRadarBench, validateRound as loaderValidateRound } from "../src/data/loader";
import { validateRadarBench as libValidateRadarBench, validateRound as libValidateRound } from "../scripts/lib.mjs";
import roundRaw from "./fixtures/round.sample.json";
import { transformRound } from "../scripts/lib.mjs";

const read = (rel: string) => JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf8"));

describe("strictNumber", () => {
  it("rejects empty string instead of coercing to 0", () => {
    expect(() => strictNumber("", "x")).toThrow(/expected number/);
  });
  it("rejects null unless nullable", () => {
    expect(() => strictNumber(null, "x")).toThrow(/expected number/);
    expect((strictNumber(null, "x", { nullable: true }) as number | null)).toBeNull();
  });
  it("rejects non-finite and below-min values", () => {
    expect(() => strictNumber("nope", "x")).toThrow(/finite number/);
    expect(() => strictNumber(-1, "x", { min: 0 })).toThrow(/>= 0/);
  });
  it("keeps real zero", () => {
    expect(strictNumber(0, "x")).toBe(0);
  });
});

describe("candidate keys", () => {
  it("round-trips model and effort", () => {
    expect(parseCandidateKey(candidateKey("gpt-6.1-sol", "high"))).toEqual({
      model: "gpt-6.1-sol",
      effort: "high",
    });
  });
  it("survives a model containing a pipe", () => {
    expect(parseCandidateKey(candidateKey("a|b", "low"))).toEqual({ model: "a|b", effort: "low" });
  });
  it("rejects degenerate keys", () => {
    expect(parseCandidateKey("a|b")).toBeTruthy();
    expect(() => parseCandidateKey("|high")).toThrow(/bad candidate key/);
    expect(() => parseCandidateKey("model|")).toThrow(/bad candidate key/);
    // P1-5：完全没有分隔符时以前 effort 解出 undefined，静默产出空档位。
    expect(() => parseCandidateKey("nomodel")).toThrow(/bad candidate key/);
  });
});

// W1 出口判据：同一个坏 payload，管道侧与浏览器侧必须给同一结论。
describe("双端契约一致", () => {
  const badRadar = () => ({
    ...read("public/data/radar-bench.json"),
    candidates: [{ ...read("public/data/radar-bench.json").candidates[0], score: "" }],
  });
  const badRound = () => {
    const data = read("public/data/round.json");
    data.round.updated_at = "not-a-timestamp";
    return data;
  };

  it.each([
    ["radar-bench 空串 score", () => badRadar(), 0],
    ["round 坏时间戳", () => badRound(), 1],
  ])("%s：两端抛出的都是同一处字段", (_name, make, index) => {
    const data = (make as () => unknown)();
    const messages: string[] = [];
    for (const fn of [
      index === 0 ? (d: unknown) => loaderValidateRadarBench(d as never) : (d: unknown) => loaderValidateRound(d as never),
      index === 0 ? (d: unknown) => libValidateRadarBench(d, { minCandidates: 1 }) : (d: unknown) => libValidateRound(d, { minCandidates: 1 }),
    ]) {
      try {
        fn(data);
        messages.push("NO THROW");
      } catch (error) {
        messages.push(String((error as Error).message).replace(/^[^:]+: /, ""));
      }
    }
    expect(messages[0]).not.toBe("NO THROW");
    expect(messages[1]).not.toBe("NO THROW");
    expect(messages[0]).toBe(messages[1]);
  });

  it("真实数据双端都通过", () => {
    expect(() => loaderValidateRadarBench(read("public/data/radar-bench.json"))).not.toThrow();
    expect(() => loaderValidateRound(read("public/data/round.json"))).not.toThrow();
    expect(() => libValidateRadarBench(read("public/data/radar-bench.json"), { minCandidates: 30 })).not.toThrow();
    expect(() => libValidateRound(read("public/data/round.json"), { minCandidates: 30 })).not.toThrow();
  });

  it("浏览器侧不做数量下限，管道侧做", () => {
    const radar = read("public/data/radar-bench.json");
    radar.candidates = radar.candidates.slice(0, 3);
    expect(() => assertRadarBenchShape(radar)).not.toThrow();
    expect(() => libValidateRadarBench(radar, { minCandidates: 30 })).toThrow(/too few candidates/);
  });

  it("round shape 接受 score 为 null 的候选（一个任务都没打分）", () => {
    const emptyResults = { ...roundRaw, round: { ...roundRaw.round, results: { "gpt-6-astra|high": {} } } };
    const partial = transformRound(emptyResults);
    expect(partial.candidates[0].score).toBeNull();
    const withEnvelope = {
      schema_version: 1,
      fetch_id: "fixture-fetch",
      generated_at: "2026-10-24T00:00:00.000Z",
      checked_at: "2026-10-24T00:00:00.000Z",
      ...partial,
    };
    expect(() => assertRoundShape(withEnvelope)).not.toThrow();
  });
});
