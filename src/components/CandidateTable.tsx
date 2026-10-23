import { useMemo, useState } from "react";
import type { RadarCandidate } from "../types";
import { computeDelta, sortCandidates, type SortKey } from "../lib/derive";
import { fmtDateTime, fmtDelta, fmtEffort, fmtPercent, fmtScore } from "../lib/format";

const COLUMNS: { key: SortKey; label: string; defaultDir: "asc" | "desc" }[] = [
  { key: "model", label: "模型", defaultDir: "asc" },
  { key: "effort", label: "档位", defaultDir: "asc" },
  { key: "score", label: "分数", defaultDir: "desc" },
  { key: "coverage", label: "覆盖率", defaultDir: "desc" },
  { key: "graded_runs_count", label: "已评分运行", defaultDir: "desc" },
  { key: "latest_graded_at", label: "最近评分", defaultDir: "desc" },
];

export function CandidateTable({
  rows,
  selectedKeys,
  onToggle,
}: {
  rows: RadarCandidate[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => `${r.model} ${r.effort} ${fmtEffort(r.effort)}`.toLowerCase().includes(q))
      : rows;
    return sort ? sortCandidates(filtered, sort.key, sort.dir) : filtered;
  }, [rows, query, sort]);

  const click = (key: SortKey) => {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: COLUMNS.find((c) => c.key === key)?.defaultDir ?? "asc" },
    );
  };

  return (
    <section className="card" aria-label="RadarBench 候选">
      <h2>RadarBench 候选</h2>
      <label className="muted">
        搜索模型或档位{" "}
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="搜索模型或档位" />
      </label>
      <div className="table-wrap">
        <table>
          <caption className="muted">最多选 6 条曲线；分数为 0–150 的基准测试分数</caption>
          <thead>
            <tr>
              <th scope="col">选择</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                  }
                >
                  <button type="button" onClick={() => click(c.key)}>
                    {c.label}
                  </button>
                </th>
              ))}
              <th scope="col">Δ</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  没有匹配的候选
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const key = r.model + "|" + r.effort;
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
                  <th scope="row">{r.model}</th>
                  <td>{fmtEffort(r.effort)}</td>
                  <td>{fmtScore(r.score)}</td>
                  <td>{fmtPercent(r.coverage / Math.max(1, r.required_tasks))}</td>
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
