import { defineConfig, devices } from "@playwright/test";

/**
 * 站点部署在 GitHub Pages 子路径 /ChatGPT-IQ-Check/ 下（见 vite.config.ts 的 base）。
 * e2e 必须从这个子路径进——根路径只用来验重定向，别拿它当基准。
 */
const PORT = 4321;
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  /**
   * 起 preview 放在 globalSetup 而不是 webServer：playwright 收尾要 taskkill 掉 webServer 进程树，
   * 受限令牌/沙箱下 taskkill 会"拒绝访问"，进程杀不掉、teardown 永久吊住——用例全绿了命令也不返回。
   * globalSetup 里 detached + unref 起服务，playwright 不跟踪它，主进程跑完立刻退出。
   * （build 与就绪轮询也都在 globalSetup 里，见 tests/e2e/global-setup.ts。）
   */
  globalSetup: "./tests/e2e/global-setup.ts",
  // preview 是单个进程、端口固定，多 worker 会互相踩，固定单 worker。
  workers: 1,
  fullyParallel: false,
  // CI 上留 retries 只为吸收抖动；本地不重试，红了就是真红，别让 flaky 藏起来。
  retries: process.env.CI ? 1 : 0,
  // 本地 .only 忘了删，CI 上要红。
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  use: {
    // 相对路径导航（page.goto("/")）以此为准。
    baseURL: ORIGIN,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
