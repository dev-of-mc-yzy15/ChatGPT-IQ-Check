import { useEffect, useState } from "react";
import type { RoundCandidate, RoundData, RoundTaskDef } from "../types";
import { assetUrl } from "../lib/asset";
import { fmtDateTime, fmtEffort, fmtMoney, fmtScore, fmtSeconds } from "../lib/format";
import { ModelName } from "./ModelName";

/** 盲评分数是 0–100 制，上屏统一 /100 归一；非有限值保持 "—"，不要落成 NaN。 */
function norm(score: number | null | undefined): string {
  return score == null || !Number.isFinite(score) ? "—" : (score / 100).toFixed(2);
}

/**
 * 动画产物走 `src` 加载，不走 `srcDoc`。
 *
 * 起因：上游产物扩展名是 `.html.txt`，托管按扩展名回 `text/plain`，直接塞 `src` 会让
 * 浏览器把源码当纯文本显示——所以早期只能 fetch 成文本再 `srcDoc`。
 *
 * 但 `srcDoc` 的子文档是**继承父文档 CSP** 的：`index.html` 的 `script-src` 只放行
 * 主题脚本那一个 hash，34 个产物里 23 个靠内联 `<script>` 驱动交互，于是被
 * `script-src-elem` 全部挡掉，线上只剩静帧（产物的 Google Fonts 也被 `style-src` 挡）。
 *
 * 解法是产物按 `.html` 落盘（见 `lib/asset.ts` 的 `localAssetName` 与 `public/assets/`），
 * 托管即回 `text/html`，`src` 可直接加载。`src` 的子文档是独立文档、不继承父 CSP，
 * 产物自己的脚本与样式表都正常生效，而 `sandbox="allow-scripts"` 的隔离一分不减。
 */
function AnimationPlayer({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      // 只放脚本：动画靠内联 script 跑。坚决不加 allow-same-origin——加了同源，沙箱隔离基本失效。
      sandbox="allow-scripts"
      src={src}
      title={title}
      width="100%"
      height={220}
      loading="lazy"
      referrerPolicy="no-referrer"
      style={{ border: "1px solid var(--line)", borderRadius: 8, display: "block", marginTop: 8 }}
    />
  );
}

export function RoundDetail({
  candidate,
  tasks,
  round,
}: {
  candidate: RoundCandidate | null;
  tasks: RoundTaskDef[];
  round?: RoundData["round"];
}) {
  // hooks 必须在 null 分支之前：candidate 由空转有值时不能改变 hook 调用顺序。
  const [assetOpen, setAssetOpen] = useState(false);
  useEffect(() => setAssetOpen(false), [candidate]);
  if (!candidate) return <section className="card muted">选择上方格子查看逐题详情。</section>;
  const byId = new Map(candidate.tasks.map((t) => [t.task_id, t]));
  const animation = candidate.animation;
  // 上游 asset_url 是站点根绝对路径，必须经 assetUrl 换成带 base 的站内路径。
  const animationSrc = assetUrl(animation?.asset_url);
  const checksum = animation?.asset_sha256?.trim() || null;
  return (
    <section className="card" aria-labelledby="round-detail-heading">
      <h2 id="round-detail-heading">
        <ModelName name={candidate.model} /> · {fmtEffort(candidate.effort)} · {fmtScore(candidate.score)}
      </h2>
      {round && (
        <p className="muted">
          开始 {fmtDateTime(round.started_at)} · 完成 {fmtDateTime(round.completed_at)} · 更新{" "}
          {fmtDateTime(round.updated_at)}
        </p>
      )}
      <p className="muted">
        {candidate.score_status === "complete" ? "全部题已评分" : "部分题缺失"} · 用时{" "}
        {fmtSeconds(candidate.totals.seconds)} · 已知成本 {fmtMoney(candidate.totals.cost_usd)}
        {candidate.totals.cost_unknown_tasks > 0 ? `（${candidate.totals.cost_unknown_tasks} 题成本未知）` : ""}
      </p>
      <div className="table-wrap" role="region" aria-label="逐题结果（可横向滚动）" tabIndex={0}>
        <table>
          <caption className="muted">{tasks.length} 题逐项结果</caption>
          <thead>
            <tr>
              <th scope="col">任务</th>
              <th scope="col">状态</th>
              <th scope="col">reward</th>
              <th scope="col">耗时</th>
              <th scope="col">成本</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const row = byId.get(task.id);
              return (
                <tr key={task.id}>
                  <th scope="row">{task.title_zh || task.id}</th>
                  <td>{row?.status ?? "missing"}</td>
                  <td>{row?.reward == null ? "—" : row.reward.toFixed(3)}</td>
                  <td>{fmtSeconds(row?.seconds ?? null)}</td>
                  <td>{fmtMoney(row?.cost_usd ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {animation?.status === "available" ? (
        <div className="card" style={{ marginTop: 12 }}>
          {/* P1-16：原始分一律 /100 归一到 0–1 再上屏，原始值留在括号里可核对，分母写明，避免 24 分被读成 24 分制。 */}
          <h3>动画盲评 · {norm(animation.score)} / 100（原始 {animation.score ?? "—"}）</h3>
          <p className="muted">
            {Object.entries(animation.scores)
              .map(([k, v]) => `${k} ${norm(v)}（${v}）`)
              .join(" · ")}{" "}
            · 分项满分 /100
          </p>
          {animation.reason && <p>{animation.reason}</p>}
          {animationSrc && (
            <>
              {/* 折叠：一轮 34 个候选各有几十 KB 自包含 HTML，展开才取，别让首屏替全部候选买单。 */}
              <details onToggle={(e) => setAssetOpen(e.currentTarget.open)}>
                <summary>播放降智动画（沙箱隔离，展开后加载）</summary>
                {assetOpen && (
                  <AnimationPlayer
                    src={animationSrc}
                    title={`降智动画：${candidate.model} · ${fmtEffort(candidate.effort)}`}
                  />
                )}
              </details>
              {checksum && (
                <p className="muted">
                  校验和 <code title={checksum}>{checksum.slice(0, 8)}</code>…（上游 asset_sha256 前 8 位，
                  可选中复制）
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="muted">动画不可用</p>
      )}
    </section>
  );
}
