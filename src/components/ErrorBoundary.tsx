import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 局部边界：只塌掉自己这块，不再往页面里塞第二个 <main>。 */
  inline?: boolean;
  label?: string;
}

interface State {
  hasError: boolean;
  error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  // 判据必须是 hasError：抛出值本身可能就是 null/undefined，
  // 用 error !== null 会在那种情况下判成"没崩"从而无限重渲染。
  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("render error", this.props.label ?? "app", error, info);
  }

  render() {
    if (this.state.hasError) {
      const label = this.props.label ? `${this.props.label}渲染失败` : "页面渲染失败";
      // 同一屏里可能同时存在几个边界，光叫「重试」语音用户分不清点哪个：可访问名带上自己的 label。
      const retryName = this.props.label ? `重试${this.props.label}` : "重试页面";
      const detail = this.state.error instanceof Error
        ? this.state.error.message
        : String(this.state.error);
      const body = (
        <div className="card" role="alert">
          <strong>{label}</strong>
          <p className="muted">{detail}</p>
          <button
            type="button"
            aria-label={retryName}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            重试
          </button>
        </div>
      );
      return this.props.inline ? body : <main id="main">{body}</main>;
    }
    return this.props.children;
  }
}
