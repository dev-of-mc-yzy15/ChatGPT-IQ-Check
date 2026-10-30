import type { RoundData } from "../types";
import { candidateKey, SCORE_MAX_FALLBACK } from "../../scripts/contract.mjs";
import { fmtDateTime, fmtEffort, fmtMoney, fmtScore, fmtSeconds } from "../lib/format";
import { roundMatrix } from "../lib/derive";
import { ModelName } from "./ModelName";

type ScoreBand = "high" | "mid" | "low" | "verylow";

// 分档按满分比例算（80% / 60% / 40%），满分不是 150 时依旧成立。
function scoreBand(score: number, scoreMax: number): ScoreBand {
  if (score >= scoreMax * 0.8) return "high";
  if (score >= scoreMax * 0.6) return "mid";
  if (score >= scoreMax * 0.4) return "low";
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
  const scoreMax = round.candidates[0]?.score_max ?? SCORE_MAX_FALLBACK;
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
        {round.round.task_count || round.tasks.length} 题一轮 · 分数 = 100 × 平均 reward ×{" "}
        {(scoreMax / 100).toFixed(2).replace(/0$/, "")} · 满分 {scoreMax} · 数据更新{" "}
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
                <th scope="row"><ModelName name={model} /></th>
                {efforts.map((effort) => {
                  const key = candidateKey(model, effort);
                  const cell = cells.get(key);
                  const band =
                    cell?.score == null || !Number.isFinite(cell.score) ? undefined : scoreBand(cell.score, scoreMax);
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