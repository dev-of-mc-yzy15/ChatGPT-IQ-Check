import { useState, useMemo } from "react";
import type { RadarCandidate } from "../types";
import { buildDailyGrid, deltaClass, deltaMark, findDegradationPoints, lastPerDay, MAX_TREND_SERIES } from "../lib/derive";
import { fmtDateTime, fmtDelta, fmtEffort, fmtScore } from "../lib/format";
import { ModelName } from "./ModelName";
import { candidateKey } from "../../scripts/contract.mjs";

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
function yOf(score: number, scoreMax: number) {
  return PAD.top + (1 - score / scoreMax) * plotHeight();
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

export function TrendChart({
  candidates,
  scoreMax,
}: {
  candidates: RadarCandidate[];
  scoreMax: number;
}) {
  // hooks 必须排在早期 return 之前：candidates 从空变非空时渲染路径切换，位置错了 hook 数量就对不上。
  // 记录被点灭的序列，默认全部可见。
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const toggleSeries = (key: string) =>
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // 数据表逐行算 Δ 时每次都要 history.slice(0, idx + 1)，是 O(n²)：先把每条序列的
  // 逐点差值算一遍，行内只查表。公式与 computeDelta 的相邻两点差值保持一致。
  const deltaByKey = useMemo(() => {
    const map = new Map<string, (number | null)[]>();
    for (const c of candidates) {
      let prev: number | null = null;
      map.set(
        candidateKey(c.model, c.effort),
        c.history.map((p) => {
          const delta = prev == null ? null : Math.round((p.score - prev) * 10) / 10;
          prev = p.score;
          return delta;
        }),
      );
    }
    return map;
  }, [candidates]);
  if (!candidates.length) {
    return <section className="card"><h2>RadarBench 趋势</h2><p className="muted">暂无可展示的曲线。</p></section>;
  }
  const grids = candidates.map((c) => buildDailyGrid(c.history));
  // 单趟循环求横轴首尾，不先 flat 再 `Math.min(...times)`：曲线一多（每条又带个 1970 坏点）
  // 实参数量就越过 V8 上限抛 RangeError，而这里外层没有 try，整张首页图会被 ErrorBoundary 吃掉。
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const grid of grids) {
    for (const p of grid) {
      const t = new Date(p.at).getTime();
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  if (min > max) {
    return <section className="card"><h2>RadarBench 趋势</h2><p className="muted">暂无历史数据。</p></section>;
  }
  // 刻度跟着数据的满分走，上游改评分上限时图不会失真。
  const ticks = [0, 1, 2, 3].map((i) => Math.round((scoreMax * i) / 3));
  const xTickTimes = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const xTicks = [...new Map(xTickTimes.map((t) => [fmtMonthDay(t), t])).values()];

  return (
    <section className="card" aria-labelledby="trend-chart-heading">
      <h2 id="trend-chart-heading">RadarBench 趋势</h2>
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
          <desc>最多 {MAX_TREND_SERIES} 条候选曲线的日桶分数，0 到 {scoreMax}。</desc>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yOf(t, scoreMax)} y2={yOf(t, scoreMax)} stroke="var(--line)" />
              <text x={PAD.left - 8} y={yOf(t, scoreMax) + 4} textAnchor="end" fill="var(--muted)" fontSize="11">{t}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={xOf(t, min, max)} y={H - 12} textAnchor="middle" fill="var(--muted)" fontSize="11">
              {fmtMonthDay(t)}
            </text>
          ))}
          {candidates.map((c, i) => {
            const seriesKey = candidateKey(c.model, c.effort);
            if (hiddenKeys.has(seriesKey)) return null;
            const grid = grids[i];
            const color = COLORS[i % COLORS.length];
            const segments: { x: number; y: number }[][] = [];
            let current: { x: number; y: number }[] = [];
            for (const p of grid) {
              if (p.score == null) {
                if (current.length) segments.push(current);
                current = [];
              } else {
                current.push({ x: xOf(new Date(p.at).getTime(), min, max), y: yOf(p.score, scoreMax) });
              }
            }
            if (current.length) segments.push(current);
            // 折线走按天去重后的网格，散点必须用同一条序列，否则同一天多次评分会出现「点飘在折线外」。
            const points = lastPerDay(c.history).map((p) => ({
              p,
              x: xOf(new Date(p.at).getTime(), min, max),
              y: yOf(p.score, scoreMax),
            }));
            const degrade = findDegradationPoints(c.history);
            return (
              <g key={seriesKey}>
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
                  <circle key={"d" + point.at} cx={xOf(new Date(point.at).getTime(), min, max)} cy={yOf(point.score, scoreMax)}
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
        {candidates.map((c, i) => {
          const seriesKey = candidateKey(c.model, c.effort);
          const shown = !hiddenKeys.has(seriesKey);
          return (
            // P1-12：图例是可操作控件，不是装饰文本——用 button + aria-pressed 表达显隐，键盘和读屏都能用。
            <button
              key={seriesKey}
              type="button"
              className="muted"
              aria-pressed={shown}
              onClick={() => toggleSeries(seriesKey)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: shown ? "var(--line)" : "transparent",
                background: "none",
                color: "inherit",
                cursor: "pointer",
                opacity: shown ? 1 : 0.5,
              }}
            >
              <span
                aria-hidden="true"
                style={{ display: "inline-block", width: 10, height: 10, background: COLORS[i % COLORS.length], borderRadius: 999 }}
              />{" "}
              <ModelName name={c.model} /> · {fmtEffort(c.effort)}
            </button>
          );
        })}
      </div>
      <details>
        <summary>查看数据表</summary>
        <div className="table-wrap" role="region" aria-label="曲线数据点（可横向滚动）" tabIndex={0}>
          <table>
            {/* 数据表保留全量行：图上看不见的序列，核对时仍要能查到原始点。 */}
            <caption className="muted">曲线数据点（含已隐藏序列）</caption>
            <thead><tr><th scope="col">日期</th><th scope="col">候选</th><th scope="col">分数</th><th scope="col">Δ</th></tr></thead>
            <tbody>
              {candidates.flatMap((c) => c.history.map((p, idx) => {
                const delta = deltaByKey.get(candidateKey(c.model, c.effort))?.[idx] ?? null;
                return (
                  <tr key={c.model + c.effort + p.at}>
                    <td>{fmtDateTime(p.at)}</td>
                    <td><ModelName name={c.model} /> · {fmtEffort(c.effort)}</td>
                    <td>{fmtScore(p.score)}</td>
                    <td className={deltaClass(delta)}>
                      {/* 首行没有可比的历史，fmtDelta 已经给破折号——符号位只在真有差值时补，
                          否则叠成「— —」。空格跟着符号走，否则空值会多出前导空格。
                          0 保留（— 0.0）：符号是「无方向」标记，值是真的 0.0。 */}
                      {delta != null && Number.isFinite(delta) ? (
                        <><span aria-hidden="true">{deltaMark(delta)}</span>{" "}</>
                      ) : null}
                      {fmtDelta(delta)}
                    </td>
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
