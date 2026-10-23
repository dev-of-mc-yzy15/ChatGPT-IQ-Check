import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("render error", error, info);
  }

  render() {
    if (this.state.error !== null) {
      const { error } = this.state;
      return (
        <main id="main">
          <div className="card" role="alert">
            <h1>页面渲染失败</h1>
            <p className="muted">{error instanceof Error ? error.message : String(error)}</p>
            <button type="button" onClick={() => this.setState({ error: null })}>
              重试
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
