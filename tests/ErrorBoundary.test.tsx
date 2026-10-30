import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

afterEach(() => vi.restoreAllMocks());

// 抛出的组件不会 return，返回类型必须显式给 JSX.Element，否则 tsc 认为它是 void
const Boom = ({ mode }: { mode: "error" | "null" }): React.JSX.Element => {
  if (mode === "null") throw null;
  throw new Error("炸了");
};

describe("ErrorBoundary", () => {
  it("catches a thrown Error and shows its message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary inline label="本轮雷达">
        <Boom mode="error" />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("本轮雷达渲染失败");
    expect(alert).toHaveTextContent("炸了");
  });

  // regression：判据曾是 error !== null，throw null 会被判成"没崩"而无限重渲染
  it("catches a thrown null", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary inline label="趋势">
        <Boom mode="null" />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("趋势渲染失败");
  });

  it("does not nest a second main element when inline", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <main id="main">
        <ErrorBoundary inline>
          <Boom mode="error" />
        </ErrorBoundary>
      </main>,
    );
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("keeps the retry button usable without white-screening", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Flaky() {
      const [ok] = useState(false);
      if (!ok) throw new Error("先炸一下");
      return <p>恢复了</p>;
    }
    render(
      <ErrorBoundary inline label="块">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试块" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
