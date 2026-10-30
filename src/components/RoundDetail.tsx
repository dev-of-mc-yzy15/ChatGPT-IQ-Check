import type { RoundCandidate, RoundData, RoundTaskDef } from "../types";
import { fmtDateTime, fmtEffort, fmtMoney, fmtScore, fmtSeconds } from "../lib/format";
import { ModelName } from "./ModelName";

/** 盲评分数是 0–100 制，上屏统一 /100 归一；非有限值保持 "—"，不要落成 NaN。 */
function norm(score: number | null | undefined): string {
  return score == null || !Number.isFinite(score) ? "—" : (score / 100).toFixed(2);
}

export function RoundDetail({
  candidate,
  tasks,
  round,
}: {
  candidate: RoundCandidate | null;
  tasks: RoundTaskDef[];
  round?: RoundData["round"];
}) {
  if (!candidate) return <section className="card muted">选择上方格子查看逐题详情。</section>;
  const byId = new Map(candidate.tasks.map((t) => [t.task_id, t]));
  const animation = candidate.animation;
  return (
    <section className="card" aria-labelledby="round-detail-heading">
      <h2 id="round-detail-heading">
        <ModelName name={candidate.model} /> · {fmtEffort(candidate.effort)} · {fmtScore(candidate.score)}
      </h2>
      {round && (
        <p className="muted">
          开始 {fmtDateTime(round.started_at)} · 完成 {fmtDateTime(round.completed_at)} · 更新{" "}
          {fmtDateTime(round.updated_at)}
        </p>
      )}
      <p className="muted">
        {candidate.score_status === "complete" ? "全部题已评分" : "部分题缺失"} · 用时{" "}
        {fmtSeconds(candidate.totals.seconds)} · 已知成本 {fmtMoney(candidate.totals.cost_usd)}
        {candidate.totals.cost_unknown_tasks > 0 ? `（${candidate.totals.cost_unknown_tasks} 题成本未知）` : ""}
      </p>
      <div className="table-wrap" role="region" aria-label="逐题结果（可横向滚动）" tabIndex={0}>
        <table>
          <caption className="muted">{tasks.length} 题逐项结果</caption>
          <thead>
            <tr>
              <th scope="col">任务</th>
              <th scope="col">状态</th>
              <th scope="col">reward</th>
              <th scope="col">耗时</th>
              <th scope="col">成本</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const row = byId.get(task.id);
              return (
                <tr key={task.id}>
                  <th scope="row">{task.title_zh || task.id}</th>
                  <td>{row?.status ?? "missing"}</td>
                  <td>{row?.reward == null ? "—" : row.reward.toFixed(3)}</td>
                  <td>{fmtSeconds(row?.seconds ?? null)}</td>
                  <td>{fmtMoney(row?.cost_usd ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {animation?.status === "available" ? (
        <div className="card" style={{ marginTop: 12 }}>
          {/* P1-16：原始分一律 /100 归一到 0–1 再上屏，原始值留在括号里可核对，分母写明，避免 24 分被读成 24 分制。 */}
          <h3>动画盲评 · {norm(animation.score)} / 100（原始 {animation.score ?? "—"}）</h3>
          <p className="muted">
            {Object.entries(animation.scores)
              .map(([k, v]) => `${k} ${norm(v)}（${v}）`)
              .join(" · ")}{" "}
            · 分项满分 /100
          </p>
          {animation.reason && <p>{animation.reason}</p>}
        </div>
      ) : (
        <p className="muted">动画不可用</p>
      )}
    </section>
  );
}
