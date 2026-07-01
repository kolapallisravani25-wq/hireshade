import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "monospace", whiteSpace: "pre-wrap", color: "#b91c1c" }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ marginBottom: 8 }}>{this.state.error.message}</p>
          <pre style={{ fontSize: 11, opacity: 0.7 }}>{this.state.error.stack}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: "6px 12px", border: "1px solid #b91c1c", borderRadius: 6 }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
