import type { RoundData } from "../types";
import { fmtEffort, fmtScore } from "../lib/format";
import { roundMatrix } from "../lib/derive";

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
  return (
    <section className="card" aria-label="本轮雷达">
      <h2>本轮雷达</h2>
      <p className="muted">
        7 题一轮 · 分数 = 100 × 平均 reward × 1.5 · 满分 150 · 数据更新{" "}
        {new Date(round.round.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
      </p>
      <div className="table-wrap">
        <table>
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
                  return (
                    <td key={effort}>
                      {cell ? (
                        <button
                          type="button"
                          className="card"
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
