import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
// token 必须先于组件样式：theme.css 里的 base 段与组件段都靠这些变量取值。
import "./styles/tokens.css";
import "./styles/theme.css";

// 根兜底：App 之外的渲染也炸时还有一个能点的重试。
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
