import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summaryUrl, refreshAll } from "../scripts/refresh.mjs";
import bindingRaw from "./fixtures/binding.sample.json";
import summaryRaw from "./fixtures/summary.sample.json";
import roundRaw from "./fixtures/round.sample.json";

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
});

