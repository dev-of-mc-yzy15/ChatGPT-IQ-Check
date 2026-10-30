# 贡献指引

欢迎改动。这是个纯静态的看板项目，没有后端，**改动很容易验证，也请务必自己先验证**。

许可：提交即表示你同意自己的贡献按 [AGPL-3.0-or-later](./LICENSE) 授权。

## 环境

- **Node >= 24**（`package.json` 的 `engines.node` 要求，也是 CI 里 `setup-node` 的版本。低于它 `npm ci` 会告警——`engine-strict` 未开，所以是告警不是硬拦；Vite 8 / Vitest 5 自己只要 Node 22.12，仓库把下限抬到 24 是为了和 CI 对齐）
- Git
- 无需任何密钥、无需数据库

## 本地环路

```bash
npm ci                  # 按 package-lock.json 精确安装
npm run dev             # 开发服务器
npm test                # 跑一遍测试
npx tsc -b              # 全量类型检查
npm run typecheck:scripts   # 单独类型检查 scripts/（checkJs 打开）
npm run build           # tsc -b + typecheck:scripts + vite build
```

开发服务器地址带固定 base 前缀：

<http://localhost:5173/ChatGPT-IQ-Check/>

`vite.config.ts` 里 `base` 是 `/ChatGPT-IQ-Check/`，漏掉前缀会 404——这不是 bug。

## PR 闸门

CI（`.github/workflows/ci.yml`）在 PR 上跑一串 `run:` 步骤，前两条是前置，任一红就轮不到后面：`npm ci --ignore-scripts`、`npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org/`（`--registry` 不能省：本机镜像没实现 audit API，不显式指公网这一步等于空跑）。**真正的闸门是下面这五条，都绿才给合**：

- `npm test`（jsdom 上的全量单测）
- `npm run build`（`tsc -b` + `typecheck:scripts` + `vite build`）
- `npm run check:base`（检查 `dist/index.html` 里没有回退到根绝对路径的引用）
- `npm run verify:assets`（资产哈希闸门：`public/assets/` 里每个文件都得对得上 `round.json` 钉的 `asset_sha256`，缺文件、哈希不符、有 URL 没钉哈希都会红。改过资产就必须重算并更新哈希）
- `npm run e2e`（真浏览器基线，`tests/e2e/base-path.spec.ts`）

`npm test` 全跑在 jsdom 上，既不放 CSP 也不做 MIME 检查，**子路径失效与 CSP 写歪这两类整页白屏故障单测一律是绿的**，只有 `npm run e2e` 能兜住，所以它跟其余闸门同级，不是可选步骤。本地跑之前先装一次 Chromium：`npx playwright install chromium`（CI 里是 `npx playwright install --with-deps chromium`），并确保 `npm run build` 已经跑过——e2e 的 `webServer` 直接吃 `dist/`。

`build` 已经串好 `tsc -b` 和 `typecheck:scripts`，所以 `npm run build` 过就等于类型检查也过了。改 `scripts/` 时想更快看 `checkJs` 的报错，可以单独跑 `npm run typecheck:scripts`（`checkJs` 只在 `tsconfig.scripts.json` 里打开）。

## 测试怎么写

测试在 `tests/`，Vitest + Testing Library，跑在 jsdom 上（配置见 `vite.config.ts`）。

- **夹具放 `tests/fixtures/`**，是上游真实响应的裁剪样本，命名 `<用途>.sample.json`。约定写在 `tests/fixtures/README.md` 里，一句话概括：**不要臆造数值**，上游 schema 一变就拿真 URL 重新裁。
- 组件用 Testing Library 的语义查询，别贴着 CSS class 断言。
- 纯函数（`src/lib/derive.ts`、`src/lib/format.ts`）优先单测，边界值要有：空数组、单点、非法输入。
- `tests/setup.ts` 已经补了 `matchMedia` 和 `ResizeObserver` 的桩，`afterEach` 会 `cleanup()`。

写新测试前先看邻近文件的写法，保持风格一致。

## 不要手改 `public/data/*.json`

三份 JSON 由抓取脚本生成：

```bash
npm run refresh
```

改数据格式要动的是 `scripts/lib.mjs`（转换）和 `scripts/contract.mjs`（契约），不是直接编辑 JSON。`contract.mjs` 是管道和浏览器共用的校验，动它等于动数据契约，PR 里请说明动机。

抓取行为（重试、回退、原子写、幂等）在 README 的「刷新数据」一节，改 `refresh.mjs` 前先读。

## 动画要尊重 `prefers-reduced-motion`

所有过渡、滚动、SVG 动画都要在 `@media (prefers-reduced-motion: reduce)` 下退化。参照 `src/styles/theme.css` 里已有的写法，别新开一套开关。

## UI 文案是简体中文

页面 `lang="zh-CN"`，按钮、标签、空态、错误态一律简体中文。专有名词（模型名、RadarBench、API 字段）保留原文。

数字格式化走 `src/lib/format.ts`，别在组件里拼字符串。

## 开 PR 前自查

1. `npm test`、`npm run build`、`npm run check:base`、`npm run e2e` 都本地跑过、都绿——不要指望 CI 替你发现。动过资产或数据的话，资产校验也要过。
2. 改的是数据格式的话，`public/data/*.json` 是 `npm run refresh` 生成的，不是手编的。
3. 新交互/新动画在 `prefers-reduced-motion: reduce` 下试过一遍。
4. 新增依赖说清理由；它能进 `dependencies` 还是只该进 `devDependencies`。
5. 提交信息说清"为什么"，PR 描述里贴上验证命令与输出。

## 提交信息

约定式提交，中文，一句话讲清改动与动机，例如：

```
fix(trend): 日桶缺口按 0 补齐，避免曲线断成折线
```

常用类型：`feat` / `fix` / `docs` / `refactor` / `test` / `chore`。

## 行尾

**新文件一律 LF。** `.gitattributes` 的 `* text=auto eol=lf` 已经把它定死：工作区和仓库里都是 LF，二进制（png / jpg / ico）标了 `binary`，不做行尾转换。`.editorconfig` 的 `end_of_line = lf` 是同一条约束的另一层。

自查用 `file` 或 `cat -A`：真 LF 的文件 `cat -A` 每行以 `$` 收尾，出现 `^M$` 说明已经钻进 CRLF 了。

## 安全

攻击面与漏洞报告通道见 [SECURITY.md](./SECURITY.md)。**安全类 PR 别先开 issue**，直接走 advisory。
