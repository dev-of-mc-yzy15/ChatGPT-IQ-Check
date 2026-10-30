# 质量整改方案 v2（评审后重排 · Lead 裁决版）

> 快照于 99bf530。

- 基线：HEAD 99bf530，工作区干净；证据：13 文件 82/82 测试通过、tsc 0 诊断、build 成功（Lead 本会话实跑，非转述）
- 来源：CTO 方案（QUALITY-REMEDIATION-PLAN.md，39 条）+ 架构 / 安全 / 验收三方独立评审
- 判定：**NEEDS WORK，不是生产就绪**。不是 P0 条数问题，而是「82/82 绿」与「真实浏览器里能用」之间没有证据链（全 jsdom、零 e2e、零 base 路径验证）
- 硬阻塞（唯一）：**工作区所有已存在子目录不可写**，实测 21/21 失败（write/rename/copy 三种落盘 × src、src/components、src/lib、tests、.github/workflows、public/data、docs 全 EPERM），仅仓库根与新 mkdir 目录可写。权限解除前代码整改一条也落不了盘。

---

## 一、三方交叉验证矩阵

| 编号 | 结论 | 提出方 | Lead 核实 | 定级 |
| --- | --- | --- | --- | --- |
| 加载未分槽 | App.tsx:18-22 单 data / :23 单 error / :78-89 三元整页互斥 | 架构 A-2 + 验收 BLK-1 | 已读码确认 | 阻断 |
| 边界粒度错 | ErrorBoundary 只包整页（App.tsx:58、:193），main.tsx:1-5 无兜底 | 架构 A-3 | 已读码确认 | 阻断 |
| 重试是假按钮 | App.tsx:81 location.reload()；ErrorBoundary.tsx:29 只清 state | 架构 A-3 | 已读码确认 | 阻断 |
| P0-1 单独落地无效 | 不改 App 状态机则只换签名仍白屏 | 架构 | 已核（同前三行） | 阻断 |
| status.ok 无消费方 | grep src 仅 types.ts 声明 | 架构 A-11 + 安全 R4 | 已 grep 确认 | 阻断 |
| 每日噪音提交 | stripVolatile 剥戳但 status 不参与比较、:251 无条件写、workflow:40 git add → :41 条件恒真 | 验收 R-6 + 架构 A-7（两人独立命中） | 已读 :89-100/:216-219/:249-251 与 yml:40-49 确认 | 阻断 |
| 无 PR 触发器 | deploy.yml:3 on: 仅 push/workflow_run/dispatch | 架构 A-8 | 已读确认 | 阻断 |
| 候选下限死锁 | refresh.mjs:182 max(30, ceil(n*0.8)) + lib.mjs:111 minCandidates=30 → 上游候选 <37.5 时 minimum 恒大于可用数，刷新永久失败 | 安全 R7 | 已读两处确认（n=20 → 需 30 > 20） | 高危 |
| 校验双实现 | 管道严（lib.mjs:111-127，score 0-150 硬界）/ 浏览器松（loader.ts:22-32 仅 schema_version+非空） | 架构 A-1 | 已读确认 | 阻断 |
| score_max 死字段 | 数据自带 radar-bench.json:8，UI 6 处硬编码 150（TrendChart.tsx:22/:47/:67、RoundMatrix.tsx:41、CandidateTable.tsx:57、App.tsx:174） | 架构 A-4 | 已 grep 确认 | P1 |
| 身份串拼接 9 处 | App.tsx:34/45/53、derive.ts:77、CandidateTable.tsx:88、RoundMatrix.tsx:60、TrendChart.tsx:104/128、TrendControls.tsx:22；有损反解 lib.mjs:183 | 架构 A-5 + 安全 R9 | 已 grep 9 处确认 | P1 |
| 未知档位不可达 | EFFORT_ORDER 既排序又过滤（derive.ts:76），未知档位整列消失、选中入口也在矩阵里 → 候选彻底点不开 | 架构 A-6 | 已读确认 | P1 |
| checkJs false | tsconfig.json:18-19 allowJs true / checkJs false，scripts 在 include 内却零类型检查 | 架构 A-9 | 已读确认 | P1 |
| 断言撞车未授权 | P0-6 打红 tests/lib.test.ts:72-104、P0-1 打红 tests/App.test.tsx:6-88，白名单只给 3 条且不含这两处 | 验收 R-1/R-2 | 已读确认 | 阻断 |
| null>=7 恒假 | types.ts:124 stale_days: number；P0-7 让 null 落地后 P1-17 的 >7 仍不告警 | 验收 R-4 | 已读确认 | 阻断 |
| 上游 sha256 被丢 | lib.mjs:217 只留 asset.url 丢 asset.sha256；asset_url 为根绝对路径与 base 冲突，接入即 404 | 安全 R1 | 已读 :210-218 确认 | 本轮外（见 §5） |

## 二、四条冲突裁决

| # | 冲突 | 裁决 | 依据 |
| --- | --- | --- | --- |
| C1 | P0-1 做多深 | 采架构：拆 Promise.all + App 三槽状态 + 边界下移，同波次不可拆 | 只改 loader 则整页白屏照旧，属无效修复 |
| C2 | P0-6 严到什么面 | 采验收：strict 仅限 radar-bench/binding 标量；round 侧 score 保持可空（lib.mjs:146-148 合法返回 null）；history 保持「缺失即空、有 points 则逐点严校验」 | 一刀切会打红 lib.test.ts:154-165 合法 partial 用例 |
| C3 | 未知时间写法 | 采验收 A4：stale_days == null 或 >= 7 一律告警；小时侧先判 !Number.isFinite 再判 >48；types.ts:124 改 number 或 null 并入编辑清单 | null >= 7 为 false，P0-7 会被 P1-17 抵消 |
| C4 | status 空转 vs spec §6 每次成功检查都更新 status | 两全：status 照写，但数据无实质变化时复用上一轮 checked_at（changed 初值改 false），并写真实 ok | 既守规范，又让 workflow:41 的内容门真正生效 |

## 三、波次（依赖序，非编号序）

顺序理由：契约先立，前端校验才有对齐目标；分槽先于边界，否则修完边界仍被白屏盖住；CI 必须最先，否则每条 P0 都只在主干上事后验。

| 波 | 内容 | 涉及文件 | 出口判据 |
| --- | --- | --- | --- |
| W0 | 权限解锁 + PR CI（加 pull_request，deploy 作业 if 排除 PR） | .github/workflows/ | PR 上 build 跑、deploy 跳过；本地能落盘 |
| W1 | 契约模块单一化 + 双端共用 fixture；score_max 从数据取；candidateKey/parseCandidateKey 收口 9 处；开 checkJs 仅覆盖 scripts | scripts/lib.mjs、src/lib/*、tsconfig.json | 双端契约测试同 fixture 同结论 |
| W2 | 加载分槽（三资源独立槽 + errors）+ status 强校验（必须排在分槽之后） | loader.ts、App.tsx、types.ts | round 成功 + 趋势失败 ⇒ 矩阵仍在、趋势区 role=alert |
| W3 | 边界下移 + 真重试 + throw null 可见 + main.tsx 兜底 | ErrorBoundary.tsx、App.tsx、main.tsx | 局部隔离 / 重试恢复 / null 错误三条用例 |
| W4 | 覆盖率闸门 0 值、趋势红点同源日桶、stale 未知三处消费 | derive.ts、TrendChart.tsx、FreshnessBanner.tsx、types.ts | 边界用例 5 条 |
| W5 | status.ok 真值 + 横幅消费 + 噪音提交消除 + 候选下限 | refresh.mjs、FreshnessBanner.tsx | ok:false 出 warn；同夹具两次 now() 第二次不写 |
| W6 | 其余 P1（errors 分类、issue 去重、rebase 顺序、paths 补 scripts、无障碍、USD 表头、时区日键） | 原 P1 表对应文件 | 单条专属断言 |
| W7 | P2 一把收 | — | — |

规则：一 commit 一条，message 带编号（fix(P0-4): ...），红输出进 commit message。

## 四、验收门（三条，缺一不算完）

1. 断言白名单从 3 处扩到 5 处，并区分「夹具更新」与「断言语义变更」：新增 tests/lib.test.ts:72-104（补 history 字段）、tests/App.test.tsx:6-88（mock 补 errors）；语义不变的夹具改动不算破线。
2. 命令闸门：npm test 全绿 + npx tsc -b 0 诊断 + npm run build 成功 + 一次 base 路径 preview 冒烟（/ChatGPT-IQ-Check/）。用例数只作参考，不作闸门（可灌水）。
3. 回滚：一 commit 一 revert；数据批先禁 schedule 再 revert；红线是测试红 15 分钟定位不到即 revert。

## 五、明确不做 / 本轮外

- 不做：push、开 Pages、Task 16/17、换技术栈、引 UI/图表/边界/DOMPurify 库、动 LICENSE/NOTICE/spec 正文（R1 一行注记除外）。
- 本轮外但必须落纸：上游动画资产 R1——接入时必须先下载并按 asset.sha256 校验、落 public/assets/、渲染走 urlFor()、iframe 带 sandbox="allow-scripts"（不要 allow-same-origin）。当前 asset_url 全是 /assets/*.html.txt 且 public/ 无 assets 目录，直接接会 34/34 全 404。
- 维持驳回 6 条 minor（task_count 回 7、合并双校验、fmtRelativeTime、loadStatus 超时、换 react-error-boundary、innerHTML 完整性校验），理由见原方案 §2。

## 六、需要拍板的一件事

权限。已排除「只是 ACL 继承问题」：三种落盘方式在 7 个目录全 EPERM，CTO 早前「已有目录可写」的结论对 src/tests 不成立。

- 方案 1（推荐）：会话切 danger-full-access，跑一次 ACL 修复脚本把沙箱 SID 授给工作区子树，之后写入与命令都通。
- 方案 2：搬仓库到 NTFS 卷（顺带解决硬链接 ENOTSUP，但路径全变）。
- 方案 3：只放开命令执行，写入靠 Lead 用临时目录 + 人工拷（最慢）。

不解决这条，W1 之后一步都落不了盘。
