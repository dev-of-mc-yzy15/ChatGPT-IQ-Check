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

  // history 点的 score 以前只压 min: 0、没有上界，和上面候选级 score 的上界不对称。
  // 后果不是文案问题：9999 能整份过校验，前端 yOf(9999, 150) 算出 -18627.4，而绘图区
  // y 只有 20~304，该点飞出视口、外层无 try 且 overflow 裁掉，那一截折线直接消失；
  // computeDelta / findDegradationPoints 的 delta 同样被污染成上千分。
  it("radar shape 拒绝 history score 超过 score_max 的点", () => {
    const radar = read("public/data/radar-bench.json");
    radar.candidates[0].history[0].score = 9999;
    // 一条正则同时钉住键路径和两个值：路径要能定位到具体历史点，两个值都要露在文案里。
    const expected = /candidates\[0\]\.history\[0\]\.score: expected <= score_max 150, got 9999/;
    expect(() => assertRadarBenchShape(radar)).toThrow(expected);
    // 两端共用这个校验函数，但落点不同（浏览器 load、管道 refresh），两端都得真拦住。
    expect(() => loaderValidateRadarBench(radar)).toThrow(expected);
    expect(() => libValidateRadarBench(radar, { minCandidates: 1 })).toThrow(expected);
  });

  // 边界：正好等于 score_max 必须放行。上界写成 >= 会把满分点误判成越界，把这条打红。
  it("radar shape 放行 history score 正好等于 score_max 的点", () => {
    const radar = read("public/data/radar-bench.json");
    const max = radar.score_max as number;
    expect(radar.candidates[0].history[0].score).not.toBe(max);
    radar.candidates[0].history[0].score = max;
    expect(() => assertRadarBenchShape(radar)).not.toThrow();
  });

  // 回归：补上界不能顺手顶掉下界。负分仍由 strictNumber 的 min: 0 拒绝，
  // 错文案也要保持原来的下界口径，不能被"没超过上限"放过去。
  it("radar shape 仍按 min 0 拒绝 history 负分", () => {
    const radar = read("public/data/radar-bench.json");
    radar.candidates[0].history[0].score = -1;
    expect(() => assertRadarBenchShape(radar)).toThrow(
      /candidates\[0\]\.history\[0\]\.score: expected number >= 0, got -1/,
    );
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

describe("夹具 asset 文件名与 sha256 前缀不变量", () => {
  // 规则来源：上游把每个动画命名为 <run>-<model>-<effort>-<sha256 前 12 位>.html.txt
  // （tests/fixtures/README.md「asset.sha256 must stay」）。夹具里那个值锚定真实上游文件，
  // 所以文件名里的十六进制必须就是 sha256 的开头，否则说明有人手滑改了一边没跟上另一边。
  //
  // 只核前缀、不重算整串：能核的只有文件名带的前缀。public/assets 现存的 34 个产物里，
  // 末段全部是 12 位且 34/34 等于自身 sha256 前 12 位；夹具这一条却是 10 位（941fa56cda），
  // URL 现在仍答 200，且把它补成 12 位（941fa56cdad0）同样答 200、字节数也一模一样，
  // 可见上游对末段长度不敏感。故这里接受 10~12 位，而不是钉死 12 位去逼夹具改值。
  // 剩 52 位不可复算：上游文件体已被回退页覆盖（b68eb88f…），原始字节拿不到。
  const MIN_PREFIX = 10;
  const MAX_PREFIX = 12;

  /** 递归收集所有同时带 url 与 sha256 的 asset 对象，不依赖固定路径，加了新动画也自动覆盖。 */
  function collectAssets(node: unknown, path = "$"): Array<{ path: string; url: string; sha256: string }> {
    if (!node || typeof node !== "object") return [];
    const found: Array<{ path: string; url: string; sha256: string }> = [];
    const obj = node as Record<string, unknown>;
    if (!Array.isArray(node) && typeof obj.url === "string" && typeof obj.sha256 === "string") {
      found.push({ path, url: obj.url, sha256: obj.sha256 });
    }
    for (const key of Object.keys(obj)) {
      found.push(...collectAssets(obj[key], `${path}.${key}`));
    }
    return found;
  }

  it("每个 asset 的 url 文件名末段都是 sha256 的十六进制前缀", () => {
    const assets = collectAssets(read("tests/fixtures/round.sample.json"));
    // 遍历结果为空时下面一条都不跑，等于恒绿——夹具必须真的带 asset。
    expect(assets.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const { path, url, sha256 } of assets) {
      const base = url.split("/").pop() ?? "";
      // 以 .html.txt 收尾是前提，否则末段不是哈希前缀而是文件名尾巴。
      if (!base.endsWith(".html.txt")) {
        problems.push(`${path}: url basename 不以 .html.txt 结尾 (${base})`);
        continue;
      }
      const fromName = base.slice(0, -".html.txt".length).split("-").pop() ?? "";
      if (!new RegExp(`^[0-9a-f]{${MIN_PREFIX},${MAX_PREFIX}}$`).test(fromName)) {
        problems.push(`${path}: 文件名末段不是 ${MIN_PREFIX}~${MAX_PREFIX} 位小写十六进制 (${fromName})`);
        continue;
      }
      if (!sha256.startsWith(fromName)) {
        problems.push(`${path}: 文件名末段 ${fromName} 不是 sha256 的前缀 (${sha256.slice(0, 12)})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("夹具里的 sha256 都是满 64 位十六进制", () => {
    // 前缀规则只在摘要保持全长时才有意义：被截短就说明有人把 sha256 缩成了可读前缀，
    // 下游拿它校验下载到的字节时会全部对不上。
    const assets = collectAssets(read("tests/fixtures/round.sample.json"));
    expect(assets.length).toBeGreaterThan(0);
    for (const { path, sha256 } of assets) {
      expect(sha256, path).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
