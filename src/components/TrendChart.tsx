import type { RadarCandidate } from "../types";
import { buildDailyGrid, computeDelta, findDegradationPoints } from "../lib/derive";
import { fmtDateTime, fmtDelta, fmtEffort, fmtScore } from "../lib/format";
import { ModelName } from "./ModelName";

const W = 860;
const H = 340;
const PAD = { top: 20, right: 20, bottom: 36, left: 48 };
const COLORS = ["#1d4ed8", "#b45309", "#0f766e", "#7c3aed", "#be123c", "#0369a1"];

function plotWidth() {
  return W - PAD.left - PAD.right;
}
function plotHeight() {
  return H - PAD.top - PAD.bottom;
}
function xOf(t: number, min: number, max: number) {
  if (max === min) return PAD.left + plotWidth() / 2;
  return PAD.left + ((t - min) / (max - min)) * plotWidth();
}
function yOf(score: number) {
  return PAD.top + (1 - score / 150) * plotHeight();
}
const MONTH_DAY = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
});

function fmtMonthDay(t: number) {
  const parts = MONTH_DAY.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}-${get("day")}`;
}

export function TrendChart({ candidates }: { candidates: RadarCandidate[] }) {
  if (!candidates.length) {
    return <section className="card"><h2>RadarBench 趋势</h2><p className="muted">暂无可展示的曲线。</p></section>;
  }
  const grids = candidates.map((c) => buildDailyGrid(c.history));
  const times = grids.flat().map((p) => new Date(p.at).getTime());
  if (!times.length) {
    return <section className="card"><h2>RadarBench 趋势</h2><p className="muted">暂无历史数据。</p></section>;
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  const ticks = [0, 50, 100, 150];
  const xTickTimes = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const xTicks = [...new Map(xTickTimes.map((t) => [fmtMonthDay(t), t])).values()];

  return (
    <section className="card" aria-label="RadarBench 趋势">
      <h2>RadarBench 趋势</h2>
      <figure>
        <figcaption className="muted">
          日桶历史（UTC，显示为北京时间）。线在缺口处断开；空心点为 provisional；红点为降智信号（Δ ≤ -5 且覆盖率 ≥ 90%）。
        </figcaption>
        <svg
          role="img"
          aria-label="RadarBench 趋势"
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          // SVG 没有 height="auto" 这个合法取值，响应式高度要走 CSS。
          style={{ height: "auto", display: "block" }}
        >
          <title>RadarBench 趋势</title>
          <desc>最多 6 条候选曲线的日桶分数，0 到 150。</desc>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--line)" />
              <text x={PAD.left - 8} y={yOf(t) + 4} textAnchor="end" fill="var(--muted)" fontSize="11">{t}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={xOf(t, min, max)} y={H - 12} textAnchor="middle" fill="var(--muted)" fontSize="11">
              {fmtMonthDay(t)}
            </text>
          ))}
          {candidates.map((c, i) => {
            const grid = grids[i];
            const color = COLORS[i % COLORS.length];
            const segments: { x: number; y: number }[][] = [];
            let current: { x: number; y: number }[] = [];
            for (const p of grid) {
              if (p.score == null) {
                if (current.length) segments.push(current);
                current = [];
              } else {
                current.push({ x: xOf(new Date(p.at).getTime(), min, max), y: yOf(p.score) });
              }
            }
            if (current.length) segments.push(current);
            // 折线走的是按天去重后的网格，散点也必须按同样规则取点，
            // 否则同一天有多次评分时会出现「点飘在折线外」。
            const lastPerDay = new Map<string, (typeof c.history)[number]>();
            for (const p of c.history) lastPerDay.set(p.at.slice(0, 10), p);
            const points = [...lastPerDay.values()].map((p) => ({
              p,
              x: xOf(new Date(p.at).getTime(), min, max),
              y: yOf(p.score),
            }));
            const degrade = findDegradationPoints(c.history);
            return (
              <g key={c.model + "|" + c.effort}>
                {segments.map((seg, j) => (
                  <polyline key={j} fill="none" stroke={color} strokeWidth={2}
                    points={seg.map((p) => `${p.x},${p.y}`).join(" ")} />
                ))}
                {points.map(({ p, x, y }) => (
                  <circle key={p.at} cx={x} cy={y} r={3} fill={p.score_status === "complete" ? color : "var(--bg)"}
                    stroke={color} strokeWidth={1.5}>
                    <title>{`${c.model} ${fmtEffort(c.effort)} · ${fmtMonthDay(new Date(p.at).getTime())} · ${fmtScore(p.score)}`}</title>
                  </circle>
                ))}
                {degrade.map(({ point, delta, days }) => (
                  <circle key={"d" + point.at} cx={xOf(new Date(point.at).getTime(), min, max)} cy={yOf(point.score)}
                    r={6} fill="var(--down)" stroke="var(--bg)" strokeWidth={2}>
                    <title>{`分数下降 ${fmtDelta(delta)}（${days} 天）`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </figure>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        {candidates.map((c, i) => (
          <span key={c.model + "|" + c.effort} className="muted">
            <span style={{ display: "inline-block", width: 10, height: 10, background: COLORS[i % COLORS.length], borderRadius: 999 }} />{" "}
            <ModelName name={c.model} /> · {fmtEffort(c.effort)}
          </span>
        ))}
      </div>
      <details>
        <summary>查看数据表</summary>
        <div className="table-wrap">
          <table>
            <caption className="muted">曲线数据点</caption>
            <thead><tr><th scope="col">日期</th><th scope="col">候选</th><th scope="col">分数</th><th scope="col">Δ</th></tr></thead>
            <tbody>
              {candidates.flatMap((c) => c.history.map((p, idx) => {
                const delta = computeDelta(c.history.slice(0, idx + 1)).delta;
                return (
                  <tr key={c.model + c.effort + p.at}>
                    <td>{fmtDateTime(p.at)}</td>
                    <td><ModelName name={c.model} /> · {fmtEffort(c.effort)}</td>
                    <td>{fmtScore(p.score)}</td>
                    <td className={delta != null && delta < 0 ? "down" : ""}>{fmtDelta(delta)}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
