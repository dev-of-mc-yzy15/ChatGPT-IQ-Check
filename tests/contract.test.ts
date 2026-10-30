import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  candidateKey,
  parseCandidateKey,
  strictNumber,
  assertRadarBenchShape,
  assertRoundShape,
  assertStatusShape,
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
  // Number(true) === 1、Number(false) === 0：布尔以前带着 1/0 一路流到落盘数据和 UI。
  it("rejects booleans instead of coercing to 1/0", () => {
    expect(() => strictNumber(true, "x")).toThrow(/number \(got boolean\)/);
    expect(() => strictNumber(false, "x")).toThrow(/number \(got boolean\)/);
  });
  // Number([5]) === 5 会静默通过；Number([5, 6]) 只是碰巧 NaN 才被 finite 拦住。
  it("rejects arrays and plain objects", () => {
    expect(() => strictNumber([5], "x")).toThrow(/number \(got array\)/);
    expect(() => strictNumber([5, 6], "x")).toThrow(/number \(got array\)/);
    expect(() => strictNumber({}, "x")).toThrow(/number \(got object\)/);
  });
  it("rejects bigint and functions", () => {
    expect(() => strictNumber(5n, "x")).toThrow(/number \(got bigint\)/);
    expect(() => strictNumber(() => 5, "x")).toThrow(/number \(got function\)/);
  });
  // 守卫：上游确实有给数字字符串的字段，字符串兼容不能被一刀切掉。
  it("still accepts a padded numeric string and a real number", () => {
    expect(strictNumber(" 12 ", "x")).toBe(12);
    expect(strictNumber(12, "x")).toBe(12);
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

  const roundEnvelope = (partial: unknown) => ({
    schema_version: 1,
    fetch_id: "fixture-fetch",
    generated_at: "2026-10-24T00:00:00.000Z",
    checked_at: "2026-10-24T00:00:00.000Z",
    ...(partial as object),
  });

  it("round shape 接受 score 为 null 的候选（一个任务都没打分）", () => {
    const emptyResults = { ...roundRaw, round: { ...roundRaw.round, results: { "gpt-6-astra|high": {} } } };
    const partial = transformRound(emptyResults);
    expect(partial.candidates[0].score).toBeNull();
    expect(() => assertRoundShape(roundEnvelope(partial))).not.toThrow();
  });

  // score 与 score_max 以前各校验各的、从不相比较：999/150 能整份过校验落盘，
  // 前端进度条和环形图再按 999/150 画出去。
  it("round shape 拒绝 score 超过 score_max 的候选", () => {
    const partial = transformRound(roundRaw);
    expect(partial.candidates[0].score).toBeGreaterThan(0);
    const over = {
      ...partial,
      candidates: [{ ...partial.candidates[0], score: 999, score_max: 150 }],
    };
    expect(() => assertRoundShape(roundEnvelope(over))).toThrow(/<= score_max 150/);
  });

  // 守卫：score 为 null 时 null > x 恒假，上限比较不能把「没打分」误判成越界。
  it("round shape 在 score 为 null 时不受上限比较误伤", () => {
    const emptyResults = { ...roundRaw, round: { ...roundRaw.round, results: { "gpt-6-astra|high": {} } } };
    const partial = transformRound(emptyResults);
    const nulled = {
      ...partial,
      candidates: [{ ...partial.candidates[0], score: null, score_max: 150 }],
    };
    expect(() => assertRoundShape(roundEnvelope(nulled))).not.toThrow();
  });
});

describe("strictNumber optional", () => {
  it("lets a missing key through only when optional", () => {
    expect(strictNumber(undefined, "x", { optional: true })).toBeUndefined();
    expect(() => strictNumber(undefined, "x")).toThrow(/expected number/);
  });
  it("still validates the value when it is present", () => {
    expect(() => strictNumber("nope", "x", { optional: true })).toThrow(/finite number/);
    expect(() => strictNumber(-3, "x", { optional: true, min: 0 })).toThrow(/>= 0/);
  });
});

describe("assertStatusShape 新分类字段", () => {
  const base = () => read("public/data/status.json");

  // 旧格式样本内联构造，不读仓库存量文件：status.json 会被管道重新抓取成新格式，
  // 拿它当"旧格式"证据，数据一刷新这条就跟着变红。新增键在 assertStatusShape 里
  // 全是 optional，旧格式必须永远合法。
  const legacyStatus = () => ({
    checked_at: "2026-10-24T00:00:00.000Z",
    ok: true,
    benchmark: "codexradar",
    candidates_ok: 3,
    candidates_total: 3,
    round_ok: true,
    latest_graded_at: null,
    round_updated_at: null,
    stale_days: 3,
    errors: [],
  });

  it("accepts a legacy status.json without the new keys", () => {
    const legacy = legacyStatus();
    // 样本必须真的是旧格式：本轮新增键一个都不能混进来。
    for (const key of [
      "binding_total",
      "reused_count",
      "missing_count",
      "stale_count",
      "min_latest",
    ]) {
      expect(legacy).not.toHaveProperty(key);
    }
    expect(() => assertStatusShape(legacy)).not.toThrow();
  });

  it("accepts the shipped status.json", () => {
    // 仓库现在发布的那份（新格式）同样要过，新旧两条路径都钉住。
    expect(() => assertStatusShape(read("public/data/status.json"))).not.toThrow();
  });

  it("validates the new keys once they exist", () => {
    const status = { ...base(), reused_count: 2, missing_count: 0, stale_count: 1, binding_total: 34 };
    expect(assertStatusShape(status).reused_count).toBe(2);
    expect(() => assertStatusShape({ ...status, reused_count: -1 })).toThrow(/>= 0/);
    expect(() => assertStatusShape({ ...status, binding_total: "nope" })).toThrow(/finite number/);
  });

  it("rejects a non-ISO min_latest but keeps null", () => {
    const status = base();
    expect(() => assertStatusShape({ ...status, min_latest: "yesterday" })).toThrow(/ISO timestamp/);
    expect(assertStatusShape({ ...status, min_latest: null }).min_latest).toBeNull();
  });
});
