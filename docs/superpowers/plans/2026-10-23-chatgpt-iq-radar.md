# ChatGPT IQ Check（降智雷达）Implementation Plan

> **Superseded by v2 (2026-10-24):** `docs/superpowers/plans/2026-10-24-chatgpt-iq-radar-v2.md`。v1 计划围绕已停更的 `/data/intelligence-efficiency.json` 编写，不能按原样执行。

> 实际实现未采用 v1 计划的 `fixture.mjs` 与 `tsconfig.node.json`，改用 `tests/fixtures/*.json` 与 `tsconfig.scripts.json`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个纯前端"降智雷达"网站，用 GitHub Actions 每日抓取无密钥公开数据源，静态托管到 GitHub Pages，实时展示各模型 IQ、趋势与降智。

**Architecture:** 浏览器只读仓库内静态 JSON；GitHub Actions（每日 + 手动）匿名拉取 codexradar + OpenAI Status，做字段裁剪/透视压缩后回写 `public/data/*.json`（零配置 `GITHUB_TOKEN`），再由 deploy workflow 用 Vite 构建并直接发 Pages。降智与趋势完全消费源站自带的 `history`，本项目不自建评测、不自写检测引擎。

**Tech Stack:** React 18 + TypeScript + Vite（`base=/ChatGPT-IQ-Check/`）、Recharts、Vitest + Testing Library、Node ESM 脚本（`.mjs`）、GitHub Actions + GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-10-23-chatgpt-iq-radar-design.md`

**红线（每个涉及远端的任务都适用）：** 绝不自动 `git push` / 开 Pages / 触发部署。计划里的 commit 都是**本地** commit；push 与启用 Actions 必须等用户本人确认。

---

## File Structure

```
package.json                     依赖与脚本 (dev/build/preview/test/refresh)
tsconfig.json / tsconfig.node.json
vite.config.ts                   base=/ChatGPT-IQ-Check/, react 插件, vitest 配置
index.html
src/
  main.tsx                       React 挂载
  App.tsx                        组合 loader + 各区块 + 加载/错误/空态
  types.ts                       与 public/data 契约对应的类型
  styles/theme.css               深浅色 CSS 变量
  data/loader.ts                 带类型的 fetch (latest/history) + 校验
  lib/format.ts                  纯格式化：分钟/货币/百分比/相对时间
  lib/derive.ts                  纯函数：排序比较器/今日推荐/表行/IQ 透视
  components/
    ThemeToggle.tsx
    StatusBanner.tsx
    TodayPicks.tsx
    RecommendTable.tsx           可排序
    IQLadder.tsx
    SpeedLadder.tsx
    TrendChart.tsx               Recharts 折线
scripts/
  lib.mjs                        纯转换：transformLatest/transformHistory/transformStatus/computeIqDelta
  refresh.mjs                    CLI：抓取(重试/超时)→调用 lib.mjs→写压缩 JSON
  fixture.mjs                    把 fixture 读成对象，供测试与本地种子共用
public/data/
  latest.json                    种子数据（由 refresh 本地生成后提交）
  history.json                   种子数据
tests/
  fixtures/codexradar.sample.json  实拉裁剪的小样本
  fixtures/status.sample.json       实拉裁剪的小样本
  lib.test.ts                       覆盖 scripts/lib.mjs
  format.test.ts
  derive.test.ts
  loader.test.ts
.github/workflows/
  refresh-data.yml                每日 + 手动，抓取回写 main
  deploy.yml                      push(主要源码/data) + 手动，build→发 Pages
README.md
```

---

## Task 1: 项目脚手架（Vite + React + TS + Vitest）

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/theme.css`
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "chatgpt-iq-check",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "refresh": "node scripts/refresh.mjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^2.12.7"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.6",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
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
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: 写 `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: 写 `vite.config.ts`（含 Pages base 与 vitest）**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ChatGPT-IQ-Check/",
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: 写 `index.html`**

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>降智雷达 · ChatGPT IQ Check</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 写 `src/styles/theme.css`**

```css
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #666; --card: #f5f6f8;
  --line: #e3e6ea; --accent: #2563eb; --down: #dc2626; --up: #16a34a;
  color-scheme: light;
}
[data-theme="dark"] {
  --bg: #0f1115; --fg: #e6e6e6; --muted: #9aa0a6; --card: #171a21;
  --line: #2a2f38; --accent: #60a5fa; --down: #f87171; --up: #4ade80;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
.card { background: var(--card); border: 1px solid var(--line);
  border-radius: 12px; padding: 16px; }
.muted { color: var(--muted); }
.down { color: var(--down); }
.up { color: var(--up); }
main { max-width: 1100px; margin: 0 auto; padding: 24px; display: grid; gap: 20px; }
```

- [ ] **Step 7: 写 `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/theme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 8: 写占位 `src/App.tsx`（Task 14 会替换成完整版）**

```tsx
export default function App() {
  return <main><h1>降智雷达</h1></main>;
}
```

- [ ] **Step 9: 写冒烟测试 `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
describe("toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 10: 安装依赖并验证**

Run: `npm install`（本地生成 package-lock.json，需提交）
Run: `npm run test` → Expected: PASS (1 test)
Run: `npm run build` → Expected: 生成 `dist/`，无 TS 报错

- [ ] **Step 11: 本地 commit（不 push）**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS + Vitest (base=/ChatGPT-IQ-Check/)"
```

---

## Task 2: 数据转换纯函数（scripts/lib.mjs）

把原始 codexradar JSON 转成前端契约。先建 fixture，再 TDD。

**Files:**
- Create: `tests/fixtures/codexradar.sample.json`, `scripts/fixture.mjs`, `scripts/lib.mjs`
- Test: `tests/lib.test.ts`

- [ ] **Step 1: 写裁剪样本 `tests/fixtures/codexradar.sample.json`**

```json
{
  "source_updated_at": "2026-10-01T23:00:27+08:00",
  "points": [
    { "model": "gpt-6-astra", "effort": "high", "harness": "codex", "iq": 110.36,
      "passed": 103.0, "valid_tasks": 140.0, "average_price_usd": 2.814112,
      "average_minutes": 13.77, "latest_graded_at": "2026-09-27T02:19:56+00:00", "total_runs": 146 },
    { "model": "gpt-6-astra", "effort": "low", "harness": "codex", "iq": 98.41,
      "passed": 103.0, "valid_tasks": 157.0, "average_price_usd": 1.52901,
      "average_minutes": 8.62, "latest_graded_at": "2026-09-29T07:28:15+00:00", "total_runs": 159 }
  ],
  "history": [
    { "at": "2026-09-23T04:55:27+08:00", "points": [
      { "model": "gpt-6-astra", "effort": "high", "iq": 108.0, "passed": 100, "valid_tasks": 140, "average_minutes": 14.0, "average_price_usd": 2.7 },
      { "model": "gpt-6-astra", "effort": "low", "iq": 99.0, "passed": 100, "valid_tasks": 150, "average_minutes": 8.5, "average_price_usd": 1.5 }
    ] },
    { "at": "2026-09-30T04:55:27+08:00", "points": [
      { "model": "gpt-6-astra", "effort": "high", "iq": 110.0, "passed": 103, "valid_tasks": 140, "average_minutes": 13.7, "average_price_usd": 2.8 },
      { "model": "gpt-6-astra", "effort": "low", "iq": 98.0, "passed": 102, "valid_tasks": 157, "average_minutes": 8.6, "average_price_usd": 1.52 }
    ] }
  ]
}
```

- [ ] **Step 2: 写 `scripts/fixture.mjs`**

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const p = (f) => fileURLToPath(new URL(`../tests/fixtures/${f}`, import.meta.url));
export const loadCodexFixture = () => JSON.parse(readFileSync(p("codexradar.sample.json"), "utf8"));
export const loadStatusFixture = () => JSON.parse(readFileSync(p("status.sample.json"), "utf8"));
```

- [ ] **Step 3: 写失败测试 `tests/lib.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { transformLatest, transformHistory, computeIqDelta } from "../scripts/lib.mjs";
import { loadCodexFixture } from "../scripts/fixture.mjs";

const raw = loadCodexFixture();

describe("transformLatest", () => {
  const models = transformLatest(raw);
  it("computes pass_rate and recommend_score = iq - 1.5*minutes", () => {
    const high = models.find((m: any) => m.effort === "high");
    expect(high.pass_rate).toBeCloseTo(103 / 140, 4);
    expect(high.recommend_score).toBeCloseTo(110.36 - 1.5 * 13.77, 2);
  });
  it("keeps only contract fields", () => {
    expect(Object.keys(models[0]).sort()).toEqual(
      ["avg_minutes","avg_price_usd","effort","harness","iq","iq_delta_7d","latest_graded_at","model","pass_rate","passed","recommend_score","total_runs","valid_tasks"].sort()
    );
  });
});

describe("transformHistory", () => {
  const series = transformHistory(raw);
  it("pivots to per model×effort series with full resolution", () => {
    const key = series.find((s: any) => s.model === "gpt-6-astra" && s.effort === "high");
    expect(key.points).toHaveLength(2); // 全保真：两个快照都保留
    expect(key.points[0]).toEqual({ at: "2026-09-23T04:55:27+08:00", iq: 108.0,
      pass_rate: 100 / 140, avg_minutes: 14.0, avg_price_usd: 2.7 });
  });
});

describe("computeIqDelta", () => {
  it("returns current iq minus iq from ~7 days ago in history", () => {
    // latest_graded_at 2026-09-27, 7天前≈09-20；样本里最早点 09-23 作为最近的前值
    const d = computeIqDelta(raw, "gpt-6-astra", "high", /*current*/ 110.36);
    expect(typeof d).toBe("number");
  });
});
```

- [ ] **Step 4: 运行验证失败**

Run: `npm run test -- lib`
Expected: FAIL（`Cannot find module .../lib.mjs` 或未导出函数）

- [ ] **Step 5: 写最小实现 `scripts/lib.mjs`**

```js
const round = (n, k = 4) => Math.round(n * 10 ** k) / 10 ** k;
const passRate = (passed, valid) => (valid > 0 ? round(passed / valid) : null);

export function transformLatest(raw) {
  const points = raw?.points ?? [];
  return points.map((p) => ({
    model: p.model,
    effort: p.effort,
    harness: p.harness ?? null,
    iq: p.iq ?? null,
    passed: p.passed ?? null,
    valid_tasks: p.valid_tasks ?? null,
    pass_rate: passRate(p.passed ?? 0, p.valid_tasks ?? 0),
    avg_price_usd: p.average_price_usd ?? null,
    avg_minutes: p.average_minutes ?? null,
    recommend_score:
      p.iq != null && p.average_minutes != null
        ? round(p.iq - 1.5 * p.average_minutes, 2)
        : null,
    iq_delta_7d: computeIqDelta(raw, p.model, p.effort, p.iq),
    latest_graded_at: p.latest_graded_at ?? null,
    total_runs: p.total_runs ?? null,
  }));
}

export function transformHistory(raw) {
  const history = raw?.history ?? [];
  const map = new Map(); // key: model|effort -> series
  for (const snap of history) {
    for (const p of snap.points ?? []) {
      const key = `${p.model}|${p.effort}`;
      if (!map.has(key)) map.set(key, { model: p.model, effort: p.effort, points: [] });
      map.get(key).points.push({
        at: snap.at,
        iq: p.iq ?? null,
        pass_rate: passRate(p.passed ?? 0, p.valid_tasks ?? 0),
        avg_minutes: p.average_minutes ?? null,
        avg_price_usd: p.average_price_usd ?? null,
      });
    }
  }
  for (const s of map.values()) s.points.sort((a, b) => new Date(a.at) - new Date(b.at));
  return [...map.values()];
}

export function computeIqDelta(raw, model, effort, currentIq) {
  if (currentIq == null) return null;
  const snaps = (raw?.history ?? [])
    .flatMap((h) => (h.points ?? []).filter((p) => p.model === model && p.effort === effort).map((p) => ({ at: h.at, iq: p.iq })))
    .filter((x) => x.iq != null)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (snaps.length === 0) return null;
  const now = snaps[snaps.length - 1];
  const target = new Date(new Date(now.at).getTime() - 7 * 864e5);
  let base = snaps[0];
  for (const s of snaps) { if (new Date(s.at) <= target) base = s; }
  return round(currentIq - base.iq, 2);
}
```

- [ ] **Step 6: 运行验证通过**

Run: `npm run test -- lib`
Expected: PASS

- [ ] **Step 7: 本地 commit**

```bash
git add scripts/lib.mjs scripts/fixture.mjs tests/fixtures/codexradar.sample.json tests/lib.test.ts
git commit -m "feat(scripts): codexradar→契约 转换纯函数 (transformLatest/History/computeIqDelta)"
```

---

## Task 3: OpenAI 状态转换（scripts/lib.mjs 扩展）

**Files:**
- Create: `tests/fixtures/status.sample.json`
- Modify: `scripts/lib.mjs`（新增 `transformStatus`）
- Test: `tests/lib.test.ts`（追加）

- [ ] **Step 1: 写样本 `tests/fixtures/status.sample.json`**

```json
{
  "page": { "name": "OpenAI", "url": "https://status.openai.com/" },
  "status": { "description": "All Systems Operational", "indicator": "none" },
  "components": [
    { "name": "Chat Completions", "status": "operational" },
    { "name": "Codex in ChatGPT Desktop", "status": "operational" }
  ]
}
```

- [ ] **Step 2: 追加失败测试到 `tests/lib.test.ts`**

```ts
import { transformStatus } from "../scripts/lib.mjs";
import { loadStatusFixture } from "../scripts/fixture.mjs";

describe("transformStatus", () => {
  const s = transformStatus(loadStatusFixture());
  it("maps indicator/description/components", () => {
    expect(s.indicator).toBe("none");
    expect(s.description).toBe("All Systems Operational");
    expect(s.components).toEqual([
      { name: "Chat Completions", status: "operational" },
      { name: "Codex in ChatGPT Desktop", status: "operational" },
    ]);
    expect(s.incidents).toEqual([]);
  });
});
```

- [ ] **Step 3: 运行验证失败**

Run: `npm run test -- lib`
Expected: FAIL（`transformStatus is not a function`）

- [ ] **Step 4: 在 `scripts/lib.mjs` 末尾新增实现**

```js
export function transformStatus(summary) {
  const incidents = (summary?.incidents ?? []).map((i) => ({
    name: i.name ?? null,
    status: i.status ?? null,
    updated_at: i.updated_at ?? null,
  }));
  return {
    indicator: summary?.status?.indicator ?? "unknown",
    description: summary?.status?.description ?? "",
    components: (summary?.components ?? []).map((c) => ({
      name: c.name ?? null,
      status: c.status ?? null,
    })),
    incidents,
  };
}
```

- [ ] **Step 5: 运行验证通过**

Run: `npm run test -- lib`
Expected: PASS

- [ ] **Step 6: 本地 commit**

```bash
git add scripts/lib.mjs tests/fixtures/status.sample.json tests/lib.test.ts
git commit -m "feat(scripts): transformStatus (OpenAI Statuspage→契约)"
```

---

## Task 4: 抓取 CLI（scripts/refresh.mjs）+ 生成本地种子数据

**Files:**
- Create: `scripts/refresh.mjs`
- Create: `public/data/latest.json`, `public/data/history.json`（本任务运行后生成）

- [ ] **Step 1: 写 `scripts/refresh.mjs`**

```js
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transformLatest, transformHistory, transformStatus } from "./lib.mjs";

const CODEX_URL = "https://codexradar.com/data/intelligence-efficiency.json";
const STATUS_URL = "https://status.openai.com/api/v2/summary.json";
const DATA_DIR = fileURLToPath(new URL("../public/data/", import.meta.url));

async function fetchJson(url, { tries = 3, timeoutMs = 30000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "iq-radar/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      console.warn(`attempt ${i + 1}/${tries} failed for ${url}: ${e.message}`);
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 2 ** i * 1000));
    } finally {
      clearTimeout(t);
    }
  }
}

async function main() {
  const [codex, status] = await Promise.all([fetchJson(CODEX_URL), fetchJson(STATUS_URL)]);
  const latest = {
    generated_at: new Date().toISOString(),
    source_updated_at: codex.source_updated_at ?? null,
    models: transformLatest(codex),
    status: transformStatus(status),
  };
  const history = { series: transformHistory(codex) };
  await mkdir(DATA_DIR, { recursive: true });
  // 压缩 JSON（不格式化）；latest 用 2 空格便于 review，history 压成一坨
  await writeFile(DATA_DIR + "latest.json", JSON.stringify(latest, null, 2));
  await writeFile(DATA_DIR + "history.json", JSON.stringify(history));
  console.log(`wrote ${latest.models.length} models, ${history.series.length} series`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 本地实跑生成种子数据（需联网）**

Run: `npm run refresh`
Expected: 打印 `wrote NN models, MM series`；生成 `public/data/latest.json`（含 `models/status`）、`public/data/history.json`（几 KB~几百 KB）。
若上游偶发失败：脚本已重试；仍失败则本任务改天重跑，不提交坏数据。

- [ ] **Step 3: 人肉校验契约**

Run: `node -e "const d=require('./public/data/latest.json');console.log(Object.keys(d), d.models[0], d.status.indicator)"`
Expected: keys=[generated_at,source_updated_at,models,status]；models[0] 含 `recommend_score/iq_delta_7d`；indicator 正常。

- [ ] **Step 4: 本地 commit**

```bash
git add scripts/refresh.mjs public/data/latest.json public/data/history.json
git commit -m "feat(scripts): refresh.mjs 抓取+裁剪, 生成种子 latest/history"
```

---

## Task 5: 前端类型 + 数据加载器（带类型的 fetch + 容错）

**Files:**
- Create: `src/types.ts`, `src/data/loader.ts`
- Test: `tests/loader.test.ts`

- [ ] **Step 1: 写 `src/types.ts`**

```ts
export type ModelRow = {
  model: string; effort: string; harness: string | null;
  iq: number | null; passed: number | null; valid_tasks: number | null;
  pass_rate: number | null; avg_price_usd: number | null; avg_minutes: number | null;
  recommend_score: number | null; iq_delta_7d: number | null;
  latest_graded_at: string | null; total_runs: number | null;
};
export type StatusSummary = {
  indicator: string; description: string;
  components: { name: string | null; status: string | null }[];
  incidents: { name: string | null; status: string | null; updated_at: string | null }[];
};
export type Latest = {
  generated_at: string; source_updated_at: string | null;
  models: ModelRow[]; status: StatusSummary;
};
export type HistoryPoint = { at: string; iq: number | null; pass_rate: number | null; avg_minutes: number | null; avg_price_usd: number | null };
export type HistorySeries = { model: string; effort: string; points: HistoryPoint[] };
export type History = { series: HistorySeries[] };
```

- [ ] **Step 2: 写失败测试 `tests/loader.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadLatest, urlFor } from "../src/data/loader";

afterEach(() => vi.unstubAllGlobals());

describe("loader", () => {
  it("builds url under base path", () => {
    expect(urlFor("data/latest.json")).toBe("/ChatGPT-IQ-Check/data/latest.json");
  });
  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    await expect(loadLatest()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 3: 运行验证失败**

Run: `npm run test -- loader`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 写 `src/data/loader.ts`**

```ts
import type { Latest, History } from "../types";

export function urlFor(rel: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(rel, base.length ? base : "/").toString().replace(/^https?:\/\/[^/]+/, "");
}

async function getJson<T>(rel: string): Promise<T> {
  const res = await fetch(urlFor(rel), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`fetch ${rel} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadLatest = () => getJson<Latest>("data/latest.json");
export const loadHistory = () => getJson<History>("data/history.json");

export async function loadAll(): Promise<{ latest: Latest; history: History }> {
  const [latest, history] = await Promise.all([loadLatest(), loadHistory()]);
  if (!Array.isArray(latest.models)) throw new Error("latest.json 结构异常: models 缺失");
  if (!Array.isArray(history.series)) throw new Error("history.json 结构异常: series 缺失");
  return { latest, history };
}
```

- [ ] **Step 5: 运行验证通过**

Run: `npm run test -- loader`
Expected: PASS

> 若 `urlFor` 在 jsdom 下返回值与断言不符，改用简单实现：`return (import.meta.env.BASE_URL || "/") + rel;`（BASE_URL 已带结尾斜杠）。保持测试通过为准。

- [ ] **Step 6: 本地 commit**

```bash
git add src/types.ts src/data/loader.ts tests/loader.test.ts
git commit -m "feat(src): 类型定义 + 带容错的静态 JSON 加载器"
```

---

## Task 6: 格式化工具（lib/format.ts）

**Files:**
- Create: `src/lib/format.ts`
- Test: `tests/format.test.ts`

- [ ] **Step 1: 写失败测试 `tests/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fmtIq, fmtMinutes, fmtMoney, fmtPercent, fmtRelativeDay } from "../src/lib/format";

describe("format", () => {
  it("formats numbers with null-safety", () => {
    expect(fmtIq(110.36)).toBe("110.4");
    expect(fmtIq(null)).toBe("—");
    expect(fmtMinutes(8.62)).toBe("9m");
    expect(fmtMinutes(null)).toBe("—");
    expect(fmtMoney(2.814)).toBe("$2.81");
    expect(fmtPercent(0.7357)).toBe("74%");
    expect(fmtPercent(null)).toBe("—");
    expect(fmtRelativeDay("2026-09-27T02:19:56+00:00")).toMatch(/\d+/);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npm run test -- format` → Expected: FAIL

- [ ] **Step 3: 写 `src/lib/format.ts`**

```ts
const dash = "—";
export const fmtIq = (n: number | null) => (n == null ? dash : n.toFixed(1));
export const fmtMinutes = (n: number | null) => (n == null ? dash : `${Math.round(n)}m`);
export const fmtMoney = (n: number | null) => (n == null ? dash : `$${n.toFixed(2)}`);
export const fmtPercent = (n: number | null) => (n == null ? dash : `${Math.round(n * 100)}%`);
export function fmtRelativeDay(iso: string | null): string {
  if (!iso) return dash;
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 864e5);
  return days <= 0 ? "今天" : `${days} 天前`;
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm run test -- format` → Expected: PASS

- [ ] **Step 5: 本地 commit**

```bash
git add src/lib/format.ts tests/format.test.ts
git commit -m "feat(src): 格式化工具 (iq/分钟/货币/百分比/相对时间)"
```

---

## Task 7: 派生逻辑（lib/derive.ts：排序 + 今日推荐）

**Files:**
- Create: `src/lib/derive.ts`
- Test: `tests/derive.test.ts`

- [ ] **Step 1: 写失败测试 `tests/derive.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { sortRows, pickTodayPicks } from "../src/lib/derive";
import type { ModelRow } from "../src/types";

const mk = (o: Partial<ModelRow>): ModelRow => ({
  model: "m", effort: "high", harness: "codex", iq: 100, passed: 100, valid_tasks: 100,
  pass_rate: 1, avg_price_usd: 1, avg_minutes: 10, recommend_score: 85, iq_delta_7d: 0,
  latest_graded_at: null, total_runs: 1, ...o,
});

describe("sortRows", () => {
  it("sorts by key asc/desc, nulls last", () => {
    const rows = [mk({ iq: 90 }), mk({ iq: null }), mk({ iq: 110 })];
    expect(sortRows(rows, "iq", "desc").map((r) => r.iq)).toEqual([110, 90, null]);
    expect(sortRows(rows, "iq", "asc").map((r) => r.iq)).toEqual([90, 110, null]);
  });
});

describe("pickTodayPicks", () => {
  it("picks smartest(highest iq), cheapest(best recommend), fastest(lowest minutes)", () => {
    const rows = [mk({ model: "A", iq: 120, recommend_score: 50, avg_minutes: 20 }),
                  mk({ model: "B", iq: 90, recommend_score: 95, avg_minutes: 20 }),
                  mk({ model: "C", iq: 80, recommend_score: 60, avg_minutes: 3 })];
    const p = pickTodayPicks(rows);
    expect(p.smartest.model).toBe("A");
    expect(p.value.model).toBe("B");
    expect(p.fastest.model).toBe("C");
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npm run test -- derive` → Expected: FAIL

- [ ] **Step 3: 写 `src/lib/derive.ts`**

```ts
import type { ModelRow } from "../types";

export type SortKey = "model" | "effort" | "iq" | "avg_minutes" | "avg_price_usd" | "pass_rate" | "recommend_score";

export function sortRows(rows: ModelRow[], key: SortKey, dir: "asc" | "desc"): ModelRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;              // nulls 永远在后
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(String(bv)) : (Number(av) - Number(bv));
    return dir === "asc" ? cmp : -cmp;
  });
}

export function pickTodayPicks(rows: ModelRow[]) {
  const valid = rows.filter((r) => r.iq != null);
  const smartest = [...valid].sort((a, b) => (b.iq ?? 0) - (a.iq ?? 0))[0] ?? null;
  const value = [...rows].sort((a, b) => (b.recommend_score ?? -Infinity) - (a.recommend_score ?? -Infinity))[0] ?? null;
  const fastest = [...rows].filter((r) => r.avg_minutes != null).sort((a, b) => (a.avg_minutes ?? Infinity) - (b.avg_minutes ?? Infinity))[0] ?? null;
  return { smartest, value, fastest };
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm run test -- derive` → Expected: PASS

- [ ] **Step 5: 本地 commit**

```bash
git add src/lib/derive.ts tests/derive.test.ts
git commit -m "feat(src): 排序比较器 + 今日推荐选择 (表驱动测试)"
```


---

## Task 8: 主题（深/浅色）

**Files:**
- Create: `src/lib/useTheme.ts`, `src/components/ThemeToggle.tsx`
- Modify: `src/App.tsx`（下一步会整体替换，此处先不改）

- [ ] **Step 1: 写 `src/lib/useTheme.ts`**

```ts
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "iq-radar-theme";

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(KEY) as Theme) ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}
```

- [ ] **Step 2: 写 `src/components/ThemeToggle.tsx`**

```tsx
import { useTheme } from "../lib/useTheme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button className="card" onClick={toggle} aria-label="切换主题">
      {theme === "dark" ? "☀️ 浅色" : "🌙 深色"}
    </button>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc -b` → Expected: 无错误

- [ ] **Step 4: 本地 commit**

```bash
git add src/lib/useTheme.ts src/components/ThemeToggle.tsx
git commit -m "feat(src): 深/浅色主题 hook + 切换按钮"
```

---

## Task 9: 状态横幅（StatusBanner）

**Files:**
- Create: `src/components/StatusBanner.tsx`

- [ ] **Step 1: 写 `src/components/StatusBanner.tsx`**

```tsx
import type { StatusSummary } from "../types";

const ok = (i: string) => i === "none" || i === "operational";

export function StatusBanner({ status }: { status: StatusSummary }) {
  const bad = status.components.filter((c) => c.status !== "operational" && c.status);
  const latest = status.incidents[0];
  return (
    <section className="card" aria-label="OpenAI 服务状态">
      <strong className={ok(status.indicator) ? "up" : "down"}>
        {status.description || "状态未知"}
      </strong>
      <div className="muted" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(bad.length ? bad : status.components).slice(0, 12).map((c, i) => (
          <span key={i}>{c.name}: {c.status}</span>
        ))}
      </div>
      {latest && (
        <p className="down" style={{ marginTop: 8 }}>
          最近事件：{latest.name}（{latest.status}）
        </p>
      )}
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        数据来源：<a href="https://status.openai.com/" rel="noreferrer" target="_blank">status.openai.com</a>
        （运行状态，不代表本平台特定模型可用性）
      </p>
    </section>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -b` → Expected: 无错误

- [ ] **Step 3: 本地 commit**

```bash
git add src/components/StatusBanner.tsx
git commit -m "feat(src): StatusBanner 组件"
```

---

## Task 10: 今日推荐（TodayPicks）

**Files:**
- Create: `src/components/TodayPicks.tsx`
- Test: `tests/TodayPicks.test.tsx`

- [ ] **Step 1: 写失败测试 `tests/TodayPicks.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayPicks } from "../src/components/TodayPicks";
import type { ModelRow } from "../src/types";

const base: ModelRow = { model: "gpt-x", effort: "HIGH", harness: "codex", iq: 110.4,
  passed: 103, valid_tasks: 141, pass_rate: 0.73, avg_price_usd: 1.83, avg_minutes: 9,
  recommend_score: 96.4, iq_delta_7d: -4, latest_graded_at: null, total_runs: 147 };

describe("TodayPicks", () => {
  it("renders three picks with iq/percent", () => {
    render(<TodayPicks rows={[base]} />);
    expect(screen.getByText("今日推荐")).toBeInTheDocument();
    expect(screen.getAllByText("110.4").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npm run test -- TodayPicks` → Expected: FAIL

- [ ] **Step 3: 写 `src/components/TodayPicks.tsx`**

```tsx
import { pickTodayPicks } from "../lib/derive";
import { fmtIq, fmtMinutes, fmtMoney, fmtPercent } from "../lib/format";
import type { ModelRow } from "../types";

function Card({ label, row, metric }: { label: string; row: ModelRow | null; metric: string }) {
  return (
    <div className="card">
      <div className="muted">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{row ? `${row.model} · ${row.effort}` : "—"}</div>
      <div>{metric}</div>
      {row && (
        <div className="muted" style={{ fontSize: 12 }}>
          IQ {fmtIq(row.iq)} · {fmtMinutes(row.avg_minutes)} · {fmtMoney(row.avg_price_usd)} · 通过 {fmtPercent(row.pass_rate)}
        </div>
      )}
    </div>
  );
}

export function TodayPicks({ rows }: { rows: ModelRow[] }) {
  const p = pickTodayPicks(rows);
  return (
    <section aria-label="今日推荐">
      <h2>今日推荐</h2>
      <p className="muted">推荐分 = IQ − 1.5 × 分钟</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Card label="要最聪明" row={p.smartest} metric={p.smartest ? fmtIq(p.smartest.iq) : "—"} />
        <Card label="要性价比" row={p.value} metric={p.value ? `推荐分 ${p.value.recommend_score}` : "—"} />
        <Card label="要最快" row={p.fastest} metric={p.fastest ? fmtMinutes(p.fastest.avg_minutes) : "—"} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm run test -- TodayPicks` → Expected: PASS

- [ ] **Step 5: 本地 commit**

```bash
git add src/components/TodayPicks.tsx tests/TodayPicks.test.tsx
git commit -m "feat(src): TodayPicks 组件 + 渲染测试"
```

---

## Task 11: 综合推荐表（可排序 RecommendTable）

**Files:**
- Create: `src/components/RecommendTable.tsx`
- Test: `tests/RecommendTable.test.tsx`

- [ ] **Step 1: 写失败测试 `tests/RecommendTable.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecommendTable } from "../src/components/RecommendTable";
import type { ModelRow } from "../src/types";

const mk = (o: Partial<ModelRow>): ModelRow => ({ model: "m", effort: "high", harness: "codex",
  iq: 100, passed: 1, valid_tasks: 1, pass_rate: 1, avg_price_usd: 1, avg_minutes: 10,
  recommend_score: 85, iq_delta_7d: 0, latest_graded_at: null, total_runs: 1, ...o });

describe("RecommendTable", () => {
  it("renders rows", () => {
    render(<RecommendTable rows={[mk({ model: "A" }), mk({ model: "B" })]} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行验证失败**

Run: `npm run test -- RecommendTable` → Expected: FAIL

- [ ] **Step 3: 写 `src/components/RecommendTable.tsx`**

```tsx
import { useMemo, useState } from "react";
import { sortRows, type SortKey } from "../lib/derive";
import { fmtIq, fmtMinutes, fmtMoney, fmtPercent } from "../lib/format";
import type { ModelRow } from "../types";

const COLS: { key: SortKey; label: string; render: (r: ModelRow) => string }[] = [
  { key: "model", label: "模型", render: (r) => r.model },
  { key: "effort", label: "档位", render: (r) => r.effort.toUpperCase() },
  { key: "iq", label: "IQ", render: (r) => fmtIq(r.iq) },
  { key: "avg_minutes", label: "耗时", render: (r) => fmtMinutes(r.avg_minutes) },
  { key: "avg_price_usd", label: "成本", render: (r) => fmtMoney(r.avg_price_usd) },
  { key: "pass_rate", label: "通过率", render: (r) => fmtPercent(r.pass_rate) },
  { key: "recommend_score", label: "推荐分", render: (r) => (r.recommend_score == null ? "—" : String(r.recommend_score)) },
];

export function RecommendTable({ rows }: { rows: ModelRow[] }) {
  const [key, setKey] = useState<SortKey>("recommend_score");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(() => sortRows(rows, key, dir), [rows, key, dir]);
  const click = (k: SortKey) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setKey(k); setDir(k === "model" || k === "effort" ? "asc" : "desc"); }
  };
  return (
    <section className="card" aria-label="综合推荐">
      <h2>综合推荐</h2>
      <table role="table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key} style={{ textAlign: "left", cursor: "pointer" }} onClick={() => click(c.key)}>
                {c.label}{c.key === key ? (dir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>
              {COLS.map((c) => (
                <td key={c.key} style={{ padding: "6px 4px", borderTop: "1px solid var(--line)" }}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm run test -- RecommendTable` → Expected: PASS

- [ ] **Step 5: 本地 commit**

```bash
git add src/components/RecommendTable.tsx tests/RecommendTable.test.tsx
git commit -m "feat(src): RecommendTable 可排序表 + 渲染测试"
```

---

## Task 12: 智力天梯 / 速度天梯（Ladders）

**Files:**
- Create: `src/components/Ladders.tsx`

- [ ] **Step 1: 写 `src/components/Ladders.tsx`**

```tsx
import { sortRows } from "../lib/derive";
import { fmtIq, fmtMinutes } from "../lib/format";
import type { ModelRow } from "../types";

function List({ title, unit, items }: { title: string; unit: string; items: { r: ModelRow; val: string }[] }) {
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      <div className="muted">{unit}</div>
      <ol style={{ paddingLeft: 20, margin: "8px 0 0" }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            <span>{it.r.model} <span className="muted">{it.r.effort.toUpperCase()}</span></span>
            <strong>{it.val}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function IQLadder({ rows }: { rows: ModelRow[] }) {
  const items = sortRows(rows, "iq", "desc").slice(0, 27)
    .map((r) => ({ r, val: fmtIq(r.iq) }));
  return <List title="智力天梯" unit="IQ INDEX" items={items} />;
}

export function SpeedLadder({ rows }: { rows: ModelRow[] }) {
  const items = sortRows(rows, "avg_minutes", "asc").slice(0, 27)
    .map((r) => ({ r, val: fmtMinutes(r.avg_minutes) }));
  return <List title="速度天梯" unit="平均耗时" items={items} />;
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -b` → Expected: 无错误

- [ ] **Step 3: 本地 commit**

```bash
git add src/components/Ladders.tsx
git commit -m "feat(src): 智力天梯 / 速度天梯组件"
```

---

## Task 13: IQ 趋势曲线（TrendChart，Recharts）

**Files:**
- Create: `src/components/TrendChart.tsx`

- [ ] **Step 1: 写 `src/components/TrendChart.tsx`**

```tsx
import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { HistorySeries } from "../types";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2"];

export function TrendChart({ series }: { series: HistorySeries[] }) {
  // 默认展示 IQ 最高(末点)的前 6 条 model×effort 曲线
  const top = useMemo(
    () => [...series]
      .filter((s) => s.points.some((p) => p.iq != null))
      .sort((a, b) => (b.points.at(-1)?.iq ?? 0) - (a.points.at(-1)?.iq ?? 0))
      .slice(0, 6),
    [series]
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const data = useMemo(() => {
    const byTs = new Map<string, Record<string, number>>();
    for (const s of top) {
      for (const p of s.points) {
        if (p.iq == null) continue;
        const row = byTs.get(p.at) ?? {};
        row[`${s.model}·${s.effort}`] = p.iq;
        byTs.set(p.at, row);
      }
    }
    return [...byTs.entries()]
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([at, v]) => ({ at: new Date(at).toLocaleDateString("zh"), ...v }));
  }, [top]);

  if (top.length === 0) return <section className="card"><h2>IQ 趋势</h2><p className="muted">暂无历史数据</p></section>;

  return (
    <section className="card" aria-label="IQ 趋势">
      <h2>IQ 趋势（降智可视化）</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {top.map((s, i) => {
          const k = `${s.model}·${s.effort}`;
          const off = hidden.has(k);
          return (
            <button key={k} className="muted" onClick={() => setHidden((h) => { const n = new Set(h); n.has(k) ? n.delete(k) : n.add(k); return n; })}
              style={{ color: off ? "var(--muted)" : COLORS[i % COLORS.length], background: "none", border: "1px solid var(--line)", borderRadius: 8, cursor: "pointer" }}>
              {k}
            </button>
          );
        })}
      </div>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--line)" />
            <XAxis dataKey="at" stroke="var(--muted)" />
            <YAxis stroke="var(--muted)" domain={["auto", "auto"]} />
            <Tooltip />
            {top.map((s, i) => {
              const k = `${s.model}·${s.effort}`;
              if (hidden.has(k)) return null;
              return <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} />;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -b` → Expected: 无错误

- [ ] **Step 3: 本地 commit**

```bash
git add src/components/TrendChart.tsx
git commit -m "feat(src): TrendChart IQ 趋势曲线 (Recharts)"
```

---

## Task 14: App 组合（加载 / 错误 / 空态）

**Files:**
- Modify: `src/App.tsx`（整体替换 Task 1 的占位）

- [ ] **Step 1: 用完整版替换 `src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { loadAll } from "./data/loader";
import type { Latest, History } from "./types";
import { ThemeToggle } from "./components/ThemeToggle";
import { StatusBanner } from "./components/StatusBanner";
import { TodayPicks } from "./components/TodayPicks";
import { RecommendTable } from "./components/RecommendTable";
import { IQLadder, SpeedLadder } from "./components/Ladders";
import { TrendChart } from "./components/TrendChart";

export default function App() {
  const [data, setData] = useState<{ latest: Latest; history: History } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll().then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  if (error) return <main><ThemeToggle /><div className="card down">加载数据失败：{error}</div></main>;
  if (!data) return <main><ThemeToggle /><div className="card muted">加载中…</div></main>;

  const { latest, history } = data;
  return (
    <main>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>降智雷达</h1>
        <ThemeToggle />
      </header>
      <StatusBanner status={latest.status} />
      {latest.models.length === 0 ? (
        <div className="card muted">暂无模型数据</div>
      ) : (
        <>
          <TodayPicks rows={latest.models} />
          <RecommendTable rows={latest.models} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <IQLadder rows={latest.models} />
            <SpeedLadder rows={latest.models} />
          </div>
          <TrendChart series={history.series} />
        </>
      )}
      <footer className="muted" style={{ fontSize: 12 }}>
        数据更新：{latest.source_updated_at ?? "—"}（抓取于 {latest.generated_at}）·
        来源 <a href="https://codexradar.com" target="_blank" rel="noreferrer">codexradar</a> ·
        本项目不自建评测，降智/趋势来自源站历史数据。
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: 全量测试 + 构建**

Run: `npm run test` → Expected: 全部 PASS
Run: `npm run build` → Expected: 成功，产出 `dist/`
Run: `npm run preview` → 手动浏览器打开确认各区块渲染（本地验证，不 push）

- [ ] **Step 3: 本地 commit**

```bash
git add src/App.tsx
git commit -m "feat(src): App 组合全部区块 + 加载/错误/空态"
```

---

## Task 15: refresh-data.yml（每日抓取回写）

**Files:**
- Create: `.github/workflows/refresh-data.yml`

- [ ] **Step 1: 写 `.github/workflows/refresh-data.yml`**

```yaml
name: refresh-data
on:
  schedule:
    - cron: "30 0 * * *"   # 每天一次 (UTC)，约东八区 08:30，跟在上游日更之后
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: refresh-data
  cancel-in-progress: false
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: true
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm run refresh
      - name: Commit data if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/data/latest.json public/data/history.json
          if ! git diff --cached --quiet; then
            git commit -m "chore(data): refresh IQ data [skip ci]"
            git push
          else
            echo "no data change"
          fi
```

> 说明：`[skip ci]` 避免数据 commit 触发其它 push workflow 的无限循环；`deploy.yml`（Task 16）用路径过滤监听 `public/data/**`，数据更新仍需部署——若用 `[skip ci]` 会被跳过。解决：`deploy.yml` 里额外由 `refresh-data.yml` 末尾显式 `workflow_run` 触发（见 Task 16 Step 1 备注）。二选一即可，实施时按 Task 16 采用 `workflow_run`。

- [ ] **Step 2: 本地 YAML 语法自检**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/refresh-data.yml','utf8');if(!/cron:/.test(s))throw 0;console.log('ok')"` → Expected: `ok`

- [ ] **Step 3: 本地 commit（不 push，不启用）**

```bash
git add .github/workflows/refresh-data.yml
git commit -m "ci: refresh-data workflow (每日抓取回写 main, 零配置 GITHUB_TOKEN)"
```

---

## Task 16: deploy.yml（构建并发 GitHub Pages）

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: 写 `.github/workflows/deploy.yml`**

```yaml
name: deploy-pages
on:
  push:
    branches: [main]
    paths:
      - "src/**"
      - "index.html"
      - "package.json"
      - "package-lock.json"
      - "vite.config.ts"
      - "tsconfig*.json"
      - "public/data/**"
  workflow_run:
    workflows: ["refresh-data"]
    types: [completed]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm run test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.out.outputs.page_url }}
    steps:
      - id: out
        uses: actions/deploy-pages@v4
```

> `workflow_run` 用于在 `refresh-data` 用 `[skip ci]` 提交数据后仍能触发部署；它默认检出的是触发时的 main HEAD，数据已在仓库，构建即用最新 `public/data`。

- [ ] **Step 2: 本地 commit（不 push，不启用）**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy-pages workflow (test→vite build→Actions 直发 Pages)"
```

---

## Task 17: README + 收尾验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 `README.md`**

```markdown
# 降智雷达 · ChatGPT IQ Check

纯前端「降智雷达」：实时展示各模型（含 ChatGPT/GPT 系列）在不同推理档位下的 IQ、
耗时、成本、通过率，并用趋势曲线直观呈现「降智」（智力下降）。

## 数据来源（无需密钥，匿名可拉）
- IQ/趋势：https://codexradar.com/data/intelligence-efficiency.json （含 points 当前值 + history 全时序）
- 服务状态：https://status.openai.com/api/v2/summary.json

本项目**不自建评测、不自写降智检测**，趋势与降智完全消费源站自带的 history。

## 本地开发
    npm install
    npm run dev            # 开发预览
    npm run refresh        # 重新抓取并生成 public/data/*.json（需联网）
    npm run test           # Vitest
    npm run build          # 产出 dist/（base=/ChatGPT-IQ-Check/）

## 部署（GitHub Pages via Actions）
1. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
2. push 到 main 触发 `deploy-pages`；`refresh-data` 每天抓取并回写数据。

> ⚠️ 首次 push、启用 Actions、开启 Pages、以及任何部署，均需本人手动确认。
```

- [ ] **Step 2: 最终全量验证**

Run: `npm run test` → Expected: 全部 PASS
Run: `npm run build` → Expected: 成功

- [ ] **Step 3: 本地 commit**

```bash
git add README.md
git commit -m "docs: README (数据源/本地开发/Pages 部署/确认红线)"
```

---

## Self-Review（写完计划后的自查）

**1. Spec 覆盖：**
- §2 数据源 → Task 4（两 URL 抓取）✅
- §4.1 refresh（每日/零配置 GITHUB_TOKEN/`[skip ci]`）→ Task 15 ✅
- §4.2 deploy（configure/upload/deploy-pages）→ Task 16 ✅
- §3 架构（浏览器只读静态 JSON、裁剪在 Actions）→ Task 4/5 ✅
- §5 前端区块（状态/今日推荐/综合表/两 ladder/TrendChart/theme）→ Task 8-14 ✅
- §6 数据契约（latest/history 形状）→ Task 2/3/4 生成，Task 5 类型对齐 ✅
- §7 容错（重试/保留旧数据/前端空错态）→ Task 4（重试+不覆盖）、Task 14（空/错/加载态）✅
- §8 测试（Vitest 表驱动 + 契约 fixture + 组件渲染）→ Task 2/3/5/6/7/10/11 ✅
- §9 红线（不 push/不部署，须确认）→ 计划顶部 + 每 commit 步骤 + README ✅

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤均给出完整代码与确切命令 ✅

**3. 类型一致性：**
- `ModelRow`/`Latest`/`History`/`HistorySeries`/`StatusSummary` 定义于 Task 5 `src/types.ts`，
  组件（Task 9-14）与 loader（Task 5）引用一致 ✅
- `transformLatest/transformHistory/transformStatus/computeIqDelta` 命名在 Task 2/3/4 一致 ✅
- `sortRows(rows, key, dir)`、`pickTodayPicks(rows)`、`urlFor(rel)`、格式化函数签名前后一致 ✅
- 契约字段名（`recommend_score`/`iq_delta_7d`/`pass_rate`/`avg_minutes`/`avg_price_usd`）在
  生成(Task2)、类型(Task5)、渲染(Task11/12) 三处一致 ✅

**待用户确认事项（不阻塞写代码，但阻塞 push/部署）：**
- Pages Source 设为 GitHub Actions（一次性设置，需用户在仓库 Settings 操作或授权）
- 是否要我把本地 commit 历史 push 到 origin（默认**不推**）
