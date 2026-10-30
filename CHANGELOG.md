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
- 上游降智动画资产落地并渲染：34 个产物按 `asset_sha256` 逐个校验后存入 `public/assets/`，`assetUrl()` 剥掉上游根绝对前缀、按 `localAssetName()` 把上游的 `.html.txt` 映射成本地 `.html`（只改后缀，内容与 `asset_sha256` 不变）再经 `urlFor()` 拼 base，详情页折叠、展开才挂出 iframe，`sandbox="allow-scripts"` 且不含 `allow-same-origin`，旁边显示校验和前 8 位（`src/lib/asset.ts`、`RoundDetail.tsx`、`public/assets/`）。两条成因都在初始实现里踩实了：`.html.txt` 会被托管按扩展名回 `text/plain`，iframe 用 `src` 只会显示源码；而 `srcDoc` 生成的子文档继承父文档 CSP，`index.html` 的 `script-src` 只放行父页面自己那一个 hash，34 个产物里 23 个的内联 `<script>` 会被 `script-src-elem` 全部挡掉、只剩静帧——`src` 指向的真实 URL 子文档有自己的 policy container，不继承父 CSP，这才走得通。新增 `tests/e2e/animation-csp.spec.ts` 当常驻闸门（子 frame 内脚本真的执行过 + 子文档零 CSP 违规 + 产物按 `text/html` 回）。
- `index.html` 的 CSP 补 `font-src 'self' data: https://fonts.gstatic.com`，`style-src` 放行 `https://fonts.googleapis.com`：缺 `font-src` 时字体回落到 `default-src 'self'`，产物里引外部 Google Fonts 的那部分会被拒。`script-src` 保持只放行父页面那一个 hash，没有为了让动画跑而引入 `'unsafe-inline'`。
- `derive` 四处时间口径缺陷收口：`lastPerDay` 改按解析后的毫秒排序，不再拿 `at` 原始字符串比字典序（混时区会把跌算成涨并漏报降智）；`buildDailyGrid` 与 `lastPerDay` 共用 `latestPerUtcDay`，同日取值统一按毫秒取最新而非数组末位；`Math.min(...spread)` 改成单趟循环，六条曲线各带一个 1970 坏点也不再撑爆实参；网格跨度加 `MAX_GRID_DAYS`（1100 天）封顶，两万多空桶不再把横轴拉成一条线（`src/lib/derive.ts`、`TrendChart.tsx`；`5220254`、`2207ec2`）。对应 XFAIL 用例已同步转真断言（`tests/derive.test.ts`）。
- 根绝对路径闸门只认双引号：`scripts/check-base.mjs` 的正则把引号写死成 `"`，而 Vite 对源 HTML 的引号形态是**原样保留**的，产物里实测能留下 `href='/assets/x.css'`、`href=/assets/x.css`、`poster`（旧正则的属性名列表里根本没有它）、`srcset` 逗号后的候选、内联 `style="url(/assets/x.png)"` 五种写法，旧正则一律放过还退 0——`check:base` 是唯一的子路径构建闸门，假绿直接等于线上 404 白屏而 CI 全绿。收口为三条独立发现器（属性 / `srcset` 逐候选 / `url(\s*/`），三种引号形态都认，行内命中按列排序去重；顺带修掉旧正则拿 `//cdn/x` 当违规的**误红**——原先的负向先行断言只挡得住 `ChatGPT-IQ-Check/`、挡不住第二个 `/`，改用 `\/(?!\/)` 放行协议相对外链。新增 `tests/check-base.test.ts` 15 条，全部子进程实跑并按退出码断言（`scripts/check-base.mjs`、`tests/check-base.test.ts`；`ed76c94`）。
- 三处「坏输入照样通关」收口。其一，`scripts/refresh.mjs` 的旧数据只要 JSON 能解析就往下走：`readJsonIfExists` 只保证可解析、形状一概不管，旧实现直接 `.map`，`{"candidates":{}}` 抛 `(intermediate value).map is not a function`、`{"candidates":[null]}` 抛 `Cannot read properties of null`，且都抛在写盘之前——`status.json` 不重写、`errors` 不落账、CI 每天红，正好与同文件注释里「坏旧数据要降级并记 errors、本轮照常跑完」的设计相反；进索引前先过形状关，新增 `indexOldCandidates()`，`candidates` 非数组、元素非对象分别降级并记进 `errors`，跳过而不猜，坏元素绝不允许走进 `reused`（`scripts/refresh.mjs`；`190309b`）。同一提交把 CLI 未知参数从静默忽略改成抛 `UsageError` 退 2——`--forse` 以前按非 force 跑，`contentEqual` 命中时连 `checked_at` 都不重写，用户以为强制刷新过了。其二，`src/lib/derive.ts` 的排序时间键仍在比字符串：`2026-10-23T10:00:00-12:00`（22:00Z）与 `2026-10-23T23:00:00+14:00`（09:00Z）`localeCompare` 给出 -1，整列跨时区倒挂——`lastPerDay` 早先已按毫秒修过，这里漏网；`topCandidates` 的同分 tie-break 同样按串比，而 `App.tsx:130` 正用它选默认 6 条曲线，同分组里会挑中更旧的一条。收口为抽出 `msOrder()` / `msOfNullable()`，坏值恒垫底且不吃方向（取反若写在外层，desc 一定把坏值翻到队首），并补「天数为 NaN 时单元格不写 `/ NaN 天`」的 UI 断言，含有限天数不得被顺手删掉的回归（`tests/derive.test.ts:745-766`）（`src/lib/derive.ts`、`src/components/CandidateTable.tsx`；`ebebbee`）。其三，`src/lib/format.ts` 的 `fmtEffort` 走原型链：`EFFORT_LABELS[effort] ?? 兜底` 只拦得住 null/undefined、拦不住继承来的键，`__proto__` 拿到 `Object.prototype` 进 JSX 直接抛 `Objects are not valid as a React child`、整块被 `ErrorBoundary` 吃掉，`constructor` / `toString` / `hasOwnProperty` 渲染成空还把函数源码拼进 aria-label——`derive.ts` 的 `effortRank` 本就为上游新档位留了通道，这些串真会落进数据；收口为只认自有属性的 `Object.hasOwn` 判据（`src/lib/format.ts`；`db1733d`）。同一提交修掉 `roundTo` 在 1e20 档位取整把值顶到 1e21、拼出非法指数串 `"1e+21e-1"` 得 `NaN`，取整后达到 1e21 直接回落原值（`src/lib/format.ts`；`db1733d`）。其四，`scripts/contract.mjs` 不校验历史点的 `score <= score_max`：候选级（`:215`）有上界、历史点漏了，把某点改成 9999 契约照样通过，`yOf(9999, 150)` 得 -18627.4（绘图区 y 只有 20~304），该点飞出 SVG 视口、外层无 try 且 overflow 裁掉，那截折线直接消失、`delta` 也被污染成上千分；收口为 `assertHistoryPoint(point, path, scoreMax)` 与候选级同一句判法，比较用 `strictNumber` 规范化后的数字，边界（`=== score_max`）必须放行、负分仍按原 `min: 0` 拒（`scripts/contract.mjs`；`da0e950`）。

### 测试与工程

- 新增 `pull_request` 校验门，`tsc` / `test` / `build` 不再只在主干上事后验（`.github/workflows/ci.yml`；`f1ec52d`）。
- 数据刷新 workflow：提交前先 `rebase` 到 `origin/main`、失败 issue 按标题去重、`paths` 白名单补 `scripts/**`（`0e59fe1`）。
- workflow 断言测试，锁定 node 版本、`[skip ci]`、`workflow_run` 门控与权限范围（`tests/workflows.test.ts`；`89a3977`、`f1ec52d`、`0e59fe1`）。
- 契约测试：同一坏 payload 在管道侧与浏览器侧抛同一处字段（`tests/contract.test.ts`；`254356a`）。
- `derive` 全量纯函数用例，覆盖降智阈值、覆盖率闸门、UTC 日桶与平局处理（`tests/derive.test.ts`；`6ca9920`）。
- loader 唯一网络出口的专属用例：超时、非 2xx、并发独立 signal（`tests/loader.test.ts`；`a0c4048`）。
- `format` 库的守卫用例（`tests/format.test.ts`；`df08833`）。
- 钉死 `fmtSeconds` 负时长取错误分钟位的回归用例（`253c5d9`）。
- 钉死无时区 ISO 串按本地时区解释的用例（`tests/format.test.ts`；`c5dd8ab`）。
- 各组件回归用例随修复同步补齐（`tests/` 下 15 个测试文件；贯穿 `d764ebc`、`4e2eca3`、`256b36b`、`5083cf2`、`3119def`）。
- 资产哈希闸门：`scripts/verify-assets.mjs` 逐条比对 `round.json` 钉的 `asset_sha256` 与 `public/assets/` 实际内容，missing / mismatch / unpinned 一律红，孤儿文件只报不判失败；已挂进 `ci.yml` 排在 `check:base` 之后（`tests/verify-assets.test.ts`、`package.json` 的 `verify:assets`）。

## 已知问题

- **`npm audit` 走本机默认 registry 会直接失败。** 本仓库默认 registry 是 `https://registry.npmmirror.com/`，它没实现 audit API，实跑返回 `404 [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet`——不显式指定就会误以为「没有漏洞」，其实是这一步空跑了。**CI 里已经自带** `--registry=https://registry.npmjs.org/`，本机手工跑必须照抄同一串：`npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org/`（实跑结果为 0 漏洞）。
- **上游 round 数据本身仍陈旧。** 移交前虽已重抓一次（`813e6d0`，`checked_at` 刷新至 2026-10-30），但那只是刷新了检查时间：`round_updated_at` 仍停在 `2026-10-24T14:30:39Z`（约 6.2 天），`min_latest` 是 `2026-10-21T02:39:21Z`（约 9 天），`stale_count` 为 **28/34**。上游迟迟不发新的评分轮次，改代码解决不了，得等上游或把刷新频率与告警阈值一起重估。
- **整改计划中被驳回的 minor 条目仍维持原状。** 计划 §5 明确不做：`task_count` 写回 7（上游已扩到 9 题集，故未回退）、合并双校验（已由 `contract.mjs` 单一化替代）、引入 `react-error-boundary`（仍用自研 `ErrorBoundary`）。另 `fmtRelativeTime`、`loadStatus` 超时两条已在实现中落地，无需再动。
- **jsdom 单测兜不住子路径与 CSP，那两块只由 e2e 守。** `npm test` 全跑在 jsdom 上，既不放 CSP 也不做 MIME 检查，子路径失效与 CSP 写歪这两类整页白屏故障在单测里一律是绿的。现已补 `tests/e2e/base-path.spec.ts`，5 条真 Chromium 用例：根路径重定向到子路径且落地页可用、页面自报的脚本与样式逐个可达且 `content-type` 对得上、缺失资源走 SPA fallback（200 + `text/html`）、全程零 CSP 违规/零 console 错误/零未捕获异常、真实业务内容渲染且 `/data/` 请求恰 3 次全落子路径。该用例在 `ci.yml` 里排在构建与产物/资产校验之后真跑（先 `npx playwright install --with-deps chromium`），本地跑前需先 `npx playwright install chromium`。同一条防线上还有 `tests/e2e/animation-csp.spec.ts`：它点进详情、展开折叠面板去咬详情页动画 iframe 里的内联脚本**真的执行过**（按子 frame 的 `requestAnimationFrame` 调用计数判，不是「iframe 出现了」），同时要求子文档与父文档全程零 CSP 违规、零 console 错误、零未捕获异常，并把 iframe 的 `sandbox` 钉成只有 `allow-scripts`、产物 `content-type` 必须回 `text/html`。两类断言缺一不可——只留「零违规」会被「放宽了但漏别处」蒙过去，只留「脚本跑了」会被「父 CSP 压根没生效」蒙过去。它的运行条件与 base-path 用例相同，也在 `ci.yml` 的同一环节里。
- **有一个上游产物自带的 SVG 缺陷：围巾两段路径的 `d` 会周期性地拼坏。** `public/assets/degradation-codex-205416a78068-6a72489e707c-gpt-6-astra-max-7026bb729b07.html:474-476` 用 `const flutter = Math.sin(t * 5.5) * 4` 做颤动，再把数值拼进模板串——`q33 ${-9 - flutter}63 ${-2 - flutter}` 这类相邻两个数值之间**没有写空格分隔符**，`flutter` 的振幅只有 4，`-9 - flutter` 恒落在 [-13, -5]、`-2 - flutter` 也在 [-6, 2] 里几乎恒为负，负号于是紧挨后一个数字、连同本该起分隔作用的 `63` 一起被吞，SVG 解析器把 `q33 -963 -2` 里那个 `-` 当分隔符、只数到 3 个参数，而 `q` 需要 4 个——**这不是过零才有的偶发，是每帧都在触发**（那条用例一次加载就攒了 145 条告警），于是 Chromium 抛 `<path> attribute d: Unexpected end of attribute`，`scarf-tail` / `scarf-fold` 在过零附近抽搐、断形，不致命。34 个产物里**只有这 1 个**有，其余全量遍历干净；`d` 是运行时算出来的，静态 grep 搜不到，只有真浏览器跑脚本才暴露。**未在本地修复**，因为产物是内容寻址的：`round.json:1140` 的 `asset_sha256` 恰是该文件自身的 sha256（`7026bb72…b92867`，文件名末 12 位即其前缀），`scripts/verify-assets.mjs` 逐字节比对、不符即 mismatch，只改一个字节就会让 `npm run verify:assets` 变红并与上游 `asset_url` 的内容漂移；要改就得连 `round.json` 一起改（那是改数据契约），否则只能等上游重跑（`npm run refresh` 会整份覆盖）。`tests/e2e/animation-csp.spec.ts` 只放行这**一个文件**的这**一种错误**：形态正则 `KNOWN_SVG_DEFECT_PATTERN = /<path> attribute d: Unexpected end of attribute/` 与产物文件名 `KNOWN_SVG_DEFECT_ASSET` 必须同时命中，归属靠 console 消息 `location().url` 的末段文件名，详情与「全部产物」两处收集共用同一套规则——按形态全局放行的老写法已收窄，**别的产物犯同样形态仍算红**并点名是哪个产物；同一条用例里还挂着陈旧守卫，该产物一条这类报错都不产生就红，提醒上游若已修复要删掉这条白名单并在此结案。

## 许可

[AGPL-3.0-or-later](./LICENSE)，第三方数据与商标说明见 [NOTICE](./NOTICE)。

`public/data/` 下的数据与 `public/assets/` 下的动画产物均不在本项目 AGPL 再许可范围内，版权归 codexradar.com 所有。
