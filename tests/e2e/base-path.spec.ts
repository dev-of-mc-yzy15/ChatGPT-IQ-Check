import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 真实浏览器基线：只守两件 jsdom 结构与 vite preview 语义都守不住的事——
 * 1) 子路径 /ChatGPT-IQ-Check/ 部署后整页真的能起来（含资源逐个可达、类型对得上）；
 * 2) index.html 头部那条 CSP 不误伤自己的内联主题脚本与运行时 DOM。
 *
 * 全部用 Chromium 真跑：jsdom 既不放 CSP、也不做 MIME 检查、更不跑布局，
 * 这三类故障在单测里一律是绿的，上线却可能是整页白屏。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_PATH = "/ChatGPT-IQ-Check/";

/**
 * Chromium 对「用 meta 下发 frame-ancestors」固定打一条 console 错误：该指令只认 HTTP 头。
 * index.html 是有意保留的（换宿主改用响应头时可直接复用同一份策略），跟资源被挡无关，
 * 所以按原文精确放行这一条；其余 console error 一律算红，别宽泛放过。
 */
const META_CSP_NOISE = /frame-ancestors.? is ignored when delivered via a <meta> element/;

type StatusProbe = { candidates_ok: number; candidates_total: number };

/** 从真实数据文件取预期文案里的数字：写死 34 的话，上游换一批候选就假红。 */
function readStatusProbe(): StatusProbe {
  const raw = JSON.parse(readFileSync(resolve(repoRoot, "public/data/status.json"), "utf8")) as Partial<StatusProbe>;
  return { candidates_ok: Number(raw.candidates_ok), candidates_total: Number(raw.candidates_total) };
}

/** 先确认挂载点还在，再往下才谈内容。 */
async function expectRootMounted(page: Page): Promise<void> {
  await expect(page.locator("#root")).toBeAttached();
}

test.describe("子路径部署与 CSP 的真实浏览器基线", () => {
  // 防：从域名根访问直接 404 / 空白。用户在站点根敲进来是常态，修法永远是重定向到子路径，
  // 不是让根路径渲染一个 base 不对的页面。
  test("根路径重定向到子路径且落地页可用", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status(), "根路径必须能拿到 200（经重定向后）").toBe(200);
    expect(page.url(), "根路径必须落到子路径下").toContain(BASE_PATH);
    await expectRootMounted(page);
    // 落地的确实是应用而不是错误页。
    await expect(page).toHaveTitle(/降智雷达/);
  });

  // 防：产物里残留根绝对路径引用（src="/assets/x.js"）。这类引用经 vite preview 的 SPA
  // fallback 会拿到 200 text/html 而不是 404，module script 因 MIME 不符静默不执行——
  // 页面上啥也看不到，控制台只有一条 MIME 报错。所以三件事一起断言，缺一不可：
  // 仍落在 base 下、状态 200、content-type 真是脚本/样式。
  test("页面自报的脚本与样式逐个可达且类型正确", async ({ page }) => {
    await page.goto(BASE_PATH);
    await expectRootMounted(page);
    // 不硬编码产物 hash：dist/ 是活的，每次构建文件名都变。
    const refs = await page.evaluate(() => [
      ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map((s) => s.src),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map((l) => l.href),
    ]);
    // 一个都没解析到就是假绿：说明选择器过期或产物形状变了。
    expect(refs.length, "页面必须自报至少一个脚本或样式").toBeGreaterThan(0);

    for (const url of refs) {
      const { pathname } = new URL(url);
      expect(pathname, `${url} 必须带 base 前缀`).toContain(BASE_PATH);
      const res = await page.request.get(url);
      expect(res.status(), `${url} 必须 200`).toBe(200);
      const type = res.headers()["content-type"] ?? "";
      // .js 必须当脚本、.css 必须当样式；拿到 HTML 就是踩了 fallback。
      const expected = pathname.endsWith(".css") ? "text/css" : "javascript";
      expect(type, `${url} 的 content-type 必须含 ${expected}，实际 ${type}`).toContain(expected);
    }
  });

  // 防：把「缺失资源返回 200」当成资源存在。vite preview 对不存在的路径一律吐 index.html，
  // 于是不存在的 .js 也是 200——只断言 status 的话，产物全丢也照样绿。
  // 这条把当前语义钉住：断言 200 + text/html。若将来换成真 404（自定义中间件或换静态服务器），
  // 本断言须同步改成 404，别默默放宽。
  test("缺失资源返回 200 但类型是 HTML（SPA fallback 语义）", async ({ page }) => {
    const missing = `${BASE_PATH}assets/does-not-exist.js`;
    const res = await page.request.get(missing);
    const type = res.headers()["content-type"] ?? "";
    expect(res.status(), `缺资源当前应为 200（fallback），实际 ${res.status()}`).toBe(200);
    expect(type, `缺资源必须是 text/html 才说明走了 fallback，实际 ${type}`).toContain("text/html");
    // 正面确认：拿到的确实是首页，不是某种神奇的 200 空体。
    expect(await res.text()).toContain('<div id="root">');
  });

  // 防：CSP 写歪把自己打死——内联主题脚本被 script-src 挡掉会闪主题甚至白屏，被挡的样式让界面
  // 塌成纯文本。三路信号（CSP 违规事件 / console.error / pageerror）任一非空都算红。
  test("加载全程无 CSP 违规、无 console 错误、无未捕获异常", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    // init script 在每个新文档创建后、任何页面脚本之前执行，早于 meta CSP 的生效点。
    await page.addInitScript(() => {
      const bucket: string[] = [];
      // 挂到 window 上供外面读回；用固定键，不依赖闭包跨上下文。
      (window as unknown as { __csp: string[] }).__csp = bucket;
      document.addEventListener("securitypolicyviolation", (event) => {
        bucket.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (META_CSP_NOISE.test(text)) return;
      consoleErrors.push(text);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(BASE_PATH);
    // 等到真实业务内容上屏：只等 #root 会过早，那时 fetch 还没回来，
    // CSP 对内联脚本与外链的判断也可能还没走完。
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("降智雷达");
    const probe = readStatusProbe();
    await expect(page.locator("#root")).toContainText(`${probe.candidates_ok}/${probe.candidates_total} 候选`);

    const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect(violations, `CSP 违规：${violations.join(" | ")}`).toEqual([]);
    expect(consoleErrors, `console 错误：${consoleErrors.join(" | ")}`).toEqual([]);
    expect(pageErrors, `未捕获异常：${pageErrors.join(" | ")}`).toEqual([]);
  });

  // 防：「200 了但其实没渲染」。资源全绿 + 白屏是最难查的一类，必须有内容级断言。
  // 顺带守住数据请求的数量与落点：改动 loader 导致多打/少打、或拼回根路径，这里会红。
  test("真实业务内容渲染，且数据请求恰 3 次并全落在子路径下", async ({ page }) => {
    const dataRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/data/")) dataRequests.push(request.url());
    });

    await page.goto(BASE_PATH);
    const probe = readStatusProbe();
    // 覆盖行直出 status.json 的 candidates_ok/candidates_total，等于证明 fetch→校验→渲染全链路通。
    await expect(page.locator("#root")).toContainText(`${probe.candidates_ok}/${probe.candidates_total} 候选`);
    // 三份数据缺一不可，README 也写着三槽互不连坐。
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByRole("tab", { name: "本轮雷达" })).toHaveAttribute("aria-selected", "true");

    expect(dataRequests.length, `/data/ 请求应恰 3 次，实际 ${dataRequests.join(", ")}`).toBe(3);
    for (const url of dataRequests) {
      expect(url, `${url} 必须落在 ${BASE_PATH}data/ 下`).toContain(`${BASE_PATH}data/`);
    }
  });
});
