import { urlFor } from "../data/loader";

/** 反斜杠分隔符用字符码构造，避开各层转义差异（Windows 风格路径也能取到 basename）。 */
const BACKSLASH = String.fromCharCode(92);

/**
 * 上游 `asset_url` 是 codexradar.com 的**站点根绝对路径**（形如
 * `/assets/degradation-….html.txt`）。直接塞进 iframe 会打到本项目域名根，
 * 在 Pages 子路径（base = `/ChatGPT-IQ-Check/`）下必然 404。
 *
 * 这里只取 basename，再拼到本项目自己的 `assets/` 目录下——那些产物已按
 * 每条的 `asset_sha256` 校验后落在 `public/assets/`。
 *
 * @param name 上游 `asset_url`（根绝对路径、完整 URL 或裸文件名均可）
 * @param base 显式 base，默认读 `import.meta.env.BASE_URL`，便于测试
 * @returns 可渲染的站内路径；无法解析时返回 `null`（调用方据此不渲染占位框）
 */
export function assetUrl(name: string | null | undefined, base?: string): string | null {
  if (typeof name !== "string") return null;
  // 先去掉 query / fragment 再切段：上游虽是静态路径，也不该被 `?v=1` 打断。
  const path = name.split(/[?#]/)[0];
  const baseName = path.split(BACKSLASH).join("/").split("/").filter(Boolean).pop();
  if (!baseName) return null;
  return urlFor(`assets/${baseName}`, base ?? (import.meta.env.BASE_URL || "/"));
}
