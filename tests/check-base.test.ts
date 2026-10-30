import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * check-base.mjs 的检出能力闸门测试。
 *
 * 这个脚本是子路径部署的唯一机器防线（base 是 /ChatGPT-IQ-Check/，站点挂在
 * GitHub Pages 子路径下），所以每条「根绝对路径得能被认出来」的形态都要有独立用例。
 *
 * 为什么必须按引号形态逐条钉：Vite 对源 HTML 里的属性引号是原样保留的，双引号、
 * 单引号、无引号三种写法都能进产物。此前脚本的正则把引号写死成 `"`，于是单引号与
 * 无引号引用在 build 后照样过闸门——CI 全绿，线上 404 白屏。只测双引号等于没测。
 *
 * 夹具一律造在 os.tmpdir() 的临时目录里，靠子进程 cwd 指过去：脚本的 TARGET 是
 * 相对 cwd 的 dist/index.html，没有 --root，用 cwd 才是它真实的调用方式（CI 也是
 * 在仓库根直接跑）。顺手也证明脚本不依赖别的东西。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(repoRoot, "scripts/check-base.mjs");

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * 造一个只含 dist/index.html 的迷你站点根。
 * `html` 传 null 表示连 dist/ 都不建，用于「产物不存在必须红」那条。
 */
async function makeRoot(html: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "check-base-"));
  created.push(root);
  if (html !== null) {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.html"), html, "utf8");
  }
  return root;
}

/**
 * 页面骨架：head 里每条各占一行，第 4 行起，行号可预期，便于断言定位信息。
 * 形状照 Vite 产物的真实样子造（doctype + 中文 lang + 空 body 挂载点）。
 */
function page(...head: string[]): string {
  const body = head.map((line) => `    ${line}`).join("\n");
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "  <head>",
    body,
    "  </head>",
    '  <body><div id="root"></div></body>',
    "</html>",
    "",
  ].join("\n");
}

function run(root: string) {
  const out = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  return { code: out.status, stdout: out.stdout ?? "", stderr: out.stderr ?? "" };
}

/** 红的通用形状：退 1、指到第 4 行、带列号与片段、说明改法。 */
function expectViolation(r: ReturnType<typeof run>, snippet: string) {
  expect(r.code, "必须退 1，假绿就是白屏").toBe(1);
  expect(r.stderr).toMatch(/第 4 行第 \d+ 列 <- /);
  expect(r.stderr).toContain(snippet);
  expect(r.stderr).toContain("根绝对路径引用");
  expect(r.stdout).not.toContain("无根绝对路径引用");
}

/** 绿的通用形状：退 0 且明确说没命中。 */
function expectClean(r: ReturnType<typeof run>) {
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("无根绝对路径引用");
  expect(r.stderr).toBe("");
}

describe("check-base", () => {
  // ── 三种引号形态。双引号一直能抓；单引号与无引号是本次补的洞 ──
  it("双引号属性里的根绝对路径退 1", async () => {
    const root = await makeRoot(page('<link rel="stylesheet" href="/assets/legacy.css">'));

    expectViolation(run(root), "/assets/legacy.css");
  });

  it("单引号属性里的根绝对路径退 1", async () => {
    // Vite 原样保留源 HTML 的单引号，旧正则只认双引号 → 这条会假绿。
    const root = await makeRoot(page("<script src='/assets/legacy.js'></script>"));

    expectViolation(run(root), "/assets/legacy.js");
  });

  it("无引号属性里的根绝对路径退 1", async () => {
    const root = await makeRoot(page("<script src=/assets/bare.js></script>"));

    expectViolation(run(root), "/assets/bare.js");
  });

  it("poster 属性里的根绝对路径也退 1", async () => {
    const root = await makeRoot(page('<video poster="/assets/cover.png"></video>'));

    expectViolation(run(root), "/assets/cover.png");
  });

  // 既有行为：单独的根路径 "/" 本身也是回退（旧版注释明确写了要抓），不能被改漏。
  it("属性值就是单独的根路径 / 时退 1", async () => {
    const root = await makeRoot(page(String.raw`<a href="/">首页</a>`));

    expectViolation(run(root), `href="/"`);
  });

  it("无引号的单独根路径 / 也退 1", async () => {
    const root = await makeRoot(page("<a href=/>首页</a>"));

    expectViolation(run(root), "href=/");
  });

  // ── srcset 是多值，逗号后每个候选都得看，不能只看第一个 ──
  it("srcset 首个候选是根绝对时退 1", async () => {
    const root = await makeRoot(
      page('<img srcset="/assets/a.png 1x, /assets/b.png 2x" src="x.png">'),
    );

    expectViolation(run(root), "/assets/a.png");
  });

  it("srcset 首候选合规、逗号后候选是根绝对时仍退 1", async () => {
    // 只按单值属性抓第一段的话，这里首段带 base 会让整条属性被放过，
    // 第二段的 /assets/b.png 就静默漏掉。
    const root = await makeRoot(
      page('<img srcset="/ChatGPT-IQ-Check/a.png 1x, /assets/b.png 2x">'),
    );

    expectViolation(run(root), "/assets/b.png");
  });

  it("单引号包裹的 srcset 里根绝对退 1", async () => {
    const root = await makeRoot(page("<img srcset='/ChatGPT-IQ-Check/a.png 1x, /assets/b.png 2x'>"));

    expectViolation(run(root), "/assets/b.png");
  });

  // ── 内联 style 里的 url(/…) ──
  it("内联 style 的 url(/…) 退 1", async () => {
    const root = await makeRoot(page('<div style="background:url(/assets/bg.png)"></div>'));

    expectViolation(run(root), "url(/assets/bg.png)");
  });

  it("url( 与斜杠之间有空白也退 1", async () => {
    const root = await makeRoot(page('<div style="background:url(  /assets/bg.png )"></div>'));

    expectViolation(run(root), "/assets/bg.png");
  });

  // ── 放行：带 base 前缀的同样形态必须绿，否则闸门会把正确写法判红 ──
  it("全部形态都带 base 前缀时退 0", async () => {
    const root = await makeRoot(
      page(
        '<link rel="stylesheet" href="/ChatGPT-IQ-Check/assets/a.css">',
        "<script src='/ChatGPT-IQ-Check/assets/a.js'></script>",
        "<script src=/ChatGPT-IQ-Check/assets/bare.js></script>",
        '<img srcset="/ChatGPT-IQ-Check/a.png 1x, /ChatGPT-IQ-Check/b.png 2x">',
        '<video poster="/ChatGPT-IQ-Check/cover.png"></video>',
        '<div style="background:url(/ChatGPT-IQ-Check/bg.png)"></div>',
      ),
    );

    expectClean(run(root));
  });

  // ── 放行：不带前导斜杠的外链与内联数据 ──
  it("data: / https: / //host 一律放行", async () => {
    const root = await makeRoot(
      page(
        '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E">',
        '<link rel="canonical" href="https://dev-of-mc-yzy15.github.io/ChatGPT-IQ-Check/">',
        '<script src="//cdn.example.com/x.js"></script>',
        '<img srcset="//cdn.example.com/a.png 1x, //cdn.example.com/b.png 2x">',
      ),
    );

    expectClean(run(root));
  });

  // ── 空闸门防护：读不到产物必须红，不能静默通过 ──
  it("dist/index.html 缺失时退 1 并说明先 build", async () => {
    const root = await makeRoot(null);

    const r = run(root);

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("不存在");
    expect(r.stderr).toContain("npm run build");
  });

  // ── 多处命中要逐条报，不能只报第一处就收工 ──
  it("多处命中时逐条打印行号与列号", async () => {
    const root = await makeRoot(
      page('<link rel="stylesheet" href="/assets/a.css">', "<script src='/assets/b.js'></script>"),
    );

    const r = run(root);

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("第 4 行");
    expect(r.stderr).toContain("第 5 行");
    expect(r.stderr).toContain("2 处根绝对路径引用");
  });
});
