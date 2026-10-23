import { useTheme } from "../lib/useTheme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      type="button"
      className="card"
      onClick={toggle}
      aria-label="切换主题"
      aria-pressed={theme === "dark"}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>{" "}
      {theme === "dark" ? "浅色" : "深色"}
    </button>
  );
}
