import type { StatusData } from "../types";
import { fmtDateTime, fmtRelativeTime } from "../lib/format";

export function FreshnessBanner({
  status,
  roundUpdatedAt,
  now = Date.now(),
}: {
  status: StatusData;
  roundUpdatedAt: string | null;
  now?: number;
}) {
  const checkedAgeHours = (now - new Date(status.checked_at).getTime()) / 3_600_000;
  const checkedTooOld = checkedAgeHours > 48;
  const stale = status.stale_days > 7;
  const warnings: string[] = [];
  if (checkedTooOld) warnings.push("数据检查已超过 48 小时");
  if (stale) warnings.push("数据可能已过期（超过 7 天）");
  const warn = warnings.length > 0;

  return (
    <div className={`card ${warn ? "warn" : ""}`} role="status" aria-live="polite">
      <strong>{warn ? `⚠️ ${warnings.join(" · ")}` : "数据状态"}</strong>
      <span className="muted">
        {" "}
        · 数据检查于 {fmtDateTime(status.checked_at)}（{fmtRelativeTime(status.checked_at, now)}）
        · RadarBench 最近评分 {fmtDateTime(status.latest_graded_at)}
        · 本轮更新 {fmtDateTime(roundUpdatedAt)}
        · {status.candidates_ok}/{status.candidates_total} 候选
      </span>
      {status.errors.length > 0 && (
        <p className="muted">部分候选复用旧数据：{status.errors.length} 条</p>
      )}
    </div>
  );
}
