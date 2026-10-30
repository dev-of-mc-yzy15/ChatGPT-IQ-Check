import { describe, it, expect } from "vitest";
import { assetUrl, localAssetName } from "../src/lib/asset";

/** 上游 `asset_url` 里的 basename：带 `.html.txt`（round.json 是上游快照，永远是这形状）。 */
const NAME = "degradation-codex-205416a78068-6a72489e707c-gpt-6.1-sol-low-69d67bc51db3.html.txt";
/** 本地 `public/assets/` 的真实文件名：去掉 `.txt`，托管才按 text/html 回、iframe 才敢用 src。 */
const LOCAL = NAME.slice(0, -".txt".length);

describe("localAssetName", () => {
  it("末尾 .html.txt 去掉 .txt", () => {
    expect(localAssetName(NAME)).toBe(LOCAL);
  });

  it("不带 .html.txt 的名字原样返回", () => {
    // 反向保护：只有末尾精确匹配才改写。上游换命名时不能被无脑截断改坏。
    expect(localAssetName("degradation-plain.html")).toBe("degradation-plain.html");
    expect(localAssetName("degradation-other.txt")).toBe("degradation-other.txt");
    expect(localAssetName("no-extension")).toBe("no-extension");
  });

  it("只认末尾出现，中间出现不动", () => {
    expect(localAssetName("a.html.txt.bak")).toBe("a.html.txt.bak");
    expect(localAssetName("a.html.txt")).toBe("a.html");
  });
});

describe("assetUrl", () => {
  it("拼出站内 assets/ 路径并带上 base", () => {
    // Pages 部署在子路径下，前缀必须是 base，不能是站点根。
    expect(assetUrl(NAME, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${LOCAL}`);
    expect(assetUrl(NAME, "/")).toBe(`/assets/${LOCAL}`);
  });

  it("basename 必须映射成本地 .html，不能留着上游的 .html.txt", () => {
    // 留着 .html.txt 的话，src 加载会拿到 text/plain，屏上是源码而不是动画。
    const out = assetUrl(NAME, "/ChatGPT-IQ-Check/")!;
    expect(out.endsWith(".html")).toBe(true);
    expect(out).not.toContain(".html.txt");
  });

  it("根绝对的上游路径必须丢掉路径只取 basename", () => {
    // 上游 asset_url 原样长这样；若不剥前缀，iframe 会打到域名根而不是 base 下。
    expect(assetUrl(`/assets/${NAME}`, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${LOCAL}`);
    // 反证：结果不能出现 `//assets` 这种根拼接痕迹。
    const out = assetUrl(`/assets/${NAME}`, "/ChatGPT-IQ-Check/")!;
    expect(out.startsWith("/ChatGPT-IQ-Check/assets/")).toBe(true);
    expect(out).not.toContain("//assets");
  });

  it("完整 URL 同样只取 basename", () => {
    expect(assetUrl(`https://codexradar.com/assets/${NAME}`, "/ChatGPT-IQ-Check/")).toBe(
      `/ChatGPT-IQ-Check/assets/${LOCAL}`,
    );
  });

  it("裸文件名可直接用", () => {
    expect(assetUrl(NAME, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${LOCAL}`);
  });

  it("null 与空串返回 null", () => {
    expect(assetUrl(null)).toBeNull();
    expect(assetUrl(undefined)).toBeNull();
    expect(assetUrl("")).toBeNull();
    // 只有斜杠也算空。
    expect(assetUrl("/", "/")).toBeNull();
  });

  it("默认 base 取自 import.meta.env.BASE_URL", () => {
    expect(assetUrl(NAME)).toBe(`${import.meta.env.BASE_URL}assets/${LOCAL}`);
  });

  it("忽略 query 与 fragment", () => {
    expect(assetUrl(`/assets/${NAME}?v=2`, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${LOCAL}`);
    expect(assetUrl(`/assets/${NAME}#x`, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${LOCAL}`);
  });
});
