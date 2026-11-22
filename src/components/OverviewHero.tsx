import type { RoundData, StatusData } from "../types";
import { fmtDateTime, fmtEffort, fmtScore } from "../lib/format";
import { ModelName } from "./ModelName";

function ArrowUpRight() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 12 12 4M5 4h7v7" />
    </svg>
  );
}

export function OverviewHero({ round, status }: { round: RoundData | null; status: StatusData | null }) {
  const ranked = [...(round?.candidates ?? [])]
    .filter((candidate) => candidate.score != null && Number.isFinite(candidate.score))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const leader = ranked[0] ?? null;
  const scoreMax = leader?.score_max ?? 150;
  const requiredTasks = round?.tasks.filter((task) => task.required).length || round?.round.task_count || 0;
  const verifiedTasks = round?.candidates.length
    ? Math.min(...round.candidates.map((candidate) => candidate.scored_tasks || 0))
    : 0;
  const verifiedPct = requiredTasks > 0 ? Math.round((Math.min(verifiedTasks, requiredTasks) / requiredTasks) * 100) : 0;
  const modelCount = round ? new Set(round.candidates.map((candidate) => candidate.model)).size : 0;
  const updatedAt = round?.round.updated_at ? fmtDateTime(round.round.updated_at) : "等待数据";
  const checkedAt = status?.checked_at ? fmtDateTime(status.checked_at).slice(0, 10).replaceAll("-", ".") : "—";

  const metrics = [
    { label: "观测配置", value: round ? String(round.candidates.length) : "—", unit: "组" },
    { label: "模型系列", value: round ? String(modelCount) : "—", unit: "个" },
    { label: "本轮任务", value: round ? String(requiredTasks) : "—", unit: "题" },
    { label: "核验进度", value: round ? String(verifiedPct) : "—", unit: "%" },
  ];

  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero__main">
        <div className="hero__copy">
          <p className="eyebrow"><span className="live-dot" aria-hidden="true" /> MODEL INTELLIGENCE / OBSERVATORY</p>
          <h2 id="hero-heading" className="hero__title">
            读懂模型的<br />
            <span>每一次波动。</span>
          </h2>
          <p className="hero__description">
            追踪不同模型与推理档位的评测表现，<br className="desktop-break" />
            在分数、趋势与细节之间，看见变化发生的地方。
          </p>
          <div className="hero__meta">
            <span className="hero__meta-icon" aria-hidden="true"><ArrowUpRight /></span>
            <span>非官方第三方观测 · 非心理学 IQ 测试</span>
          </div>
        </div>

        <div className="snapshot" role="group" aria-label="本轮高分配置概览">
          <svg className="snapshot__radar" viewBox="0 0 180 180" aria-hidden="true">
            <circle cx="90" cy="90" r="70" /><circle cx="90" cy="90" r="48" /><circle cx="90" cy="90" r="25" />
            <path d="M90 8v164M8 90h164M32 32l116 116M148 32 32 148" />
            <path className="snapshot__sweep" d="m90 90 55-43A70 70 0 0 1 160 90Z" />
          </svg>
          <div className="snapshot__header">
            <span className="snapshot__label">CURRENT LEADER</span>
            <span className="snapshot__live"><span className="live-dot" aria-hidden="true" /> 本轮快照</span>
          </div>
          {leader ? (
            <>
              <div className="snapshot__score">
                {fmtScore(leader.score)}<span> / {scoreMax}</span>
              </div>
              <p className="snapshot__model"><ModelName name={leader.model} /><span>·</span>{fmtEffort(leader.effort)}</p>
              <div className="snapshot__ranking">
                {ranked.slice(0, 3).map((candidate, index) => (
                  <div className="snapshot__row" key={`${candidate.model}-${candidate.effort}`}>
                    <span className="snapshot__rank">0{index + 1}</span>
                    <span className="snapshot__name"><ModelName name={candidate.model} /></span>
                    <span className="snapshot__effort">{fmtEffort(candidate.effort)}</span>
                    <span className="snapshot__track" aria-hidden="true">
                      <span style={{ width: `${Math.max(0, Math.min(100, ((candidate.score ?? 0) / scoreMax) * 100))}%` }} />
                    </span>
                    <strong>{fmtScore(candidate.score)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="snapshot__empty"><strong>—</strong><span>正在同步本轮观测数据</span></div>
          )}
          <div className="snapshot__footer"><span>最后更新</span><time>{updatedAt}</time></div>
        </div>
      </div>

      <div className="hero__metrics" role="group" aria-label="概览指标">
        {metrics.map((metric, index) => (
          <div className="metric" key={metric.label}>
            <span className="metric__index" aria-hidden="true">0{index + 1}</span>
            <div><strong>{metric.value}<small>{metric.unit}</small></strong><span>{metric.label}</span></div>
          </div>
        ))}
        <div className="hero__date"><span>DATA CHECK</span><strong>{checkedAt}</strong></div>
      </div>
    </section>
  );
}
