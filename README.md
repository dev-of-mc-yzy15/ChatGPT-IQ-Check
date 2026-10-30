# 降智雷达 · ChatGPT IQ Check

把 [CodexRadar](https://codexradar.com/) 公开的 RadarBench 分数做成一个每天自动刷新的静态看板：
模型 × 推理档位矩阵、逐题明细、日桶趋势曲线、降智信号标记。

> **免责声明**
> 本项目是**非官方**项目，与 OpenAI 无任何关联。
> 分数是第三方基准测试分数，**不是心理学 IQ**，也不代表模型的通用能力。
> 数据版权归 codexradar.com 所有。

**部署后**地址（Pages 尚未启用）：<https://dev-of-mc-yzy15.github.io/ChatGPT-IQ-Check/>

---

## 它做什么 / 不做什么

**做**

- 展示 CodexRadar 的 RadarBench 加权分数（0–`score_max`，当前 150）与覆盖率、评分状态。
- 给出「本轮雷达」：模型 × 档位（低 / 中 / 高 / 极高 / 最高 / 极限）的分数矩阵，点开可看逐题得分、耗时、成本。
- 给出「RadarBench 趋势」：按日桶聚合的历史曲线，缺口断开、空心点表示 provisional、红点标出降智信号。
- 顶部新鲜度横幅：数据检查时间、最近评分时间、本轮更新时间，超 48h / 7d 两级告警。
- 深浅色主题、键盘可达（跳过链接 / 焦点样式）、错误边界与空态。

**不做**

- 不自己跑模型评测、不自己算分数——分数与覆盖率都来自上游数据；只有降智标记是前端按上游历史自行判定的，规则见[降智信号判定](#降智信号判定)。
- 没有后端、没有数据库、不存任何密钥。
- 不在浏览器里直连第三方接口——抓取与裁剪都在 GitHub Actions 里完成。

## 技术栈

React 19 · TypeScript 5 · Vite 8 · Vitest 5 · 原生 CSS 变量（无 UI 框架）· 自绘 SVG 图表（无图表库）

Node 版本要求：**>= 24**。

## 目录结构

```
src/
  App.tsx               页面组合：本轮雷达 / 趋势 / 关于 三个 tab
  components/           RoundMatrix RoundDetail CandidateTable TrendChart
                        TrendControls FreshnessBanner ThemeToggle SkipLink ErrorBoundary
  data/loader.ts        拉取 + 校验 public/data/*.json，带超时与错误态
  lib/derive.ts         纯函数：排序 / Δ / 降智点 / 日桶 / 矩阵
  lib/format.ts         格式化：分数、耗时、成本、时间
  lib/useTheme.ts       主题读写与系统偏好跟随
  styles/theme.css      CSS 变量与基础样式
  types.ts              数据契约类型
scripts/
  refresh.mjs           抓取 CLI：拉上游 → 归一化 → 校验 → 原子写入
  lib.mjs               纯函数：上游响应转换、合并、计分（有单测覆盖）
  contract.mjs          双端共用的数据契约校验，管道落盘前与浏览器加载后各跑一次
public/data/
  radar-bench.json      候选分数 + 历史序列
  round.json            本轮逐题明细
  status.json           抓取状态与新鲜度
tests/                  Vitest 单测与组件测试 + fixtures
```

## 数据源

| 用途 | 地址 |
|---|---|
| 候选目录 | `https://codexradar.com/data/radar-bench-binding.json` |
| 单候选分数 + 历史 | `https://codexradar.com/api/radar-bench-score?model=&effort=&view=summary&selection=user-selected-v1` |
| 本轮看板 | `https://codexradar.com/degradation-codex-latest.json` |

不使用的接口（上游已废弃或不可用，留作备忘）：
`/data/intelligence-efficiency.json`（旧 fallback）、`/api/v1/table`（410）、`/api/intelligence-efficiency-metrics`（502）。

全部匿名可拉，**不需要任何密钥**。

## 本地开发

```bash
npm ci
npm run dev        # 开发服务器（base 为 /ChatGPT-IQ-Check/）
npm test           # 跑一遍测试
npm run build      # tsc -b + vite build，产物在 dist/
npm run preview    # 预览构建产物
```

> `vite.config.ts` 里 `base` 固定为 `/ChatGPT-IQ-Check/`，所以本地访问要带上这个前缀：
> <http://localhost:5173/ChatGPT-IQ-Check/>

## 刷新数据

```bash
npm run refresh           # 抓取并写入 public/data/
npm run refresh -- --force  # 内容没变也强制重写（重置时间戳）
```

行为要点：

- 上游三个接口：`radar-bench-binding.json`（候选清单）、`api/radar-bench-score`（单候选分数，并发 4）、`degradation-codex-latest.json`（本轮明细）。
- 最多尝试 3 次（指数退避），仅网络错误与 429 / 5xx 重试，其余 4xx 立即失败；单个候选失败时**回退到上一次已提交的数据**，不写坏数据。
- 成功数低于 `min(候选数, max(30, 候选数 × 80%))`（下限不超过候选总数）时整体失败、退出码 1，不会覆盖已有 JSON。
- 写入是**原子的**（临时文件 + rename），不会出现半截 JSON。
- **幂等**：忽略 `generated_at` / `checked_at` / `fetch_id` 后内容相同就不重写，避免 Actions 里产生空提交。

### 回滚坏数据

如果某次刷新写进了坏数据：**先禁用 `refresh-data` 的 schedule**，再 `git revert` 那个数据 commit 并重新部署。
顺序很重要——不禁用定时任务的话，下一次 cron 会把坏数据再写一遍。

## 部署（GitHub Pages）

三个 workflow：

| 文件 | 触发 | 作用 |
|---|---|---|
| `.github/workflows/ci.yml` | `pull_request` 与手动 `workflow_dispatch` | `npm ci --ignore-scripts` + `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org/` + `npm test` + `npm run build`（build 含 `tsc -b`、`typecheck:scripts`）+ `npm run check:base` + `npm run verify:assets` + `npm run e2e`（真 Chromium，先 `npx playwright install --with-deps chromium`）→ PR 闸门 |
| `.github/workflows/refresh-data.yml` | 每天 UTC 00:30 + 手动 | 跑 `refresh.mjs`，有变化就提交 `public/data/`（带 `[skip ci]`），失败自动开 issue |
| `.github/workflows/deploy.yml` | push 到 main、`refresh-data` 完成后、手动 | `npm ci` + `npm test` + `npm run build` → 上传产物 → 部署 Pages |

> **为什么 refresh 提交后还要靠 `workflow_run` 触发部署？**
> 用 `GITHUB_TOKEN` 推送产生的 `push` 事件**不会**触发其他 workflow（GitHub 的防递归规则），
> 而 commit message 里的 `[skip ci]` 又把 push 触发彻底关掉。
> 所以 deploy 额外监听 `refresh-data` 的 `completed` 事件——这个事件不受防递归规则限制，
> 并且用 `conclusion == 'success'` 门控，刷新失败时不会把旧产物重新部署一遍。

### 首次启用（需手动操作一次）

> **首次 push 之前上面这个地址打不开，是预期行为**：`origin/main` 目前只有一个 `Initial commit`，
> 本地领先 50 多个尚未推送的 commit，Pages 也还没启用。先 push 到 main 并走完下面三步，地址才会有内容。

1. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
2. 确认 **Settings → Actions → General → Workflow permissions** 允许读写（workflow 内已声明最小权限）。
3. 手动跑一次 `refresh-data` workflow 或直接 push 到 main，触发首次部署。

不需要配置任何 secret，用的是默认 `GITHUB_TOKEN`。

## 数据契约

三份 JSON 都由 `scripts/refresh.mjs` 生成，结构由 `scripts/contract.mjs` 校验（前端 loader 加载时复用同一份），前端 `src/types.ts` 与之对应。

### `radar-bench.json`

```jsonc
{
  "schema_version": 1,
  "generated_at": "ISO8601",
  "checked_at": "ISO8601",
  "benchmark": "radar-bench",
  "score_version": "…",
  "score_max": 150,
  "candidates": [
    {
      "model": "gpt-6.1-sol",
      "effort": "high",
      "score": 126.9,
      "coverage": 1.0,
      "required_tasks": 64,
      "score_status": "complete",
      "graded_runs_count": 87,
      "source_scores": { "…": { "score": 0, "coverage": 0, "required_tasks": 0, "graded_runs_count": 0 } },
      "statistics": { "sample_count": 0, "elapsed_ms_mean": null, "api_equivalent_usd_mean": null },
      "latest_graded_at": "ISO8601",
      "history": [
        { "at": "ISO8601", "score": 124.1, "coverage": 1.0,
          "required_tasks": 64, "score_status": "complete" }
      ]
    }
  ]
}
```

### `round.json`

```jsonc
{
  "schema_version": 1,
  "generated_at": "ISO8601",
  "checked_at": "ISO8601",
  "source_schema": "…",
  "round": {
    "id": "…", "status": "…",
    "started_at": "ISO8601", "completed_at": "ISO8601", "updated_at": "ISO8601",
    "taskset_version": "…", "task_count": 64, "timings": {}
  },
  "tasks": [
    { "id": "…", "category": "…", "title_zh": "…", "title_en": "…",
      "weight": 1, "required": true }
  ],
  "candidates": [
    {
      "model": "gpt-6.1-sol", "effort": "high",
      "score": 126.9, "score_max": 150,
      "score_status": "complete",        // complete | partial
      "scored_tasks": 64, "total_tasks": 64,
      "tasks": [
        { "task_id": "…", "status": "…", "reward": 1, "seconds": 12.3, "cost_usd": 0.01 }
      ],
      "totals": { "seconds": 0, "cost_usd": 0, "cost_known_tasks": 0, "cost_unknown_tasks": 0 },
      "animation": null                   // 或 { status, score, scores, reason, seconds, cost_usd, asset_url, asset_sha256 }
    }
  ]
}
```

### `status.json`

```jsonc
{
  "checked_at": "ISO8601",
  "ok": true,
  "benchmark": "radar-bench",
  "candidates_ok": 34,
  "candidates_total": 34,
  "binding_total": 34,          // 上游声明的候选数，含被丢弃的
  "reused_count": 0,            // 抓取失败、回退到旧数据的候选数
  "missing_count": 0,           // 抓取失败且无旧数据、被丢弃的候选数
  "round_ok": true,
  "latest_graded_at": "ISO8601",
  "min_latest": "ISO8601",      // 参与候选里最旧的评分时间
  "stale_count": 0,             // 评分超过 7 天（或时间未知）的候选数
  "round_updated_at": "ISO8601",
  "stale_days": 0,              // null = 上游没给，未知不等于 0
  "errors": []
}
```

### 动画资产：已本地化并渲染

上游给每个候选都配了一段降智动画——自包含 HTML（内联脚本，形如 `/assets/degradation-….html.txt`）。这些产物**不是本项目的代码**：版权归 codexradar.com，见 [NOTICE](./NOTICE)。

- 34 个产物已逐个比对上游 `asset_sha256` 后落在 `public/assets/`，随站点一起发布。**不在浏览器里直接 iframe 上游地址**：上游给的是站点根绝对路径，与 Pages 的 base `/ChatGPT-IQ-Check/` 冲突，直连必然 34/34 全 404。
- 路径由 `src/lib/asset.ts` 的 `assetUrl()` 剥成 basename，再经 `urlFor()` 拼上 base；上游路径前缀一律丢掉。
- 详情页用 `<details>` 折叠，**展开时才取回并注入**，34 个候选不会一起抢首屏带宽。
- 落盘后缀是 `.html.txt`，静态托管按扩展名回 `text/plain`——iframe 直接给 `src` 只会显示源码。所以先 `fetch` 取回文本、再走 `srcDoc`，由浏览器强制按 HTML 解析（产物自包含：内联脚本 + 绝对 URL 字体，无存储 API、无 `top`/`parent` 依赖，适合沙箱）。
- iframe 用 `sandbox="allow-scripts"`，**不要**再加 `allow-same-origin`——动画靠内联 `<script>` 跑，而一旦同源，sandbox 的隔离基本失效。
- 接新批次时：先下载，逐个比对 `asset_sha256`；不等就重抓，仍不等就记进失败清单，别把错文件硬塞进目录。文件名保持上游 basename。
- 详情页同时显示校验和的前 8 位（`<code>` 可选中复制，悬停看全文），方便人肉核对产物与数据是否对得上。

## 降智信号判定

前端只做展示，判定规则写在 `src/lib/derive.ts`：

> 相邻日桶分数下降 **≥ 5 分**，且覆盖率 **≥ 90%**、评分状态为 `complete` → 标记为降智点（红点）。

## 测试

```bash
npm test          # 单次
npm run test:watch
```

覆盖纯函数（排序 / Δ / 日桶 / 矩阵 / 格式化）、loader 的错误态、抓取脚本的转换与去重、以及主要组件的渲染与交互。
fixtures 在 `tests/fixtures/`，是从上游真实响应裁剪出的样本。

## 许可

[AGPL-3.0-or-later](./LICENSE)，第三方数据与商标说明见 [NOTICE](./NOTICE)。

源码仓库：<https://github.com/dev-of-mc-yzy15/ChatGPT-IQ-Check>

`public/data/` 下的数据与 `public/assets/` 下的动画产物均不在本项目 AGPL 再许可范围内，版权归 codexradar.com 所有；本项目仅展示并链接来源。
本项目不保证数据准确性——分数受样本量、覆盖率、任务集版本影响。与 OpenAI 无关联。
