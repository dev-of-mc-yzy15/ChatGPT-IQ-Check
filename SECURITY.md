# 安全策略

## 这是个什么项目

ChatGPT IQ Check（降智雷达）是 **[codexradar.com](https://codexradar.com/) 第三方 API 的纯静态客户端**。

- 仓库里只有前端源码、一个抓取脚本（`scripts/refresh.mjs`，连同同目录的转换模块 `lib.mjs` 与契约模块 `contract.mjs`）和 GitHub Actions workflow，**自身没有后端、没有数据库、不存任何密钥**。
- 浏览器只读取同源的 `public/data/*.json`（构建后是 `dist/data/*.json`），**不直连任何第三方接口**。
- 抓取在 GitHub Actions 里完成：`scripts/refresh.mjs` 拉上游 → 归一化 → 校验 → 写盘 → 由 `refresh-data` workflow 提交。

因此，"服务端"能出的问题在这项目里大多不存在；真实风险集中在下面三处管道。

## 真实攻击面

### (a) 抓取管道把不可信上游 JSON 写进 `public/data/`

`scripts/refresh.mjs` 把 `codexradar.com` 的响应归一化后写进 `public/data/radar-bench.json`、`round.json`、`status.json`，这些文件随后被部署、被浏览器加载。

上游是**不可信输入**。要注意的环节：

- 上游字段的长度、类型、嵌套深度、数值范围都假定会变坏。
- `scripts/contract.mjs` 是双端共用的数据契约校验：管道落盘前跑一次，浏览器加载后再跑一次。任何绕过它的写入路径都算缺陷。
- 写入是原子的（临时文件 + rename），避免半截 JSON 上线。
- 单点抓取失败时复用上一份已提交数据里该候选的旧记录（`outcome: "reused"`）；连旧记录都没有才丢掉这一条并计入 `missing_count`。两条路径都不会把坏数据覆盖上去。

如果上游 JSON 能造成 XSS、耗尽内存、或者让校验被绕过而落盘非法结构，**这是漏洞**。

### (b) 持 `contents: write` 的 CI workflow

`.github/workflows/refresh-data.yml` 需要 `contents: write` 才能提交刷新后的数据，另外有 `issues: write` 用于失败时开 issue。

风险在于：**只要能影响写进 `public/data/` 的内容，就能影响这个仓库的下一次提交**。所以命令注入、路径穿越、以及"上游字段被当成脚本片段执行"都归到这一类。

### (c) Pages 部署 job

`.github/workflows/deploy.yml` 分两个 job：`build` job 只有 `contents: read`，用 `actions/upload-pages-artifact` 把 `dist` 打成 Pages artifact；写权限全部收在 `deploy` job 上——只有它持 `pages: write` 和 `id-token: write`，并用 `actions/deploy-pages` 发布。

部署链路的风险是**产物污染**：只要能让 `dist` 里出现不该有的内容（或让构建步骤被绕过），就能把它送上 `*.github.io`。

### 已经落实的基线

- 三个 workflow 都在 workflow 级显式声明 `permissions`，不依赖仓库默认权限。默认面只有 `contents: read`；带写权限的只有两处，且各自写在需要它的 job 上：`refresh-data` 的 `contents: write` + `issues: write`，以及 deploy job 的 `pages: write` + `id-token: write`。
- `checkout` 默认 `persist-credentials: false`；只有确实需要推送的 `refresh-data` 才置 `true`。
- 部署走 `workflow_run` + `conclusion == 'success'` 门控，刷新失败不会把旧产物重发一遍。
- 刷新提交带 `[skip ci]`，避免 `GITHUB_TOKEN` 推送递归触发。
- **CI 安装依赖一律 `npm ci --ignore-scripts`**，`ci.yml` 与 `deploy.yml` 都是这么写的。构建链不需要 `postinstall`：lockfile 里只有 `fsevents` 带 install script，而它只在 darwin 上装。等于默认砍掉装包期的任意代码执行面。
- **`ci.yml` 每次运行都跑 `npm audit --omit=dev --audit-level=high`，且必须打公网 registry**（`deploy.yml` 不重复跑 audit——它在 `npm test` + `npm run build` 之前只做 `npm ci --ignore-scripts`，漏洞扫由闸门 workflow 负责）：

  ```bash
  npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org/
  ```

  原因很具体——本机默认 registry 是 npmmirror 镜像，它**没有实现 audit API**：

  ```
  npm warn audit 404 Not Found - POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk
  npm warn audit [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet
  ```

  在镜像上直接跑 `npm audit` 只会拿到 `NOT_IMPLEMENTED`，误以为"没漏洞"。`--omit=dev` 是因为运行时依赖只有 `react` / `react-dom`，devDependencies 不进产物。

## 报告漏洞

**不要直接开公开 issue。**

### 可利用漏洞 → GitHub Security Advisory

走本仓库的私有报告通道：

<https://github.com/dev-of-mc-yzy15/ChatGPT-IQ-Check/security/advisories/new>

可以复现的 XSS、校验绕过、注入、产物污染、权限提升都走这里。请尽量带上：

- 影响的是哪一条管道（a / b / c）
- 复现步骤或最小 PoC
- 你观察到的实际后果（能改数据？能执行脚本？能污染产物？）

### 其余情况 → 普通 issue

文档错误、边缘 case、可疑但不确定能不能利用的现象，直接开 issue 即可：

<https://github.com/dev-of-mc-yzy15/ChatGPT-IQ-Check/issues>

拿不准走哪边也没关系，按 issue 提，需要时再转成 advisory。

### 承诺

- **7 日内确认**收到报告（不含节假日顺延）。
- 确认后一起商量修复与披露时间；修好后在 advisory 或 issue 里致谢（除非你要匿名）。

这是个人维护的项目，没有赏金，只有尽快修。

## 不在范围内

### 上游基准数字本身算错，算 issue 不算漏洞

本站不跑评测、不算分。分数、覆盖率、评分状态全部来自上游，前端只做展示（唯一的前端计算是降智信号标记，规则公开在 README）。

所以下面这些**按普通 issue 提**，不走 advisory：

- 某个模型的分数看起来不对
- 覆盖率、样本量、任务集版本有问题
- 上游挂掉或改了 schema 导致页面空掉

换句话说：**上游数据对不对是 codexradar.com 的事，我们怎么处理这些数据是我们的事。** 后者才可能是漏洞。

### 明确不管的

- GitHub Pages 平台自身的可用性与 DDoS 防护
- 浏览器或 Node 自身 0day（除非本项目的用法放大了它）
- 依赖包的已知问题，除非能在这个项目里实际触发（能触发的报给我们，我们升级）
- 与 OpenAI 的商标、命名争议（见 [NOTICE](./NOTICE)）
