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
  if (!checkedKnown) warnings.push("数据检查时间未知");
  else if (checkedAgeHours > 48) warnings.push("数据检查已超过 48 小时");

  if (status.stale_days == null) warnings.push("数据新鲜度未知");
  else if (status.stale_days > 7) warnings.push("数据可能已过期（超过 7 天）");

  const reuseErrors = Array.isArray(status.errors) ? status.errors : null;
  if (reuseErrors === null) warnings.push("复用记录缺失");

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
      {reuseErrors !== null && reuseErrors.length > 0 && (
        <p className="muted">部分候选复用旧数据：{reuseErrors.length} 条</p>
      )}
    </div>
  );
}
