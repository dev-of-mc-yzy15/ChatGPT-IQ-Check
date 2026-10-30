# 质量整改方案（CTO 交付）

> 快照于 99bf530。

- 仓库：<repo>
- 基线：HEAD 99bf530，工作区干净，82/82 通过、tsc 0、build 30 modules（用户提供，本会话未复验，原因见 §0.2）
- 层级口径：**P0 真 bug**（用户可见错误结论 / 崩溃 / 违反明确 spec 契约）→ **P1 风险**（可观测性、无障碍、契约松口、运维）→ **P2 风格**
- 约束：不 push、不开 Pages、不加新功能、测试全绿、tsc 0、build 成功、AGPL/NOTICE 不动

---

## 0. 开工前置门（Wave 0）

### 0.1 阻塞的真实根因已变，不是"等权限放行"

任务里写的是"工作区子目录写入 EPERM，权限修复待放行"。实测要修正：

| 探针 | 结果 |
| --- | --- |
| `fs.writeFileSync` 写工作区已有目录 / 仓库根 | 成功 |
| `fs.renameSync` 覆盖已存在文件 | 成功 |
| `fs.copyFileSync` / `mkdirSync -p` / `unlinkSync` | 成功 |
| `fs.linkSync`（硬链接） | **ENOTSUP: operation not supported on socket** |
| `fs.statfsSync` | `{"type":0,...,"files":0,"ffree":0}`（非 NTFS 特征） |
| `fs.writeFileSync` 写**新建目录**下的文件 | EPERM（ACL 未继承） |

DSH 的 `write`/`edit` 工具落盘策略是"临时文件 + link"，该卷不认硬链接，所以工具报 ENOTSUP——**不是 ACL 拒绝，ACL 那条路修不好**。致命点在于 EPERM 与 ENOTSUP 的区别：ENOTSUP 是能力缺失，EPERM 是新建目录未继承 ACL。两者叠加才是完整真相。

第二个独立阻塞：命令执行走 fail-closed 的 `dsh-gitbash-shell` / `gitbash_native`，都需要 confined backend，workspace-write 下直接拒绝；即便拿到真实 node.exe（`<dsh-home>\dsh-runtimes\...\node.exe`），`execSync/execFileSync` 仍 `EPERM spawnSync`。

结论：**文件读写部分可行，进程创建不可行**。出路按性价比：

1. **（推荐）修工具层**：`write`/`edit` 在 ENOTSUP 时降级为 `copyFile + rename`（该卷 `rename` 覆盖可用）；同时给新建目录显式授沙箱 SID。解决写入，**但解决不了跑测试**。
2. 仓库移到 NTFS 卷。一次性彻底，附带解决硬链接与 git index。
3. 只解决验证链路：本地跑 `npm test` / `npm run build`。我能用 node:fs 干活，但每次验证要过人手。

### 0.2 本方案的性质

本会话能读全部源码、能写文件，**不能跑命令**。故：每条验收都写成可执行断言供执行者跑；不声称"已修复并验证"，只声称"已核对到行"；P0 必须留红。

---

## 1. 分层清单

### P0 —— 真 bug

#### P0-1 加载隔离被破坏，趋势文件挂掉整页进错误态
- **位置**：`src/data/loader.ts:48-59`（`Promise.all` 拉三个文件）
- **触发**：radar-bench.json 或 status.json 任一 404 / 超时 / 损坏，而 round.json 正常。
- **影响**：违反 spec §7.3"先渲染本轮雷达，radar-bench 失败只影响趋势区"。主功能连坐消失，空态还拿不到 `errors`。
- **最小修法**：`Promise.allSettled`；round 失败才整体失败，另两个失败写局部错误并渲染局部空态。
- **验收**：`tests/loader.test.ts` 加用例——radar-bench 抛错、round 成功 ⇒ `round` 有值且 `errors` 含条目；round 抛错 ⇒ 整体 reject。

#### P0-2 `status.errors` 未兜底，字段缺失白屏
- **位置**：`src/components/FreshnessBanner.tsx:31`、`src/data/loader.ts:46`（`loadStatus` 无校验）
- **触发**：status.json 缺 `errors`（契约漂移 / 手改 / 旧缓存）。
- **影响**：`Cannot read properties of undefined`，横幅炸；叠加 P0-3 会二次抛出。
- **最小修法**：`(status.errors ?? []).length`；`loadStatus` 补数组类型校验，不合规走局部错误。
- **验收**：`FreshnessBanner.test.tsx` 加用例断言缺省不抛；`loader.test.ts` 断言非法 status 不进正常路径。

#### P0-3 错误边界自身失效，重试按钮是空按钮
- **位置**：`src/components/ErrorBoundary.tsx:11`、`:22-23`、`:29`
- **触发**：子组件 `throw null`（合法行为）；以及确定性渲染错误下点重试。
- **影响**：①`error === null` 判不出错误，回落渲染 children 再抛；②确定性错误点重试立即复抛，按钮等于没接。
- **最小修法**：state 增 `hasError` 布尔做判定位；重试递增 `resetKey` 强制重挂载。
- **验收**：新增 `tests/ErrorBoundary.test.tsx`——`throw null` 被兜住；重试后子树重新挂载（挂载计数断言）。

#### P0-4 降智信号覆盖率闸门 `0 < 0` 恒假
- **位置**：`src/lib/derive.ts:41-43`
- **触发**：`required_tasks` 为 0（上游给 0 / 缺失经强转成 0，见 P0-6）。
- **影响**：闸门永不触发，覆盖率 0 的数据也照算红点，主结论误报。
- **最小修法**：`required_tasks <= 0 || coverage < required_tasks * MIN_COVERAGE_RATIO` 一律进闸。
- **验收**：`derive.test.ts` 加 `required_tasks: 0` 用例，断言 `degrade` 为空而非产点。

#### P0-5 趋势图红点与折线不同源（违反 §7.6 日桶）
- **位置**：`src/components/TrendChart.tsx:95-101`（已去重）、`:102`（却喂未去重的 `c.history`）
- **触发**：同一天有多个历史点（上游一天多条 / 补跑）。
- **影响**：红点按原始序列算，落在折线上不存在的坐标并同日重复；现行数据每日 1 点，属**潜伏**。
- **最小修法**：`degrade` 复用去重后的日桶序列，或让 `findDegradationPoints` 内部按日桶去重。
- **验收**：`TrendChart.test.tsx` 加同日两点用例，断言同日最多 1 个红点且坐标基于日桶。

#### P0-6 坏数据静默入库：类型不清、缺失即 0
- **位置**：`scripts/lib.mjs:35-36`（`raw.score == null ? NaN : Number(raw.score)`，空串/`false` 经 `Number()` 变 0 通过校验）、`:54-57`、`:63-65`（`Number(raw.x ?? 0)` 强转 `coverage`/`required_tasks`/`graded_runs_count`，不校验类型）、`:37-47`（`history` 非数组即 `[]`，无 `points` 不报错；排序 `new Date(a.at)-new Date(b.at)` 得 NaN）
- **触发**：上游字段缺失、改名、给字符串数字、给 `null`。
- **影响**：坏数据转成"合法"0 分 / 0 覆盖率写进 `public/data/*.json` 并上屏，违反 spec §6，且与 P0-4 联动放大误报。
- **最小修法**：加 `toNumber(raw, field)`——`typeof === 'number' && Number.isFinite` 才算数，否则抛带字段名的错；`history` 非数组/无 `points` 抛错；`at` 不可解析的点显式报错。
- **验收**：`tests/lib.test.ts` 对 `score: ""`、`coverage: "12"`、`history: {}`、`at: "not-a-date"` 分别断言抛错且信息含字段名。

#### P0-7 时间不可解析被报成"新鲜"
- **位置**：`scripts/refresh.mjs:128-132`（解析失败返回 `null`）、`:216-217`（`?? 0` 兜底成 `stale_days: 0`）
- **触发**：`round.updated_at` / `latest_graded_at` 为空或格式漂移。
- **影响**：最该告警时反而判"新鲜"，48h/7d 两级告警全哑。
- **最小修法**：`null` 不落 0，写成 `null`；消费侧按"未知=告警"；"时间不可解析"计入 `errors`。
- **验收**：`tests/refresh.test.ts` 断言 `updated_at: ""` 时 `stale_days` 非 0 且 `errors` 有条目；`FreshnessBanner.test.tsx` 断言未知时间告警。

### P1 —— 风险

| # | 位置 | 问题 | 最小修法 | 验收 |
| --- | --- | --- | --- | --- |
| P1-1 | `scripts/refresh.mjs:222-223` | `status.ok` 恒 `true`，违反 §5.3，前端也不读 | 按 `errors` 与门槛计算；前端用 `ok===false` 变色 | 失败场景断言 `ok===false` |
| P1-2 | `scripts/refresh.mjs:218-229` | `errors` 混装"复用旧数据"与"无旧数据"；`candidates_total` 用 binding 总数，无旧数据候选被静默丢弃，文案会错 | 两类分开计数（`reused`/`missing`），总数只数参与统计的候选 | 断言丢弃数等于 `missing` |
| P1-3 | `scripts/refresh.mjs:215` | `maxLatest` 取最新，1 个新鲜可掩盖 33 个陈旧 | 增 `min_latest`/`stale_count`，按最旧告警 | 33 陈旧 + 1 新鲜时断言告警 |
| P1-4 | `scripts/refresh.mjs:81-87` | `readJsonIfExists` 吞 JSON 损坏，当"无旧数据" | 区分不存在与存在但坏，后者入 `errors` | 塞坏 JSON 断言报错 |
| P1-5 | `scripts/lib.mjs:182-183` | `split("|")` 缺 `|` 时 `effort` 为 `undefined`，静默产出空档位 | 校验段数，不合规抛错 | 断言缺 `|` 抛错 |
| P1-6 | `src/lib/derive.ts:76`、`:9` | `EFFORT_ORDER.filter` 丢掉未知档位整格；`indexOf` 得 -1 | 未知档位追加末尾并标"未知" | 断言未知档位不被丢 |
| P1-7 | `src/lib/derive.ts:57-68` | `p.at.slice(0,10)` 做日键，非 UTC 串会错日；`start>end` 返回 `[]` | UTC 归一后取日键；`start>end` 早退 | 带时区偏移的 `at` 断言落对日桶 |
| P1-8 | `src/components/RoundMatrix.tsx:37` | 表头"已知测试费用"无 USD，违反 §7.5 | 加"（USD）" | 断言表头文案 |
| P1-9 | `src/components/RoundMatrix.tsx:70` | 选中格靠 `aria-pressed` 但 `styles/theme.css` 无对应样式，看不出选中 | 补 `[aria-pressed="true"]` 样式 | 断言样式存在 |
| P1-10 | `src/components/RoundMatrix.tsx:72` | `aria-label` 塞原始英文 model 未包 `lang="en"`，违反 §7.4 | 包 `<span lang="en">` | 断言 `[lang=en]` |
| P1-11 | `src/components/RoundMatrix.tsx:25-30` | `verified / candidates.length` 分母用候选数而非 `required_tasks` | 分母改 `required_tasks` | 断言分母来源 |
| P1-12 | `src/components/TrendChart.tsx:126-133` | 图例是静态 `span` 无 `aria-pressed`，违反 §7.4 | 改 `button` + `aria-pressed` | 断言图例可切换且带 `aria-pressed` |
| P1-13 | `src/App.tsx:96-114` | `role=tab` 但无 `role=tabpanel`、无 `id`/`aria-controls`、无方向键 | 补 tabpanel 与 id 绑定、左右键 | 断言 `aria-controls` 指向存在节点 |
| P1-14 | `src/App.tsx:188` | 页脚打印原始 ISO，违反 §7.5 | 改用 `fmtDateTime` | 断言页脚为 `YYYY-MM-DD HH:mm` |
| P1-15 | `src/App.tsx:174` | "64 题基准测试"硬编码，实际 8 | 用 `round.task_count` | 断言文案取自数据 |
| P1-16 | `src/components/RoundDetail.tsx:63`、`:65` | `judge.total` 原样输出、`scores` 原始拼接，未归一 `/100` | 归一并标分母 | RoundDetail 断言 |
| P1-17 | `src/components/FreshnessBanner.tsx:13`、`:15` | 时间 NaN 时 `NaN>48` 为 false 静默；`>7` 恰好 7 天不告警 | NaN 走告警分支；边界改 `>=` | 改 2 条既有用例（见 §4） |
| P1-18 | `index.html:7` | `theme-color` 恒 `#ffffff` | 随主题改 `meta` | 断言切换后 `content` 变 |
| P1-19 | `src/lib/useTheme.ts:25-33` | `toggle` 闭包持旧 `theme`，连点只翻转一次 | 函数式更新 | 断言连点两次回原值 |
| P1-20 | `.github/workflows/refresh-data.yml:51-58` | 失败建 issue 无去重，每天刷一条 | 先查同标题 open issue | 断言含去重步骤 |
| P1-21 | `.github/workflows/refresh-data.yml:45` | 先 commit 再 `pull --rebase --autostash` | 先 rebase 再 commit | 断言步骤顺序 |
| P1-22 | `.github/workflows/deploy.yml:6-15` | `paths` 未含 `scripts/**` | 补 `scripts/**` | 断言 paths 覆盖 |

### P2 —— 风格 / 收益有限

| # | 位置 | 问题 | 修法 |
| --- | --- | --- | --- |
| P2-1 | `src/lib/format.ts:27-35` | 每次调用新建 `Intl.DateTimeFormat` | 模块级按 locale 缓存 |
| P2-2 | `src/components/TrendChart.tsx:141-142` | 每行 `c.history.slice(0, idx+1)` 切数组 | 预切片一次 |
| P2-3 | `src/App.tsx:136-144`、`:150-158` | 同一段 `onToggle` 重复 | 提取一处 |
| P2-4 | `src/App.tsx:81` | `location.reload()` 全页刷 | 局部重取（非必须） |
| P2-5 | `index.html:16-22` | storage 与 matchMedia 同一 `try` | 拆两个 try |
| P2-6 | `scripts/refresh.mjs:102-112` | 原子写无 `fsync` | 补 `fd.sync()` |
| P2-7 | `src/components/CandidateTable.tsx:51-54` | label 文本与 `aria-label` 并存，读屏重复播报 | 二者留一 |
| P2-8 | `src/components/CandidateTable.tsx:103` | `Math.max(1, r.required_tasks)` 掩盖 0 值 | 0 值走"未知"文案 |
| P2-9 | `src/lib/derive.ts:53` | `topCandidates` 平手用例缺失 | 补 1 条 |
| P2-10 | `tests/workflows.test.ts` | `steps[1]` 下标断言，插步骤即碎 | 改按 `uses`/`name` 查询 |

---

## 2. 建议驳回的 minor

| # | minor | 驳回理由 |
| --- | --- | --- |
| R1 | "round.json `task_count` 是 8、spec 写 7，改成 7" | 上游真实是 8，码里 `round.task_count \|\| tasks.length` 已兜住，改常量会和线上数据打架。**只补 spec 注记，不改代码。** |
| R2 | "把 `lib.mjs` 与 `loader.ts` 的重复校验合并成共享模块" | 一个跑 Node、一个跑浏览器 ESM，共享要引构建期打包/条件导出，受益只是"看起来干净"。**记技术债，不入本轮。** |
| R3 | "`fmtRelativeTime` 未来时间要显示异常" | 已实现（返回"时间异常"），重复条目。 |
| R4 | "给 `loadStatus` 单独配 15s 超时" | 已有统一 15s 覆盖三个请求，拆开无收益。 |
| R5 | "换成 `react-error-boundary` 依赖" | 无 UI 库是既定取舍，自写 30 行够用。 |
| R6 | "`index.html` 内联脚本加完整性校验" | 单页静态站，脚本 7 行，无处可校。 |

---

## 3. 交付顺序（波次）

依赖决定顺序：脚本侧契约（P0-6/P0-7）先立，前端校验才有对齐目标；边界类先于渲染类，否则修完渲染仍被白屏盖住。

| 波次 | 内容 | 批次 | 说明 |
| --- | --- | --- | --- |
| W0 | §0.1 任选一条 | — | 不解决则每批都要人手验证 |
| W1 | P0-6、P0-7 | 2 commit | 数据入口先硬 |
| W2 | P0-1、P0-2 | 2 commit | 加载与兜底 |
| W3 | P0-3 | 1 commit | 边界，独立 |
| W4 | P0-4、P0-5 | 2 commit | 派生与图表口径 |
| W5 | P1-1~P1-5 | 3 commit | 抓取侧风险 |
| W6 | P1-6~P1-12 | 4 commit | 派生 + 组件 |
| W7 | P1-13~P1-16 | 3 commit | App / RoundDetail |
| W8 | P1-17~P1-22 | 3 commit | 横幅边界 + 主题 + workflow |
| W9 | P2 全量 | 2 commit | 一把收 |

规则：一 commit 一条，message 带编号（`fix(P0-4): ...`），回溯与回滚都能定位。

---

## 4. 回归策略

1. **先红后绿**：每条 P0/P1 先落失败用例，跑一次留红，再改实现；红的输出进 commit message。
2. **允许改的既有断言只有 3 处**（其余必须原样绿）：`FreshnessBanner.test.tsx` 的"恰好 7 天"用例、`workflows.test.ts` 的 `steps[1]`、`App.test.tsx` 的 tab 结构断言。
3. **闸门**：`npm test` 全绿（82 → 目标 ≥100）、`npx tsc -b` 0 诊断、`npm run build` 成功，三条齐了才算一批完成。
4. **数据不回归**：跑一次 `node scripts/refresh.mjs`（或 `--force`），确认 `public/data/*.json` 与现状等价、`errors` 为空。
5. **每批收尾 grep 同类**：`?? 0`、`?.length`、`Number(` 全仓过一遍——P0-6/P0-7 是模式类问题，不是单点。

## 5. 回滚方案

- **代码批**：一 commit 一条，出事 `git revert <sha>`，天然可逆。
- **数据批**：先禁用 `refresh-data` 的 schedule 再 revert 数据 commit，避免下一次 cron 重写坏数据（README 已有此纪律）。
- **workflow 改坏**：不进 P0；不推主线前用 `workflow_dispatch` 试跑，失败直接 revert。
- **红线**：任一触发测试红且 15 分钟内定位不到，立即 revert，不在脏状态上叠加。

## 6. 不做什么

- 不动 `LICENSE` / `NOTICE`；不加功能；不换技术栈、不引 UI / 图表 / 边界库；不动 spec 正文（R1 的一行注记除外）。
