import type { RatingsData } from "../types";
import { fmtDateTime, fmtEffort, fmtScore } from "../lib/format";
import { ModelName } from "./ModelName";

/**
 * 社区体感卡片。
 *
 * 与 RadarBench 分数是两套刻度：1–10 星人工打分 vs 0–150 加权基准分。
 * 这里只做展示，**不参与任何排序或换算** —— 混算会让「体感 8 分」被读成「8/150」，
 * 也会把主观投票混进客观基准的序列里，两个指标都失去可比性。
 */
export function CommunityRatings({ data }: { data: RatingsData }) {
  const rows = data.ratings;
  const total = data.total_slots;
  // 数据时间是上游 updated_at；缺失时退回本地抓取时间，别显示一个破折号了事。
  const updatedAt = data.source_updated_at ?? data.checked_at;
  return (
    <section className="card" aria-labelledby="ratings-heading">
      <h2 id="ratings-heading">社区体感</h2>
      <p className="muted">
        近 {data.window_hours} 小时人工评分（1–10 星）· {rows.length}/{total} 个档位有投票 · 数据更新{" "}
        {fmtDateTime(updatedAt)} · 与 RadarBench 分数不是一套刻度，不参与排序
      </p>
      {rows.length === 0 ? (
        <p className="muted">这个窗口内还没有人打分。</p>
      ) : (
        <div className="table-wrap" role="region" aria-label="社区体感（可横向滚动）" tabIndex={0}>
          <table>
            <caption className="muted">按平均星级降序，同分按票数多的在前；票数 &lt; 3 的分数波动大，已淡化显示</caption>
            <thead>
              <tr>
                <th scope="col">模型</th>
                <th scope="col">档位</th>
                <th scope="col">平均星级</th>
                <th scope="col">票数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                // 1 票打出的 10.0 不该在视觉上与 10 票的 8.4 等重：淡化只是提示样本量，
                // 分数与票数都照常可读，不改变排序（排序仍按 spec 只看平均分）。
                <tr key={row.id} data-low-sample={row.count < 3 ? "true" : undefined}>
                  <th scope="row">
                    <ModelName name={row.model} />
                  </th>
                  <td>{fmtEffort(row.effort)}</td>
                  <td>
                    {/* 条形只是辅助：数值走文本，读屏与色觉障碍都不依赖它。 */}
                    <span className="rating-cell">
                      <span className="rating-bar" aria-hidden="true">
                        <span style={{ width: `${(row.average / 10) * 100}%` }} />
                      </span>
                      <span>{fmtScore(row.average)}</span>
                    </span>
                  </td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
