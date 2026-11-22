import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  summaryUrl,
  refreshAll,
  fetchJson,
  roundCandidateFloor,
  parseArgs,
  promoteLiveChain,
} from "../scripts/refresh.mjs";
import { assertRadarBenchShape, assertRatingsShape, assertRoundShape, assertStatusShape } from "../scripts/contract.mjs";
import bindingRaw from "./fixtures/binding.sample.json";
import summaryRaw from "./fixtures/summary.sample.json";
import roundRaw from "./fixtures/round.sample.json";
import ratingsRaw from "./fixtures/ratings.sample.json";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts/refresh.mjs");

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("summaryUrl", () => {
  it("builds the required query from the binding-declared endpoint", () => {
    const url = summaryUrl("gpt-6-astra", "high", "https://api.codexradar.com/api/v1/radar-bench-score");
    expect(url).toContain("https://api.codexradar.com/api/v1/radar-bench-score?");
    expect(url).toContain("model=gpt-6-astra");
    expect(url).toContain("effort=high");
    expect(url).toContain("view=summary");
    expect(url).toContain("selection=user-selected-v1");
  });

  it("builds the required query", () => {
    const url = summaryUrl("gpt-6-astra", "high");
    expect(url).toContain("model=gpt-6-astra");
    expect(url).toContain("effort=high");
    expect(url).toContain("view=summary");
    expect(url).toContain("selection=user-selected-v1");
  });
});

describe("refreshAll", () => {
  it("writes radar-bench, round and status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({ ...summaryRaw, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({ fetchImpl: fetchImpl as unknown as typeof fetch, outDir: dir, now: () => new Date("2026-10-24T00:00:00Z"), minRadarCandidates: 3, minRoundCandidates: 2 });
    expect(result.radarBench.candidates).toHaveLength(3);
    expect(result.round.candidates).toHaveLength(2);
    const status = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(status.ok).toBe(true);
    expect(status.candidates_ok).toBe(3);
  });

  it("marks data stale when only round.updated_at is old", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const staleRound = JSON.parse(JSON.stringify(roundRaw));
    staleRound.round.updated_at = "2026-09-01T00:00:00Z";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({ ...summaryRaw, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(staleRound);
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({ fetchImpl: fetchImpl as unknown as typeof fetch, outDir: dir, now: () => new Date("2026-10-24T00:00:00Z"), minRadarCandidates: 3, minRoundCandidates: 2 });
    expect(result.status.stale_days).toBeGreaterThanOrEqual(7);
    const status = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(status.stale_days).toBe(result.status.stale_days);
  });

  it("throws when too few summaries succeed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) throw new Error("boom");
      return jsonResponse(roundRaw);
    });
    await expect(refreshAll({ fetchImpl: fetchImpl as unknown as typeof fetch, outDir: dir, now: () => new Date("2026-10-24T00:00:00Z"), minRadarCandidates: 3, minRoundCandidates: 2 })).rejects.toThrow(/summaries/);
  });
});

describe("refreshAll 状态与空转", () => {
  const mkFetch = (opts: { failFor?: string; round?: unknown } = {}) =>
    vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        const model = u.searchParams.get("model") ?? "";
        // 同一 model 可能有多档 effort，必须按身份串打，否则会一次打掉多个候选
        const key = `${model}|${u.searchParams.get("effort") ?? ""}`;
        if (opts.failFor && key === opts.failFor) throw new Error("boom");
        return jsonResponse({ ...summaryRaw, model, effort: u.searchParams.get("effort") });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(opts.round ?? roundRaw);
      if (url.includes("api/iq-progress/current")) {
        return jsonResponse({
          schema: 1,
          round_id: "codex-four-repeat-oauth-20261122",
          revision: 7,
          state: "running",
          total: 232,
          answered: 128,
          graded: 126,
          observed_at: "2026-10-24T00:00:00.000Z",
          changed_at: "2026-10-24T00:00:00.000Z",
        });
      }
      throw new Error("unexpected url " + url);
    });

  // P0-7 / status.ok：复用旧数据的候选必须让 ok 变 false，不能硬写 true
  it("writes ok=false when a candidate had to reuse previous data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const seeded = await refreshAll({
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });
    expect(seeded.status.ok).toBe(true);

    // 已有一份完整数据，这次让其中一个候选挂掉 → 复用旧值
    const victim = seeded.radarBench.candidates[0];
    const partial = await refreshAll({
      fetchImpl: mkFetch({ failFor: `${victim.model}|${victim.effort}` }) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });
    expect(partial.status.ok).toBe(false);
    expect(partial.status.errors.length).toBeGreaterThan(0);
    const onDisk = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(onDisk.ok).toBe(false);
  });

  it("does not rewrite status when nothing materially changed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const args = {
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    };
    await refreshAll({ ...args, now: () => new Date("2026-10-24T00:00:00Z") });
    const first = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));

    // 用同一天内的两个时刻：stale_days 不变，内容才是真的没变化
    await refreshAll({ ...args, now: () => new Date("2026-10-24T00:30:00Z") });
    const second = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    // 内容一致 → 不写盘，checked_at 保持第一次的值（不然每天一条空提交）
    expect(second.checked_at).toBe(first.checked_at);
    expect(second.stale_days).toBe(first.stale_days);
  });

  it("rewrites status when a user-visible field changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const args = {
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    };
    await refreshAll({ ...args, now: () => new Date("2026-10-24T00:00:00Z") });
    const first = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));

    await refreshAll({
      ...args,
      fetchImpl: mkFetch({ failFor: "zzz-not-a-model" }) as unknown as typeof fetch,
      now: () => new Date("2026-10-24T05:00:00Z"),
    });
    const second = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(second.checked_at).not.toBe(first.checked_at);
  });

  // 安全 R7：上限曾被 max(30, ...) 钉死，候选数不足 37.5 时刷新永久失败
  it("accepts a binding with fewer candidates than the old 30 floor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const small = JSON.parse(JSON.stringify(bindingRaw));
    small.model_efforts = small.model_efforts.slice(0, 2);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(small);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({ ...summaryRaw, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      return jsonResponse(roundRaw);
    });
    // 不传 minRadarCandidates，走默认值
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRoundCandidates: 2,
    });
    expect(result.status.candidates_total).toBe(2);
    expect(result.status.ok).toBe(true);
  });

  // 安全 R7 的 round 侧孪生问题：round 曾硬判 30，今天 34 个候选看不出病，
  // 上游真发少了就是永久死锁。这里给 3 个候选且不传 minRoundCandidates。
  it("accepts a round payload with fewer than 30 candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const small = JSON.parse(JSON.stringify(bindingRaw));
    small.model_efforts = small.model_efforts.slice(0, 3);
    const smallRound = JSON.parse(JSON.stringify(roundRaw));
    smallRound.round.results = {
      "gpt-6-astra|high": smallRound.round.results["gpt-6-astra|high"],
      "gpt-6-astra|low": smallRound.round.results["gpt-6-astra|low"],
      "gpt-6.1-sol|high": {},
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(small);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({ ...summaryRaw, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      return jsonResponse(smallRound);
    });
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
    });
    expect(result.round.candidates).toHaveLength(3);
  });

  it("clamps the round floor to the candidate count but never to 0", () => {
    expect(roundCandidateFloor(3)).toBe(3);
    expect(roundCandidateFloor(34)).toBe(30);
    // 空 payload 不能让下限归零，否则"一个候选都没有"反而全放过。
    expect(roundCandidateFloor(0)).toBe(1);
  });
});

// P1-2 / P1-3 / P1-4：errors 分类、陈旧识别、旧数据损坏
describe("refreshAll 旧数据降级与陈旧识别", () => {
  const mkFetch = (opts: { failFor?: string; gradedAt?: Record<string, string>; round?: unknown } = {}) =>
    vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        const model = u.searchParams.get("model") ?? "";
        const effort = u.searchParams.get("effort") ?? "";
        // 同一 model 有多档 effort，必须按身份串打，否则一次打掉多个候选
        const key = model + "|" + effort;
        if (opts.failFor === "*" || opts.failFor === key) throw new Error("boom");
        const gradedAt = opts.gradedAt?.[key];
        return jsonResponse({
          ...summaryRaw,
          model,
          effort,
          ...(gradedAt
            ? { detail_metrics: { ...summaryRaw.detail_metrics, latest_graded_at: gradedAt } }
            : {}),
        });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(opts.round ?? roundRaw);
      throw new Error("unexpected url " + url);
    });

  const seed = async (dir: string) =>
    refreshAll({
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });

  // P1-2：复用旧数据与无旧数据丢弃必须分开计数，总数只数参与统计的候选
  it("separates reused candidates from dropped ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const seeded = await seed(dir);
    const victim = seeded.radarBench.candidates[0];

    const partial = await refreshAll({
      fetchImpl: mkFetch({ failFor: victim.model + "|" + victim.effort }) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });

    expect(partial.status.reused_count).toBe(1);
    expect(partial.status.missing_count).toBe(0);
    // 被复用的候选仍在输出里，所以仍计入 candidates_total，等式必须成立
    expect(partial.status.candidates_total).toBe(partial.status.candidates_ok + partial.status.reused_count);
    expect(partial.status.candidates_total).toBe(3);
    expect(partial.status.binding_total).toBe(3);
    expect(partial.status.ok).toBe(false);
    expect(partial.status.errors.some((e) => String(e ?? "").startsWith("reused:"))).toBe(true);
  });

  // P1-2 + P1-4：旧 radar 损坏 → 旧数据不可用，失败候选走 missing，且 errors 点名坏文件
  it("reports dropped candidates and a corrupt radar-bench.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const seeded = await seed(dir);
    await writeFile(join(dir, "radar-bench.json"), "{ this is not json", "utf8");
    const victim = seeded.radarBench.candidates[0];

    const result = await refreshAll({
      fetchImpl: mkFetch({ failFor: victim.model + "|" + victim.effort }) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      // 放宽：3 个里只成功 2 个，否则会命中 minimum 直接抛错
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });

    expect(result.status.missing_count).toBe(1);
    expect(result.status.reused_count).toBe(0);
    expect(result.status.candidates_total).toBe(result.status.candidates_ok + result.status.reused_count);
    expect(result.status.candidates_total).toBe(2);
    expect(result.status.binding_total).toBe(3);
    expect(result.status.ok).toBe(false);
    expect(result.status.errors.some((e) => String(e ?? "").startsWith("missing:"))).toBe(true);
    expect(result.status.errors.some((e) => String(e ?? "").includes("radar-bench.json: 坏数据"))).toBe(true);
    // 被丢弃的候选不再出现在输出里
    expect(result.radarBench.candidates).toHaveLength(2);
  });

  // P1-4：坏 status.json 也要报错，不能当成"没有旧数据"静默重写
  it("reports a corrupt status.json and writes ok=false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    await seed(dir);
    await writeFile(join(dir, "status.json"), "not json at all", "utf8");

    const result = await refreshAll({
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });

    expect(result.status.ok).toBe(false);
    expect(result.status.errors.some((e) => String(e ?? "").includes("status.json: 坏数据"))).toBe(true);
    const onDisk = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(onDisk.ok).toBe(false);
    expect(onDisk.errors.some((e: string) => e.includes("status.json: 坏数据"))).toBe(true);
  });

  // P1-3：2 个陈旧 + 1 个新鲜，不能因为最新那条新鲜就把整体说成健康
  it("counts stale candidates and reports the oldest grade time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const result = await refreshAll({
      fetchImpl: mkFetch({
        gradedAt: {
          "gpt-6-astra|high": "2026-08-01T00:00:00Z",
          "gpt-6-astra|low": "2026-09-01T00:00:00Z",
          "gpt-6.1-sol|high": "2026-10-23T00:00:00Z",
        },
      }) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });

    expect(result.status.stale_count).toBe(2);
    expect(result.status.min_latest).toBe("2026-08-01T00:00:00Z");
    // latest 仍是取最新：两者都要有，才看得到"整体被 1 条新鲜掩盖"的真相
    expect(result.status.latest_graded_at).toBe("2026-10-23T00:00:00Z");
    // 陈旧本身不是错误，全成功时 ok 仍为 true
    expect(result.status.ok).toBe(true);
    const onDisk = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(onDisk.stale_count).toBe(2);
    expect(onDisk.min_latest).toBe("2026-08-01T00:00:00Z");
  });

  // 时间的"未知"不能冒充新鲜
  it("counts candidates without a grade time as stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        const { detail_metrics: _drop, ...rest } = summaryRaw;
        return jsonResponse({ ...rest, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      return jsonResponse(roundRaw);
    });
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    expect(result.status.stale_count).toBe(3);
    expect(result.status.min_latest).toBeNull();
  });

  // 旧数据只经 JSON.parse 就被复用的话，形状一旦坏掉就是永久固化：
  // 每轮"复用成功"、永远不会被重新抓取修正。抓取失败 + 旧数据形状坏必须走 missing。
  it("drops a candidate whose previous data no longer matches the contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const seeded = await seed(dir);
    const victim = seeded.radarBench.candidates[0];

    // 把落盘数据改坏：source_scores 契约要求对象表，这里写成数组
    const onDisk = JSON.parse(await readFile(join(dir, "radar-bench.json"), "utf8"));
    const broken = onDisk.candidates.find(
      (c: any) => c.model === victim.model && c.effort === victim.effort,
    );
    broken.source_scores = [1, 2, 3];
    await writeFile(join(dir, "radar-bench.json"), JSON.stringify(onDisk), "utf8");

    const result = await refreshAll({
      fetchImpl: mkFetch({ failFor: victim.model + "|" + victim.effort }) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });

    expect(result.status.missing_count).toBe(1);
    expect(result.status.reused_count).toBe(0);
    expect(result.status.ok).toBe(false);
    // 坏对象不能进输出，必须被丢弃
    expect(
      result.radarBench.candidates.some(
        (c: any) => c.model === victim.model && c.effort === victim.effort,
      ),
    ).toBe(false);
    expect(result.status.errors.some((e) => String(e ?? "").startsWith("missing:"))).toBe(true);
    expect(result.status.errors.some((e) => String(e ?? "").includes("旧数据不可用"))).toBe(true);
  });
});

// 缺陷 2：单个 URL 最坏 63s × 34 候选 / 并发 4 ≈ 9.5 分钟，加 binding 与 round
// 约 11.6 分钟，超出 workflow 的 timeout-minutes: 10 —— job 会被砍在写盘之前，整轮白跑。
// 总预算由 deadline 兜底：预算没了就只保留一次真实尝试，不再重试。
describe("fetchJson 总预算", () => {
  it("stops after one attempt once the deadline has passed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    // 约定：deadline 过期时仍放行一次真实尝试（拿真实错误比合成一个更有用），
    // 但绝不进入第 2、3 次重试。
    await expect(
      fetchJson(
        "https://example.test/x",
        { deadline: Date.now() - 1000 },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/预算耗尽/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // 守卫：不传 deadline 时行为必须与今天完全一致（3 次重试 + 退避）。
  it("still retries three times when no deadline is given", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => {
        throw new Error("boom");
      });
      const settled = fetchJson(
        "https://example.test/x",
        {},
        fetchImpl as unknown as typeof fetch,
      ).catch((e: Error) => e);
      // 用假时钟推进两次退避（2 ** 0 * 1000、2 ** 1 * 1000），不靠真实等待。
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      const error = await settled;
      expect(error.message).toBe("boom");
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // 预算耗尽后的候选必须走既有的 missing 分支，不另开路径。
  it("drops candidates instead of retrying once the refresh budget is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        const model = u.searchParams.get("model") ?? "";
        const effort = u.searchParams.get("effort") ?? "";
        if (model === "gpt-6-astra" && effort === "high") {
          return jsonResponse({ ...summaryRaw, model, effort });
        }
        throw new Error("boom");
      }
      return jsonResponse(roundRaw);
    });

    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      // 负预算 → deadline 必然落在过去；放行的那一次尝试里 1 个成功、2 个失败
      budgetMs: -1,
      minRadarCandidates: 1,
      minRoundCandidates: 2,
    });

    expect(result.status.missing_count).toBe(2);
    expect(result.status.reused_count).toBe(0);
    expect(result.status.errors).toHaveLength(2);
    expect(result.status.errors.every((e) => String(e ?? "").includes("预算耗尽"))).toBe(true);
    // 3 个候选各只打 1 次；若还在重试就是 7 次（1 + 3 + 3）
    const scoreCalls = fetchImpl.mock.calls.filter(([u]) =>
      String(u).includes("radar-bench-score"),
    );
    expect(scoreCalls).toHaveLength(3);
  });
});

// 缺陷 1：readJsonIfExists 只保证「JSON 可解析」，不保证形状。旧实现直接
// (oldRadar?.candidates ?? []).map(...)，于是 candidates 是对象/字符串、或元素是 null 时
// 抛在写盘之前：status.json 不重写、errors 里也没有记录，整轮静默崩成红灯 —— 正好违反
// refresh.mjs 里「旧数据坏了要降级、要记 errors、本轮照常跑完」的既有约定。
describe("refreshAll 旧 radar 形状坏掉要降级", () => {
  const mkFetch = (opts: { failFor?: string } = {}) =>
    vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        const model = u.searchParams.get("model") ?? "";
        const effort = u.searchParams.get("effort") ?? "";
        if (opts.failFor === model + "|" + effort) throw new Error("boom");
        return jsonResponse({ ...summaryRaw, model, effort });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });

  const seed = (dir: string) =>
    refreshAll({
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });

  const cases: Array<[string, unknown]> = [
    ["candidates 是对象", { candidates: {} }],
    ["candidates 是字符串", { candidates: "x" }],
    ["candidates 里只有 null", { candidates: [null] }],
  ];

  it.each(cases)("旧 radar 的 %s 时不抛，降级重抓并记 errors", async (_label, shape) => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    await seed(dir);
    await writeFile(join(dir, "radar-bench.json"), JSON.stringify(shape), "utf8");

    const result = await refreshAll({
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });

    // 坏旧数据一个都不能被当成可用而走进 reused：全部落回重新抓取
    expect(result.status.reused_count).toBe(0);
    expect(result.status.missing_count).toBe(0);
    expect(result.status.candidates_ok).toBe(3);
    expect(result.status.ok).toBe(false);
    // status.json 必须照常重写，且 errors 里点名坏文件
    const onDisk = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(onDisk.candidates_ok).toBe(3);
    expect(onDisk.ok).toBe(false);
    expect(
      onDisk.errors.some((e: string) => e.includes("radar-bench.json: 旧数据不可用")),
    ).toBe(true);
  });

  // 坏元素只淘汰自己，不能把整块旧数据一起判死。
  it("null 混在好元素中间时，好的旧候选仍可复用", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const seeded = await seed(dir);
    const victim = seeded.radarBench.candidates[0];
    const onDisk = JSON.parse(await readFile(join(dir, "radar-bench.json"), "utf8"));
    onDisk.candidates.splice(1, 0, null);
    await writeFile(join(dir, "radar-bench.json"), JSON.stringify(onDisk), "utf8");

    const result = await refreshAll({
      fetchImpl: mkFetch({ failFor: victim.model + "|" + victim.effort }) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });

    expect(result.status.reused_count).toBe(1);
    expect(result.status.missing_count).toBe(0);
    expect(result.status.errors.some((e) => String(e ?? "").includes("旧数据不可用"))).toBe(true);
  });

  // 降级后写回的必须是干净数据，否则坏形状会被下一轮固化。
  it("坏形状降级后写回的 radar-bench.json 能被下一轮复用", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    await seed(dir);
    await writeFile(join(dir, "radar-bench.json"), JSON.stringify({ candidates: "x" }), "utf8");
    await refreshAll({
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });

    const repaired = JSON.parse(await readFile(join(dir, "radar-bench.json"), "utf8"));
    expect(Array.isArray(repaired.candidates)).toBe(true);
    expect(repaired.candidates).toHaveLength(3);

    const victim = repaired.candidates[0];
    const next = await refreshAll({
      fetchImpl: mkFetch({ failFor: victim.model + "|" + victim.effort }) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T02:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });
    expect(next.status.reused_count).toBe(1);
  });
});

// 缺陷 2：main 以前用 new Set(process.argv.slice(2)) 只认 --force，未知参数静默忽略。
// `node scripts/refresh.mjs --forse` 会按非 force 跑，contentEqual 命中时连 checked_at
// 都不重写，用户以为强制刷新过了。对齐 verify-assets.mjs:68 —— 未知参数直接红、退 2。
describe("refresh CLI 参数", () => {
  it("未知参数抛错", () => {
    expect(() => parseArgs(["--forse"])).toThrow(/未知参数/);
  });

  it("--force 与空参数仍正常", () => {
    expect(parseArgs(["--force"])).toEqual({ force: true });
    expect(parseArgs([])).toEqual({ force: false });
  });

  it("未知参数直接退出 2，且不进入抓取", () => {
    const out = spawnSync(process.execPath, [script, "--forse"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("未知参数");
  });
});

// 缺陷：contentEqual 比较的是 stripVolatile 之后的对象，而被 strip 掉的正是
// generated_at / checked_at / fetch_id —— 这三个字段从不参与相等判断。旧文件里它们是
// null / 对象 / "昨天" 时，相等照样命中，非法旧值被无条件抄进新数据；而形状校验在
// 这之前就跑完了，于是落盘的是契约不合法的数据、管道却报成功（前端 loader 走同一份
// 契约，详情页整块抛）。回填必须按 contract 同一套判据逐个过筛，不过筛就保留新值。
describe("refreshAll 只回填合法的易变字段", () => {
  const mkFetch = () =>
    vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({
          ...summaryRaw,
          model: u.searchParams.get("model") ?? "",
          effort: u.searchParams.get("effort"),
        });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });

  const first = () => new Date("2026-10-24T00:00:00Z");
  // 第二轮换时刻：新 stamp 与旧值不同，「回填成功」和「保留新值」在落盘内容里可分辨。
  const second = () => new Date("2026-10-24T00:30:00Z");

  /** 跑一轮落盘 → 把指定文件的易变字段改坏 → 再跑一轮，返回落盘结果。 */
  async function seedThenCorrupt(
    fileName: "round.json" | "status.json" | "radar-bench.json",
    mutate: (data: Record<string, any>) => void,
  ) {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const opts = {
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    };
    await refreshAll({ ...opts, now: first });
    const file = join(dir, fileName);
    const seeded = JSON.parse(await readFile(file, "utf8"));
    mutate(seeded);
    await writeFile(file, JSON.stringify(seeded, null, 2) + "\n");
    await refreshAll({ ...opts, now: second });
    return JSON.parse(await readFile(file, "utf8"));
  }

  const isIso = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));

  it("旧 round.generated_at 为 null：不回填，落盘是本次新生成的合法 ISO", async () => {
    const onDisk = await seedThenCorrupt("round.json", (d) => {
      d.generated_at = null;
    });
    expect(isIso(onDisk.generated_at)).toBe(true);
    expect(onDisk.generated_at).toBe("2026-10-24T00:30:00.000Z");
    expect(() => assertRoundShape(onDisk)).not.toThrow();
  });

  it("旧 round.fetch_id 是对象：不回填，落盘是本次新生成的字符串", async () => {
    const onDisk = await seedThenCorrupt("round.json", (d) => {
      d.fetch_id = { stale: true };
    });
    expect(typeof onDisk.fetch_id).toBe("string");
    expect((onDisk.fetch_id as string).length).toBeGreaterThan(0);
    expect(() => assertRoundShape(onDisk)).not.toThrow();
  });

  // radar-bench 与 round/status 各是一处独立调用点，共用助手不等于共用覆盖：
  // 这里直击它自己的回填分支，避免 :571 只靠「同一个函数」间接保证。
  it("旧 radar-bench.generated_at 为 null：不回填，落盘是本次新生成的合法 ISO", async () => {
    const onDisk = await seedThenCorrupt("radar-bench.json", (d) => {
      d.generated_at = null;
    });
    expect(isIso(onDisk.generated_at)).toBe(true);
    expect(onDisk.generated_at).toBe("2026-10-24T00:30:00.000Z");
    expect(() => assertRadarBenchShape(onDisk)).not.toThrow();
  });

  it("旧 round.checked_at 是「昨天」：不回填，落盘是本次新生成的合法 ISO", async () => {
    const onDisk = await seedThenCorrupt("round.json", (d) => {
      d.checked_at = "昨天";
    });
    expect(isIso(onDisk.checked_at)).toBe(true);
    expect(onDisk.checked_at).toBe("2026-10-24T00:30:00.000Z");
    expect(() => assertRoundShape(onDisk)).not.toThrow();
  });

  // 回归：三个字段都合法时照旧全部回填，且文件逐字节不变（说明真的没重写）。
  it("三个易变字段都合法：仍然回填且不重写文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const opts = {
      fetchImpl: mkFetch() as unknown as typeof fetch,
      outDir: dir,
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    };
    await refreshAll({ ...opts, now: first });
    const file = join(dir, "round.json");
    const before = await readFile(file, "utf8");
    await refreshAll({ ...opts, now: second });
    const after = await readFile(file, "utf8");
    expect(JSON.parse(after).checked_at).toBe(JSON.parse(before).checked_at);
    expect(JSON.parse(after).generated_at).toBe(JSON.parse(before).generated_at);
    expect(JSON.parse(after).fetch_id).toBe(JSON.parse(before).fetch_id);
    expect(after).toBe(before);
  });

  it("旧 status.checked_at 为 null：不回填，落盘是本次新生成的合法 ISO", async () => {
    const onDisk = await seedThenCorrupt("status.json", (d) => {
      d.checked_at = null;
    });
    expect(isIso(onDisk.checked_at)).toBe(true);
    expect(onDisk.checked_at).toBe("2026-10-24T00:30:00.000Z");
    expect(() => assertStatusShape(onDisk)).not.toThrow();
  });
});

// 站点概览兜底（用户要求的两源 fallback）：binding 挂了不能整轮失败，
// 还有首页内嵌的 home-overview-data 这条路；它挂掉才算真失败。
describe("refreshAll 站点概览兜底", () => {
  const overviewHtml = (rows: { model: string; effort: string; score150: number }[]) =>
    `<html><script type="application/json" id="home-overview-data">${JSON.stringify({
      scores: {
        protocol: "codex-four-weighted-150-v2",
        round_id: "codex-four-279-10c-solmax-20261031",
        score_max: 150,
        author_test_interval: { completed_at: "2026-10-31T08:53:42.839890+00:00" },
        rows,
      },
    })}</script></html>`;

  function textResponse(body: string, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
  }

  it("falls back to the site overview when binding is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) throw new Error("binding down");
      if (url.endsWith("codexradar.com/")) {
        return textResponse(
          overviewHtml([
            { model: "gpt-6.1-sol", effort: "low", score150: 114.375 },
            { model: "gpt-6-luna", effort: "max", score150: 84.189 },
          ]),
        );
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-11-01T00:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });
    expect(result.status.score_source).toBe("site-overview");
    expect(result.radarBench.benchmark).toBe("site-overview-codex-four");
    expect(result.radarBench.candidates).toHaveLength(2);
    // 降级必须留痕：既进 errors，也不许把 ok 说成 true。
    expect(result.status.errors.join("\n")).toMatch(/回落到站点概览/);
    expect(result.status.ok).toBe(false);
    const onDisk = JSON.parse(await readFile(join(dir, "radar-bench.json"), "utf8"));
    expect(onDisk.score_version).toBe("codex-four-weighted-150-v2");
    expect(() => assertRadarBenchShape(onDisk)).not.toThrow();
    expect(() => assertStatusShape(JSON.parse(JSON.stringify(result.status)))).not.toThrow();
  });

  it("falls back to the site overview when binding works but too few summaries succeed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        return jsonResponse({ error: { code: "not_found", message: "RadarBench is not installed." } }, 404);
      }
      if (url.endsWith("codexradar.com/")) {
        return textResponse(
          overviewHtml([
            { model: "gpt-6.1-sol", effort: "low", score150: 114.375 },
            { model: "gpt-6-luna", effort: "max", score150: 84.189 },
          ]),
        );
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-11-01T00:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });
    expect(result.status.score_source).toBe("site-overview");
    expect(result.radarBench.candidates).toHaveLength(2);
    expect(result.status.errors.join("\n")).toMatch(/RadarBench is not installed/);
    expect(result.status.errors.join("\n")).toMatch(/api\.codexradar\.com\/api\/v1\/radar-bench-score/);
    expect(result.status.errors.join("\n")).toMatch(/HTTP 404/);
    expect(result.status.errors.join("\n")).toMatch(/not_found: RadarBench is not installed/);
    expect(result.status.ok).toBe(false);
  });

  it("throws when both binding and the site overview are unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) throw new Error("binding down");
      if (url.endsWith("codexradar.com/")) throw new Error("site down");
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    await expect(
      refreshAll({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        outDir: dir,
        now: () => new Date("2026-11-01T00:00:00Z"),
        minRadarCandidates: 2,
        minRoundCandidates: 2,
      }),
    ).rejects.toThrow(/binding down/);
  });

  it("keeps using the API path and never reads the overview when binding works", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({ ...summaryRaw, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      if (url.endsWith("codexradar.com/")) return textResponse(overviewHtml([]));
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    expect(result.status.score_source).toBe("radar-bench-api");
    expect(result.radarBench.benchmark).toBe("radar-bench-final64-20261004");
  });
});

// 端点活着但分数停更，和挂掉一样不可用：到阈值就该主动切兜底，不到就不能乱切。
describe("refreshAll 陈旧自动切换", () => {
  const html = (rows: { model: string; effort: string; score150: number }[]) =>
    `<script type="application/json" id="home-overview-data">${JSON.stringify({
      scores: {
        protocol: "codex-four-weighted-150-v2",
        round_id: "codex-four-279-10c-solmax-20261031",
        score_max: 150,
        author_test_interval: { completed_at: "2026-11-04T08:00:00.000Z" },
        rows,
      },
    })}</script>`;

  function mkFetch(overviewRows: { model: string; effort: string; score150: number }[]) {
    return vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        // fixture 的 latest_graded_at 固定在 2026-10-23，配下面的 now 决定陈旧天数。
        return jsonResponse({ ...summaryRaw, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      if (url.endsWith("codexradar.com/")) {
        return { ok: true, status: 200, text: async () => html(overviewRows) } as Response;
      }
      throw new Error("unexpected url " + url);
    });
  }

  it("switches to the overview when the API scores went stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const result = await refreshAll({
      fetchImpl: mkFetch([
        { model: "gpt-6-astra", effort: "high", score150: 120 },
        { model: "gpt-6.1-sol", effort: "low", score150: 114 },
        { model: "gpt-6-luna", effort: "max", score150: 84 },
      ]) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-11-05T00:00:00Z"), // 距 fixture 的 10-23 已 13 天
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });
    expect(result.status.score_source).toBe("site-overview");
    expect(result.radarBench.benchmark).toBe("site-overview-codex-four");
    expect(result.status.errors.join("\n")).toMatch(/已回落到站点概览/);
    // 切换后新鲜度必须按新源重算，不能留着旧源的 13 天。
    expect(result.status.score_stale_days).toBe(0);
    expect(result.status.latest_graded_at).toBe("2026-11-04T08:00:00.000Z");
    expect(result.status.ok).toBe(false);
  });

  it("stays on the API while the scores are under the threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const result = await refreshAll({
      fetchImpl: mkFetch([{ model: "x", effort: "low", score150: 1 }]) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-29T00:00:00Z"), // 距 10-23 只有 6 天
      minRadarCandidates: 2,
      minRoundCandidates: 2,
    });
    expect(result.status.score_source).toBe("radar-bench-api");
    expect(result.status.errors.join("\n")).not.toMatch(/回落到站点概览/);
  });

  it("can be switched off explicitly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const result = await refreshAll({
      fetchImpl: mkFetch([{ model: "x", effort: "low", score150: 1 }]) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-11-05T00:00:00Z"),
      minRadarCandidates: 2,
      minRoundCandidates: 2,
      fallbackWhenStale: false,
    });
    expect(result.status.score_source).toBe("radar-bench-api");
  });
});

// P0-1 回归：概览是 best-effort 第二源，必须自成一个很小的预算，失败要重试但次数有上限。
// 修复前它借主 deadline、且完全不重试：首页一次 5xx 就丢掉整条兜底路，
// 首页 hang 住则要陪跑到主预算，把主流程的抓取窗口一起耗掉。
describe("overview 抓取的独立预算与重试", () => {
  const homeHtml = (rows: { model: string; effort: string; score150: number }[]) =>
    `<script type="application/json" id="home-overview-data">${JSON.stringify({
      scores: {
        protocol: "codex-four-weighted-150-v2",
        round_id: "codex-four-279-10c-solmax-20261031",
        score_max: 150,
        author_test_interval: { completed_at: "2026-10-23T08:53:42.839890+00:00" },
        rows,
      },
    })}</script>`;

  const textResponse = (body: string, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response;

  it("首页 5xx 一次后重试成功：一次抖动不打掉整条兜底路", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    let homeCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) throw new Error("binding down");
      if (url.endsWith("codexradar.com/")) {
        homeCalls += 1;
        if (homeCalls === 1) return textResponse("upstream boom", 503);
        return textResponse(homeHtml([{ model: "gpt-6.1-sol", effort: "low", score150: 114.375 }]));
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 1,
      minRoundCandidates: 2,
    });
    expect(homeCalls).toBe(2);
    expect(result.status.score_source).toBe("site-overview");
  });

  it("首页一直 5xx：重试次数有上限，打满就放弃", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    let homeCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) throw new Error("binding down");
      if (url.endsWith("codexradar.com/")) {
        homeCalls += 1;
        return textResponse("upstream boom", 502);
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    await expect(
      refreshAll({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        outDir: dir,
        now: () => new Date("2026-10-24T00:00:00Z"),
        minRadarCandidates: 1,
        minRoundCandidates: 2,
      }),
    ).rejects.toThrow(/binding down/);
    // 一次都不能少（否则一次抖动就没了），也不能像主源那样重试到 3 次（那是拖累）。
    expect(homeCalls).toBe(2);
  });

  it("首页 4xx 不重试：不是暂时性错误，重试只是白等", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    let homeCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) throw new Error("binding down");
      if (url.endsWith("codexradar.com/")) {
        homeCalls += 1;
        return textResponse("nf", 404);
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    await expect(
      refreshAll({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        outDir: dir,
        now: () => new Date("2026-10-24T00:00:00Z"),
        minRadarCandidates: 1,
        minRoundCandidates: 2,
      }),
    ).rejects.toThrow(/binding down/);
    expect(homeCalls).toBe(1);
  });

  it("首页永不返回时，主源成功路径不被它拖住", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({
          ...summaryRaw,
          model: u.searchParams.get("model"),
          effort: u.searchParams.get("effort"),
        });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      // 首页挂住，永不 settle
      if (url.endsWith("codexradar.com/")) return new Promise<Response>(() => {});
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      outDir: dir,
      // 10-24 相对 fixture 的 10-23 不陈旧 → 不触发陈旧切换，也就不会 await 概览
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    expect(result.status.score_source).toBe("radar-bench-api");
    expect(result.radarBench.candidates).toHaveLength(3);
  });
});

// P0-2 回归：round 上游挂掉不能把 radar 侧已经拿到的成果一起陪葬。
// 写盘在整轮最后，修复前 round 一抛就整轮 reject —— 辛苦抓到的 radar 一个字节都不落，
// 兜底路径（概率最高的故障形态：binding 挂了走概览，round 跟着挂）直接归零。
describe("round 抓取失败不得陪葬 radar", () => {
  const okApi = () =>
    vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({
          ...summaryRaw,
          model: u.searchParams.get("model"),
          effort: u.searchParams.get("effort"),
        });
      }
      return jsonResponse(roundRaw);
    });

  const withRoundDown = (inner: ReturnType<typeof okApi>) =>
    vi.fn(async (url: string) => {
      if (url.includes("degradation-codex-latest")) throw new Error("round down");
      return inner(url);
    });

  it("round 挂且没有旧数据：radar 照常落盘，round_ok 说真话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const result = await refreshAll({
      fetchImpl: withRoundDown(okApi()) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    expect(result.round).toBeNull();
    expect(result.status.round_ok).toBe(false);
    expect(result.status.round_updated_at).toBeNull();
    expect(result.status.round_stale_days).toBeNull();
    expect(result.status.errors.join("\n")).toMatch(/round: 本轮抓取失败/);
    // radar 侧成果必须已经在盘上
    const onDisk = JSON.parse(await readFile(join(dir, "radar-bench.json"), "utf8"));
    expect(onDisk.candidates).toHaveLength(3);
    expect(() => assertRadarBenchShape(onDisk)).not.toThrow();
    // round.json 既然没有过，就不该凭空造一个
    await expect(readFile(join(dir, "round.json"), "utf8")).rejects.toThrow();
  });

  it("round 挂但有形状与分母都合法的旧数据：沿用旧值，不清空", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    await refreshAll({
      fetchImpl: okApi() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    const before = await readFile(join(dir, "round.json"), "utf8");

    const result = await refreshAll({
      fetchImpl: withRoundDown(okApi()) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    expect(result.status.round_ok).toBe(true);
    expect(result.status.errors.join("\n")).toMatch(/沿用上一轮数据/);
    // 内容一致 → 不重写，盘上仍是原来那份，不能被清空
    expect(await readFile(join(dir, "round.json"), "utf8")).toBe(before);
  });

  it("旧 round 的分母与当前不一致时不复用：宁可没有，也不给错刻度", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    await refreshAll({
      fetchImpl: okApi() as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T00:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    // 旧刻度的分母被改过（模拟上游改过 score_max）
    const stale = JSON.parse(await readFile(join(dir, "round.json"), "utf8"));
    for (const c of stale.candidates) c.score_max = 200;
    await writeFile(join(dir, "round.json"), JSON.stringify(stale, null, 2) + "\n", "utf8");

    const result = await refreshAll({
      fetchImpl: withRoundDown(okApi()) as unknown as typeof fetch,
      outDir: dir,
      now: () => new Date("2026-10-24T01:00:00Z"),
      minRadarCandidates: 3,
      minRoundCandidates: 2,
    });
    expect(result.round).toBeNull();
    expect(result.status.round_ok).toBe(false);
    expect(result.status.errors.join("\n")).toMatch(/没有可复用的上一轮数据/);
  });
});

describe("社区体感（可选源）", () => {
  const ratingsFetch = (opts: { failRatings?: boolean } = {}) =>
    vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({
          ...summaryRaw,
          model: u.searchParams.get("model"),
          effort: u.searchParams.get("effort"),
        });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      if (url.includes("model-ratings")) {
        // 502 是上游当前的真实形态（2026-11-16 起 summary 与体感同域故障时出现过），
        // 走 HttpError 分支，恰好验证「非 2xx 也只降级不抛」。
        if (opts.failRatings) return jsonResponse({ error: "bad gateway" }, 502);
        return jsonResponse(ratingsRaw);
      }
      throw new Error("unexpected url " + url);
    });

  const baseOpts = (dir: string) => ({
    fetchImpl: null as unknown as typeof fetch,
    outDir: dir,
    minRadarCandidates: 2,
    minRoundCandidates: 2,
  });

  it("独立落盘：只留有票档位，按星级降序，且不污染 status.errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-ratings-"));
    const result = await refreshAll({
      ...baseOpts(dir),
      fetchImpl: ratingsFetch() as unknown as typeof fetch,
      now: () => new Date("2026-11-17T00:00:00Z"),
    });
    const doc = JSON.parse(await readFile(join(dir, "ratings.json"), "utf8"));
    // fixture 6 个槽里 1 个 average=null/count=0，落盘只能剩 5 条
    expect(doc.total_slots).toBe(6);
    expect(doc.ratings.map((r: { id: string }) => r.id)).toEqual([
      "gpt-6-astra-xhigh",
      "gpt-6-astra-max",
      "dsv4-pro-high",
      "gpt-6.1-sol-off",
      "gpt-5.6-luna-low",
    ]);
    // 7.25 收口到一位小数
    expect(doc.ratings[2].average).toBe(7.3);
    expect(doc.window).toBe("rolling_24h");
    expect(doc.source_updated_at).toBe("2026-11-16T17:44:18.712Z");
    expect(() => assertRatingsShape(doc)).not.toThrow();
    // 可选源成功不该改变主数据的健康状态
    expect(result.status.errors).toEqual([]);
    expect(result.status.ok).toBe(true);
    expect(result.ratings?.ratings).toHaveLength(5);
  });

  it("体感源 502：整轮照常成功，只是没有 ratings.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-ratings-"));
    const result = await refreshAll({
      ...baseOpts(dir),
      fetchImpl: ratingsFetch({ failRatings: true }) as unknown as typeof fetch,
      now: () => new Date("2026-11-17T00:00:00Z"),
    });
    expect(result.ratings).toBeNull();
    // 关键：可选源失败不进 errors、不打黄 status.ok
    expect(result.status.errors).toEqual([]);
    expect(result.status.ok).toBe(true);
    await expect(readFile(join(dir, "ratings.json"), "utf8")).rejects.toThrow();
    // 三份主数据照常落盘
    const bench = JSON.parse(await readFile(join(dir, "radar-bench.json"), "utf8"));
    expect(() => assertRadarBenchShape(bench)).not.toThrow();
  });

  it("体感源 502 但盘上已有旧文件：一个字节都不改", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-ratings-"));
    await refreshAll({
      ...baseOpts(dir),
      fetchImpl: ratingsFetch() as unknown as typeof fetch,
      now: () => new Date("2026-11-17T00:00:00Z"),
    });
    const before = await readFile(join(dir, "ratings.json"), "utf8");
    await refreshAll({
      ...baseOpts(dir),
      fetchImpl: ratingsFetch({ failRatings: true }) as unknown as typeof fetch,
      now: () => new Date("2026-11-18T00:00:00Z"),
    });
    expect(await readFile(join(dir, "ratings.json"), "utf8")).toBe(before);
  });

  it("内容没变：第二次不重写，checked_at 保持首次的值", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-ratings-"));
    const fetchImpl = ratingsFetch() as unknown as typeof fetch;
    await refreshAll({ ...baseOpts(dir), fetchImpl, now: () => new Date("2026-11-17T00:00:00Z") });
    const file = join(dir, "ratings.json");
    const before = await readFile(file, "utf8");
    await refreshAll({ ...baseOpts(dir), fetchImpl, now: () => new Date("2026-11-18T00:00:00Z") });
    expect(await readFile(file, "utf8")).toBe(before);
    expect(JSON.parse(before).checked_at).toBe("2026-11-17T00:00:00.000Z");
  });
});

describe("promoteLiveChain 主源切换", () => {
  const fourTask = {
    protocol: "codex-four-weighted-150-v2",
    score_max: 150,
    round: { id: "codex-four-repeat-oauth-20261121", completed_at: "2026-11-21T17:05:43Z" },
    candidates: [
      {
        model: "A",
        effort: "high",
        score: 120,
        latest_at: "2026-11-21T16:00:00Z",
        tasks: [{ id: "combined" }, { id: "pompeii" }, { id: "pelican" }, { id: "candy" }],
        totals: { seconds: 10, cost_usd: 0.2 },
        history: [{ at: "2026-11-14T00:00:00Z", score: 110 }, { at: "2026-11-21T16:00:00Z", score: 120 }],
      },
    ],
  };
  const baseStatus = {
    checked_at: "2026-11-22T00:00:00Z",
    ok: false,
    benchmark: "site-overview-codex-four",
    score_source: "site-overview",
    candidates_ok: 0,
    candidates_total: 1,
    binding_total: 1,
    reused_count: 0,
    missing_count: 0,
    round_ok: true,
    latest_graded_at: "2026-11-21T16:00:00Z",
    min_latest: "2026-11-21T16:00:00Z",
    stale_count: 0,
    round_updated_at: "2026-10-24T14:30:39Z",
    stale_days: 28,
    score_stale_days: 0,
    round_stale_days: 28,
    errors: ["overview: 主摘要端点失败（HTTP 404 not_found: RadarBench is not installed.）"],
  };

  it("兜底源没有历史时，用现行四题链发布分数、历史与轮次", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-promote-"));
    const status = await promoteLiveChain({
      result: { radarBench: { fetch_id: "f1", candidates: [] }, status: baseStatus },
      fourTask,
      outDir: dir,
      stamp: "2026-11-22T00:00:00Z",
      now: new Date("2026-11-22T00:00:00Z"),
    });
    expect(status.score_source).toBe("four-task");
    expect(status.ok).toBe(true);
    expect(status.errors).toEqual([]);
    expect(status.candidates_total).toBe(1);
    // 轮次跟着同一条链走，不再拿 10-24 的旧 degradation 轮充数。
    expect(status.round_stale_days).toBe(0);
    // 最新点 11-21 16:00Z，距注入的 now 8 小时 → 0 天；陈旧度按真实时间算，不按"看起来旧"。
    expect(status.score_stale_days).toBe(0);
    // 死接口的原始证据保留，但不是"坏文件"。
    expect(status.legacy_error).toMatch(/RadarBench is not installed/);
    const radar = JSON.parse(await readFile(join(dir, "radar-bench.json"), "utf8"));
    expect(radar.candidates[0].history).toHaveLength(2);
    expect(() => assertRadarBenchShape(radar)).not.toThrow();
    expect(() => assertStatusShape(status)).not.toThrow();
    const onDisk = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(onDisk.score_source).toBe("four-task");
  });

  it("结构化端点仍可用时一个字都不改", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-promote-"));
    const result = { radarBench: { fetch_id: "f2", candidates: [] }, status: { ...baseStatus, score_source: "radar-bench-api" } };
    const out = await promoteLiveChain({ result, fourTask, outDir: dir, stamp: "2026-11-22T00:00:00Z" });
    expect(out).toBe(result);
    await expect(readFile(join(dir, "radar-bench.json"), "utf8")).rejects.toThrow();
  });
});
