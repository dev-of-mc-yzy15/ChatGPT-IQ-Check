import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "iq-radar-theme";

/** 地址栏/状态栏配色取自 theme.css 的 --bg，浅深各一份。 */
const THEME_COLOR: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#0f1115",
};

/** index.html 里是静态 #ffffff；测试与首屏之外都靠这里兜底，缺节点就补一个。 */
function syncThemeColor(theme: Theme) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", THEME_COLOR[theme]);
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore storage failures and fall through to media query */
  }
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    syncThemeColor(theme);
  }, [theme]);

  // 函数式更新：toggle 只捕获稳定的 setTheme，连点两次能真的翻回去。
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
