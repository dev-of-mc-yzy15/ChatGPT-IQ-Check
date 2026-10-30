import { expect, test } from "@playwright/test";

test("diag", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => logs.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
  page.on("response", (r) => { if (r.status() >= 400) logs.push(`http ${r.status()}: ${r.url()}`); });

  await page.goto("/ChatGPT-IQ-Check/");
  await page.locator("#round-matrix-heading").locator("xpath=ancestor::section[1]")
    .getByRole("button", { name: /gpt-6\.1-sol 低 /i }).click();
  await page.locator("#round-detail-heading").waitFor();
  await page.getByText("播放降智动画（沙箱隔离，展开后加载）").click();
  const iframe = page.locator("#round-detail-heading").locator("xpath=ancestor::section[1]").locator("iframe");
  await expect(iframe).toBeAttached();
  await page.waitForTimeout(3000);
  const html = await iframe.evaluate((e) => e.outerHTML);
  const handle = await iframe.elementHandle();
  const frame = await handle?.contentFrame();
  let url = "NO FRAME";
  let body = "NO BODY";
  let toggle = "NO TOGGLE";
  try {
    url = frame ? frame.url() : "NO FRAME";
    body = frame ? (await frame.evaluate(() => document.body.innerHTML)).slice(0, 120) : "NO BODY";
    toggle = frame ? String(await frame.evaluate(() => !!document.getElementById("toggle"))) : "NO TOGGLE";
  } catch (error) { body = `EVAL ERROR: ${(error as Error).message}`; }
  console.log("=== DIAG BEGIN ===");
  console.log("iframe outerHTML:", html);
  console.log("frame.url():", JSON.stringify(url));
  console.log("body:", JSON.stringify(body));
  console.log("hasToggle:", toggle);
  console.log("logs:", logs.join("\n"));
  console.log("=== DIAG END ===");
});
