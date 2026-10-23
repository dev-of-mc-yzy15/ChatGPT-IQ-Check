import { render, screen } from "@testing-library/react";
import App from "../src/App";

it("renders the app title", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /降智雷达/ })).toBeInTheDocument();
});
