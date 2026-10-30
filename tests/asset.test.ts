import { describe, it, expect } from "vitest";
import { assetUrl } from "../src/lib/asset";

const NAME = "degradation-codex-205416a78068-6a72489e707c-gpt-6.1-sol-low-69d67bc51db3.html.txt";

describe("assetUrl", () => {
  it("拼出站内 assets/ 路径并带上 base", () => {
    // Pages 部署在子路径下，前缀必须是 base，不能是站点根。
    expect(assetUrl(NAME, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${NAME}`);
    expect(assetUrl(NAME, "/")).toBe(`/assets/${NAME}`);
  });

  it("根绝对的上游路径必须丢掉路径只取 basename", () => {
    // 上游 asset_url 原样长这样；若不剥前缀，iframe 会打到域名根而不是 base 下。
    expect(assetUrl(`/assets/${NAME}`, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${NAME}`);
    // 反证：结果不能出现 `//assets` 这种根拼接痕迹。
    const out = assetUrl(`/assets/${NAME}`, "/ChatGPT-IQ-Check/")!;
    expect(out.startsWith("/ChatGPT-IQ-Check/assets/")).toBe(true);
    expect(out).not.toContain("//assets");
  });

  it("完整 URL 同样只取 basename", () => {
    expect(assetUrl(`https://codexradar.com/assets/${NAME}`, "/ChatGPT-IQ-Check/")).toBe(
      `/ChatGPT-IQ-Check/assets/${NAME}`,
    );
  });

  it("裸文件名可直接用", () => {
    expect(assetUrl(NAME, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${NAME}`);
  });

  it("null 与空串返回 null", () => {
    expect(assetUrl(null)).toBeNull();
    expect(assetUrl(undefined)).toBeNull();
    expect(assetUrl("")).toBeNull();
    // 只有斜杠也算空。
    expect(assetUrl("/", "/")).toBeNull();
  });

  it("默认 base 取自 import.meta.env.BASE_URL", () => {
    expect(assetUrl(NAME)).toBe(`${import.meta.env.BASE_URL}assets/${NAME}`);
  });

  it("忽略 query 与 fragment", () => {
    expect(assetUrl(`/assets/${NAME}?v=2`, "/ChatGPT-IQ-Check/")).toBe(`/ChatGPT-IQ-Check/assets/${NAME}`);
  });
});
