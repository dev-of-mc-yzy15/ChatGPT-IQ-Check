import type { RoundData } from "../types";
import { fmtDateTime, fmtEffort, fmtMoney, fmtScore, fmtSeconds } from "../lib/format";
import { roundMatrix } from "../lib/derive";

type ScoreBand = "high" | "mid" | "low" | "verylow";

function scoreBand(score: number): ScoreBand {
  if (score >= 120) return "high";
  if (score >= 90) return "mid";
  if (score >= 60) return "low";
  return "verylow";
}

export function RoundMatrix({
  round,
  selectedKey,
  onSelect,
}: {
  round: RoundData;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const { models, efforts, cells } = roundMatrix(round);
  const verified = round.candidates.filter((c) => c.scored_tasks === c.total_tasks).length;
  const totalCost = round.candidates.reduce(
    (sum, c) => sum + (Number.isFinite(c.totals.cost_usd) ? c.totals.cost_usd : 0),
    0,
  );
  const unknownCostTasks = round.candidates.reduce((sum, c) => sum + (c.totals.cost_unknown_tasks || 0), 0);
  return (
    <section className="card round-matrix" aria-label="本轮雷达">
      <h2>本轮雷达</h2>
      <p className="muted">
        {round.round.status === "completed" ? "本轮已完成" : `本轮状态：${round.round.status}`} ·{" "}
        {verified}/{round.candidates.length} 档位核验 · 本轮用时{" "}
        {fmtSeconds(round.round.timings?.wall_seconds)} · 已知测试费用 {fmtMoney(totalCost)}
        {unknownCostTasks > 0 ? `（${unknownCostTasks} 题成本未知）` : ""}
      </p>
      <p className="muted">
        7 题一轮 · 分数 = 100 × 平均 reward × 1.5 · 满分 150 · 数据更新{" "}
        {fmtDateTime(round.round.updated_at)}
      </p>
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <table style={{ minWidth: 560 }}>
          <caption className="muted">模型 × 推理档位，缺失档位显示 —</caption>
          <thead>
            <tr>
              <th scope="col">模型</th>
              {efforts.map((effort) => (
                <th key={effort} scope="col">{fmtEffort(effort)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model}>
                <th scope="row">{model}</th>
                {efforts.map((effort) => {
                  const key = model + "|" + effort;
                  const cell = cells.get(key);
                  const band =
                    cell?.score == null || !Number.isFinite(cell.score) ? undefined : scoreBand(cell.score);
                  return (
                    <td key={effort}>
                      {cell ? (
                        <button
                          type="button"
                          className="card"
                          data-band={band}
                          aria-pressed={selectedKey === key}
                          aria-label={`${model} ${fmtEffort(effort)} ${fmtScore(cell.score)} 分`}
                          onClick={() => onSelect(key)}
                        >
                          {fmtScore(cell.score)}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
