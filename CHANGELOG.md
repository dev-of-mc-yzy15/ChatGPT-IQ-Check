# 变更记录

本项目自 `6aea61b` Initial commit 起未发布正式版本，以下按 `Keep a Changelog` 分组记录移交前的整改。

## 未发布

### 新增

- 从零搭建前端骨架：React 19 + Vite 8 + Vitest 5，base 固定为 `/ChatGPT-IQ-Check/`（`src/`、`tests/setup.ts`、`vite.config.ts`、`tsconfig.json`；代表 commit `88b5360`）。
- 数据抓取管线：binding / summary 归一化、本轮雷达转换与评分、`refresh` CLI 抓取三源并原子写入（`scripts/lib.mjs`、`scripts/refresh.mjs`；代表 commit `13b87dd`、`d39cc27`、`1e10201`）。
- 静态 JSON 加载层，含超时、结构校验与三槽错误态（`src/data/loader.ts`；代表 commit `210a907`）。
- 派生与格式化纯函数：排序、Δ 计算、降智点判定、UTC 日桶、矩阵列（`src/lib/derive.ts`、`src/lib/format.ts`；代表 commit `ca2eadd`）。
- 主题切换、跳过链接、错误边界、新鲜度横幅（`src/components/`、`src/lib/useTheme.ts`；代表 commit `5fd7be3`）。
- 本轮雷达矩阵与逐题详情视图（`RoundMatrix.tsx`、`RoundDetail.tsx`；代表 commit `6f853ce`）。
- RadarBench 候选表，含排序、筛选与选择（`CandidateTable.tsx`；代表 commit `427ee87`）。
- 自绘 SVG 趋势图与曲线选择，支持缺口、降智点、provisional 三档标注（`TrendChart.tsx`、`TrendControls.tsx`；代表 commit `28862b8`）。
- App 层组合：本轮雷达、趋势、关于三区，含加载态与错误态（`src/App.tsx`；代表 commit `a61d507`）。
- 响应式、无障碍与 SEO 收尾（`index.html`、`theme.css`；代表 commit `721f2ba`）。
- 新鲜度横幅消费 `binding_total` / `min_latest` / `stale_count` 三个此前无人读的字段（`FreshnessBanner.tsx`；`f6dd262`）。
- 首次落库真实数据快照，34/34 候选抓取成功、`stale_days = 0`（`public/data/`；`5811630`）。
- 移交前重抓上游数据刷新 `public/data/`，`checked_at` 更新至 2026-10-30，`reused_count` / `missing_count` 均为 0（`813e6d0`）。

### 变更

- 数据契约由双端双实现改为单一实现，`scripts/contract.mjs` 统一供管道与浏览器调用（`254356a`，前身见 `13b87dd`）。
- 候选身份串收敛到 `candidateKey` / `parseCandidateKey`，替掉 9 处手写 `model|effort` 拼接（`e4502ba`）。
- `scripts/*.mjs` 纳入 `checkJs` 类型检查，新增独立 `tsconfig.scripts.json` 并挂进 build 链（`1330bf2`）。
- 满分、任务数等魔法值改为从数据读取，替掉硬编码 150 与写死 7 题（`c88d47c`、`4c1e5e3`）。
- 性能收尾：`Intl` 格式化器提到模块级、Δ 预计算消除 O(n²)、`writeJson` 补 `fsync`（`95b7698`）。
- 补齐 AGPL 许可头、`NOTICE` 的 §13 对应源码声明与仓库元数据（`LICENSE`、`NOTICE`、`package.json`；`f882bb7`）。
- 修正 README 与代码不一致的七处描述（`972535c`）。
- 修正 `.claude` preview 地址与 spec 状态行（`aff1944`）。
- 设计规格与实施计划文档的更迭：新增后又整体移除 `docs/superpowers/` 生成物，再于移交前重新纳入版本控制（`9eb87e4`、`26d0dba`、`8083365`、`581a002`、`f882bb7`）。
- 补 README 与 refresh / deploy 两个 workflow，用 `workflow_run` 绕开 `GITHUB_TOKEN` 推送不触发下游 workflow 的限制（`d84fc8b`、`89a3977`）。

### 修复

- 三份数据改分槽加载，任一槽失败不再整页白屏；重试只重试失败槽（`4e2eca3`，配合 `ErrorBoundary` 判据改为 `hasError`）。
- 空串 / `null` / `NaN` 不再被 `Number(x ?? 0)` 静默折成 0，校验失败直接抛（`e3ffd30`、`d095576`、`eee61a9`）。
- 候选下限不再被 `max(30, …)` 钉死，上游候选少于 30 时不再永久刷新失败（`3657ead`、`eee61a9`）。
- `status.ok` / `round_ok` 由硬编码真值改为按实际结果计算；无实质变化时不写盘，消除每日空提交（`3657ead`）。
- 覆盖率闸门对 `required_tasks = 0` 生效，`NaN` 覆盖率不再放行降智标记（`063ac94`）。
- 降智红点、散点与折线统一走按 UTC 日去重的同一序列，同日多次评分不再让红点飘出折线（`063ac94`、`99bf530`）。
- 未知档位不再整列消失，`effortRank` 将其排到末尾并单独成列（`256b36b`）。
- 新鲜度告警边界 `>` 改 `>=`，`null` 与 `NaN` 的 `stale_days` 一律走「未知」分支（`4e2eca3`、`3119def`）。
- 抓取失败的 `errors` 按 success / reused / missing 三类分开记账，坏旧数据不再与 `ENOENT` 混成一个 `null`（`339c810`）。
- 无障碍修复：tab 补 `tabpanel` 与方向键、图例改 `button` 可点灭、选中格补样式、英文模型名包 `lang="en"`（`5083cf2`、`3119def`、`22548ba`）。
- 补齐 WCAG 2.2 AA 十项缺陷：重复朗读、标签名、区域命名、滚动容器、重名按钮、纯色编码、竞态与键盘操作（`e0ab95a`）。
- 核验分母改必做题数、盲评分数归一到百分比、`coverage` 分母为 0 时显示破折号（`5083cf2`、`256b36b`）。
- 首绘主题脚本拆成两个独立 `try`，存储不可用时不再拖垮配色与 `theme-color`（`80f3a58`、`3119def`）。
- `fetch` 超时的英文 `DOMException` 翻成中文并带毫秒，原始 error 挂 `cause` 留证（`a0c4048`）。
- 375px 下 grid 子项允许收缩，消除整页横向溢出（`20db004`）。
- 本轮头部、时间戳展示与分数色阶修正，详情格式收口（`d2d270e`）。
- 48h 与 7d 两级新鲜度告警分级，顺带收口主题切换与错误边界（`05b92d2`）。
- 修回被误塞进 JSX 属性区的注释（`ThemeToggle.tsx`；`78634ab`）。
- 时间戳、`asset.sha256`、分数上限等 round 侧静默漂移收口（`13707fd`、`24685d8`、`eee61a9`）。

### 测试与工程

- 新增 `pull_request` 校验门，`tsc` / `test` / `build` 不再只在主干上事后验（`.github/workflows/ci.yml`；`f1ec52d`）。
- 数据刷新 workflow：提交前先 `rebase` 到 `origin/main`、失败 issue 按标题去重、`paths` 白名单补 `scripts/**`（`0e59fe1`）。
- workflow 断言测试，锁定 node 版本、`[skip ci]`、`workflow_run` 门控与权限范围（`tests/workflows.test.ts`；`89a3977`、`f1ec52d`、`0e59fe1`）。
- 契约测试：同一坏 payload 在管道侧与浏览器侧抛同一处字段（`tests/contract.test.ts`；`254356a`）。
- `derive` 全量纯函数用例，覆盖降智阈值、覆盖率闸门、UTC 日桶与平局处理（`tests/derive.test.ts`；`6ca9920`）。
- loader 唯一网络出口的专属用例：超时、非 2xx、并发独立 signal（`tests/loader.test.ts`；`a0c4048`）。
- `format` 库的守卫用例（`tests/format.test.ts`；`df08833`）。
- 钉死 `fmtSeconds` 负时长取错误分钟位的回归用例（`253c5d9`）。
- 各组件回归用例随修复同步补齐（`tests/` 下 15 个测试文件；贯穿 `d764ebc`、`4e2eca3`、`256b36b`、`5083cf2`、`3119def`）。

## 已知问题

- **上游动画资产接入即 404。** 上游 `asset_url` 是站点根绝对路径（形如 `/assets/degradation-….html.txt`），而 `public/assets/` 目录并不存在，直接渲染会 34/34 全部打空。接线前必须先下载产物落进 `public/assets/`、按 `asset_sha256` 校验、经 `urlFor()` 解析（Pages 的 base 是 `/ChatGPT-IQ-Check/`），iframe 用 `sandbox="allow-scripts"` 且不要加 `allow-same-origin`。出处：`docs/quality-remediation/REMEDIATION-PLAN-REVIEWED.md` §5、README「动画资产：已记录，尚未渲染」。
- **`asset_sha256` 尚无 UI 消费方。** 该字段已随 `eee61a9` 落进类型、契约与转换层，`round.json` 里也有真实值，但界面还没有播放动画的位置，校验和目前只是被记下来。
- **`npm audit` 在本机镜像下不可用。** 当前 registry 为 `https://registry.npmmirror.com/`，其未实现该 API，实测返回 `404 [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet`。需显式打公网：`npm audit --registry=https://registry.npmjs.org/`（实跑结果为 0 漏洞）。
- **上游 round 数据本身仍陈旧。** 移交前虽已重抓一次（`813e6d0`，`checked_at` 刷新至 2026-10-30），但那只是刷新了检查时间：`round_updated_at` 仍停在 `2026-10-24T14:30:39Z`（约 6.2 天），`min_latest` 是 `2026-10-21T02:39:21Z`（约 9 天），`stale_count` 为 **28/34**。上游迟迟不发新的评分轮次，改代码解决不了，得等上游或把刷新频率与告警阈值一起重估。
- **`derive` 三处缺陷在测试里已标注待修，代码尚未跟进。** `lastPerDay` 末尾用字符串字典序排序（`a.at < b.at`）而非 `Date.parse` 比较，混合时区会倒挂并漏报降智；`buildDailyGrid` 同日取值依赖数组位置，且 1970 坏点没有跨度上限；`Math.min(...spread)` 在 6 条曲线各带一个 1970 坏点时抛 `RangeError`。出处：`6ca9920` 的 commit message 与 `tests/derive.test.ts`。
- **整改计划中被驳回的 minor 条目仍维持原状。** 计划 §5 明确不做：`task_count` 写回 7（上游已扩到 9 题集，故未回退）、合并双校验（已由 `contract.mjs` 单一化替代）、引入 `react-error-boundary`（仍用自研 `ErrorBoundary`）。另 `fmtRelativeTime`、`loadStatus` 超时两条已在实现中落地，无需再动。
- **零 e2e、零真实浏览器验证。** 全量测试跑在 jsdom 上，base 路径冒烟只有 `95b7698` 记录的一次手工 200 检查，没有自动化兜住。

## 许可

[AGPL-3.0-or-later](./LICENSE)，第三方数据与商标说明见 [NOTICE](./NOTICE)。

`public/data/` 下的数据不在本项目 AGPL 再许可范围内，版权归 codexradar.com 所有。
