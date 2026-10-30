# ChatGPT IQ Check（降智雷达）v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个纯前端「降智雷达」静态站：GitHub Actions 每日抓取 CodexRadar 的 RadarBench 逐候选 summary 与 7 题本轮看板，归一化成静态 JSON，GitHub Pages 展示「本轮雷达」与「RadarBench 趋势」。

**Architecture:** 浏览器只读 `public/data/*.json`。Actions 侧 `scripts/refresh.mjs` 先读 `radar-bench-binding.json` 拿到 34 个候选，再并发请求 34 个 `radar-bench-score?view=summary`，同时抓 `degradation-codex-latest.json`；校验、归一化、原子写入 `radar-bench.json` / `round.json` / `status.json`。前端 React + 自绘 SVG 图表，不引入 Recharts。

**Tech Stack:** React 19 + TypeScript 5.9 + Vite 8 + Vitest 5 + Testing Library + jsdom；Node 24 ESM 脚本（零运行时依赖）；GitHub Actions + GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-10-24-chatgpt-iq-radar-design-v2.md`

## Global Constraints

- 主数据源只允许：`https://codexradar.com/data/radar-bench-binding.json`、`https://codexradar.com/api/radar-bench-score?model=&effort=&view=summary&selection=user-selected-v1`、`https://codexradar.com/degradation-codex-latest.json`。
- 禁止请求：`/data/intelligence-efficiency.json`、`/api/v1/table`、`/api/v1/radar-bench`、`/api/intelligence-efficiency-metrics`、`/api/radar-insights`。
- 34 个候选必须逐个请求；并发上限 4；重试 3 次；单次超时 20s。
- 任何校验失败都不得覆盖已有 `public/data/radar-bench.json` / `round.json`。
- 页面文案：分数是「第三方基准测试分数」，不是心理学 IQ；「本轮雷达分」与「RadarBench 分数」分开命名。
- 不自动 push / 开 Pages / 部署；push 与启用 Actions 必须用户本人确认。
- Node `>=24`；TypeScript `target/lib ES2022`；`types` 必须包含 `vite/client`、`vitest/globals`、`node`。
- Vitest include 必须是 `tests/**/*.test.{ts,tsx}`；`setupFiles` 必须加载 jest-dom 与 `matchMedia`/`ResizeObserver` stub。
- 所有时间显示统一 `Asia/Shanghai`，页脚注明「北京时间（UTC+8）」。
- 降智阈值：`delta <= -5`，且 `coverage >= 0.9 * required_tasks`，且 `score_status === "complete"`。

---

## File Structure

```
.gitignore                         Node/构建忽略项
package.json                       依赖与脚本
tsconfig.json                      单一 TS 配置（含 vite.config.ts）
vite.config.ts                     base、React 插件、Vitest 配置
index.html                         meta/OG/内联主题/noscript
src/
  main.tsx                         React 挂载
  App.tsx                          Tab、加载/错误/空态、页脚
  types.ts                         数据契约类型
  styles/theme.css                 变量、响应式、焦点、矩阵、表格
  data/loader.ts                   带超时/校验的静态 JSON 加载
  lib/format.ts                    分数/时间/货币/档位格式化
  lib/derive.ts                    排序/筛选/Δ/降智点/日桶/矩阵
  lib/useTheme.ts                  主题 hook（try/catch storage/matchMedia）
  components/
    ThemeToggle.tsx
    FreshnessBanner.tsx
    RoundMatrix.tsx
    RoundDetail.tsx
    CandidateTable.tsx
    TrendChart.tsx
    TrendControls.tsx
    ErrorBoundary.tsx
    SkipLink.tsx
scripts/
  lib.mjs                          纯转换/校验/评分函数
  refresh.mjs                      CLI：抓取→归一化→校验→原子写入
public/data/
  radar-bench.json                 种子数据（refresh 生成）
  round.json                       种子数据
  status.json                      每次检查状态
tests/
  fixtures/binding.sample.json     实拉裁剪样本
  fixtures/summary.sample.json     实拉裁剪样本
  fixtures/round.sample.json       实拉裁剪样本
  fixtures/README.md               样本来源与抓取日期
  setup.ts                         jest-dom + matchMedia/ResizeObserver
  lib.test.ts                      scripts/lib.mjs
  refresh.test.ts                  scripts/refresh.mjs（mock fetch）
  format.test.ts
  derive.test.ts
  loader.test.ts
  RoundMatrix.test.tsx
  RoundDetail.test.tsx
  CandidateTable.test.tsx
  TrendChart.test.tsx
  FreshnessBanner.test.tsx
  App.test.tsx
  workflows.test.ts                YAML 解析与关键字段断言
.github/workflows/
  refresh-data.yml
  deploy.yml
README.md
NOTICE
```

---

### Task 1: 脚手架、配置、冒烟测试

**Files:**
- Modify: `.gitignore`
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/theme.css`, `tests/setup.ts`, `tests/smoke.test.tsx`

**Interfaces:**
- Produces: `App` default export; `npm run test` / `npm run build` 可用；`tests/setup.ts` 供后续组件测试使用。

- [ ] **Step 1: 更新 `.gitignore`**

在现有 Jekyll 条目后追加：

```gitignore
# Node / Vite
node_modules/
dist/
coverage/
.vite/
*.tsbuildinfo
*.log
.env
.env.*
.worktrees/
```

- [ ] **Step 2: 写 `package.json`**

```json
{
  "name": "chatgpt-iq-check",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "refresh": "node scripts/refresh.mjs"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.2",
    "@testing-library/jest-dom": "^6.9.0",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^24.0.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.9.3",
    "vite": "^8.3.5",
    "vitest": "^5.0.5",
    "yaml": "^2.8.0"
  }
}
```

- [ ] **Step 3: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowJs": true,
    "checkJs": false,
    "types": ["vitest/globals", "vite/client", "node"]
  },
  "include": ["src", "tests", "scripts", "vite.config.ts"]
}
```

- [ ] **Step 4: 写 `vite.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ChatGPT-IQ-Check/",
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
```

- [ ] **Step 5: 写 `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="非官方项目：展示 CodexRadar 公开的 RadarBench 分数、覆盖率与日桶趋势。分数是第三方基准测试分数，不是心理学 IQ。" />
    <meta name="theme-color" content="#ffffff" />
    <meta property="og:title" content="降智雷达 · CodexRadar 分数与趋势" />
    <meta property="og:description" content="本轮雷达 + RadarBench 日桶趋势。非官方项目，与 OpenAI 无关联。" />
    <meta property="og:type" content="website" />
    <title>降智雷达 · CodexRadar 分数与趋势</title>
    <script>
      try {
        var k = "iq-radar-theme";
        var s = localStorage.getItem(k);
        var t = s === "light" || s === "dark" ? s
          : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        document.documentElement.dataset.theme = t;
      } catch (_) {}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <noscript>
      <main>
        <h1>降智雷达</h1>
        <p>本页面需要 JavaScript。数据来源：codexradar.com。非官方项目，与 OpenAI 无关联。</p>
      </main>
    </noscript>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 写 `src/main.tsx`**

```tsx
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 7: 写占位 `src/App.tsx`（Task 11 替换）**

```tsx
export default function App() {
  return (
    <main>
      <h1>降智雷达</h1>
    </main>
  );
}
```

- [ ] **Step 8: 写 `src/styles/theme.css`**

```css
:root {
  --bg: #ffffff;
  --fg: #17181c;
  --muted: #5c6370;
  --card: #f6f7f9;
  --line: #e1e4e8;
  --accent: #1d4ed8;
  --down: #b91c1c;
  --up: #15803d;
  --warn-bg: #fff7e6;
  --warn-fg: #92400e;
  color-scheme: light;
}
[data-theme="dark"] {
  --bg: #0f1115;
  --fg: #e8eaed;
  --muted: #9aa0a6;
  --card: #171a21;
  --line: #2a2f38;
  --accent: #93b4ff;
  --down: #f87171;
  --up: #4ade80;
  --warn-bg: #2b2111;
  --warn-fg: #fbbf24;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.55 "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--accent); }
button { font: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.muted { color: var(--muted); }
.down { color: var(--down); }
.up { color: var(--up); }
.warn { background: var(--warn-bg); color: var(--warn-fg); border-radius: 10px; padding: 10px 12px; }
main { max-width: 1180px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
.skip-link { position: absolute; left: -9999px; }
.skip-link:focus { left: 12px; top: 12px; z-index: 10; background: var(--card); padding: 8px 12px; border-radius: 8px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px 6px; border-top: 1px solid var(--line); text-align: left; }
th button { background: none; border: 0; color: inherit; cursor: pointer; padding: 0; }
@media (max-width: 720px) {
  main { padding: 14px; gap: 14px; }
  .card { padding: 12px; }
}
```

- [ ] **Step 9: 写 `tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 10: 写 `tests/smoke.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import App from "../src/App";

it("renders the app title", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /降智雷达/ })).toBeInTheDocument();
});
```

- [ ] **Step 11: 安装并验证**

Run: `npm install`
Run: `npm run test`
Expected: 1 test PASS
Run: `npx tsc -b`
Expected: exit 0
Run: `npm run build`
Expected: 生成 `dist/`

- [ ] **Step 12: 本地 commit（不 push）**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vite.config.ts index.html src/main.tsx src/App.tsx src/styles/theme.css tests/setup.ts tests/smoke.test.tsx
git commit -m "chore: scaffold React 19 + Vite 8 + Vitest 5 (base=/ChatGPT-IQ-Check/)"
```

---

### Task 2: 类型与脚本纯函数（binding / summary）

**Files:**
- Create: `src/types.ts`, `scripts/lib.mjs`, `tests/fixtures/binding.sample.json`, `tests/fixtures/summary.sample.json`, `tests/fixtures/README.md`, `tests/lib.test.ts`

**Interfaces:**
- Produces: `transformBinding(raw)`, `transformSummary(raw)`, `mergeRadarBench({binding, summaries, generatedAt, checkedAt, fetchId})`, `validateRadarBench(data, opts)`；类型 `RadarBenchData` / `RadarCandidate` / `HistoryPoint`。

- [ ] **Step 1: 写 `src/types.ts`**

```ts
export type ScoreStatus = "complete" | "provisional";
export type RoundScoreStatus = "complete" | "partial";

export interface SourceScore {
  score: number;
  coverage: number;
  required_tasks: number;
  graded_runs_count: number;
}

export interface HistoryPoint {
  at: string;
  score: number;
  coverage: number;
  required_tasks: number;
  score_status: ScoreStatus;
}

export interface RadarCandidate {
  model: string;
  effort: string;
  score: number;
  coverage: number;
  required_tasks: number;
  score_status: ScoreStatus;
  graded_runs_count: number;
  source_scores: Record<string, SourceScore>;
  statistics: {
    sample_count: number;
    elapsed_ms_mean: number | null;
    api_equivalent_usd_mean: number | null;
  };
  latest_graded_at: string | null;
  history: HistoryPoint[];
}

export interface RadarBenchData {
  schema_version: 1;
  fetch_id: string;
  generated_at: string;
  checked_at: string;
  benchmark: string;
  score_version: string;
  score_max: number;
  catalog_version: string;
  task_set_sha256: string;
  candidates: RadarCandidate[];
}

export interface RoundTaskDef {
  id: string;
  category: string;
  title_zh: string;
  title_en: string;
  weight: number;
  required: boolean;
}

export interface RoundTaskResult {
  task_id: string;
  status: string;
  reward: number | null;
  seconds: number | null;
  cost_usd: number | null;
}

export interface RoundAnimation {
  status: string;
  score: number | null;
  scores: Record<string, number>;
  reason: string | null;
  seconds: number | null;
  cost_usd: number | null;
  asset_url: string | null;
}

export interface RoundCandidate {
  model: string;
  effort: string;
  score: number | null;
  score_max: number;
  score_status: RoundScoreStatus;
  scored_tasks: number;
  total_tasks: number;
  tasks: RoundTaskResult[];
  totals: {
    seconds: number;
    cost_usd: number;
    cost_known_tasks: number;
    cost_unknown_tasks: number;
  };
  animation: RoundAnimation | null;
}

export interface RoundData {
  schema_version: 1;
  fetch_id: string;
  generated_at: string;
  checked_at: string;
  source_schema: string;
  round: {
    id: string;
    status: string;
    started_at: string;
    completed_at: string;
    updated_at: string;
    taskset_version: string;
    task_count: number;
    timings: Record<string, number>;
  };
  tasks: RoundTaskDef[];
  candidates: RoundCandidate[];
}

export interface StatusData {
  checked_at: string;
  ok: boolean;
  benchmark: string;
  candidates_ok: number;
  candidates_total: number;
  round_ok: boolean;
  latest_graded_at: string | null;
  round_updated_at: string | null;
  stale_days: number;
  errors: string[];
}
```

- [ ] **Step 2: 写 `tests/fixtures/binding.sample.json`**

```json
{
  "enabled": true,
  "interface_confirmed": true,
  "production_read_verified": true,
  "benchmark": "radar-bench-final64-20261004",
  "catalog_version": "dradar-four-library-deployment007-server024-20261004-config64",
  "task_set_sha256": "f75ff09b6117cd83d3ab6ea744fe379ac117676c042538d5df5e38489af27bc4",
  "total_tasks": 64,
  "total_cells": 320,
  "score_version": "radar-bench-v2-150",
  "score_max": 150,
  "model_efforts": [
    { "model": "gpt-6-astra", "effort": "high" },
    { "model": "gpt-6-astra", "effort": "low" },
    { "model": "gpt-6.1-sol", "effort": "high" }
  ],
  "members": [
    { "source_benchmark": "deepswe15-20261003-v4", "collection_id": "deepswe", "task_id": "igel-persist-feature-schema", "task_content_hash": "74eb5d622e1af229331c3d5664baeb793faff9eebc7992c8727103f120b72f20" }
  ],
  "active_display_selection": { "model": "gpt-6.1-sol", "effort": "low" },
  "public_api_observed_at": "2026-10-04T12:07:35.098713+00:00"
}
```

- [ ] **Step 3: 写 `tests/fixtures/summary.sample.json`**

```json
{
  "schema": "radar-bench-public-summary-v6-150-details",
  "benchmark": "radar-bench-final64-20261004",
  "score_version": "radar-bench-v2-150",
  "score_max": 150,
  "catalog_version": "dradar-four-library-deployment007-server024-20261004-config64",
  "task_set_sha256": "f75ff09b6117cd83d3ab6ea744fe379ac117676c042538d5df5e38489af27bc4",
  "model": "gpt-6-astra",
  "effort": "high",
  "score": 104.56151352837776,
  "coverage": 64,
  "required_tasks": 64,
  "score_status": "complete",
  "graded_runs_count": 101,
  "source_counts": { "deepswe": 15, "pompeii": 16, "tb4": 14, "science": 19 },
  "source_scores": {
    "deepswe": { "score": 105, "coverage": 15, "required_tasks": 15, "graded_runs_count": 21 },
    "pompeii": { "score": 129.183554113511, "coverage": 16, "required_tasks": 16, "graded_runs_count": 22 },
    "tb4": { "score": 101.78571428571429, "coverage": 14, "required_tasks": 14, "graded_runs_count": 16 },
    "science": { "score": 85.52631578947368, "coverage": 19, "required_tasks": 19, "graded_runs_count": 42 }
  },
  "statistics": {
    "sample_count": 101,
    "metrics": {
      "elapsed_ms": { "mean": 835906.3177022804, "total": 84426538.08793032 },
      "api_equivalent_usd": { "mean": 3.5784834059405943, "total": 361.426824 }
    }
  },
  "detail_metrics": {
    "valid_grade_events": 101,
    "latest_graded_at": "2026-10-23T01:19:00.816645Z",
    "as_of": "2026-10-23T17:01:10.589Z",
    "graded_24h": 2,
    "graded_48h": 2
  },
  "history": {
    "schema": "radar-bench-public-history-v1-150-daily",
    "score_version": "radar-bench-v2-150",
    "score_max": 150,
    "model": "gpt-6-astra",
    "effort": "high",
    "time_zone": "UTC",
    "bucket": "day",
    "basis": "last canonical score per UTC grading day; days without grades omitted",
    "updated_bucket": "2026-10-23T00:00:00.000Z",
    "points": [
      { "at": "2026-10-09T00:00:00.000Z", "score": 111.97304941062372, "coverage": 58, "required_tasks": 64, "score_status": "provisional" },
      { "at": "2026-10-17T00:00:00.000Z", "score": 107.33495102837776, "coverage": 64, "required_tasks": 64, "score_status": "complete" },
      { "at": "2026-10-23T00:00:00.000Z", "score": 104.56151352837776, "coverage": 64, "required_tasks": 64, "score_status": "complete" }
    ]
  }
}
```

- [ ] **Step 4: 写 `tests/fixtures/README.md`**

```markdown
# Fixtures

These are trimmed excerpts of live CodexRadar responses, fetched 2026-10-24:

- `binding.sample.json` — `https://codexradar.com/data/radar-bench-binding.json` (trimmed to 3 candidates / 1 member)
- `summary.sample.json` — `https://codexradar.com/api/radar-bench-score?model=gpt-6-astra&effort=high&view=summary&selection=user-selected-v1` (trimmed to 3 history points)
- `round.sample.json` — `https://codexradar.com/degradation-codex-latest.json` (trimmed to 2 candidates / 7 tasks)

Do not invent values; refresh with the URLs above when the upstream schema changes.
```

- [ ] **Step 5: 写失败测试 `tests/lib.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import bindingRaw from "./fixtures/binding.sample.json";
import summaryRaw from "./fixtures/summary.sample.json";
import {
  transformBinding,
  transformSummary,
  mergeRadarBench,
  validateRadarBench,
} from "../scripts/lib.mjs";

describe("transformBinding", () => {
  it("dedupes and keeps model/effort pairs", () => {
    const b = transformBinding(bindingRaw);
    expect(b.candidates).toEqual([
      { model: "gpt-6-astra", effort: "high" },
      { model: "gpt-6-astra", effort: "low" },
      { model: "gpt-6.1-sol", effort: "high" },
    ]);
    expect(b.benchmark).toBe("radar-bench-final64-20261004");
    expect(b.score_max).toBe(150);
  });

  it("throws on empty model_efforts", () => {
    expect(() => transformBinding({ model_efforts: [] })).toThrow(/empty/);
  });
});

describe("transformSummary", () => {
  it("normalizes score, coverage and sorted history", () => {
    const s = transformSummary(summaryRaw);
    expect(s.model).toBe("gpt-6-astra");
    expect(s.effort).toBe("high");
    expect(s.score).toBeCloseTo(104.5615, 4);
    expect(s.coverage).toBe(64);
    expect(s.score_status).toBe("complete");
    expect(s.history).toHaveLength(3);
    expect(s.history[0].at).toBe("2026-10-09T00:00:00.000Z");
    expect(s.history[2].score).toBeCloseTo(104.5615, 4);
  });

  it("throws on invalid score", () => {
    expect(() => transformSummary({ ...summaryRaw, score: "nope" })).toThrow(/invalid score/);
  });
});

describe("mergeRadarBench + validateRadarBench", () => {
  it("merges summaries in binding order", () => {
    const b = transformBinding(bindingRaw);
    const summaries = b.candidates.map((c) => ({
      ...transformSummary(summaryRaw),
      model: c.model,
      effort: c.effort,
    }));
    const data = mergeRadarBench({
      binding: bindingRaw,
      summaries,
      generatedAt: "2026-10-24T00:00:00.000Z",
      checkedAt: "2026-10-24T00:00:00.000Z",
      fetchId: "test-fetch",
    });
    expect(data.candidates.map((c) => c.model + "|" + c.effort)).toEqual([
      "gpt-6-astra|high",
      "gpt-6-astra|low",
      "gpt-6.1-sol|high",
    ]);
    expect(() => validateRadarBench(data, { minCandidates: 3 })).not.toThrow();
    expect(() => validateRadarBench(data, { minCandidates: 30 })).toThrow(/too few/);
  });

  it("throws when a summary is missing", () => {
    const b = transformBinding(bindingRaw);
    const summaries = [transformSummary(summaryRaw)];
    expect(() => mergeRadarBench({
      binding: bindingRaw,
      summaries,
      generatedAt: "2026-10-24T00:00:00.000Z",
      checkedAt: "2026-10-24T00:00:00.000Z",
      fetchId: "test-fetch",
    })).toThrow(/missing summary/);
  });
});
```

- [ ] **Step 6: 运行失败测试**

Run: `npm run test -- lib`
Expected: FAIL（`scripts/lib.mjs` 不存在或未导出）

- [ ] **Step 7: 写 `scripts/lib.mjs`**

```js
export const SCORE_MAX = 150;
export const ROUND_MULTIPLIER = 1.5;

export function transformBinding(raw) {
  const modelEfforts = Array.isArray(raw?.model_efforts) ? raw.model_efforts : [];
  const seen = new Set();
  const candidates = [];
  for (const item of modelEfforts) {
    const model = String(item?.model ?? "").trim();
    const effort = String(item?.effort ?? "").trim();
    if (!model || !effort) continue;
    const key = model + "|" + effort;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ model, effort });
  }
  if (!candidates.length) throw new Error("binding: model_efforts is empty");
  return {
    benchmark: String(raw?.benchmark ?? ""),
    score_version: String(raw?.score_version ?? ""),
    score_max: Number(raw?.score_max ?? SCORE_MAX),
    catalog_version: String(raw?.catalog_version ?? ""),
    task_set_sha256: String(raw?.task_set_sha256 ?? ""),
    candidates,
  };
}

export function transformSummary(raw) {
  if (!raw || typeof raw !== "object") throw new Error("summary: invalid payload");
  const model = String(raw.model ?? "").trim();
  const effort = String(raw.effort ?? "").trim();
  if (!model || !effort) throw new Error("summary: missing model/effort");
  const score = Number(raw.score);
  if (!Number.isFinite(score)) throw new Error("summary: invalid score");
  const points = Array.isArray(raw?.history?.points) ? raw.history.points : [];
  const history = points
    .map((p) => ({
      at: String(p?.at ?? ""),
      score: Number(p?.score),
      coverage: Number(p?.coverage ?? 0),
      required_tasks: Number(p?.required_tasks ?? 0),
      score_status: p?.score_status === "complete" ? "complete" : "provisional",
    }))
    .filter((p) => p.at && Number.isFinite(p.score))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  return {
    model,
    effort,
    score,
    coverage: Number(raw.coverage ?? 0),
    required_tasks: Number(raw.required_tasks ?? 0),
    score_status: raw.score_status === "complete" ? "complete" : "provisional",
    graded_runs_count: Number(raw.graded_runs_count ?? 0),
    source_scores: Object.fromEntries(
      Object.entries(raw.source_scores ?? {}).map(([key, value]) => [
        key,
        {
          score: Number(value?.score ?? 0),
          coverage: Number(value?.coverage ?? 0),
          required_tasks: Number(value?.required_tasks ?? 0),
          graded_runs_count: Number(value?.graded_runs_count ?? 0),
        },
      ]),
    ),
    statistics: {
      sample_count: Number(raw.statistics?.sample_count ?? 0),
      elapsed_ms_mean: Number.isFinite(Number(raw.statistics?.metrics?.elapsed_ms?.mean))
        ? Number(raw.statistics.metrics.elapsed_ms.mean)
        : null,
      api_equivalent_usd_mean: Number.isFinite(Number(raw.statistics?.metrics?.api_equivalent_usd?.mean))
        ? Number(raw.statistics.metrics.api_equivalent_usd.mean)
        : null,
    },
    latest_graded_at: raw.detail_metrics?.latest_graded_at ?? null,
    history,
  };
}

export function mergeRadarBench({ binding, summaries, generatedAt, checkedAt, fetchId }) {
  const b = transformBinding(binding);
  const byKey = new Map(summaries.map((s) => [s.model + "|" + s.effort, s]));
  const candidates = b.candidates.map((c) => {
    const s = byKey.get(c.model + "|" + c.effort);
    if (!s) throw new Error(`missing summary for ${c.model}|${c.effort}`);
    return s;
  });
  return {
    schema_version: 1,
    fetch_id: fetchId,
    generated_at: generatedAt,
    checked_at: checkedAt,
    benchmark: b.benchmark,
    score_version: b.score_version,
    score_max: b.score_max,
    catalog_version: b.catalog_version,
    task_set_sha256: b.task_set_sha256,
    candidates,
  };
}

export function validateRadarBench(data, { minCandidates = 30 } = {}) {
  if (!data || data.schema_version !== 1) throw new Error("radar-bench: bad schema_version");
  if (!Array.isArray(data.candidates) || data.candidates.length < minCandidates) {
    throw new Error("radar-bench: too few candidates");
  }
  const seen = new Set();
  for (const c of data.candidates) {
    const key = c.model + "|" + c.effort;
    if (seen.has(key)) throw new Error("radar-bench: duplicate candidate " + key);
    seen.add(key);
    if (!Number.isFinite(c.score) || c.score < 0 || c.score > 150) {
      throw new Error("radar-bench: bad score for " + key);
    }
    if (!Array.isArray(c.history)) throw new Error("radar-bench: missing history for " + key);
  }
  return data;
}
```

- [ ] **Step 8: 运行通过**

Run: `npm run test -- lib`
Expected: PASS

- [ ] **Step 9: 本地 commit**

```bash
git add src/types.ts scripts/lib.mjs tests/fixtures/binding.sample.json tests/fixtures/summary.sample.json tests/fixtures/README.md tests/lib.test.ts
git commit -m "feat(scripts): binding/summary 归一化与契约校验"
```

---

### Task 3: 本轮雷达转换与评分

**Files:**
- Modify: `scripts/lib.mjs`
- Create: `tests/fixtures/round.sample.json`
- Modify: `tests/lib.test.ts`

**Interfaces:**
- Produces: `computeRoundScore(results, tasks)`, `transformRound(raw)`, `validateRound(data, opts)`。

- [ ] **Step 1: 写 `tests/fixtures/round.sample.json`**

```json
{
  "schema": "degradation-codex-plan/2",
  "taskset": { "version": "codex-set-01c3e200e66b", "status": "selected", "harness": "codex", "task_count": 7 },
  "settings": [
    { "model": "gpt-6-astra", "effort": "high", "availability": { "status": "available", "checked_at": "2026-10-23T08:25:00.590027+00:00", "reason": null, "seconds": 11.41, "cost": { "usd": 0.105898, "kind": "estimated", "source": "usage_pricing", "includes_subagents": true } } }
  ],
  "tasks": [
    { "id": "local-reasoning:candy-cross-shape", "category": "local-reasoning", "title_zh": "糖果十字", "title_en": "Candy cross", "weight": 0.142857, "required": true },
    { "id": "deepswe:anko-typed-variable-bindings", "category": "deepswe", "title_zh": "Anko 类型化变量绑定", "title_en": "Anko typed variable bindings", "weight": 0.142857, "required": true },
    { "id": "deepswe:httpx-streaming-json-iteration", "category": "deepswe", "title_zh": "httpx 流式 JSON 迭代", "title_en": "httpx streaming JSON iteration", "weight": 0.142857, "required": true },
    { "id": "deepswe:ts-pattern-match-each", "category": "deepswe", "title_zh": "ts-pattern 匹配", "title_en": "ts-pattern match each", "weight": 0.142857, "required": true },
    { "id": "pompeii:pompeii-adjacency-rp-042", "category": "pompeii", "title_zh": "庞贝邻接", "title_en": "Pompeii adjacency", "weight": 0.142857, "required": true },
    { "id": "tb4:embedding-drift-monitor", "category": "tb4", "title_zh": "嵌入漂移监控", "title_en": "Embedding drift monitor", "weight": 0.142857, "required": true },
    { "id": "tb4:sound-change-cascade", "category": "tb4", "title_zh": "声音变化级联", "title_en": "Sound change cascade", "weight": 0.142857, "required": true }
  ],
  "judge": { "version": "pelican-fc7412ae540c", "status": "configured_not_run", "model": "gpt-6-astra", "effort": "xhigh", "blind": true, "criteria": [] },
  "round": {
    "id": "codex34x8-20261023T082434Z",
    "status": "completed",
    "started_at": "2026-10-23T08:29:34.263178+00:00",
    "completed_at": "2026-10-23T10:43:22.273210+00:00",
    "updated_at": "2026-10-23T10:43:22.484295+00:00",
    "taskset_version": "codex-set-01c3e200e66b",
    "timings": { "wall_seconds": 8028.01, "verification_wall_seconds": 68.98, "solve_wall_seconds": 7275.25, "animation_wall_seconds": 1394.61, "review_wall_seconds": 3610.12 },
    "results": {
      "gpt-6-astra|high": {
        "local-reasoning:candy-cross-shape": { "status": "scored", "reward": 1, "seconds": 67.823285, "cost": { "usd": 0.093634, "kind": "estimated", "source": "usage_pricing", "includes_subagents": true } },
        "deepswe:anko-typed-variable-bindings": { "status": "scored", "reward": 1, "seconds": 481.619794, "cost": { "usd": 2.155026, "kind": "estimated", "source": "usage_pricing", "includes_subagents": true } },
        "deepswe:httpx-streaming-json-iteration": { "status": "scored", "reward": 1, "seconds": 837.107355, "cost": { "usd": 4.297338, "kind": "estimated", "source": "usage_pricing", "includes_subagents": true } },
        "deepswe:ts-pattern-match-each": { "status": "scored", "reward": 0, "seconds": 566.039652, "cost": { "usd": null, "kind": "unknown", "source": null, "includes_subagents": null } },
        "pompeii:pompeii-adjacency-rp-042": { "status": "scored", "reward": 0.9166666666666666, "seconds": 1171.03283, "cost": { "usd": 2.545178, "kind": "estimated", "source": "usage_pricing", "includes_subagents": true } },
        "tb4:embedding-drift-monitor": { "status": "scored", "reward": 1, "seconds": 530.850551, "cost": { "usd": null, "kind": "unknown", "source": null, "includes_subagents": null } },
        "tb4:sound-change-cascade": { "status": "scored", "reward": 1, "seconds": 632.868796, "cost": { "usd": 1.324404, "kind": "estimated", "source": "usage_pricing", "includes_subagents": true } }
      },
      "gpt-6-astra|low": {
        "local-reasoning:candy-cross-shape": { "status": "scored", "reward": 1, "seconds": 77.72, "cost": { "usd": 0.13719 } },
        "deepswe:anko-typed-variable-bindings": { "status": "scored", "reward": 0, "seconds": 285.34, "cost": { "usd": 1.222488 } },
        "deepswe:httpx-streaming-json-iteration": { "status": "scored", "reward": 1, "seconds": 322.75, "cost": { "usd": 1.23913 } },
        "deepswe:ts-pattern-match-each": { "status": "scored", "reward": 0, "seconds": 361.01, "cost": { "usd": 1.203306 } },
        "pompeii:pompeii-adjacency-rp-042": { "status": "scored", "reward": 0.9629629629629629, "seconds": 1065.34, "cost": { "usd": 1.792094 } },
        "tb4:embedding-drift-monitor": { "status": "scored", "reward": 1, "seconds": 227.8, "cost": { "usd": 0.845306 } },
        "tb4:sound-change-cascade": { "status": "scored", "reward": 1, "seconds": 666.35, "cost": { "usd": 1.99429 } }
      }
    },
    "animations": {
      "gpt-6-astra|high": {
        "status": "available",
        "seconds": 400.36,
        "cost": { "usd": 0.840332, "kind": "estimated", "source": "usage_pricing", "includes_subagents": true },
        "judge": { "status": "scored", "version": "pelican-fc7412ae540c", "total": 91, "scores": { "pelican": 24, "cycling": 23, "motion": 25, "finish": 19 }, "reason": "长喙、喉囊与体态使鹈鹕辨识清楚。", "defects": [], "seconds": 38.37, "cost": { "usd": 0.114864 } },
        "asset": { "url": "/assets/example.html.txt", "bytes": 19605, "sha256": "7b979b4febfe", "download": "gpt-6-astra-high-pelican.html" }
      }
    }
  },
  "animation_task": { "id": "pelican-bicycle-html-svg", "title_zh": "鹈鹕骑车动画", "title_en": "Cycling pelican animation", "content_sha256": "d1d1d34e" }
}
```

- [ ] **Step 2: 追加失败测试到 `tests/lib.test.ts`**

```ts
import roundRaw from "./fixtures/round.sample.json";
import { computeRoundScore, transformRound, validateRound } from "../scripts/lib.mjs";

describe("computeRoundScore", () => {
  const tasks = roundRaw.tasks;
  it("computes 100 * mean(reward) * 1.5", () => {
    const r = computeRoundScore(roundRaw.round.results["gpt-6-astra|high"], tasks);
    expect(r.score).toBeCloseTo(126.8, 1);
    expect(r.scored_tasks).toBe(7);
    expect(r.status).toBe("complete");
  });
  it("returns partial when a task is missing", () => {
    const partial = { ...roundRaw.round.results["gpt-6-astra|high"] };
    delete (partial as Record<string, unknown>)["tb4:sound-change-cascade"];
    const r = computeRoundScore(partial, tasks);
    expect(r.status).toBe("partial");
    expect(r.scored_tasks).toBe(6);
  });
  it("returns null score when nothing is scored", () => {
    const r = computeRoundScore({}, tasks);
    expect(r.score).toBeNull();
    expect(r.status).toBe("partial");
  });
});

describe("transformRound", () => {
  it("normalizes tasks, candidates, totals and animation", () => {
    const r = transformRound(roundRaw);
    expect(r.tasks).toHaveLength(7);
    expect(r.candidates).toHaveLength(2);
    const high = r.candidates.find((c) => c.effort === "high")!;
    expect(high.score).toBeCloseTo(126.8, 1);
    expect(high.tasks).toHaveLength(7);
    expect(high.totals.cost_unknown_tasks).toBe(2);
    expect(high.animation?.score).toBe(91);
    expect(high.animation?.scores.pelican).toBe(24);
  });
  it("validates schema and task count", () => {
    const r = { schema_version: 1, ...transformRound(roundRaw) };
    expect(() => validateRound(r, { minCandidates: 2 })).not.toThrow();
    expect(() => validateRound({ ...r, tasks: [] }, { minCandidates: 2 })).toThrow(/7 tasks/);
  });
});
```

- [ ] **Step 3: 运行失败测试**

Run: `npm run test -- lib`
Expected: FAIL（`computeRoundScore` / `transformRound` 未导出）

- [ ] **Step 4: 在 `scripts/lib.mjs` 末尾追加实现**

```js
export function computeRoundScore(results, tasks) {
  const rewards = [];
  let scored = 0;
  for (const task of tasks) {
    const r = results?.[task.id];
    if (r && r.status === "scored" && Number.isFinite(Number(r.reward))) {
      rewards.push(Number(r.reward));
      scored++;
    }
  }
  if (!rewards.length) {
    return { score: null, scored_tasks: 0, total_tasks: tasks.length, status: "partial" };
  }
  const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  return {
    score: Math.round(100 * mean * ROUND_MULTIPLIER * 10) / 10,
    scored_tasks: scored,
    total_tasks: tasks.length,
    status: scored === tasks.length ? "complete" : "partial",
  };
}

export function transformRound(raw) {
  const tasks = Array.isArray(raw?.tasks)
    ? raw.tasks
        .map((t) => ({
          id: String(t?.id ?? ""),
          category: String(t?.category ?? ""),
          title_zh: String(t?.title_zh ?? ""),
          title_en: String(t?.title_en ?? ""),
          weight: Number(t?.weight ?? 0),
          required: Boolean(t?.required),
        }))
        .filter((t) => t.id)
    : [];
  if (tasks.length !== 7) throw new Error("round: expected 7 tasks, got " + tasks.length);
  const results = raw?.round?.results ?? {};
  const animations = raw?.round?.animations ?? {};
  const candidates = Object.entries(results).map(([key, taskResults]) => {
    const [model, effort] = key.split("|");
    const score = computeRoundScore(taskResults, tasks);
    const taskRows = tasks.map((t) => {
      const r = taskResults?.[t.id] ?? {};
      return {
        task_id: t.id,
        status: String(r.status ?? "missing"),
        reward: Number.isFinite(Number(r.reward)) ? Number(r.reward) : null,
        seconds: Number.isFinite(Number(r.seconds)) ? Number(r.seconds) : null,
        cost_usd: Number.isFinite(Number(r.cost?.usd)) ? Number(r.cost.usd) : null,
      };
    });
    const totals = taskRows.reduce(
      (acc, t) => {
        if (t.seconds != null) acc.seconds += t.seconds;
        if (t.cost_usd != null) {
          acc.cost_usd += t.cost_usd;
          acc.cost_known_tasks++;
        } else {
          acc.cost_unknown_tasks++;
        }
        return acc;
      },
      { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 },
    );
    const a = animations[key];
    const animation = a
      ? {
          status: String(a.status ?? "missing"),
          score: Number.isFinite(Number(a.judge?.total)) ? Number(a.judge.total) : null,
          scores: a.judge?.scores ?? {},
          reason: a.judge?.reason ?? null,
          seconds: Number.isFinite(Number(a.seconds)) ? Number(a.seconds) : null,
          cost_usd: Number.isFinite(Number(a.cost?.usd)) ? Number(a.cost.usd) : null,
          asset_url: a.asset?.url ?? null,
        }
      : null;
    return {
      model,
      effort,
      score: score.score,
      score_max: SCORE_MAX,
      score_status: score.status,
      scored_tasks: score.scored_tasks,
      total_tasks: score.total_tasks,
      tasks: taskRows,
      totals,
      animation,
    };
  });
  if (!candidates.length) throw new Error("round: no candidates");
  return {
    source_schema: String(raw?.schema ?? ""),
    round: {
      id: String(raw?.round?.id ?? ""),
      status: String(raw?.round?.status ?? ""),
      started_at: String(raw?.round?.started_at ?? ""),
      completed_at: String(raw?.round?.completed_at ?? ""),
      updated_at: String(raw?.round?.updated_at ?? ""),
      taskset_version: String(raw?.round?.taskset_version ?? ""),
      task_count: Number(raw?.round?.task_count ?? tasks.length),
      timings: raw?.round?.timings ?? {},
    },
    tasks,
    candidates,
  };
}

export function validateRound(data, { minCandidates = 30 } = {}) {
  if (!data || data.schema_version !== 1) throw new Error("round: bad schema_version");
  if (!data.round || !data.round.updated_at) throw new Error("round: missing updated_at");
  if (!Array.isArray(data.tasks) || data.tasks.length !== 7) throw new Error("round: expected 7 tasks");
  if (!Array.isArray(data.candidates) || data.candidates.length < minCandidates) {
    throw new Error("round: too few candidates");
  }
  return data;
}
```

- [ ] **Step 5: 运行通过**

Run: `npm run test -- lib`
Expected: PASS

- [ ] **Step 6: 本地 commit**

```bash
git add scripts/lib.mjs tests/fixtures/round.sample.json tests/lib.test.ts
git commit -m "feat(scripts): 本轮雷达转换、评分与校验"
```

---

### Task 4: 刷新 CLI（抓取 → 校验 → 原子写入）

**Files:**
- Create: `scripts/refresh.mjs`, `tests/refresh.test.ts`
- Create after local run: `public/data/radar-bench.json`, `public/data/round.json`, `public/data/status.json`

**Interfaces:**
- Produces: `fetchJson(url, opts, fetchImpl)`, `mapLimit(items, limit, fn)`, `summaryUrl(model, effort)`, `refreshAll(opts)`；CLI `npm run refresh`。

- [ ] **Step 1: 写失败测试 `tests/refresh.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summaryUrl, refreshAll } from "../scripts/refresh.mjs";
import bindingRaw from "./fixtures/binding.sample.json";
import summaryRaw from "./fixtures/summary.sample.json";
import roundRaw from "./fixtures/round.sample.json";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("summaryUrl", () => {
  it("builds the required query", () => {
    const url = summaryUrl("gpt-6-astra", "high");
    expect(url).toContain("model=gpt-6-astra");
    expect(url).toContain("effort=high");
    expect(url).toContain("view=summary");
    expect(url).toContain("selection=user-selected-v1");
  });
});

describe("refreshAll", () => {
  it("writes radar-bench, round and status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) {
        const u = new URL(url);
        return jsonResponse({ ...summaryRaw, model: u.searchParams.get("model"), effort: u.searchParams.get("effort") });
      }
      if (url.includes("degradation-codex-latest")) return jsonResponse(roundRaw);
      throw new Error("unexpected url " + url);
    });
    const result = await refreshAll({ fetchImpl: fetchImpl as unknown as typeof fetch, outDir: dir, now: () => new Date("2026-10-24T00:00:00Z"), minRadarCandidates: 3, minRoundCandidates: 2 });
    expect(result.radarBench.candidates).toHaveLength(3);
    expect(result.round.candidates).toHaveLength(2);
    const status = JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
    expect(status.ok).toBe(true);
    expect(status.candidates_ok).toBe(3);
  });

  it("throws when too few summaries succeed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "iq-refresh-"));
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("radar-bench-binding")) return jsonResponse(bindingRaw);
      if (url.includes("radar-bench-score")) throw new Error("boom");
      return jsonResponse(roundRaw);
    });
    await expect(refreshAll({ fetchImpl: fetchImpl as unknown as typeof fetch, outDir: dir, now: () => new Date("2026-10-24T00:00:00Z"), minRadarCandidates: 3, minRoundCandidates: 2 })).rejects.toThrow(/summaries/);
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm run test -- refresh`
Expected: FAIL（`scripts/refresh.mjs` 不存在）

- [ ] **Step 3: 写 `scripts/refresh.mjs`**

```js
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  transformBinding,
  transformSummary,
  transformRound,
  mergeRadarBench,
  validateRadarBench,
  validateRound,
} from "./lib.mjs";

export const BINDING_URL = "https://codexradar.com/data/radar-bench-binding.json";
export const SUMMARY_URL = "https://codexradar.com/api/radar-bench-score";
export const ROUND_URL = "https://codexradar.com/degradation-codex-latest.json";
const DATA_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

export async function fetchJson(url, { tries = 3, timeoutMs = 20000, headers = {} } = {}, fetchImpl = fetch) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: ctrl.signal,
        headers: { "user-agent": "iq-radar/2.0", accept: "application/json", ...headers },
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.json();
    } catch (error) {
      const retryable =
        !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
      if (!retryable || i === tries - 1) throw error;
      await new Promise((r) => setTimeout(r, 2 ** i * 1000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("unreachable");
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function summaryUrl(model, effort) {
  const query = new URLSearchParams({
    model,
    effort,
    view: "summary",
    selection: "user-selected-v1",
  });
  return `${SUMMARY_URL}?${query.toString()}`;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function stripVolatile(data) {
  if (!data || typeof data !== "object") return data;
  const copy = { ...data };
  delete copy.checked_at;
  delete copy.generated_at;
  delete copy.fetch_id;
  return copy;
}

function contentEqual(a, b) {
  return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
}

async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

function maxLatest(summaries) {
  return summaries
    .map((s) => s.latest_graded_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function staleDays(iso, now) {
  if (!iso) return null;
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

export async function refreshAll({
  fetchImpl = fetch,
  outDir = DATA_DIR,
  now = () => new Date(),
  force = false,
  minRadarCandidates,
  minRoundCandidates,
} = {}) {
  const bindingRaw = await fetchJson(BINDING_URL, {}, fetchImpl);
  const binding = transformBinding(bindingRaw);
  const oldRadar = await readJsonIfExists(join(outDir, "radar-bench.json"));
  const oldByKey = new Map((oldRadar?.candidates ?? []).map((c) => [c.model + "|" + c.effort, c]));
  const errors = [];

  const summaries = await mapLimit(binding.candidates, 4, async (candidate) => {
    const key = candidate.model + "|" + candidate.effort;
    try {
      const raw = await fetchJson(
        summaryUrl(candidate.model, candidate.effort),
        { headers: { "x-radar-bench-selection": "user-selected-v1" } },
        fetchImpl,
      );
      return transformSummary(raw);
    } catch (error) {
      const old = oldByKey.get(key);
      if (old) {
        errors.push(`${key}: reused previous data (${error.message})`);
        return old;
      }
      errors.push(`${key}: ${error.message}`);
      throw error;
    }
  });

  const freshCount = summaries.filter((s) => !errors.some((e) => e.startsWith(s.model + "|" + s.effort + ":"))).length;
  const minimum = minRadarCandidates ?? Math.max(30, Math.ceil(binding.candidates.length * 0.8));
  if (freshCount < minimum) {
    throw new Error(`only ${freshCount}/${binding.candidates.length} summaries succeeded (minimum ${minimum})`);
  }

  const roundRaw = await fetchJson(ROUND_URL, {}, fetchImpl);
  const round = transformRound(roundRaw);
  const stamp = now().toISOString();
  const fetchId = randomUUID();

  const radarBench = mergeRadarBench({
    binding: bindingRaw,
    summaries,
    generatedAt: stamp,
    checkedAt: stamp,
    fetchId,
  });
  validateRadarBench(radarBench, { minCandidates: minimum });

  const roundData = {
    schema_version: 1,
    fetch_id: fetchId,
    generated_at: stamp,
    checked_at: stamp,
    ...round,
  };
  validateRound(roundData, { minCandidates: minRoundCandidates ?? 30 });

  const latestStale = staleDays(maxLatest(summaries), now()) ?? 0;
  const roundStale = staleDays(roundData.round.updated_at, now()) ?? 0;
  const status = {
    checked_at: stamp,
    ok: true,
    benchmark: radarBench.benchmark,
    candidates_ok: freshCount,
    candidates_total: binding.candidates.length,
    round_ok: true,
    latest_graded_at: maxLatest(summaries),
    round_updated_at: roundData.round.updated_at,
    stale_days: Math.max(latestStale, roundStale),
    errors,
  };

  let radarChanged = true;
  let roundChanged = true;
  if (!force) {
    const oldRound = await readJsonIfExists(join(outDir, "round.json"));
    if (oldRadar && contentEqual(oldRadar, radarBench)) {
      radarBench.generated_at = oldRadar.generated_at;
      radarBench.checked_at = oldRadar.checked_at;
      radarBench.fetch_id = oldRadar.fetch_id;
      radarChanged = false;
    }
    if (oldRound && contentEqual(oldRound, roundData)) {
      roundData.generated_at = oldRound.generated_at;
      roundData.checked_at = oldRound.checked_at;
      roundData.fetch_id = oldRound.fetch_id;
      roundChanged = false;
    }
  }

  if (radarChanged) await writeJson(join(outDir, "radar-bench.json"), radarBench);
  if (roundChanged) await writeJson(join(outDir, "round.json"), roundData);
  await writeJson(join(outDir, "status.json"), status);
  return { radarBench, round: roundData, status };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await refreshAll({ force: args.has("--force") });
  console.log(
    `wrote ${result.radarBench.candidates.length} candidates, ${result.round.candidates.length} round candidates`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: 运行通过**

Run: `npm run test -- refresh`
Expected: PASS

- [ ] **Step 5: 本地实跑生成种子数据（需联网）**

Run: `npm run refresh`
Expected: 打印 `wrote 34 candidates, 34 round candidates`；生成 `public/data/radar-bench.json`、`round.json`、`status.json`。
若上游偶发失败：脚本会重试；仍失败则保留旧数据，不提交坏数据。

- [ ] **Step 6: 人肉校验契约**

Run:

```bash
node -e "const d=require('./public/data/radar-bench.json');console.log(d.candidates.length, d.candidates[0])"
node -e "const d=require('./public/data/round.json');console.log(d.candidates.length, d.candidates[0].score)"
node -e "const d=require('./public/data/status.json');console.log(d)"
```

Expected: `34`；候选含 `score/coverage/score_status/history`；status `ok=true`。

- [ ] **Step 7: 本地 commit**

```bash
git add scripts/refresh.mjs tests/refresh.test.ts public/data/radar-bench.json public/data/round.json public/data/status.json
git commit -m "feat(scripts): refresh CLI 抓取 binding+summary+round, 校验与原子写入"
```

---

### Task 5: 前端 Loader（超时 + 校验）

**Files:**
- Create: `src/data/loader.ts`, `tests/loader.test.ts`

**Interfaces:**
- Consumes: `RadarBenchData` / `RoundData` / `StatusData` from `src/types.ts`。
- Produces: `urlFor(rel, base?)`, `loadRadarBench()`, `loadRound()`, `loadStatus()`, `loadAll()`。

- [ ] **Step 1: 写失败测试 `tests/loader.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadRadarBench, loadRound, urlFor } from "../src/data/loader";

afterEach(() => vi.unstubAllGlobals());

describe("urlFor", () => {
  it("joins base and relative path", () => {
    expect(urlFor("data/radar-bench.json", "/ChatGPT-IQ-Check/")).toBe(
      "/ChatGPT-IQ-Check/data/radar-bench.json",
    );
    expect(urlFor("data/radar-bench.json", "/")).toBe("/data/radar-bench.json");
  });
});

describe("loader", () => {
  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    await expect(loadRadarBench()).rejects.toThrow(/500/);
  });

  it("throws on malformed radar-bench payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    await expect(loadRadarBench()).rejects.toThrow(/结构异常/);
  });

  it("throws on malformed round payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    await expect(loadRound()).rejects.toThrow(/结构异常/);
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm run test -- loader`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 `src/data/loader.ts`**

```ts
import type { RadarBenchData, RoundData, StatusData } from "../types";

export function urlFor(rel: string, base = import.meta.env.BASE_URL || "/"): string {
  return base.endsWith("/") ? base + rel : base + "/" + rel;
}

async function getJson<T>(rel: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlFor(rel), {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`加载 ${rel} 失败：HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function validateRadarBench(data: RadarBenchData): void {
  if (!data || data.schema_version !== 1 || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new Error("radar-bench.json 结构异常");
  }
}

export function validateRound(data: RoundData): void {
  if (!data || data.schema_version !== 1 || !data.round || !Array.isArray(data.candidates) || data.candidates.length === 0) {
    throw new Error("round.json 结构异常");
  }
}

export async function loadRadarBench(): Promise<RadarBenchData> {
  const data = await getJson<RadarBenchData>("data/radar-bench.json");
  validateRadarBench(data);
  return data;
}

export async function loadRound(): Promise<RoundData> {
  const data = await getJson<RoundData>("data/round.json");
  validateRound(data);
  return data;
}

export const loadStatus = () => getJson<StatusData>("data/status.json");

export async function loadAll(): Promise<{
  radarBench: RadarBenchData;
  round: RoundData;
  status: StatusData;
}> {
  const [radarBench, round, status] = await Promise.all([
    loadRadarBench(),
    loadRound(),
    loadStatus(),
  ]);
  return { radarBench, round, status };
}
```

- [ ] **Step 4: 运行通过**

Run: `npm run test -- loader`
Expected: PASS

- [ ] **Step 5: 本地 commit**

```bash
git add src/data/loader.ts tests/loader.test.ts
git commit -m "feat(src): 静态 JSON loader (超时/校验/错误态)"
```

---

### Task 6: 格式化与派生纯函数

**Files:**
- Create: `src/lib/format.ts`, `src/lib/derive.ts`, `tests/format.test.ts`, `tests/derive.test.ts`

**Interfaces:**
- Produces: `fmtScore`, `fmtDelta`, `fmtMoney`, `fmtPercent`, `fmtSeconds`, `fmtDateTime`, `fmtRelativeTime`, `fmtEffort`；`sortCandidates`, `computeDelta`, `findDegradationPoints`, `topCandidates`, `buildDailyGrid`, `roundMatrix`。

- [ ] **Step 1: 写失败测试 `tests/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  fmtScore, fmtDelta, fmtMoney, fmtPercent, fmtSeconds, fmtDateTime, fmtRelativeTime, fmtEffort,
} from "../src/lib/format";

describe("format", () => {
  it("formats numbers with null safety", () => {
    expect(fmtScore(104.56)).toBe("104.6");
    expect(fmtScore(null)).toBe("—");
    expect(fmtDelta(-4.2)).toBe("-4.2");
    expect(fmtDelta(2.4)).toBe("+2.4");
    expect(fmtMoney(3.5785)).toBe("$3.58");
    expect(fmtPercent(0.7357)).toBe("74%");
    expect(fmtSeconds(835.9)).toBe("13 分 56 秒");
    expect(fmtSeconds(42)).toBe("42 秒");
  });
  it("formats Beijing time and relative time", () => {
    expect(fmtDateTime("2026-10-23T10:43:22Z")).toBe("2026-10-23 18:43");
    const now = new Date("2026-10-24T00:00:00Z").getTime();
    expect(fmtRelativeTime("2026-10-23T23:30:00Z", now)).toBe("30 分钟前");
    expect(fmtRelativeTime("2026-10-25T00:00:00Z", now)).toBe("时间异常");
  });
  it("formats effort labels", () => {
    expect(fmtEffort("low")).toBe("低");
    expect(fmtEffort("xhigh")).toBe("极高");
    expect(fmtEffort("unknown")).toBe("UNKNOWN");
    expect(fmtEffort(null)).toBe("—");
  });
});
```

- [ ] **Step 2: 写失败测试 `tests/derive.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  sortCandidates, computeDelta, findDegradationPoints, topCandidates, buildDailyGrid, roundMatrix,
} from "../src/lib/derive";
import type { HistoryPoint, RadarCandidate, RoundData } from "../src/types";

const mk = (o: Partial<RadarCandidate>): RadarCandidate => ({
  model: "m", effort: "high", score: 100, coverage: 64, required_tasks: 64,
  score_status: "complete", graded_runs_count: 10,
  source_scores: {}, statistics: { sample_count: 10, elapsed_ms_mean: 1000, api_equivalent_usd_mean: 1 },
  latest_graded_at: "2026-10-23T00:00:00Z", history: [], ...o,
});

const hp = (at: string, score: number, status: "complete" | "provisional" = "complete"): HistoryPoint => ({
  at, score, coverage: 64, required_tasks: 64, score_status: status,
});

describe("sortCandidates", () => {
  it("sorts by score desc and keeps nulls last", () => {
    const rows = [mk({ score: 90 }), mk({ score: 110 }), mk({ score: 0 })];
    expect(sortCandidates(rows, "score", "desc").map((r) => r.score)).toEqual([110, 90, 0]);
  });
  it("sorts effort by reasoning order", () => {
    const rows = [mk({ effort: "ultra" }), mk({ effort: "low" }), mk({ effort: "high" })];
    expect(sortCandidates(rows, "effort", "asc").map((r) => r.effort)).toEqual(["low", "high", "ultra"]);
  });
});

describe("computeDelta / findDegradationPoints", () => {
  it("computes delta and window days", () => {
    const h = [hp("2026-10-17T00:00:00Z", 107.33), hp("2026-10-23T00:00:00Z", 104.56)];
    expect(computeDelta(h)).toEqual({ delta: -2.8, days: 6 });
  });
  it("marks a degradation point only when complete and covered", () => {
    const h = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100)];
    expect(findDegradationPoints(h)).toHaveLength(1);
    const provisional = [hp("2026-10-17T00:00:00Z", 110), hp("2026-10-23T00:00:00Z", 100, "provisional")];
    expect(findDegradationPoints(provisional)).toHaveLength(0);
  });
});

describe("topCandidates", () => {
  it("picks complete candidates by score, then recency", () => {
    const rows = [
      mk({ model: "A", score: 110, score_status: "complete" }),
      mk({ model: "B", score: 120, score_status: "provisional" }),
      mk({ model: "C", score: 105, score_status: "complete" }),
    ];
    expect(topCandidates(rows, 2).map((r) => r.model)).toEqual(["A", "C"]);
  });
});

describe("buildDailyGrid", () => {
  it("fills missing days with null", () => {
    const grid = buildDailyGrid([hp("2026-10-20T00:00:00Z", 100), hp("2026-10-22T00:00:00Z", 90)]);
    expect(grid.map((p) => p.score)).toEqual([100, null, 90]);
  });
});

describe("roundMatrix", () => {
  it("builds model/effort matrix and missing cells", () => {
    const round = {
      candidates: [
        { model: "A", effort: "low", score: 10 },
        { model: "A", effort: "high", score: 20 },
        { model: "B", effort: "low", score: 30 },
      ],
    } as unknown as RoundData;
    const m = roundMatrix(round);
    expect(m.models).toEqual(["A", "B"]);
    expect(m.efforts).toEqual(["low", "high"]);
    expect(m.cells.get("A|high")?.score).toBe(20);
    expect(m.cells.get("B|high")).toBeUndefined();
  });
});
```

- [ ] **Step 3: 运行失败测试**

Run: `npm run test -- format derive`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 写 `src/lib/format.ts`**

```ts
const DASH = "—";

export const fmtScore = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : n.toFixed(1);

export const fmtDelta = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

export const fmtMoney = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `$${n.toFixed(2)}`;

export const fmtPercent = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? DASH : `${Math.round(n * 100)}%`;

export function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return DASH;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function fmtRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return DASH;
  const diff = now - time;
  if (diff < 0) return "时间异常";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export const EFFORT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "极限",
};

export const fmtEffort = (effort: string | null | undefined): string =>
  effort ? EFFORT_LABELS[effort] ?? effort.toUpperCase() : DASH;
```

- [ ] **Step 5: 写 `src/lib/derive.ts`**

```ts
import type { HistoryPoint, RadarCandidate, RoundCandidate, RoundData } from "../types";

export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];
export type SortKey = "model" | "effort" | "score" | "coverage" | "graded_runs_count" | "latest_graded_at";

export function sortCandidates(rows: RadarCandidate[], key: SortKey, dir: "asc" | "desc"): RadarCandidate[] {
  return [...rows].sort((a, b) => {
    if (key === "effort") {
      const order = EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort);
      return dir === "asc" ? order : -order;
    }
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(String(bv), "en") : Number(av) - Number(bv);
    return dir === "asc" ? cmp : -cmp;
  });
}

export function computeDelta(history: HistoryPoint[]): { delta: number | null; days: number | null } {
  if (!history || history.length < 2) return { delta: null, days: null };
  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  const days = Math.round((new Date(current.at).getTime() - new Date(previous.at).getTime()) / 86400000);
  return { delta: Math.round((current.score - previous.score) * 10) / 10, days };
}

export const DEGRADE_THRESHOLD = -5;
export const MIN_COVERAGE_RATIO = 0.9;

export function findDegradationPoints(
  history: HistoryPoint[],
): { point: HistoryPoint; delta: number; days: number }[] {
  const out: { point: HistoryPoint; delta: number; days: number }[] = [];
  for (let i = 1; i < history.length; i++) {
    const current = history[i];
    const previous = history[i - 1];
    const delta = current.score - previous.score;
    if (delta > DEGRADE_THRESHOLD) continue;
    if (current.score_status !== "complete") continue;
    if (current.coverage < current.required_tasks * MIN_COVERAGE_RATIO) continue;
    const days = Math.round((new Date(current.at).getTime() - new Date(previous.at).getTime()) / 86400000);
    out.push({ point: current, delta: Math.round(delta * 10) / 10, days });
  }
  return out;
}

export function topCandidates(rows: RadarCandidate[], n = 6): RadarCandidate[] {
  return [...rows]
    .filter((r) => r.score_status === "complete")
    .sort((a, b) => b.score - a.score || (b.latest_graded_at ?? "").localeCompare(a.latest_graded_at ?? ""))
    .slice(0, n);
}

export function buildDailyGrid(history: HistoryPoint[]): { at: string; score: number | null }[] {
  if (!history.length) return [];
  const start = new Date(history[0].at);
  const end = new Date(history[history.length - 1].at);
  const byDay = new Map(history.map((p) => [p.at.slice(0, 10), p.score]));
  const out: { at: string; score: number | null }[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ at: key + "T00:00:00.000Z", score: byDay.get(key) ?? null });
  }
  return out;
}

export function roundMatrix(round: RoundData): {
  models: string[];
  efforts: string[];
  cells: Map<string, RoundCandidate>;
} {
  const models = [...new Set(round.candidates.map((c) => c.model))];
  const efforts = EFFORT_ORDER.filter((e) => round.candidates.some((c) => c.effort === e));
  const cells = new Map(round.candidates.map((c) => [c.model + "|" + c.effort, c]));
  return { models, efforts, cells };
}
```

- [ ] **Step 6: 运行通过**

Run: `npm run test -- format derive`
Expected: PASS

- [ ] **Step 7: 本地 commit**

```bash
git add src/lib/format.ts src/lib/derive.ts tests/format.test.ts tests/derive.test.ts
git commit -m "feat(src): 格式化与派生纯函数 (排序/Δ/降智点/日桶/矩阵)"
```

---

### Task 7: 主题、状态横幅、错误边界

**Files:**
- Create: `src/lib/useTheme.ts`, `src/components/ThemeToggle.tsx`, `src/components/FreshnessBanner.tsx`, `src/components/ErrorBoundary.tsx`, `src/components/SkipLink.tsx`
- Create: `tests/FreshnessBanner.test.tsx`

**Interfaces:**
- Produces: `useTheme()`、`ThemeToggle`、`FreshnessBanner({ status, roundUpdatedAt })`、`ErrorBoundary`、`SkipLink`。

- [ ] **Step 1: 写 `src/lib/useTheme.ts`**

```ts
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "iq-radar-theme";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () =>
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  return [theme, toggle];
}
```

- [ ] **Step 2: 写 `src/components/ThemeToggle.tsx`**

```tsx
import { useTheme } from "../lib/useTheme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button type="button" className="card" onClick={toggle} aria-pressed={theme === "dark"}>
      {theme === "dark" ? "☀️ 浅色" : "🌙 深色"}
    </button>
  );
}
```

- [ ] **Step 3: 写 `src/components/SkipLink.tsx`**

```tsx
export function SkipLink() {
  return (
    <a className="skip-link" href="#main">
      跳到主要内容
    </a>
  );
}
```

- [ ] **Step 4: 写 `src/components/ErrorBoundary.tsx`**

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main id="main">
          <div className="card" role="alert">
            <h1>页面渲染失败</h1>
            <p className="muted">{this.state.error.message}</p>
            <button type="button" onClick={() => this.setState({ error: null })}>
              重试
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 5: 写失败测试 `tests/FreshnessBanner.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FreshnessBanner } from "../src/components/FreshnessBanner";
import type { StatusData } from "../src/types";

const status: StatusData = {
  checked_at: "2026-10-24T00:00:00Z",
  ok: true,
  benchmark: "radar-bench-final64-20261004",
  candidates_ok: 34,
  candidates_total: 34,
  round_ok: true,
  latest_graded_at: "2026-10-23T01:19:00Z",
  round_updated_at: "2026-10-23T10:43:22Z",
  stale_days: 1,
  errors: [],
};

describe("FreshnessBanner", () => {
  it("shows fresh state", () => {
    render(<FreshnessBanner status={status} roundUpdatedAt={status.round_updated_at!} now={new Date("2026-10-24T02:00:00Z").getTime()} />);
    expect(screen.getByRole("status")).toHaveTextContent("数据检查于");
    expect(screen.queryByText(/数据可能已过期/)).not.toBeInTheDocument();
  });

  it("warns when data is stale", () => {
    render(<FreshnessBanner status={{ ...status, stale_days: 9 }} roundUpdatedAt={status.round_updated_at!} now={new Date("2026-10-24T02:00:00Z").getTime()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/数据可能已过期/);
  });
});
```

- [ ] **Step 6: 写 `src/components/FreshnessBanner.tsx`**

```tsx
import type { StatusData } from "../types";
import { fmtDateTime, fmtRelativeTime } from "../lib/format";

export function FreshnessBanner({
  status,
  roundUpdatedAt,
  now = Date.now(),
}: {
  status: StatusData;
  roundUpdatedAt: string | null;
  now?: number;
}) {
  const stale = status.stale_days > 7;
  return (
    <div className={`card ${stale ? "warn" : ""}`} role="status" aria-live="polite">
      <strong>{stale ? "⚠️ 数据可能已过期" : "数据状态"}</strong>
      <span className="muted">
        {" "}
        · 数据检查于 {fmtDateTime(status.checked_at)}（{fmtRelativeTime(status.checked_at, now)}）
        · RadarBench 最近评分 {fmtDateTime(status.latest_graded_at)}
        · 本轮更新 {fmtDateTime(roundUpdatedAt)}
        · {status.candidates_ok}/{status.candidates_total} 候选
      </span>
      {status.errors.length > 0 && (
        <p className="muted">部分候选复用旧数据：{status.errors.length} 条</p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 运行测试**

Run: `npm run test -- FreshnessBanner`
Expected: PASS

- [ ] **Step 8: 本地 commit**

```bash
git add src/lib/useTheme.ts src/components/ThemeToggle.tsx src/components/SkipLink.tsx src/components/ErrorBoundary.tsx src/components/FreshnessBanner.tsx tests/FreshnessBanner.test.tsx
git commit -m "feat(src): 主题/跳过链接/错误边界/新鲜度横幅"
```

---

> **Post-review fix (commit 05b92d2):** `FreshnessBanner` also warns when `checked_at` is older than 48h, independent of `stale_days > 7`; `useTheme` consults `matchMedia` even if storage throws; `ThemeToggle` uses a constant accessible name; `ErrorBoundary` handles non-Error thrown values.

### Task 8: 本轮雷达矩阵与详情

**Files:**
- Create: `src/components/RoundMatrix.tsx`, `src/components/RoundDetail.tsx`
- Create: `tests/RoundMatrix.test.tsx`, `tests/RoundDetail.test.tsx`

**Interfaces:**
- Consumes: `RoundData`, `RoundCandidate`, `RoundTaskDef`; `roundMatrix`, `fmtScore`, `fmtEffort`, `fmtSeconds`, `fmtMoney`.
- Produces: `RoundMatrix({ round, selectedKey, onSelect })`、`RoundDetail({ candidate, tasks })`。

- [ ] **Step 1: 写失败测试 `tests/RoundMatrix.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoundMatrix } from "../src/components/RoundMatrix";
import type { RoundData } from "../src/types";

const round: RoundData = {
  schema_version: 1, fetch_id: "f", generated_at: "2026-10-24T00:00:00Z", checked_at: "2026-10-24T00:00:00Z",
  source_schema: "degradation-codex-plan/2",
  round: { id: "r", status: "completed", started_at: "", completed_at: "", updated_at: "2026-10-23T10:43:22Z", taskset_version: "t", task_count: 7, timings: {} },
  tasks: [],
  candidates: [
    { model: "A", effort: "low", score: 10, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 }, animation: null },
    { model: "A", effort: "high", score: 20, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 }, animation: null },
    { model: "B", effort: "low", score: 30, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 }, animation: null },
  ],
};

describe("RoundMatrix", () => {
  it("renders models, efforts and missing cells", () => {
    render(<RoundMatrix round={round} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("20.0")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("calls onSelect with model|effort", async () => {
    const onSelect = vi.fn();
    render(<RoundMatrix round={round} selectedKey={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /A 高/ }));
    expect(onSelect).toHaveBeenCalledWith("A|high");
  });
});
```

- [ ] **Step 2: 写 `src/components/RoundMatrix.tsx`**

```tsx
import type { RoundData } from "../types";
import { fmtEffort, fmtScore } from "../lib/format";
import { roundMatrix } from "../lib/derive";

export function RoundMatrix({
  round,
  selectedKey,
  onSelect,
}: {
  round: RoundData;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const { models, efforts, cells } = roundMatrix(round);
  return (
    <section className="card" aria-label="本轮雷达">
      <h2>本轮雷达</h2>
      <p className="muted">
        7 题一轮 · 分数 = 100 × 平均 reward × 1.5 · 满分 150 · 数据更新{" "}
        {new Date(round.round.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
      </p>
      <div className="table-wrap">
        <table>
          <caption className="muted">模型 × 推理档位，缺失档位显示 —</caption>
          <thead>
            <tr>
              <th scope="col">模型</th>
              {efforts.map((effort) => (
                <th key={effort} scope="col">{fmtEffort(effort)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model}>
                <th scope="row">{model}</th>
                {efforts.map((effort) => {
                  const key = model + "|" + effort;
                  const cell = cells.get(key);
                  return (
                    <td key={effort}>
                      {cell ? (
                        <button
                          type="button"
                          className="card"
                          aria-pressed={selectedKey === key}
                          aria-label={`${model} ${fmtEffort(effort)} ${fmtScore(cell.score)} 分`}
                          onClick={() => onSelect(key)}
                        >
                          {fmtScore(cell.score)}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: 写失败测试 `tests/RoundDetail.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoundDetail } from "../src/components/RoundDetail";
import type { RoundCandidate, RoundTaskDef } from "../src/types";

const tasks: RoundTaskDef[] = [
  { id: "t1", category: "deepswe", title_zh: "任务一", title_en: "Task one", weight: 1, required: true },
  { id: "t2", category: "tb4", title_zh: "任务二", title_en: "Task two", weight: 1, required: true },
];
const candidate: RoundCandidate = {
  model: "A", effort: "high", score: 120, score_max: 150, score_status: "complete", scored_tasks: 2, total_tasks: 2,
  tasks: [
    { task_id: "t1", status: "scored", reward: 1, seconds: 60, cost_usd: 0.5 },
    { task_id: "t2", status: "scored", reward: 0.5, seconds: 120, cost_usd: null },
  ],
  totals: { seconds: 180, cost_usd: 0.5, cost_known_tasks: 1, cost_unknown_tasks: 1 },
  animation: { status: "available", score: 91, scores: { pelican: 24, cycling: 23, motion: 25, finish: 19 }, reason: "不错", seconds: 400, cost_usd: 0.84, asset_url: "/a" },
};

describe("RoundDetail", () => {
  it("renders tasks, totals and animation", () => {
    render(<RoundDetail candidate={candidate} tasks={tasks} />);
    expect(screen.getByText("任务一")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /120\.0/ })).toBeInTheDocument();
    expect(screen.getByText(/91/)).toBeInTheDocument();
    expect(screen.getByText(/不错/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 写 `src/components/RoundDetail.tsx`**

```tsx
import type { RoundCandidate, RoundTaskDef } from "../types";
import { fmtEffort, fmtMoney, fmtScore, fmtSeconds } from "../lib/format";

export function RoundDetail({
  candidate,
  tasks,
}: {
  candidate: RoundCandidate | null;
  tasks: RoundTaskDef[];
}) {
  if (!candidate) return <section className="card muted">选择上方格子查看逐题详情。</section>;
  const byId = new Map(candidate.tasks.map((t) => [t.task_id, t]));
  return (
    <section className="card" aria-label="本轮详情">
      <h2>
        {candidate.model} · {fmtEffort(candidate.effort)} · {fmtScore(candidate.score)}
      </h2>
      <p className="muted">
        {candidate.score_status === "complete" ? "全部题已评分" : "部分题缺失"} · 用时{" "}
        {fmtSeconds(candidate.totals.seconds)} · 已知成本 {fmtMoney(candidate.totals.cost_usd)}
        {candidate.totals.cost_unknown_tasks > 0 ? `（${candidate.totals.cost_unknown_tasks} 题成本未知）` : ""}
      </p>
      <div className="table-wrap">
        <table>
          <caption className="muted">7 题逐项结果</caption>
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
                  <td>{row?.reward ?? "—"}</td>
                  <td>{fmtSeconds(row?.seconds ?? null)}</td>
                  <td>{fmtMoney(row?.cost_usd ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {candidate.animation && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>动画盲评 · {candidate.animation.score ?? "—"} / 100</h3>
          <p className="muted">
            {Object.entries(candidate.animation.scores).map(([k, v]) => `${k} ${v}`).join(" · ")}
          </p>
          {candidate.animation.reason && <p>{candidate.animation.reason}</p>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: 运行测试**

Run: `npm run test -- RoundMatrix RoundDetail`
Expected: PASS

- [ ] **Step 6: 本地 commit**

```bash
git add src/components/RoundMatrix.tsx src/components/RoundDetail.tsx tests/RoundMatrix.test.tsx tests/RoundDetail.test.tsx
git commit -m "feat(src): 本轮雷达矩阵与逐题详情"
```

---

### Task 9: RadarBench 候选表

**Files:**
- Create: `src/components/CandidateTable.tsx`, `tests/CandidateTable.test.tsx`

**Interfaces:**
- Consumes: `RadarCandidate`, `sortCandidates`, `computeDelta`, `fmt*`.
- Produces: `CandidateTable({ rows, selectedKeys, onToggle })`。

- [ ] **Step 1: 写失败测试 `tests/CandidateTable.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandidateTable } from "../src/components/CandidateTable";
import type { RadarCandidate } from "../src/types";

const mk = (o: Partial<RadarCandidate>): RadarCandidate => ({
  model: "A", effort: "high", score: 100, coverage: 64, required_tasks: 64,
  score_status: "complete", graded_runs_count: 10, source_scores: {},
  statistics: { sample_count: 10, elapsed_ms_mean: 1000, api_equivalent_usd_mean: 1 },
  latest_graded_at: "2026-10-23T00:00:00Z",
  history: [{ at: "2026-10-22T00:00:00Z", score: 105, coverage: 64, required_tasks: 64, score_status: "complete" }, { at: "2026-10-23T00:00:00Z", score: 100, coverage: 64, required_tasks: 64, score_status: "complete" }],
  ...o,
});

describe("CandidateTable", () => {
  it("renders rows and sorts by score", async () => {
    const rows = [mk({ model: "A", score: 90 }), mk({ model: "B", score: 110 })];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /分数/ }));
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(cells[0]).toContain("B");
  });

  it("filters by model", async () => {
    const rows = [mk({ model: "A" }), mk({ model: "B" })];
    render(<CandidateTable rows={rows} selectedKeys={[]} onToggle={() => {}} />);
    await userEvent.type(screen.getByLabelText(/搜索模型/), "B");
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("toggles selection", async () => {
    const onToggle = vi.fn();
    render(<CandidateTable rows={[mk({ model: "A" })]} selectedKeys={[]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /选择 A/ }));
    expect(onToggle).toHaveBeenCalledWith("A|high");
  });
});
```

- [ ] **Step 2: 写 `src/components/CandidateTable.tsx`**

```tsx
import { useMemo, useState } from "react";
import type { RadarCandidate } from "../types";
import { computeDelta, sortCandidates, type SortKey } from "../lib/derive";
import { fmtDateTime, fmtDelta, fmtEffort, fmtPercent, fmtScore } from "../lib/format";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "model", label: "模型" },
  { key: "effort", label: "档位" },
  { key: "score", label: "分数" },
  { key: "coverage", label: "覆盖率" },
  { key: "graded_runs_count", label: "已评分运行" },
  { key: "latest_graded_at", label: "最近评分" },
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
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const filtered = rows.filter((r) =>
      (r.model + " " + r.effort).toLowerCase().includes(query.toLowerCase()),
    );
    return sortCandidates(filtered, sortKey, dir);
  }, [rows, query, sortKey, dir]);

  const click = (key: SortKey) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(key === "model" || key === "effort" ? "asc" : "desc");
    }
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
                <th key={c.key} scope="col" aria-sort={sortKey === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => click(c.key)}>{c.label}</button>
                </th>
              ))}
              <th scope="col">Δ</th>
            </tr>
          </thead>
          <tbody>
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
                    {fmtDelta(delta)}{days != null ? ` / ${days} 天` : ""}
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
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- CandidateTable`
Expected: PASS

- [ ] **Step 4: 本地 commit**

```bash
git add src/components/CandidateTable.tsx tests/CandidateTable.test.tsx
git commit -m "feat(src): RadarBench 候选表 (排序/筛选/选择)"
```

---

### Task 10: 趋势图与控制条

**Files:**
- Create: `src/components/TrendChart.tsx`, `src/components/TrendControls.tsx`
- Create: `tests/TrendChart.test.tsx`

**Interfaces:**
- Consumes: `RadarCandidate`, `HistoryPoint`, `buildDailyGrid`, `findDegradationPoints`, `computeDelta`, `fmt*`.
- Produces: `TrendChart({ candidates })`、`TrendControls({ rows, selectedKeys, onToggle, max })`。

- [ ] **Step 1: 写失败测试 `tests/TrendChart.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendChart } from "../src/components/TrendChart";
import type { RadarCandidate } from "../src/types";

const candidate: RadarCandidate = {
  model: "A", effort: "high", score: 100, coverage: 64, required_tasks: 64,
  score_status: "complete", graded_runs_count: 10, source_scores: {},
  statistics: { sample_count: 10, elapsed_ms_mean: 1000, api_equivalent_usd_mean: 1 },
  latest_graded_at: "2026-10-23T00:00:00Z",
  history: [
    { at: "2026-10-17T00:00:00Z", score: 110, coverage: 64, required_tasks: 64, score_status: "complete" },
    { at: "2026-10-20T00:00:00Z", score: 108, coverage: 64, required_tasks: 64, score_status: "complete" },
    { at: "2026-10-23T00:00:00Z", score: 100, coverage: 64, required_tasks: 64, score_status: "complete" },
  ],
};

describe("TrendChart", () => {
  it("renders a chart with a text alternative and data table", () => {
    render(<TrendChart candidates={[candidate]} />);
    expect(screen.getByRole("img", { name: /RadarBench 趋势/ })).toBeInTheDocument();
    expect(screen.getByText(/分数下降/)).toBeInTheDocument();
    expect(screen.getByText(/2026-10-23/)).toBeInTheDocument();
  });

  it("renders empty state", () => {
    render(<TrendChart candidates={[]} />);
    expect(screen.getByText(/暂无可展示的曲线/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 写 `src/components/TrendChart.tsx`**

```tsx
import type { RadarCandidate } from "../types";
import { buildDailyGrid, computeDelta, findDegradationPoints } from "../lib/derive";
import { fmtDateTime, fmtDelta, fmtEffort, fmtScore } from "../lib/format";

const W = 860;
const H = 340;
const PAD = { top: 20, right: 20, bottom: 36, left: 48 };
const COLORS = ["#1d4ed8", "#b45309", "#0f766e", "#7c3aed", "#be123c", "#0369a1"];

function xOf(t: number, min: number, max: number) {
  return PAD.left + ((t - min) / Math.max(1, max - min)) * (W - PAD.left - PAD.right);
}
function yOf(score: number) {
  return PAD.top + (1 - score / 150) * (H - PAD.top - PAD.bottom);
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
  const xTicks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  return (
    <section className="card" aria-label="RadarBench 趋势">
      <h2>RadarBench 趋势</h2>
      <figure>
        <figcaption className="muted">
          日桶历史（UTC，显示为北京时间）。线在缺口处断开；空心点为 provisional；红点为分数下降信号（Δ ≤ -5 且覆盖率 ≥ 90%）。
        </figcaption>
        <svg role="img" aria-label="RadarBench 趋势" viewBox={`0 0 ${W} ${H}`} width="100%" height="auto">
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
              {new Date(t).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" })}
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
            const points = c.history.map((p) => ({ p, x: xOf(new Date(p.at).getTime(), min, max), y: yOf(p.score) }));
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
                    <title>{`${c.model} ${fmtEffort(c.effort)} · ${fmtDateTime(p.at)} · ${fmtScore(p.score)}`}</title>
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
            {c.model} · {fmtEffort(c.effort)}
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
                const prev = idx > 0 ? c.history[idx - 1] : null;
                const delta = prev ? Math.round((p.score - prev.score) * 10) / 10 : null;
                return (
                  <tr key={c.model + c.effort + p.at}>
                    <td>{fmtDateTime(p.at)}</td>
                    <td>{c.model} · {fmtEffort(c.effort)}</td>
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
```

- [ ] **Step 3: 写 `src/components/TrendControls.tsx`**

```tsx
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
```

- [ ] **Step 4: 运行测试**

Run: `npm run test -- TrendChart`
Expected: PASS

- [ ] **Step 5: 本地 commit**

```bash
git add src/components/TrendChart.tsx src/components/TrendControls.tsx tests/TrendChart.test.tsx
git commit -m "feat(src): 自绘 SVG 趋势图 + 曲线选择 (缺口/降智点/provisional)"
```

---

### Task 11: App 组合与 Tab

**Files:**
- Modify: `src/App.tsx`
- Create: `tests/App.test.tsx`

**Interfaces:**
- Consumes: `loadAll`, `FreshnessBanner`, `RoundMatrix`, `RoundDetail`, `CandidateTable`, `TrendControls`, `TrendChart`, `ThemeToggle`, `ErrorBoundary`, `SkipLink`, `topCandidates`.
- Produces: 完整页面。

- [ ] **Step 1: 写失败测试 `tests/App.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";

vi.mock("../src/data/loader", () => ({
  loadAll: vi.fn(async () => ({
    round: {
      schema_version: 1, fetch_id: "f", generated_at: "2026-10-24T00:00:00Z", checked_at: "2026-10-24T00:00:00Z",
      source_schema: "degradation-codex-plan/2",
      round: { id: "r", status: "completed", started_at: "", completed_at: "", updated_at: "2026-10-23T10:43:22Z", taskset_version: "t", task_count: 7, timings: {} },
      tasks: [],
      candidates: [{ model: "A", effort: "high", score: 120, score_max: 150, score_status: "complete", scored_tasks: 7, total_tasks: 7, tasks: [], totals: { seconds: 0, cost_usd: 0, cost_known_tasks: 0, cost_unknown_tasks: 0 }, animation: null }],
    },
    radarBench: {
      schema_version: 1, fetch_id: "f", generated_at: "2026-10-24T00:00:00Z", checked_at: "2026-10-24T00:00:00Z",
      benchmark: "b", score_version: "v", score_max: 150, catalog_version: "c", task_set_sha256: "s",
      candidates: [{ model: "A", effort: "high", score: 100, coverage: 64, required_tasks: 64, score_status: "complete", graded_runs_count: 1, source_scores: {}, statistics: { sample_count: 1, elapsed_ms_mean: 1, api_equivalent_usd_mean: 1 }, latest_graded_at: "2026-10-23T00:00:00Z", history: [] }],
    },
    status: { checked_at: "2026-10-24T00:00:00Z", ok: true, benchmark: "b", candidates_ok: 1, candidates_total: 1, round_ok: true, latest_graded_at: "2026-10-23T00:00:00Z", round_updated_at: "2026-10-23T10:43:22Z", stale_days: 0, errors: [] },
  })),
}));

describe("App", () => {
  it("renders the round tab and switches to trend", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /降智雷达/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /本轮雷达/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /RadarBench 趋势/ }));
    expect(screen.getByRole("heading", { name: /RadarBench 趋势/ })).toBeInTheDocument();
  });

  it("renders an error state when loading fails", async () => {
    const { loadAll } = await import("../src/data/loader");
    vi.mocked(loadAll).mockRejectedValueOnce(new Error("boom"));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/);
  });
});
```

- [ ] **Step 2: 写 `src/App.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { loadAll } from "./data/loader";
import type { RadarBenchData, RoundData, StatusData } from "./types";
import { topCandidates } from "./lib/derive";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FreshnessBanner } from "./components/FreshnessBanner";
import { RoundDetail } from "./components/RoundDetail";
import { RoundMatrix } from "./components/RoundMatrix";
import { CandidateTable } from "./components/CandidateTable";
import { TrendChart } from "./components/TrendChart";
import { TrendControls } from "./components/TrendControls";
import { ThemeToggle } from "./components/ThemeToggle";
import { SkipLink } from "./components/SkipLink";

type Tab = "round" | "trend" | "about";

export default function App() {
  const [data, setData] = useState<{ radarBench: RadarBenchData; round: RoundData; status: StatusData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("round");
  const [selectedRound, setSelectedRound] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  useEffect(() => {
    loadAll()
      .then((loaded) => {
        setData(loaded);
        setSelectedKeys(topCandidates(loaded.radarBench.candidates, 6).map((c) => c.model + "|" + c.effort));
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  const selectedCandidate = useMemo(() => {
    if (!data || !selectedRound) return null;
    return data.round.candidates.find((c) => c.model + "|" + c.effort === selectedRound) ?? null;
  }, [data, selectedRound]);

  const trendCandidates = useMemo(() => {
    if (!data) return [];
    return data.radarBench.candidates.filter((c) => selectedKeys.includes(c.model + "|" + c.effort));
  }, [data, selectedKeys]);

  if (error) {
    return (
      <main id="main">
        <SkipLink />
        <div className="card" role="alert">
          <h1>降智雷达</h1>
          <p>加载数据失败：{error}</p>
          <button type="button" onClick={() => location.reload()}>重试</button>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main id="main">
        <SkipLink />
        <div className="card" role="status" aria-live="polite">加载中…</div>
      </main>
    );
  }

  return (
    <ErrorBoundary>
      <main id="main">
        <SkipLink />
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0 }}>降智雷达</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              非官方项目 · 分数是第三方基准测试分数，不是心理学 IQ
            </p>
          </div>
          <ThemeToggle />
        </header>
        <FreshnessBanner status={data.status} roundUpdatedAt={data.round.round.updated_at} />
        <div role="tablist" aria-label="视图" style={{ display: "flex", gap: 8 }}>
          {([
            ["round", "本轮雷达"],
            ["trend", "RadarBench 趋势"],
            ["about", "关于"],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        {tab === "round" && (
          <>
            <RoundMatrix round={data.round} selectedKey={selectedRound} onSelect={setSelectedRound} />
            <RoundDetail candidate={selectedCandidate} tasks={data.round.tasks} round={data.round.round} />
          </>
        )}
        {tab === "trend" && (
          <>
            <TrendControls
              rows={data.radarBench.candidates}
              selectedKeys={selectedKeys}
              onToggle={(key) => setSelectedKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : prev.length >= 6 ? prev : [...prev, key])}
            />
            <TrendChart candidates={trendCandidates} />
            <CandidateTable
              rows={data.radarBench.candidates}
              selectedKeys={selectedKeys}
              onToggle={(key) => setSelectedKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : prev.length >= 6 ? prev : [...prev, key])}
            />
          </>
        )}
        {tab === "about" && (
          <section className="card">
            <h2>关于</h2>
            <p>数据来源：<a href="https://codexradar.com/" target="_blank" rel="noreferrer">codexradar.com</a> 的公开接口。</p>
            <p>RadarBench 分数是 64 题基准测试的加权分数（0–150），不是心理学 IQ。</p>
            <p>降智信号：相邻日桶分数下降 ≥ 5 分，且覆盖率 ≥ 90%、评分状态为 complete。</p>
            <p>本项目与 OpenAI 无关联；数据版权归原站所有。</p>
            <p>源码许可：AGPL-3.0-or-later。</p>
          </section>
        )}
        <footer className="muted" style={{ fontSize: 12 }}>
          数据检查于 {data.status.checked_at} · 北京时间（UTC+8）· 来源 codexradar.com · 非官方项目
        </footer>
      </main>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 3: 运行测试**

Run: `npm run test -- App`
Expected: PASS

- [ ] **Step 4: 本地 commit**

```bash
git add src/App.tsx tests/App.test.tsx
git commit -m "feat(src): App 组合 (本轮雷达/趋势/关于 + 加载/错误态)"
```

---

### Task 12: 响应式、无障碍与 SEO 收尾

**Files:**
- Modify: `src/styles/theme.css`, `index.html`, `src/components/RoundMatrix.tsx`, `src/components/CandidateTable.tsx`, `src/components/TrendChart.tsx`

**Interfaces:**
- Produces: 375px 无整页横向溢出；表头键盘可排序；图表有文本替代；meta/OG/favicon；焦点样式。

- [ ] **Step 1: 追加响应式与焦点样式**

```css
@media (max-width: 720px) {
  main { padding: 12px; gap: 12px; }
  .card { padding: 12px; }
  .round-matrix td button { min-width: 52px; }
}
@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; }
}
```

- [ ] **Step 2: 给矩阵加横向滚动与最小宽度**

在 `RoundMatrix` 的 `.table-wrap` 上设置 `style={{ overflowX: "auto" }}`，表格 `style={{ minWidth: 560 }}`。

- [ ] **Step 3: 给候选表加 `minWidth`**

在 `CandidateTable` 的表格上设置 `style={{ minWidth: 760 }}`。

- [ ] **Step 4: 检查表头键盘可操作**

`CandidateTable` 的 `<th>` 内已经是 `<button>`；确认 `aria-sort` 已设置，按钮有可见 focus。

- [ ] **Step 5: 图表文本替代**

确认 `TrendChart` 的 `<svg role="img" aria-label="RadarBench 趋势">`、`<title>`、`<desc>`、`<details>` 数据表存在。

- [ ] **Step 6: 补 meta/OG/favicon**

在 `index.html` 的 `<head>` 中补：

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231d4ed8'/%3E%3Cpath d='M8 22 L14 12 L18 18 L24 10' stroke='white' stroke-width='3' fill='none'/%3E%3C/svg%3E" />
<meta name="twitter:card" content="summary" />
<link rel="canonical" href="https://dev-of-mc-yzy15.github.io/ChatGPT-IQ-Check/" />
```

- [ ] **Step 7: 验证**

Run: `npm run test`
Run: `npx tsc -b`
Run: `npm run build`
Expected: 全部通过。

- [ ] **Step 8: 本地 commit**

```bash
git add src/styles/theme.css index.html src/components/RoundMatrix.tsx src/components/CandidateTable.tsx src/components/TrendChart.tsx
git commit -m "feat(src): 响应式/无障碍/SEO 收尾"
```

---

### Task 13: refresh-data workflow

**Files:**
- Create: `.github/workflows/refresh-data.yml`, `tests/workflows.test.ts`

**Interfaces:**
- Produces: 每日/手动刷新；失败开 issue；Node 24；零 npm 依赖。

- [ ] **Step 1: 写失败测试 `tests/workflows.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const load = (name: string) => parse(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));

describe("workflows", () => {
  it("refresh-data uses Node 24, no npm ci, and a timeout", () => {
    const wf = load("refresh-data.yml");
    expect(wf.jobs.refresh["timeout-minutes"]).toBe(10);
    expect(JSON.stringify(wf)).toContain('node-version: "24"');
    expect(JSON.stringify(wf)).not.toContain("npm ci");
    expect(wf.permissions.contents).toBe("write");
  });

  it("deploy gates workflow_run on success and scopes permissions", () => {
    const wf = load("deploy.yml");
    expect(wf.jobs.build.if).toContain("workflow_run.conclusion == 'success'");
    expect(wf.jobs.deploy.permissions.pages).toBe("write");
    expect(wf.jobs.deploy.permissions["id-token"]).toBe("write");
    expect(wf.concurrency["cancel-in-progress"]).toBe(false);
  });
});
```

- [ ] **Step 2: 运行失败测试**

Run: `npm run test -- workflows`
Expected: FAIL（YAML 不存在）

- [ ] **Step 3: 写 `.github/workflows/refresh-data.yml`**

```yaml
name: refresh-data
on:
  schedule:
    - cron: "30 0 * * *"
  workflow_dispatch:
permissions:
  contents: write
  issues: write
concurrency:
  group: refresh-data
  cancel-in-progress: false
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: true
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
      - name: Refresh data
        run: node scripts/refresh.mjs
      - name: Commit data if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/data/radar-bench.json public/data/round.json public/data/status.json
          if ! git diff --cached --quiet; then
            git commit -m "chore(data): refresh RadarBench data [skip ci]"
            git pull --rebase --autostash origin main
            git push
          else
            echo "no data change"
          fi
      - name: Open issue on failure
        if: failure()
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh issue create \
            --title "refresh-data failed" \
            --body "Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

- [ ] **Step 4: 运行通过**

Run: `npm run test -- workflows`
Expected: PASS

- [ ] **Step 5: 本地 commit（不 push，不启用）**

```bash
git add .github/workflows/refresh-data.yml tests/workflows.test.ts
git commit -m "ci: refresh-data workflow (Node 24, 零依赖, 失败开 issue)"
```

---

### Task 14: deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: push/workflow_run/manual 触发；测试→构建→Pages；权限收窄；成功门禁。

- [ ] **Step 1: 写 `.github/workflows/deploy.yml`**

```yaml
name: deploy-pages
on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "tests/**"
      - "index.html"
      - "package.json"
      - "package-lock.json"
      - "vite.config.ts"
      - "tsconfig.json"
      - "public/data/**"
  workflow_run:
    workflows: ["refresh-data"]
    types: [completed]
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: 运行 workflow 测试**

Run: `npm run test -- workflows`
Expected: PASS

- [ ] **Step 3: 本地 commit（不 push，不启用）**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy-pages workflow (Node 24, 权限收窄, 成功门禁)"
```

---

### Task 15: README、NOTICE、最终验证

**Files:**
- Create: `README.md`, `NOTICE`
- Modify: `docs/superpowers/specs/2026-10-23-chatgpt-iq-radar-design.md`（标记 superseded）
- Modify: `docs/superpowers/plans/2026-10-23-chatgpt-iq-radar.md`（标记 superseded）

**Interfaces:**
- Produces: 可交接的文档与最终验证证据。

- [ ] **Step 1: 写 `README.md`**

```markdown
# 降智雷达 · ChatGPT IQ Check

非官方项目：展示 CodexRadar 公开的「本轮雷达」（7 题一轮）与「RadarBench 趋势」（64 题日桶历史）。

> 分数是第三方基准测试分数，不是心理学 IQ。本项目与 OpenAI 无关联。

## 数据源

- 候选目录：https://codexradar.com/data/radar-bench-binding.json
- 单候选分数 + 历史：https://codexradar.com/api/radar-bench-score?model=&effort=&view=summary&selection=user-selected-v1
- 本轮看板：https://codexradar.com/degradation-codex-latest.json

不使用的接口：`/data/intelligence-efficiency.json`（旧 fallback）、`/api/v1/table`（410）、`/api/intelligence-efficiency-metrics`（502）。

## 本地开发

    npm ci
    npm run dev
    npm run test
    npm run build
    npm run refresh   # 需要联网，生成 public/data/*.json

`npm run preview` 后打开 http://localhost:4173/ChatGPT-IQ-Check/。

## 数据刷新

- GitHub Actions `refresh-data` 每天 00:30 UTC 抓取；也可手动 `workflow_dispatch`。
- 34 个 summary 并发 4、重试 3、超时 20s。
- 校验失败会保留旧数据并退出 1；`status.json` 记录错误。
- 回滚：先禁用 schedule，再 `git revert` 数据 commit，重新部署；否则下一次 cron 会再次写入坏数据。

## 部署

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
2. push main 触发 `deploy-pages`；`refresh-data` 成功后会通过 `workflow_run` 触发部署。
3. 首次 push、启用 Actions、开启 Pages 必须由仓库所有者确认。

## 免责声明

- 数据来源 codexradar.com；数据版权归原站所有，`public/data/` 不在本项目 AGPL 再许可范围内。
- 本项目不保证数据准确性；分数受样本量、覆盖率、任务集版本影响。
- 与 OpenAI 无关联；ChatGPT/OpenAI 是其各自所有者的商标。

## 许可

AGPL-3.0-or-later；见 `LICENSE` 与 `NOTICE`。
```

- [ ] **Step 2: 写 `NOTICE`**

```text
ChatGPT IQ Check（降智雷达）
Copyright (C) 2026 dev-of-mc-yzy15

This project is licensed under AGPL-3.0-or-later. See LICENSE.

Third-party data:
- Data is fetched from codexradar.com public endpoints.
- The data under public/data/ is not relicensed under AGPL; it remains subject to the
  original site's terms and copyright. This project only displays and links to the source.
- No affiliation with OpenAI. ChatGPT and OpenAI are trademarks of their respective owners.

Contact for data removal: open an issue in this repository.
```

- [ ] **Step 3: 标记旧文档 superseded**

在 v1 spec 和 plan 顶部各加一行：

```markdown
> **Superseded by v2 (2026-10-24):** `docs/superpowers/specs/2026-10-24-chatgpt-iq-radar-design-v2.md` / `docs/superpowers/plans/2026-10-24-chatgpt-iq-radar-v2.md`. The v1 data source was a stale fallback.
```

- [ ] **Step 4: 最终验证**

Run: `npm ci`
Run: `npm run test`
Expected: 全部 PASS，且测试文件数 ≥ 10。
Run: `npx tsc -b`
Expected: exit 0。
Run: `npm run build`
Expected: 成功，`dist/` 生成。
Run: `git status --porcelain`
Expected: 只剩本次提交的文件；没有 `node_modules/`、`dist/`、`*.tsbuildinfo`。

- [ ] **Step 5: 本地 commit**

```bash
git add README.md NOTICE docs/superpowers/specs/2026-10-23-chatgpt-iq-radar-design.md docs/superpowers/plans/2026-10-23-chatgpt-iq-radar.md
git commit -m "docs: v2 README/NOTICE, 标记 v1 superseded"
```

---

## Self-Review

**1. Spec coverage:**
- §2 数据源 → Task 2/3/4（binding/summary/round）✅
- §3 产品结构 → Task 8/9/10/11（本轮/趋势/关于）✅
- §5 数据契约 → Task 2/3/4/5/6 ✅
- §6 刷新与容错 → Task 4/13 ✅
- §7 前端 → Task 5/6/7/8/9/10/11/12 ✅
- §8 测试 → Task 2/3/4/5/6/7/8/9/10/11/13/14 ✅
- §9 红线 → 每个 commit 只本地；workflow 不自动 push（运行时才 push）✅
- §10 交付物 → Task 1-15 ✅
- §13 验收 → Task 15 Step 4 + 手动清单（见 README）✅

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤给出完整代码与命令 ✅

**3. Type consistency:**
- `RadarBenchData` / `RadarCandidate` / `HistoryPoint` 在 Task 2 定义，Task 5/6/9/10 引用一致 ✅
- `RoundData` / `RoundCandidate` / `RoundTaskDef` 在 Task 2 定义，Task 3/8/11 引用一致 ✅
- `transformBinding/transformSummary/transformRound/mergeRadarBench/validateRadarBench/validateRound` 在 Task 2/3 定义，Task 4 引用一致 ✅
- `fmtScore/fmtDelta/fmtMoney/fmtPercent/fmtSeconds/fmtDateTime/fmtRelativeTime/fmtEffort` 在 Task 6 定义，Task 7/8/9/10 引用一致 ✅
- `sortCandidates/computeDelta/findDegradationPoints/topCandidates/buildDailyGrid/roundMatrix` 在 Task 6 定义，Task 9/10/11 引用一致 ✅
- 契约字段名 `score/coverage/required_tasks/score_status/graded_runs_count/history` 在 Task 2/4/5/6/9/10 一致 ✅

**已知取舍：**
- 34 个 summary 请求而不是 bulk；总下载约 293 KB，换取实时性与无 410 依赖。
- 自绘 SVG 而不是 Recharts；减少 70% 包体与 EOL 风险，代价是图表代码约 150 行。
- 社区体感 `/api/model-ratings` 列为 P1 可选，未进入本计划任务；如需可另开 Task 16。
- OpenAI Status 横幅未纳入 v2；如需可另开 Task 17。
