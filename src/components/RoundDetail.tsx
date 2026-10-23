import type { RoundCandidate, RoundTaskDef } from "../types";
import { fmtEffort, fmtMoney, fmtScore, fmtSeconds } from "../lib/format";

export function RoundDetail({
  candidate,
  tasks,
}: {
  candidate: RoundCandidate | null;
  tasks: RoundTaskDef[];
}) {
  if (!candidate) return <section className="card muted">选择上方格子查看逐题详情。</section>;
  const byId = new Map(candidate.tasks.map((t) => [t.task_id, t]));
  return (
    <section className="card" aria-label="本轮详情">
      <h2>
        {candidate.model} · {fmtEffort(candidate.effort)} · {fmtScore(candidate.score)}
      </h2>
      <p className="muted">
        {candidate.score_status === "complete" ? "全部题已评分" : "部分题缺失"} · 用时{" "}
        {fmtSeconds(candidate.totals.seconds)} · 已知成本 {fmtMoney(candidate.totals.cost_usd)}
        {candidate.totals.cost_unknown_tasks > 0 ? `（${candidate.totals.cost_unknown_tasks} 题成本未知）` : ""}
      </p>
      <div className="table-wrap">
        <table>
          <caption className="muted">7 题逐项结果</caption>
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
                  <td>{row?.reward ?? "—"}</td>
                  <td>{fmtSeconds(row?.seconds ?? null)}</td>
                  <td>{fmtMoney(row?.cost_usd ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {candidate.animation && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>动画盲评 · {candidate.animation.score ?? "—"} / 100</h3>
          <p className="muted">
            {Object.entries(candidate.animation.scores).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </p>
          {candidate.animation.reason && <p>{candidate.animation.reason}</p>}
        </div>
      )}
    </section>
  );
}
