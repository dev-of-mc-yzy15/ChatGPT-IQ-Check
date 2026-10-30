import type { StatusData } from "../types";
import { fmtDateTime, fmtRelativeTime } from "../lib/format";

/**
 * status 是外部 JSON，可能缺字段、可能整个槽都没取到：
 * - stale_days 可能是 null（未知），不能让它落进 > 7 的假分支
 * - errors 可能不是数组，status.errors.length 会直接崩
 * - checked_at 可能是坏时间串，差值成 NaN 就永远不告警
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

  // ok / round_ok 以前是硬写 true 的死字段，现在写真值，横幅必须消费。
  if (status.ok === false) warnings.push("最近一次刷新未全部成功");
  if (status.round_ok === false) warnings.push("本轮数据未刷新成功");

  const warn = warnings.length > 0;

  return (
    <div className={`card ${warn ? "warn" : ""}`} role="status" aria-live="polite">
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
  );
}
