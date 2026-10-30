import { urlFor } from "../data/loader";

/** 反斜杠分隔符用字符码构造，避开各层转义差异（Windows 风格路径也能取到 basename）。 */
const BACKSLASH = String.fromCharCode(92);

/**
 * 上游产物的扩展名是 `.html.txt`：上游按「源码文本」收，静态托管一律回 `text/plain`。
 * 本地落盘时去掉那个 `.txt`（见 `localAssetName`），托管按扩展名回 `text/html`，
 * iframe 才能用 `src` 直接加载——`src` 的子文档是独立文档，**不继承父页面 CSP**。
 *
 * 这一点是硬需求，不是偏好：`index.html` 的 `script-src` 只放行自己那一个 hash，
 * 而 34 个产物里有 23 个靠内联 `<script>` 驱动交互。走 `srcDoc` 时子文档继承父 CSP，
 * 那些脚本会被 `script-src-elem` 全部挡掉，线上动画只剩静帧。
 */
const UPSTREAM_SUFFIX = ".html.txt";
const LOCAL_SUFFIX = ".html";

/**
 * 把上游 basename 映射成本地 `public/assets/` 下的真实文件名。
 *
 * 只认末尾的 `.html.txt`，其余名字原样返回——上游将来换命名时不要被这里悄悄改写。
 * `scripts/verify-assets.mjs` 里有一份同规则的副本（该脚本跑在 node 下，不经过 TS 构建），
 * 两处必须同时改；`tests/asset.test.ts` 与 `tests/verify-assets.test.ts` 分别钉住两侧。
 *
 * @param baseName 上游 `asset_url` 的 basename
 * @returns 本地文件名
 */
export function localAssetName(baseName: string): string {
  return baseName.endsWith(UPSTREAM_SUFFIX)
    ? baseName.slice(0, -UPSTREAM_SUFFIX.length) + LOCAL_SUFFIX
    : baseName;
}

/**
 * 上游 `asset_url` 是 codexradar.com 的**站点根绝对路径**（形如
 * `/assets/degradation-….html.txt`）。直接塞进 iframe 会打到本项目域名根，
 * 在 Pages 子路径（base = `/ChatGPT-IQ-Check/`）下必然 404。
 *
 * 这里只取 basename，映射成本地文件名（`.html.txt` → `.html`），再拼到本项目自己的
 * `assets/` 目录下——那些产物已按每条的 `asset_sha256` 校验后落在 `public/assets/`。
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
  return urlFor(`assets/${localAssetName(baseName)}`, base ?? (import.meta.env.BASE_URL || "/"));
}
