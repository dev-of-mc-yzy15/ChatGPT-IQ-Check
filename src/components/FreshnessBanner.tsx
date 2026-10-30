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

  // stale_days 同理：null 与 NaN 都算未知；边界取 >= ，恰好 7 天不再漏报。
  if (status.stale_days == null || !Number.isFinite(status.stale_days)) warnings.push("数据新鲜度未知");
  else if (status.stale_days >= 7) warnings.push("数据可能已过期（超过 7 天）");

  const reuseErrors = Array.isArray(status.errors) ? status.errors : null;
  if (reuseErrors === null) warnings.push("复用记录缺失");

  // errors 里混了三类结局：复用旧数据（reused:）、丢弃候选（missing:）、数据文件坏。
  // 混成一句"复用 N 条"会说谎，所以分类计数；count 字段优先，缺了才按前缀数字符串。
  const countBy = (prefix: string): number =>
    reuseErrors === null ? 0 : reuseErrors.filter((e) => String(e).startsWith(prefix + ": ")).length;
  // 明细（errors 前缀）优先，计数器只在前缀一条都对不上时兜底：
  // errors 被截断时才需要汇总数，能数出明细就以明细为准。
  const prefixedReused = countBy("reused");
  const prefixedMissing = countBy("missing");
  const reusedCount = prefixedReused > 0 ? prefixedReused : (status.reused_count ?? 0);
  const missingCount = prefixedMissing > 0 ? prefixedMissing : (status.missing_count ?? 0);
  const brokenCount =
    reuseErrors === null ? 0 : reuseErrors.length - countBy("reused") - countBy("missing");

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
          · {status.candidates_ok ?? "?"}/{status.candidates_total ?? "?"} 候选
        </span>
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
