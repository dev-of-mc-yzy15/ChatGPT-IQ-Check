import type { StatusData } from "../types";
import { fmtDateTime, fmtRelativeTime } from "../lib/format";

/**
 * status 是外部 JSON，可能缺字段、可能整个槽都没取到：
 * - stale_days 可能是 null（未知），不能让它落进 > 7 的假分支
 * - errors 可能不是数组，status.errors.length 会直接崩
 * - checked_at 可能是坏时间串，差值成 NaN 就永远不告警
 * - binding_total / min_latest / stale_count 是后加的，旧 status.json 里一个都没有
 */
export function FreshnessBanner({
  status,
  roundUpdatedAt,
  now = Date.now(),
}: {
  status: StatusData;
  roundUpdatedAt: string | null;
  now?: number;
}) {
  const checkedMs = status.checked_at ? new Date(status.checked_at).getTime() : Number.NaN;
  const checkedKnown = Number.isFinite(checkedMs);
  const checkedAgeHours = (now - checkedMs) / 3_600_000;

  const warnings: string[] = [];
  // NaN 走显式分支：`NaN > 48` 恒 false，靠 > 判断会静默当成新鲜。
  if (!checkedKnown || !Number.isFinite(checkedAgeHours)) warnings.push("数据检查时间未知");
  else if (checkedAgeHours > 48) warnings.push("数据检查已超过 48 小时");

  // 分数与轮次分开判：以前只读 stale_days（分数、轮次的较大值），轮次一旦久不更新就整页打
  // "数据可能已过期"，而分数可能隔天还在涨。
  //
  // 判据按「键存不存在」而不是「值空不空」：`??` 会把 null 和 undefined 挤成同一条路，于是
  // score_stale_days 明确为 null（上游没给分数时间，未知）时被回落成 stale_days——那个值可能被
  // 轮次拉高，就会无证据地断言"分数已超过 7 天"。三态必须分开：
  //   键缺失（旧 status.json，没有细分口径）→ 回落 stale_days，旧值被轮次拉高，只会更保守，不漏报
  //   键存在但为 null/NaN                → 分数新鲜度未知，报未知而不是报过期
  //   键存在且有值                       → 按它判，边界取 >=，恰好 7 天不漏
  const scoreStale = "score_stale_days" in status ? status.score_stale_days : status.stale_days;
  if (scoreStale == null || !Number.isFinite(scoreStale)) warnings.push("数据新鲜度未知");
  else if (scoreStale >= 7) warnings.push("分数已超过 7 天未更新");

  // 轮次是另一条时间线：degradation 轮久没开新轮不等于分数过期，单独点名，别混进上一句。
  const roundStale = status.round_stale_days;
  if (roundStale != null && Number.isFinite(roundStale) && roundStale >= 7) {
    warnings.push(`降智轮次已 ${roundStale} 天未更新`);
  }

  const reuseErrors = Array.isArray(status.errors) ? status.errors : null;
  if (reuseErrors === null) warnings.push("复用记录缺失");

  // errors 里混了四类结局：复用旧数据（reused:）、丢弃候选（missing:）、回落到站点概览
  // （overview:）、数据文件坏。混成一句"复用 N 条"会说谎，所以分类计数；
  // count 字段优先，缺了才按前缀数字符串。
  const countBy = (prefix: string): number =>
    reuseErrors === null ? 0 : reuseErrors.filter((e) => String(e).startsWith(prefix + ": ")).length;
  // 明细（errors 前缀）优先，计数器只在前缀一条都对不上时兜底：
  // errors 被截断时才需要汇总数，能数出明细就以明细为准。
  const prefixedReused = countBy("reused");
  const prefixedMissing = countBy("missing");
  const reusableOverview = countBy("overview");
  const reusedCount = prefixedReused > 0 ? prefixedReused : (status.reused_count ?? 0);
  const missingCount = prefixedMissing > 0 ? prefixedMissing : (status.missing_count ?? 0);
  // overview: 是"换成另一条数据路"，本身不是坏文件，别混进 brokenCount 里冤枉它。
  const brokenCount =
    reuseErrors === null
      ? 0
      : reuseErrors.length - countBy("reused") - countBy("missing") - reusableOverview;
  const fromOverview = reusableOverview > 0 || status.score_source === "site-overview";

  // 一条陈旧候选就能藏在整体新鲜的板后面：点名总数，别让均值替它说话。
  // 缺失/NaN 都走 false 分支静默略过，不印 NaN 条。
  if (status.stale_count != null && Number.isFinite(status.stale_count) && status.stale_count > 0) {
    warnings.push(`有 ${status.stale_count} 个候选已长时间未更新。`);
  }

  // min_latest 是最旧那条评分；坏串与缺失都落进 Number.isFinite 的 false 分支。
  const minLatestMs = status.min_latest ? Date.parse(status.min_latest) : Number.NaN;
  if (Number.isFinite(minLatestMs) && (now - minLatestMs) / 3_600_000 > 48) {
    warnings.push(`最旧的最近评分停在 ${fmtDateTime(status.min_latest)}。`);
  }

  // ok / round_ok 以前是硬写 true 的死字段，现在写真值，横幅必须消费。
  if (status.ok === false) warnings.push("最近一次刷新未全部成功");
  if (status.round_ok === false) warnings.push("本轮数据未刷新成功");

  const warn = warnings.length > 0;

  // 覆盖行是中性信息、不是告警，所以留在 aria-live 之外，别跟着告警每次重播。
  // 口径与上方复用/丢弃行同源（prefixed 明细优先），否则会出现"覆盖满"却同时报丢弃。
  // 只有 binding_total 与 missing_count 都是有限值才算得出来；算不出就不渲染，不印 NaN。
  const bindingTotal =
    status.binding_total != null && Number.isFinite(status.binding_total) ? status.binding_total : null;
  const missingKnown = status.missing_count != null && Number.isFinite(status.missing_count);
  const coverage =
    bindingTotal !== null && missingKnown && bindingTotal > 0
      ? Math.max(0, bindingTotal - missingCount - reusedCount)
      : null;
  // 兜底源下 0 个"主源成功"读起来像全挂了，实际是整批换了来源：这条计数改用实际产出的条数。
  const okShown = fromOverview ? (status.candidates_total ?? "?") : (status.candidates_ok ?? "?");

  return (
    <div className={`card ${warn ? "warn" : ""}`}>
      <div role="status" aria-live="polite">
        <strong>{warn ? `⚠️ ${warnings.join(" · ")}` : "数据状态"}</strong>
        <span className="muted">
          {" "}
          · 数据检查于 {checkedKnown ? fmtDateTime(status.checked_at) : "未知"}（
          {checkedKnown ? fmtRelativeTime(status.checked_at, now) : "未知"}）
          · RadarBench 最近评分 {fmtDateTime(status.latest_graded_at)}
          · 本轮更新 {fmtDateTime(roundUpdatedAt)}
          · {okShown}/{status.candidates_total ?? "?"} 候选
        </span>
        {fromOverview && (
          <p className="muted">
            分数取自站点概览兜底：与 RadarBench 不是同一套评分协议，覆盖与历史缺失。
          </p>
        )}
        {reusedCount > 0 && <p className="muted">复用旧数据：{reusedCount} 条</p>}
        {missingCount > 0 && (
          <p className="muted">候选被丢弃（无旧数据可复用）：{missingCount} 条</p>
        )}
        {brokenCount > 0 && <p className="muted">数据文件异常：{brokenCount} 项</p>}
      </div>
      {coverage !== null && (
        <p className="muted">
          本次覆盖 {coverage}/{bindingTotal} 个候选。
        </p>
      )}
    </div>
  );
}
