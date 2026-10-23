import { useTheme } from "../lib/useTheme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button type="button" className="card" onClick={toggle} aria-pressed={theme === "dark"}>
      {theme === "dark" ? "☀️ 浅色" : "🌙 深色"}
    </button>
  );
}
