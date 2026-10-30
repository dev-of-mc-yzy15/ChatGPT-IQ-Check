import { useTheme } from "../lib/useTheme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  // WCAG 2.5.3 Label in Name：可访问名必须原样包含可见文本，语音控制用户才喊得出来。
  return (
    <button
      type="button"
      className="card"
      onClick={toggle}
      aria-label={`切换主题：${theme === "dark" ? "浅色" : "深色"}`}
      aria-pressed={theme === "dark"}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>{" "}
      {theme === "dark" ? "浅色" : "深色"}
    </button>
  );
}
