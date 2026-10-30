import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 降智动画的 CSP 契约。base-path.spec.ts 只停在首页，从不点进详情、从不展开动画，
 * 所以「iframe 里的内联脚本被父文档 CSP 全部挡死、34 个动画全变静帧」这类故障
 * 在它那儿是绿的——这个文件就是补那个缺口，并作为常驻闸门。
 *
 * 背景（已实证的缺陷）：`srcDoc` 生成的子文档继承父文档的 policy container，
 * 于是 index.html 的 `script-src 'self' 'sha256-…'`（只放行父页面自己那一个 hash）
 * 原样落到动画产物身上，产物自带的 `<script>` 被 `script-src-elem` 全部拒绝，
 * 动画只剩第一帧。修法是把产物按 `.html` 落盘、iframe 走 `src`：真实 URL 的文档
 * 有自己的 policy container，不继承父 CSP。
 *
 * 两条断言缺一不可：
 * 1) 子文档的脚本**真的执行过**（不是 iframe 出现、不是 `<script>` 标签还在）；
 * 2) 全程零 CSP 违规。
 * 只留第 2 条会被「用 `csp` 属性放宽但漏了别的」蒙过去；只留第 1 条会被
 * 「父 CSP 没生效」蒙过去。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_PATH = "/ChatGPT-IQ-Check/";

/** 推理档位的中文标签，与 src/lib/format.ts 的 EFFORT_LABELS 一致（格子可访问名要用）。 */
const EFFORT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "极限",
};

/** 上游产物扩展名；本地落盘去掉末尾 `.txt`，托管才会按 `text/html` 回。 */
const UPSTREAM_SUFFIX = ".html.txt";
const LOCAL_SUFFIX = ".html";

/**
 * 上游 `asset_url` 的 basename → `public/assets/` 里的真实文件名。
 *
 * 与 `src/lib/asset.ts` 的 `localAssetName()` 同一规则（只认末尾 `.html.txt`，其余原样返回）。
 * 这里不 import 那个函数：该模块经 `../data/loader` 引到 `import.meta.env.BASE_URL`，
 * 在 playwright 的 node 转译下要靠默认参数兜底；规则本身只有一行，抽出来复用即可。
 * 规则基线由 `tests/asset.test.ts` 与 `tests/verify-assets.test.ts` 两侧各自钉住。
 */
function toLocalName(baseName: string): string {
  return baseName.endsWith(UPSTREAM_SUFFIX)
    ? baseName.slice(0, -UPSTREAM_SUFFIX.length) + LOCAL_SUFFIX
    : baseName;
}

/**
 * 从真实数据挑一个「产物里有 rAF 驱动脚本」的候选。
 *
 * 为什么不能直接点第一个格子：34 个产物里**只有 20 多个带内联脚本，其余是纯 CSS 动画**
 * （CSS 动画不受 script-src 管，被 CSP 打死也照样在动）。点到纯 CSS 那一个，rAF 计数
 * 恒为 0，探针判据就假红了。写死某个模型名同样不行——上游换一批候选就假红。
 *
 * 本地文件名是上游 basename 去掉 `.html.txt` 的 `.txt`（见 src/lib/asset.ts）。
 */
function pickAnimatedCandidate(): { model: string; effort: string; asset: string } {
  const round = JSON.parse(readFileSync(resolve(repoRoot, "public/data/round.json"), "utf8")) as {
    candidates?: { model?: string; effort?: string; animation?: { asset_url?: string } }[];
  };
  const assetsDir = resolve(repoRoot, "public/assets");
  const files = new Set(readdirSync(assetsDir));
  for (const candidate of round.candidates ?? []) {
    const url = candidate.animation?.asset_url;
    if (!url || !candidate.model || !candidate.effort) continue;
    const base = url.split(/[?#]/)[0].split("/").pop();
    if (!base) continue;
    const local = toLocalName(base);
    if (!files.has(local)) continue;
    if (readFileSync(resolve(assetsDir, local), "utf8").includes("requestAnimationFrame")) {
      return { model: candidate.model, effort: candidate.effort, asset: local };
    }
  }
  // 一个都找不到就是判据失效（或资产全没了），必须红而不是静默跳过。
  throw new Error("round.json 里找不到含 requestAnimationFrame 的产物，判据需要更新");
}

/**
 * Chromium 对「meta 下发 frame-ancestors」固定打一条 console 错误：该指令只认 HTTP 头。
 * index.html 有意保留（换宿主改用响应头时直接复用同一份策略），与资源被挡无关，
 * 按原文精确放行；其余 console error 一律算红。
 */
const META_CSP_NOISE = /frame-ancestors.? is ignored when delivered via a <meta> element/;

/**
 * 网络层抖动：本机或 CI 切换网络时 Chromium 会打一条 `Failed to load resource:
 * net::ERR_NETWORK_CHANGED`，与 CSP、脚本执行都无关，重跑就没了。只放过这一个错误码——
 * `Failed to load resource` 的其它形态（404/被 CSP 拒）仍算红。
 */
const NETWORK_NOISE = /net::ERR_NETWORK_CHANGED/;

/**
 * 产物自身的 SVG 缺陷（上游产物，不是本仓代码）：`gpt-6-astra-max` 那个产物在 draw() 里
 * 用模板拼 `scarf-tail` / `scarf-fold` 的 `d`，负数变量后面紧跟下一个数字且中间没有分隔
 * 空格——`q33 ${-9 - flutter}63 ${-2 - flutter}` 在 flutter 为正时会拼出 `q33 -963 -2`，
 * SVG 解析器把 `-` 当分隔符，只数到 3 个数（q 需要 4 个），于是打 `Unexpected end of
 * attribute`。只在 flutter（`Math.sin(t * 5.5) * 4`）把值推成负数时出现。
 *
 * 实测只有这 1 个产物触发：Chromium 按 SVG 的容错规则补零、照常渲染，几何仍然有效
 * （已用 getTotalLength() 逐条验证该产物 108 条 path 全部可解析），没有渲染损坏；
 * 但每次 setAttribute('d') 都打一条，一次加载累计 145 条，足以把 console 断言打红。
 *
 * 与 CSP、脚本执行、可达性都无关，视觉上只是围巾局部形状略失真。产物是上游生成的、
 * `npm run refresh` 会整份覆盖，改本地文件还得同步 round.json 的 asset_sha256，所以放行；
 * 只放过这一个错误形态，其余 `attribute d` 报错仍算红。
 */
const PRODUCT_NOISE = /<path> attribute d: Unexpected end of attribute/;

/** 子 frame 的探针桶：`__raf` 由产物脚本触发，`__violations` 是 CSP 违规原文。 */
type ProbeWindow = Window & { __raf?: number; __violations?: string[]; __isChild?: boolean };

/**
 * 注入到**每个**文档（含 iframe）的探针。`addInitScript` 走 CDP，
 * 不受被注入文档自身 CSP 的限制，所以被拦的文档里探针照样在。
 *
 * `requestAnimationFrame` 是这里的关键信号：带脚本的产物都靠 rAF 驱动，
 * 无脚本（或脚本被挡）时一个调用都不会有；父页面自己的 rAF 用量与它无关（按 `child` 分流）。
 * 所以挑候选必须挑带 rAF 的（见 `pickAnimatedCandidate`），不能随手点第一个格子。
 */
async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as ProbeWindow;
    w.__isChild = window.top !== window;
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__violations!.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
    const raf = w.requestAnimationFrame.bind(w);
    w.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      if (w.__isChild) w.__raf = (w.__raf ?? 0) + 1;
      return raf(cb);
    };
  });
}

/** 详情卡容器（含要断言的 iframe），靠标题 section 锚定。 */
function detailSection(page: Page) {
  return page.locator("#round-detail-heading").locator("xpath=ancestor::section[1]");
}

/**
 * 点进指定候选并展开折叠面板，返回承载动画的 iframe 对应的 frame。
 *
 * 目标由 `pickAnimatedCandidate` 从真实数据挑（带 rAF 的那个），
 * 因此既能避开纯 CSS 产物的假红，也不会因上游换一批候选而假红。
 */
async function openAnimation(
  page: Page,
  target: { model: string; effort: string; asset: string },
): Promise<Frame> {
  await page.goto(BASE_PATH);
  // 等目标格子可见再点：只等 #root 会点到占位骨架。
  const label = EFFORT_LABELS[target.effort] ?? target.effort.toUpperCase();
  const cell = page
    .locator("#round-matrix-heading")
    .locator("xpath=ancestor::section[1]")
    .getByRole("button", { name: new RegExp(`${target.model} ${label} `, "i") });
  await expect(cell).toBeVisible();
  await cell.click();

  // 详情卡必须真的换成了这个候选（否则是在旧的空态上找折叠控件）。
  await expect(page.locator("#round-detail-heading")).toBeVisible();

  const summary = page.getByText("播放降智动画（沙箱隔离，展开后加载）");
  await expect(summary, "每个可用动画都必须有折叠播放入口").toBeVisible();
  await summary.click();

  const iframe = detailSection(page).locator("iframe");
  await expect(iframe, "展开后必须挂出 iframe").toBeAttached();

  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  expect(frame, "iframe 必须加载出真实子文档").not.toBeNull();
  return frame!;
}

/** 读子 frame 的探针结果；frame 尚未可执行时返回零值而不是抛。 */
async function readProbe(frame: Frame): Promise<{ raf: number; violations: string[] }> {
  return frame.evaluate(() => {
    const w = window as ProbeWindow;
    return { raf: w.__raf ?? 0, violations: w.__violations ?? [] };
  });
}

/**
 * 点一次 `#toggle` 之后核对状态：`aria-pressed` 必须是期望值，`#status` 文案必须跟着变。
 * 失败时把**实际**的 `aria-pressed` 与文案原样带出来，不用二次复跑取证。
 *
 * 用精确 `textContent` 而不是 `toHaveText`：后者归一空白，会把产物文案里的 `&nbsp;`
 * 和脚本写入的普通空格当成同一串（`#status` 目前不含 nbsp，但同类改写随时可能引入）。
 */
async function expectToggled(
  toggle: Locator,
  status: Locator,
  hasStatus: boolean,
  pressed: string,
  text: string | null,
  note: string,
): Promise<void> {
  try {
    await expect(toggle, `${note} aria-pressed 必须变成 "${pressed}"`).toHaveAttribute(
      "aria-pressed",
      pressed,
      { timeout: 5_000 },
    );
    if (!hasStatus) return;
    await expect
      .poll(() => status.textContent(), {
        message: `${note} #status 文案必须变成 ${JSON.stringify(text)}`,
        timeout: 5_000,
      })
      .toBe(text);
  } catch (error) {
    const actualPressed = await toggle.getAttribute("aria-pressed").catch(() => "<读不到>");
    const actualStatus = hasStatus ? await status.textContent().catch(() => "<读不到>") : "<无该节点>";
    throw new Error(
      `${note}状态没跟上：期望 aria-pressed="${pressed}"` +
        (hasStatus ? `、#status=${JSON.stringify(text)}` : "（该产物无 #status）") +
        `；实际 aria-pressed=${JSON.stringify(actualPressed)}、#status=${JSON.stringify(actualStatus)}` +
        `\n原始错误：${(error as Error).message}`,
    );
  }
}

test.describe("降智动画在沙箱 iframe 内可执行且无 CSP 违规", () => {
  // 核心用例：脚本执行 + 零违规。修复前（srcDoc 继承父 CSP）在第一步就红。
  test("展开动画后内联脚本真的跑起来，且全程无 CSP 违规", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (META_CSP_NOISE.test(text) || NETWORK_NOISE.test(text) || PRODUCT_NOISE.test(text)) return;
      consoleErrors.push(text);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await installProbe(page);
    const target = pickAnimatedCandidate();
    const frame = await openAnimation(page, target);

    // 先把 iframe 的 sandbox 钉住：没有 allow-scripts 就没有交互，加了 allow-same-origin 则隔离失效。
    expect(await detailSection(page).locator("iframe").getAttribute("sandbox"), "sandbox 必须只放脚本").toBe(
      "allow-scripts",
    );

    // 等帧内脚本至少驱动一帧。被 CSP 挡掉时计数恒为 0：此时把违规原文与 console
    // 原文一并抛出来，取证不用二次复跑。
    try {
      await expect
        .poll(async () => (await readProbe(frame)).raf, {
          message: "iframe 内脚本必须执行过（rAF 从未被调用说明内联脚本被挡）",
          timeout: 10_000,
        })
        .toBeGreaterThan(0);
    } catch (error) {
      const probe = await readProbe(frame).catch(() => ({ raf: -1, violations: [] as string[] }));
      throw new Error(
        "iframe 内脚本没有执行（rAF=" +
          probe.raf +
          "）。CSP 违规：" +
          (probe.violations.join(" | ") || "（无 violation 事件）") +
          "；console：" +
          (consoleErrors.join(" | ") || "（无）") +
          "\n原始错误：" +
          (error as Error).message,
      );
    }

    const inside = await readProbe(frame);
    expect(inside.violations, `子文档 CSP 违规：${inside.violations.join(" | ")}`).toEqual([]);

    // 收敛：光有 rAF 只能证明「在跑」，还要证明脚本真的改到了可见 DOM、且中途没崩。
    //
    // 不能拿「文本必须偏离静态初值」当判据——产物里 `#status` 的文字**只在 setPaused() 里变**
    // （`statusText.textContent = paused ? '在海边歇一会儿' : '海岸骑行中'`），而初始化那句
    // `setPaused(reduced.matches)` 在非 reduced-motion 下写回的就是「海岸骑行中」，与静态初值
    // 字面完全相同。也就是说没人点按钮时，运行值与初值**永远相等**，旧断言是恒假红。
    //
    // 所以改成主动驱动交互：点 `#toggle` → `aria-pressed` 必须翻转、`#status` 文案必须跟着翻；
    // 再点一次 → 必须整体复原。一次同时证明三件事：脚本执行过、改到了可见 DOM、sandbox 里点得动。
    //
    // 初始状态由产物自己定（开了 reduced-motion 时它一上来就是 paused），期望值一律从**当前实际值**
    // 推导，不写死 "false"，两种 prefers-reduced-motion 取值下都成立。
    const toggle = frame.locator("#toggle");
    const status = frame.locator("#status");
    if ((await toggle.count()) > 0) {
      await toggle.scrollIntoViewIfNeeded();
      const hasStatus = (await status.count()) > 0;
      const before = (await toggle.getAttribute("aria-pressed")) ?? "<null>";
      expect(
        before,
        `#toggle 的 aria-pressed 必须是 "true"/"false" 布尔字符串，实际 ${JSON.stringify(before)}` +
          "（拿不到说明脚本没跑过 setPaused，或 aria-pressed 被删了）",
      ).toMatch(/^(true|false)$/);

      const flipped = before === "true" ? "false" : "true";
      const beforeStatus = hasStatus ? await status.textContent() : null;
      // paused 与运行态的固定文案，取自产物自己的 setPaused()。
      const pausedText = "在海边歇一会儿";
      const runningText = "海岸骑行中";

      // 第一次点击：翻转（paused=true 时文案为「在海边歇一会儿」，翻回运行态则为「海岸骑行中」）。
      await toggle.click();
      await expectToggled(toggle, status, hasStatus, flipped, flipped === "true" ? pausedText : runningText, "第一次点击后");
      // 第二次点击：回到初始状态，证明不是改一次就卡死。
      await toggle.click();
      await expectToggled(toggle, status, hasStatus, before, beforeStatus, "第二次点击后");

      test.info().annotations.push({
        type: "#toggle",
        description: `已驱动交互：aria-pressed ${before}→${flipped}→${before}` + (hasStatus ? "，且状态文案同步翻转" : "（该产物无 #status）"),
      });
    } else {
      // 退化分支：挑中的产物没有 `#toggle`（34 个产物里只有 6 个带按钮），点不了就改用
      // 两个时刻的 body.innerHTML 对比——rAF 循环每帧都在写 SVG 的 d / transform 属性，
      // 脚本真在写 DOM 时两次序列化必然不同；被 CSP 挡死或脚本崩掉时两串逐字节相同。
      // 400ms 在 60fps 下是 20 多帧，够稳又不拖测试。
      const t0 = await frame.evaluate(() => document.body.innerHTML);
      await page.waitForTimeout(400);
      const t1 = await frame.evaluate(() => document.body.innerHTML);
      expect(
        t1,
        `产物 ${target.asset} 没有 #toggle 可点，且 400ms 后 body.innerHTML 与 400ms 前完全一致` +
          `（${t0.length} 字节）——子文档脚本没有写 DOM`,
      ).not.toBe(t0);
      test.info().annotations.push({
        type: "退化判据",
        description: "该产物无 #toggle，改用 body.innerHTML 两时刻不等取证",
      });
    }

    // 页面级信号：父文档也没被自己的 CSP 打到。
    const pageViolations = await page.evaluate(() => (window as ProbeWindow).__violations ?? []);
    expect(pageViolations, `父文档 CSP 违规：${pageViolations.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console 错误：${consoleErrors.join(" | ")}`).toEqual([]);
    expect(pageErrors, `未捕获异常：${pageErrors.join(" | ")}`).toEqual([]);
  });

  // 产物按 text/html 落盘是这条路的前提：上游 `.html.txt` 会被托管回 text/plain，
  // 那样 src 加载出来的是一屏源码，脚本自然也不跑。扩展名与 content-type 一起钉死。
  test("动画产物以 text/html 提供，iframe 走 src 而非 srcDoc", async ({ page }) => {
    await installProbe(page);
    const frame = await openAnimation(page, pickAnimatedCandidate());
    // contentFrame() 拿到的是 frame 对象，此刻导航未必已提交，url() 可能还是空串；
    // 先等它落到真实地址再解析，否则 new URL("") 直接 Invalid URL（竞态假红）。
    await expect
      .poll(() => frame.url(), { message: "iframe 必须导航到真实地址", timeout: 10_000 })
      .toContain(`${BASE_PATH}assets/`);
    const url = new URL(frame.url());

    expect(url.pathname, "iframe 必须以真实 URL 加载（src），不能是 about:srcdoc").toContain(
      `${BASE_PATH}assets/`,
    );
    expect(url.pathname, "落盘后不再带 .txt 后缀").not.toContain(".html.txt");

    const res = await page.request.get(frame.url());
    expect(res.status(), `${frame.url()} 必须可达`).toBe(200);
    const type = res.headers()["content-type"] ?? "";
    expect(type, `产物必须按 HTML 回，实际 ${type}`).toContain("text/html");
  });
});

/* ───────────────────────────── 全量产物闸门 ──────────────────────────────── */

/**
 * 上面的用例只深验**一个**带 rAF 的候选：它能证明「这条路整体是通的」，但覆盖不到
 * 34 个产物里的其余 33 个。缺口最明显的是纯 CSS 那 11 个——它们不含 `<script>`，
 * rAF/交互判据对它们恒无意义，是不是 200、是不是被托管回 `text/plain`（iframe 里
 * 只剩一屏源码）、内联样式有没有被打，此前全靠运气。
 *
 * 所以这里退一步做**面**上的补齐：每一个产物 URL 逐一断言 200、`text/html`、
 * 内联进父页面后零 CSP 违规。带脚本的那几个「脚本真的跑起来」仍由上一条用例负责，
 * 两条互补，不是替代。
 */

/** 数据里应有 34 个产物；上游真增减时这条守卫先红，不会静默少跑一批。 */
const EXPECTED_ASSET_COUNT = 34;
/** 每批同时挂多少 iframe。太小批次空转，太大时 Chromium 排队解码反而拖慢 load。 */
const PROBE_BATCH_SIZE = 8;
/** 承载探测 iframe 的容器 id：必须挂在真实页面上，父页面 CSP 才真的参与。 */
const PROBE_HOST_ID = "asset-probe-host";

/**
 * 全量清单：`public/data/round.json` 里每个 `animation.asset_url` 都换算成本地路径。
 *
 * 不写死 34 条——上游换一批候选、增减产物，清单自动跟着变（条数由用例里的守卫显式卡住）。
 * 换算与 `src/lib/asset.ts` 的 `assetUrl(localAssetName())` 同路：只取 basename、
 * 去掉上游 `.txt`、拼到本站 `BASE_PATH` 的 `assets/` 下。
 */
function collectAssetPaths(): string[] {
  const round = JSON.parse(readFileSync(resolve(repoRoot, "public/data/round.json"), "utf8")) as {
    candidates?: { animation?: { asset_url?: string } }[];
  };
  const paths: string[] = [];
  for (const candidate of round.candidates ?? []) {
    const name = candidate.animation?.asset_url;
    if (!name) continue;
    const base = name.split(/[?#]/)[0].split("/").pop();
    if (!base) continue;
    paths.push(`${BASE_PATH}assets/${toLocalName(base)}`);
  }
  return paths;
}

/**
 * 取出 `index.html` 的 CSP 原文并拆出字体相关的两条指令。
 * 用 `default-src` 兜定位（页面只有一个 CSP meta，且它正是以 `default-src` 开头的那条）。
 */
function readCspDirectives(): { raw: string; styleSrc: string; fontSrc: string } {
  const html = readFileSync(resolve(repoRoot, "index.html"), "utf8");
  const raw = /http-equiv="Content-Security-Policy"[\s\S]{0,80}?content="([^"]*)"/.exec(html)?.[1] ?? "";
  const directives = raw.split(";").map((part) => part.trim());
  return {
    raw,
    styleSrc: directives.find((part) => part.startsWith("style-src")) ?? "",
    fontSrc: directives.find((part) => part.startsWith("font-src")) ?? "",
  };
}

test.describe("全部动画产物逐个可达且内联无 CSP 违规", () => {
  test("每个产物都 200 + text/html + 零 CSP 违规，且字体放行仍在", async ({ page }) => {
    // 34 个分 5 批跑，实测远低于 90s；上限给到 120s 是留冷启动与杀软扫描的余量。
    test.setTimeout(120_000);

    const urls = collectAssetPaths();
    expect(
      urls.length,
      `必须从 round.json 的 candidates[].animation.asset_url 取到全部 ${EXPECTED_ASSET_COUNT} 个产物，实际 ${urls.length} 条` +
        (urls.length === 0 ? "（一条都取不到：round.json 结构或 animation.asset_url 变了？）" : ""),
    ).toBe(EXPECTED_ASSET_COUNT);

    // ── 字体放行守卫 ──
    // 34 个里恰好 1 个引 fonts.googleapis.com。子文档有自己的 policy container、不继承父 CSP，
    // 但 index.html 那份策略仍是唯一权威定义：谁把这两段删了，将来换成同源承载或响应头承载时
    // 字体会整片掉、且只在真浏览器里才看得出。所以放行名单与产物引用两侧一起钉死。
    const csp = readCspDirectives();
    expect(csp.raw, "index.html 必须仍有 Content-Security-Policy").not.toBe("");
    expect(csp.styleSrc, `style-src 必须放行 https://fonts.googleapis.com，实际 "${csp.styleSrc}"`).toContain(
      "https://fonts.googleapis.com",
    );
    expect(csp.fontSrc, `font-src 必须放行 https://fonts.gstatic.com，实际 "${csp.fontSrc}"`).toContain(
      "https://fonts.gstatic.com",
    );
    const assetsDir = resolve(repoRoot, "public/assets");
    const fontAssets = readdirSync(assetsDir).filter((file) =>
      readFileSync(resolve(assetsDir, file), "utf8").includes("https://fonts.googleapis.com"),
    );
    expect(
      fontAssets.length,
      `引 Google Fonts 的产物数量变了（${fontAssets.join(", ") || "0 个"}），字体放行名单要重新对齐`,
    ).toBe(1);
    expect(urls, "引 Google Fonts 的那个产物必须也在遍历清单里").toContain(`${BASE_PATH}assets/${fontAssets[0]}`);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (META_CSP_NOISE.test(text) || NETWORK_NOISE.test(text) || PRODUCT_NOISE.test(text)) return;
      consoleErrors.push(text);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await installProbe(page);
    await page.goto(BASE_PATH);
    await expect(page.locator("#root")).toBeAttached();
    await page.evaluate((id) => {
      const host = document.createElement("div");
      host.id = id;
      host.style.cssText = "position:fixed;top:0;left:-400px;width:0;height:0;overflow:visible";
      document.body.append(host);
    }, PROBE_HOST_ID);
    const host = page.locator(`#${PROBE_HOST_ID}`);

    const problems: string[] = [];
    for (let offset = 0; offset < urls.length; offset += PROBE_BATCH_SIZE) {
      const batch = urls.slice(offset, offset + PROBE_BATCH_SIZE);

      // 先单独打传输层：状态码与 content-type 和「渲染成不成」分开取证，
      // 这样「被托管回 text/plain」和「文档根本没起来」不会混成一条含混信息。
      await Promise.all(
        batch.map(async (url) => {
          const res = await page.request.get(url).catch((error: Error) => error);
          if (res instanceof Error) {
            problems.push(`${url} 请求失败：${res.message}`);
            return;
          }
          if (res.status() !== 200) problems.push(`${url} 状态码 ${res.status()}（必须 200）`);
          const type = res.headers()["content-type"] ?? "";
          if (!type.includes("text/html")) {
            problems.push(`${url} content-type 为 ${JSON.stringify(type)}（必须含 text/html，否则 iframe 里只剩源码）`);
          }
        }),
      );

      // 再挂 iframe：`sandbox="allow-scripts"` 与真实详情卡保持一致。
      await page.evaluate(
        ({ id, batch: urlsInBatch }) => {
          const container = document.getElementById(id)!;
          container.replaceChildren();
          urlsInBatch.forEach((url, index) => {
            const iframe = document.createElement("iframe");
            iframe.setAttribute("sandbox", "allow-scripts");
            iframe.setAttribute("data-probe-index", String(index));
            iframe.style.cssText = "width:320px;height:180px";
            iframe.setAttribute("src", url);
            container.append(iframe);
          });
        },
        { id: PROBE_HOST_ID, batch },
      );

      await Promise.all(
        batch.map(async (url, index) => {
          const iframe = host.locator(`iframe[data-probe-index="${index}"]`);
          try {
            await expect(iframe, `${url} 的 iframe 必须挂上`).toBeAttached({ timeout: 10_000 });
            const frame = await (await iframe.elementHandle())?.contentFrame();
            if (!frame) {
              problems.push(`${url} 没加载出真实子文档`);
              return;
            }
            await expect
              .poll(() => frame.url(), { message: `${url} 子文档必须导航到真实地址`, timeout: 20_000 })
              .toContain(`${BASE_PATH}assets/`);

            const probe = await frame.evaluate(() => {
              const w = window as ProbeWindow;
              return {
                isChild: w.__isChild === true,
                contentType: document.contentType,
                violations: w.__violations ?? [],
              };
            });
            if (!probe.isChild) problems.push(`${url} 探针没落到子文档，违规收集不可信`);
            // text/plain 被浏览器当源码渲染时，contentType 也会是 text/plain——
            // 与上面的响应头断言互为交叉证据。
            if (probe.contentType !== "text/html") {
              problems.push(`${url} 子文档 contentType 为 ${JSON.stringify(probe.contentType)}（必须 text/html）`);
            }
            const violations = probe.violations.filter((item) => !META_CSP_NOISE.test(item));
            if (violations.length > 0) problems.push(`${url} CSP 违规：${violations.join(" | ")}`);
          } catch (error) {
            problems.push(`${url} 渲染/取证失败：${(error as Error).message.split("\n")[0]}`);
          }
        }),
      );

      // 每批收掉，避免 34 个 iframe 同时挂着吃内存、掩盖后续批次的加载问题。
      await page.evaluate((id) => document.getElementById(id)?.replaceChildren(), PROBE_HOST_ID);
    }

    expect(problems, `${problems.length} 项问题：\n${problems.join("\n")}`).toEqual([]);

    const pageViolations = await page.evaluate(() => (window as ProbeWindow).__violations ?? []);
    expect(pageViolations, `父文档 CSP 违规：${pageViolations.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console 错误：${consoleErrors.join(" | ")}`).toEqual([]);
    expect(pageErrors, `未捕获异常：${pageErrors.join(" | ")}`).toEqual([]);

    test.info().annotations.push({
      type: "产物覆盖",
      description: `${urls.length} 个产物逐个断言 200 + text/html + 零 CSP 违规`,
    });
  });
});
