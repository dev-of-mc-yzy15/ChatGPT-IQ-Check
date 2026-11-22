import { useMemo, useState } from "react";
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

export function FourTaskPanel({ data }: { data: FourTaskData }) {
  // 默认全可见：46 条曲线一起看才有「谁在掉」的整体感，单看 Top N 会漏掉中段的异常。
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);

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
            每个点是一个批次。同模型同色，档位越高越不透明（low → ultra）。点击图例可隐藏。
          </figcaption>
          <svg
            role="img"
            aria-label="四题总分趋势"
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{ height: "auto", display: "block" }}
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
                  fill="var(--muted)"
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
                fill="var(--muted)"
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
              const isSelected = key === selected;
              // 同模型 6 档：0.42 起步，每档 +0.11，最高约 0.97。
              const opacity = 0.42 + effortIndex * 0.11;
              const points = c.history
                .map((p) => `${xOf(new Date(p.at).getTime(), min, max)},${yOf(p.score, data.score_max)}`)
                .join(" ");
              const last = c.history[c.history.length - 1];
              return (
                <g key={key}>
                  <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 1.4}
                    strokeOpacity={isSelected ? 1 : opacity}
                    points={points}
                  />
                  <circle
                    cx={xOf(new Date(last.at).getTime(), min, max)}
                    cy={yOf(last.score, data.score_max)}
                    r={isSelected ? 4.5 : 2.4}
                    fill={color}
                    fillOpacity={isSelected ? 1 : opacity}
                  >
                    <title>{`${c.model} ${fmtEffort(c.effort)} · ${fmtScore(last.score)} · ${fmtMonthDay(new Date(last.at).getTime())}`}</title>
                  </circle>
                </g>
              );
            })}
          </svg>
        </figure>

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
