import { Fragment, useMemo, useState } from "react";
import type { RadarCandidate, ScoreStatus } from "../types";
import { computeDelta, sortCandidates, type SortKey } from "../lib/derive";
import { fmtDateTime, fmtDelta, fmtEffort, fmtPercent, fmtScore } from "../lib/format";
import { ModelName } from "./ModelName";
import { candidateKey } from "../../scripts/contract.mjs";

const COLUMNS: { key: SortKey; label: string; defaultDir: "asc" | "desc" }[] = [
  { key: "model", label: "模型", defaultDir: "asc" },
  { key: "effort", label: "档位", defaultDir: "asc" },
  { key: "score", label: "分数", defaultDir: "desc" },
  { key: "coverage", label: "覆盖率", defaultDir: "desc" },
  { key: "graded_runs_count", label: "已评分运行", defaultDir: "desc" },
  { key: "latest_graded_at", label: "最近评分", defaultDir: "desc" },
];

const STATUS_AFTER: SortKey = "coverage";
const STATUS_LABELS: Record<ScoreStatus, string> = { complete: "完整", provisional: "临时" };
const COLUMN_COUNT = COLUMNS.length + 3;

export function CandidateTable({
  rows,
  selectedKeys,
  onToggle,
  scoreMax,
}: {
  rows: RadarCandidate[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  scoreMax: number;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "score", dir: "desc" });
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => `${r.model} ${r.effort} ${fmtEffort(r.effort)}`.toLowerCase().includes(q))
      : rows;
    return sortCandidates(filtered, sort.key, sort.dir);
  }, [rows, query, sort]);

  const click = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: COLUMNS.find((c) => c.key === key)?.defaultDir ?? "asc" },
    );
  };

  return (
    <section className="card" aria-label="RadarBench 候选">
      <h2>RadarBench 候选</h2>
      <label className="muted">
        {/* label 已经提供可访问名，再挂 aria-label 读屏会念两遍。 */}
        搜索模型或档位 <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="table-wrap">
        <table style={{ minWidth: 760 }}>
          <caption className="muted">最多选 6 条曲线；分数为 0–{scoreMax} 的基准测试分数</caption>
          <thead>
            <tr>
              <th scope="col">选择</th>
              {COLUMNS.map((c) => (
                <Fragment key={c.key}>
                  <th
                    scope="col"
                    aria-sort={
                      sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <button type="button" onClick={() => click(c.key)}>
                      {c.label}
                    </button>
                  </th>
                  {c.key === STATUS_AFTER && <th scope="col">状态</th>}
                </Fragment>
              ))}
              <th scope="col">Δ</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="muted">
                  {rows.length === 0 ? "暂无候选" : "没有匹配的候选"}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const key = candidateKey(r.model, r.effort);
              const { delta, days } = computeDelta(r.history);
              return (
                <tr key={key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(key)}
                      onChange={() => onToggle(key)}
                      aria-label={`选择 ${r.model} ${fmtEffort(r.effort)}`}
                    />
                  </td>
                  <th scope="row"><ModelName name={r.model} /></th>
                  <td>{fmtEffort(r.effort)}</td>
                  <td>{fmtScore(r.score)}</td>
                  {/* required_tasks 为 0 时不能用 max(1,·) 硬凑分母，会伪装成 6400%。 */}
                  <td>
                    {r.required_tasks > 0
                      ? fmtPercent(r.coverage / r.required_tasks)
                      : <span title={`覆盖 ${r.coverage}`}>—</span>}
                  </td>
                  <td className={r.score_status === "provisional" ? "muted" : undefined}>
                    {STATUS_LABELS[r.score_status]}
                  </td>
                  <td>{r.graded_runs_count}</td>
                  <td>{fmtDateTime(r.latest_graded_at)}</td>
                  <td className={delta != null && delta < 0 ? "down" : ""}>
                    {fmtDelta(delta)}
                    {days != null ? ` / ${days} 天` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}