import { execSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 起 preview 服务。
 *
 * 为什么不用 config 的 webServer：playwright 收尾要 taskkill 掉 webServer 进程树，
 * 而受限令牌/沙箱下 taskkill 会被"拒绝访问"，进程杀不掉、teardown 就永远吊着——
 * 5 条用例全绿了命令也不返回，CI 只能挂到 job 超时。
 * 改法：detached + unref 自己拉起 preview，playwright 不跟踪它，主进程跑完立刻退出；
 * 残留进程下次直接复用（preview 每次请求都读磁盘，build 完就是新产物，复用不脏）。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_PATH = "/ChatGPT-IQ-Check/";
const PORT = 4321;
const PROBE_URL = `http://localhost:${PORT}${BASE_PATH}`;
/** preview 正常几百毫秒就绪；给到 30s 是留冷启动与杀软扫描的余量。 */
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

/** 只认 200 + HTML：拿到 404 或空体都算没就绪。 */
async function isServing(): Promise<boolean> {
  try {
    const res = await fetch(PROBE_URL);
    if (!res.ok) return false;
    return (res.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export default async function globalSetup(): Promise<void> {
  // CI 上 build 由前一个 step 负责（见 .github/workflows/ci.yml），重复构建纯属浪费。
  if (process.env.E2E_PREBUILT !== "1") {
    execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });
  }

  if (await isServing()) {
    console.log(`[e2e] ${PROBE_URL} 已有 preview 在跑，直接复用`);
    return;
  }

  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: repoRoot,
    // detached：自立进程组，父进程退出不带走它；unref：不阻止父进程退出。
    detached: true,
    // ignore：一旦往父进程的 stdio 写，父进程退出就得等管道关闭。
    stdio: "ignore",
    // Windows 上 npx 是 .cmd，必须过 shell。
    shell: true,
  });
  child.unref();

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServing()) {
      console.log(`[e2e] preview 已就绪：${PROBE_URL}`);
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `preview 在 ${READY_TIMEOUT_MS}ms 内没起来（pid ${child.pid ?? "?"}）。` +
      "常见原因：4321 被占但服务的是别的东西，或 build 产物缺 dist/index.html。",
  );
}
