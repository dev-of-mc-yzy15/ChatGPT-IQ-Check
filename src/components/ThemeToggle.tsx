import { useTheme } from "../lib/useTheme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  // WCAG 2.5.3 Label in Name：可访问名必须原样包含可见文本，语音控制用户才喊得出来。
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={toggle}
      aria-label={`切换主题：${theme === "dark" ? "浅色" : "深色"}`}
      aria-pressed={theme === "dark"}
    >
      <svg className="theme-toggle__icon" viewBox="0 0 20 20" aria-hidden="true">
        {theme === "dark" ? (
          <><circle cx="10" cy="10" r="3.5" /><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6 5 5M15 15l1.4 1.4M16.4 3.6 15 5M5 15l-1.4 1.4" /></>
        ) : (
          <path d="M16.8 12.2A7.3 7.3 0 0 1 7.8 3.2a7.3 7.3 0 1 0 9 9Z" />
        )}
      </svg>
      {theme === "dark" ? "浅色" : "深色"}
    </button>
  );
}
