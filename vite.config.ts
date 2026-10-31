import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ChatGPT-IQ-Check/",
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // 默认 5 s 对真实 fs 密集用例只有 1.6 倍余量，负载下会假红，假红比慢更贵
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
