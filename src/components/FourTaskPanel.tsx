import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FourTaskCandidate, FourTaskData } from "../types";
import { fmtDateTime, fmtEffort, fmtScore } from "../lib/format";
import { ModelName } from "./ModelName";
import { candidateKey } from "../../scripts/contract.mjs";

const W = 900;
const H = 380;
const PAD = { top: 16, right: 16, bottom: 34, left: 46 };

/** 一个模型一个基色；同模型的 6 个档位靠透明度分层，避免 48 种互不相干的颜色。 */
const MODEL_COLORS = [
  "#1d4ed8",
  "#b45309",
  "#0f766e",
  "#7c3aed",
  "#be123c",
  "#0369a1",
  "#4d7c0f",
  "#a21caf",
];
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];

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

/** 成本显示到 4 位：单轮几十美分，2 位小数会全变成 0.00。 */
function fmtCost(usd: number) {
  if (!Number.isFinite(usd)) return "—";
  return "$" + (usd < 1 ? usd.toFixed(4) : usd.toFixed(2));
}
function fmtMinutes(seconds: number) {
  if (!Number.isFinite(seconds)) return "—";
  return (seconds / 60).toFixed(1) + " 分钟";
}

type PointAddress = { key: string; index: number };

function pointId({ key, index }: PointAddress) {
  return `four-task-point-${key}-${index}`;
}

export function FourTaskPanel({ data }: { data: FourTaskData }) {
  // 默认全可见：46 条曲线一起看才有「谁在掉」的整体感，单看 Top N 会漏掉中段的异常。
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PointAddress | null>(null);
  const [focusedPoint, setFocusedPoint] = useState<PointAddress | null>(null);

  const models = useMemo(() => {
    const order = new Map<string, number>();
    for (const c of data.candidates) if (!order.has(c.model)) order.set(c.model, order.size);
    return [...order.keys()];
  }, [data.candidates]);

  const byModel = useMemo(() => {
    const map = new Map<string, FourTaskCandidate[]>();
    for (const c of data.candidates) {
      const list = map.get(c.model) ?? [];
      list.push(c);
      map.set(c.model, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort));
    }
    return map;
  }, [data.candidates]);

  const ranked = useMemo(
    () => [...data.candidates].sort((a, b) => b.score - a.score),
    [data.candidates],
  );

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setModelVisible = (model: string, visible: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      for (const c of byModel.get(model) ?? []) {
        const key = candidateKey(c.model, c.effort);
        if (visible) next.delete(key);
        else next.add(key);
      }
      return next;
    });

  const visible = data.candidates.filter((c) => !hidden.has(candidateKey(c.model, c.effort)));

  // 横轴范围按全部数据算，不随显隐抖动——否则每点一次图例整张图都在缩放，没法比。
  const { min, max } = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const c of data.candidates) {
      for (const p of c.history) {
        const t = new Date(p.at).getTime();
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    return { min: lo, max: hi };
  }, [data.candidates]);

  const ticks = [0, 1, 2, 3].map((i) => Math.round((data.score_max * i) / 3));
  const xTicks = [...new Map(
    Array.from({ length: 5 }, (_, i) => fmtMonthDay(min + ((max - min) * i) / 4)).map((label, i) => [
      label,
      min + ((max - min) * i) / 4,
    ]),
  ).entries()];

  const selectedCandidate = selected
    ? data.candidates.find((c) => candidateKey(c.model, c.effort) === selected) ?? null
    : null;

  const selectedPointDetails = selectedPoint
    ? (() => {
        if (hidden.has(selectedPoint.key)) return null;
        const candidate = data.candidates.find((c) => candidateKey(c.model, c.effort) === selectedPoint.key);
        const point = candidate?.history[selectedPoint.index];
        if (!candidate || !point) return null;
        const batch = data.batches.find((item) => item.completed_at === point.at);
        return { candidate, point, batch };
      })()
    : null;

  // 整张图只占一个 Tab 位；方向键在全部点之间移动，避免一千多个批次点把键盘用户困住。
  const visibleWithHistory = visible.filter((candidate) => candidate.history.length > 0);
  const focusedIsVisible = focusedPoint && visibleWithHistory.some((candidate) =>
    candidateKey(candidate.model, candidate.effort) === focusedPoint.key && candidate.history[focusedPoint.index],
  );
  const initialCandidate = visibleWithHistory[0];
  const tabStop: PointAddress | null = focusedIsVisible
    ? focusedPoint
    : initialCandidate
      ? { key: candidateKey(initialCandidate.model, initialCandidate.effort), index: initialCandidate.history.length - 1 }
      : null;

  const selectPoint = (address: PointAddress, moveFocus = false) => {
    setSelectedPoint(address);
    if (moveFocus) {
      setFocusedPoint(address);
      // 目标点已经存在，直接移动焦点即可；React 稍后会同步 roving tabindex。
      document.getElementById(pointId(address))?.focus();
    }
  };

  const onPointKeyDown = (event: ReactKeyboardEvent<SVGGElement>, address: PointAddress) => {
    if (event.key === "Escape") {
      setSelectedPoint(null);
      return;
    }
    const candidateIndex = visibleWithHistory.findIndex((candidate) => candidateKey(candidate.model, candidate.effort) === address.key);
    const candidate = visibleWithHistory[candidateIndex];
    if (!candidate) return;
    let nextCandidate = candidateIndex;
    let nextIndex = address.index;
    if (event.key === "ArrowLeft") nextIndex = Math.max(0, address.index - 1);
    else if (event.key === "ArrowRight") nextIndex = Math.min(candidate.history.length - 1, address.index + 1);
    else if (event.key === "ArrowUp") nextCandidate = Math.max(0, candidateIndex - 1);
    else if (event.key === "ArrowDown") nextCandidate = Math.min(visibleWithHistory.length - 1, candidateIndex + 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = candidate.history.length - 1;
    else return;
    event.preventDefault();
    const nextSeries = visibleWithHistory[nextCandidate];
    nextIndex = Math.min(nextIndex, nextSeries.history.length - 1);
    selectPoint({ key: candidateKey(nextSeries.model, nextSeries.effort), index: nextIndex }, true);
  };

  return (
    <>
      <section className="card">
        <h2>四题竞技场</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          上游 2026-10-27 起改用{" "}
          <span lang="en">{data.protocol}</span> 协议：四个任务加权成 0–{data.score_max} 分。
          当前轮次 <strong>{data.round.label}</strong>，{data.round.graded}/{data.round.expected} 题全部评分。
        </p>
        <p className="muted">
          权重：
          {data.tasks.map((t, i) => (
            <span key={t.id}>
              {i > 0 && " + "}
              {t.title_zh} {t.weight}
            </span>
          ))}
          {" = "}
          {data.score_max}。共 {data.batches.length} 个批次、{data.candidates.length} 个配置。
        </p>
        {/* 这是本项目最容易误读的地方：两套分数都长在 0–150 上，但题目集合不同。 */}
        <p className="muted">
          ⚠️ 与「RadarBench 趋势」不是同一套题，<strong>分数不可横向比较</strong>；两套视图各自独立，互不换算。
        </p>
      </section>

      <section className="card" aria-labelledby="four-task-trend-heading">
        <h2 id="four-task-trend-heading">四题总分趋势</h2>
        <figure>
          <figcaption className="muted">
            每个点是一个批次，点击查看数值；方向键逐点切换，Esc 取消选择。同模型同色，点击图例可隐藏。
            <span className="four-task-chart-mobile-hint">手机端可横向滑动图表。</span>
          </figcaption>
          <div className="four-task-chart-scroll" role="region" aria-label="四题趋势图（可横向滚动）" tabIndex={0}>
          <svg
            role="group"
            aria-label="四题总分趋势，方向键切换批次点"
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            className="four-task-chart"
          >
            <title>四题总分趋势</title>
            <desc>
              共 {data.candidates.length} 条候选曲线，纵轴 0 到 {data.score_max} 分。
            </desc>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={yOf(t, data.score_max)}
                  y2={yOf(t, data.score_max)}
                  stroke="var(--line)"
                />
                <text
                  x={PAD.left - 8}
                  y={yOf(t, data.score_max) + 4}
                  textAnchor="end"
                  fill="var(--fg-muted)"
                  fontSize="11"
                >
                  {t}
                </text>
              </g>
            ))}
            {xTicks.map(([label, t]) => (
              <text
                key={label}
                x={xOf(t, min, max)}
                y={H - 12}
                textAnchor="middle"
                fill="var(--fg-muted)"
                fontSize="11"
              >
                {label}
              </text>
            ))}
            {visible.map((c) => {
              const modelIndex = models.indexOf(c.model);
              const color = MODEL_COLORS[modelIndex % MODEL_COLORS.length];
              const effortIndex = Math.max(0, EFFORT_ORDER.indexOf(c.effort));
              const key = candidateKey(c.model, c.effort);
              const isSelected = key === selected || key === selectedPoint?.key;
              // 同模型 6 档：0.42 起步，每档 +0.11，最高约 0.97。
              const opacity = 0.42 + effortIndex * 0.11;
              const points = c.history
                .map((p) => `${xOf(new Date(p.at).getTime(), min, max)},${yOf(p.score, data.score_max)}`)
                .join(" ");
              return (
                <g key={key}>
                  <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 1.4}
                    strokeOpacity={isSelected ? 1 : opacity}
                    points={points}
                  />
                  {c.history.map((point, index) => {
                    const address = { key, index };
                    const active = selectedPoint?.key === key && selectedPoint.index === index;
                    const batch = data.batches.find((item) => item.completed_at === point.at);
                    const label = `${c.model} ${fmtEffort(c.effort)}，${batch?.label ?? fmtDateTime(point.at)}，总分 ${fmtScore(point.score)}`;
                    const x = xOf(new Date(point.at).getTime(), min, max);
                    const y = yOf(point.score, data.score_max);
                    return (
                      <g
                        id={pointId(address)}
                        key={point.at}
                        className={`four-task__point ${active ? "is-active" : ""}`}
                        role="button"
                        tabIndex={tabStop?.key === key && tabStop.index === index ? 0 : -1}
                        aria-label={label}
                        aria-pressed={active}
                        onFocus={() => setFocusedPoint(address)}
                        onClick={() => selectPoint(address)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectPoint(address);
                          } else onPointKeyDown(event, address);
                        }}
                      >
                        <title>{label}</title>
                        <circle className="four-task__point-hit" cx={x} cy={y} r={10} fill="transparent" />
                        {active && <circle className="four-task__point-halo" cx={x} cy={y} r={8} />}
                        <circle
                          className="four-task__point-dot"
                          cx={x}
                          cy={y}
                          r={active ? 4.5 : 2.5}
                          fill={color}
                          fillOpacity={isSelected ? 1 : Math.max(0.7, opacity)}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          </div>
        </figure>

        {selectedPointDetails && (
          <div className="four-point-readout" role="status" aria-live="polite" aria-atomic="true" aria-label="选中批次数值">
            <div className="four-point-readout__identity">
              <span className="eyebrow">SELECTED BATCH</span>
              <strong><ModelName name={selectedPointDetails.candidate.model} /></strong>
              <span>{fmtEffort(selectedPointDetails.candidate.effort)}</span>
            </div>
            <div className="four-point-readout__batch">
              <span>{selectedPointDetails.batch?.label ?? "未命名批次"}</span>
              <time>{fmtDateTime(selectedPointDetails.point.at)}</time>
            </div>
            <div className="four-point-readout__score">
              <strong>{fmtScore(selectedPointDetails.point.score)}</strong><span> / {data.score_max}</span>
            </div>
            <button type="button" className="four-point-readout__close" aria-label="清除选中批次" onClick={() => setSelectedPoint(null)}>×</button>
          </div>
        )}

        {/* 图例按模型分组：46 个平铺按钮看不过来，按模型成束更好找。 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {models.map((model) => {
            const list = byModel.get(model) ?? [];
            const color = MODEL_COLORS[models.indexOf(model) % MODEL_COLORS.length];
            const allHidden = list.every((c) => hidden.has(candidateKey(c.model, c.effort)));
            return (
              <div key={model} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  aria-pressed={!allHidden}
                  onClick={() => setModelVisible(model, allHidden)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 130,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--line)",
                    background: "none",
                    color: "inherit",
                    cursor: "pointer",
                    opacity: allHidden ? 0.4 : 1,
                    fontSize: 12,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" }}
                  />
                  <ModelName name={model} />
                </button>
                {list.map((c) => {
                  const key = candidateKey(c.model, c.effort);
                  const shown = !hidden.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="muted"
                      aria-pressed={shown}
                      onClick={() => toggle(key)}
                      style={{
                        padding: "1px 7px",
                        borderRadius: 999,
                        border: "1px solid",
                        borderColor: shown ? "var(--line)" : "transparent",
                        background: "none",
                        color: "inherit",
                        cursor: "pointer",
                        opacity: shown ? 1 : 0.35,
                        fontSize: 11,
                      }}
                    >
                      {fmtEffort(c.effort)}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="four-task-table-heading">
        <h2 id="four-task-table-heading">四题排名</h2>
        <p className="muted">
          按总分降序。点任意一行看它的四个任务明细；「封顶」表示原始分被规则上限压过。
        </p>
        <div className="table-wrap" role="region" aria-label="四题排名（可横向滚动）" tabIndex={0}>
          {/* caption 讲口径，aria-label 给表格一个短名字：读屏跳表时先听到的是名字，不是一整句说明。 */}
          <table aria-label="四题排名">
            <caption className="muted">
              {data.round.label} · {data.candidates.length} 个配置 · 总分 /{data.score_max}
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">模型</th>
                <th scope="col">档位</th>
                <th scope="col">总分</th>
                {data.tasks.map((t) => (
                  <th key={t.id} scope="col" title={`权重 ${t.weight}`}>
                    {t.title_zh}
                  </th>
                ))}
                <th scope="col">成本</th>
                <th scope="col">耗时</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((c, index) => {
                const key = candidateKey(c.model, c.effort);
                const isSelected = key === selected;
                return (
                  <tr
                    key={key}
                    onClick={() => setSelected(isSelected ? null : key)}
                    style={{ cursor: "pointer", background: isSelected ? "var(--line)" : undefined }}
                  >
                    <td className="muted">{index + 1}</td>
                    <td>
                      <ModelName name={c.model} />
                    </td>
                    <td>{fmtEffort(c.effort)}</td>
                    <td>
                      <strong>{fmtScore(c.score)}</strong>
                    </td>
                    {data.tasks.map((t) => {
                      const cell = c.tasks.find((x) => x.id === t.id);
                      return (
                        <td key={t.id}>
                          {cell ? fmtScore(cell.score) : "—"}
                          {cell?.capped && (
                            <span className="muted" title={`原始 ${fmtScore(cell.raw_total)}，被规则封顶`}>
                              {" "}
                              封顶
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td>{fmtCost(c.totals.cost_usd)}</td>
                    <td>{fmtMinutes(c.totals.seconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCandidate && (
        <section className="card" aria-labelledby="four-task-detail-heading">
          <h2 id="four-task-detail-heading">
            <ModelName name={selectedCandidate.model} /> · {fmtEffort(selectedCandidate.effort)}
          </h2>
          <p className="muted">
            总分 {fmtScore(selectedCandidate.score)} · 完成于 {fmtDateTime(selectedCandidate.latest_at)} · 合计{" "}
            {fmtCost(selectedCandidate.totals.cost_usd)} / {fmtMinutes(selectedCandidate.totals.seconds)}
          </p>
          <div className="table-wrap" role="region" aria-label="任务明细" tabIndex={0}>
            <table aria-label="任务明细">
              <thead>
                <tr>
                  <th scope="col">任务</th>
                  <th scope="col">得分 /100</th>
                  <th scope="col">计入总分</th>
                  <th scope="col">原始分</th>
                  <th scope="col">耗时</th>
                  <th scope="col">成本</th>
                </tr>
              </thead>
              <tbody>
                {selectedCandidate.tasks.map((cell) => {
                  const def = data.tasks.find((t) => t.id === cell.id);
                  const weighted = (cell.score * (def?.weight ?? 0)) / 100;
                  return (
                    <tr key={cell.id}>
                      <td>{def?.title_zh ?? cell.id}</td>
                      <td>
                        {cell.id === "candy" ? (cell.correct ? "对" : "错") : fmtScore(cell.score)}
                      </td>
                      <td>
                        {weighted.toFixed(3)}
                        <span className="muted"> / {def?.weight}</span>
                      </td>
                      <td>
                        {fmtScore(cell.raw_total)}
                        {cell.capped && <span className="muted"> （封顶）</span>}
                      </td>
                      <td>{fmtMinutes(cell.seconds)}</td>
                      <td>{fmtCost(cell.cost_usd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
