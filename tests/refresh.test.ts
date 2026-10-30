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
} from "../scripts/refresh.mjs";
import { assertRadarBenchShape, assertRoundShape, assertStatusShape } from "../scripts/contract.mjs";
import bindingRaw from "./fixtures/binding.sample.json";
import summaryRaw from "./fixtures/summary.sample.json";
import roundRaw from "./fixtures/round.sample.json";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts/refresh.mjs");

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("summaryUrl", () => {
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
