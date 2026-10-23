import type { RadarCandidate } from "../types";
import { fmtEffort, fmtScore } from "../lib/format";

export function TrendControls({
  rows,
  selectedKeys,
  onToggle,
  max = 6,
}: {
  rows: RadarCandidate[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  max?: number;
}) {
  return (
    <section className="card" aria-label="曲线选择">
      <h2>曲线选择</h2>
      <p className="muted">最多 {max} 条；当前 {selectedKeys.length} / {rows.length}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {rows.map((r) => {
          const key = r.model + "|" + r.effort;
          const checked = selectedKeys.includes(key);
          const disabled = !checked && selectedKeys.length >= max;
          return (
            <label key={key} className="card" style={{ padding: "6px 10px" }}>
              <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(key)} />
              {" "}{r.model} · {fmtEffort(r.effort)} · {fmtScore(r.score)}
            </label>
          );
        })}
      </div>
    </section>
  );
}
