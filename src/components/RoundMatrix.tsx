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
  // P1-11：分母是必做题数（required_tasks），不是候选数——候选档位少的时候用候选数做分母永远满分，会掩盖题目根本没跑完。
  // 上游 round 段没给 required_tasks 时回退到题集里的 required 标记与 task_count（两者同源，都是本轮必做题数）。
  const requiredTasks = round.tasks.filter((t) => t.required).length || round.round.task_count || 1;
  // 分子取各档位已评分题数的最小值：最慢的档位决定真实核验进度，不许被跑得快的档位拉高。
  const verifiedTasks = round.candidates.length
    ? Math.min(...round.candidates.map((c) => c.scored_tasks || 0))
    : 0;
  const verifiedPct = Math.round((Math.min(verifiedTasks, requiredTasks) / requiredTasks) * 100);
  const totalCost = round.candidates.reduce(
    (sum, c) => sum + (Number.isFinite(c.totals.cost_usd) ? c.totals.cost_usd : 0),
    0,
  );
  const unknownCostTasks = round.candidates.reduce((sum, c) => sum + (c.totals.cost_unknown_tasks || 0), 0);
  return (
    <section className="card round-matrix" aria-labelledby="round-matrix-heading">
      <h2 id="round-matrix-heading">本轮雷达</h2>
      <p className="muted">
        {round.round.status === "completed" ? "本轮已完成" : `本轮状态：${round.round.status}`} ·{" "}
        {verifiedTasks}/{requiredTasks} 题已核验（{verifiedPct}%） · 本轮用时{" "}
        {fmtSeconds(round.round.timings?.wall_seconds)} · 已知测试费用（USD） {fmtMoney(totalCost)}
        {unknownCostTasks > 0 ? `（${unknownCostTasks} 题成本未知）` : ""}
      </p>
      <p className="muted">
        {round.round.task_count || round.tasks.length} 题一轮 · 分数 = 100 × 平均 reward ×{" "}
        {(scoreMax / 100).toFixed(2).replace(/0$/, "")} · 满分 {scoreMax} · 数据更新{" "}
        {fmtDateTime(round.round.updated_at)}
      </p>
      {/* 横向滚动容器要可聚焦（role=region + tabindex=0），否则键盘用户够不到溢出部分；overflow 交给 theme.css，不再内联。 */}
      <div className="table-wrap" role="region" aria-label="分数矩阵（可横向滚动）" tabIndex={0}>
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
                          onClick={() => onSelect(key)}
                        >
                          {/* 可访问名走 sr-only 文本：aria-label 是纯文本，塞不进 lang；只有真实文本节点上的 lang 才让读屏换语音。
                              可见分数 aria-hidden：sr-only 里已经带了「N 分」，不屏蔽会被念两遍。 */}
                          <span className="sr-only">
                            <span lang="en">{model}</span> {fmtEffort(effort)} {fmtScore(cell.score)} 分
                          </span>
                          <span aria-hidden="true">{fmtScore(cell.score)}</span>
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