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
  const stale = status.stale_days > 7;
  return (
    <div className={`card ${stale ? "warn" : ""}`} role="status" aria-live="polite">
      <strong>{stale ? "⚠️ 数据可能已过期" : "数据状态"}</strong>
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
