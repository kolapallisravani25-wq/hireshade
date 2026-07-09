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
      // Never render the raw error message/stack: a thrown error can carry a
      // session token or other sensitive data (e.g. an auth/fetch failure whose
      // message includes a URL or JWT), and dumping it here would leak it as
      // visible text. Full details still go to the console via componentDidCatch.
      return (
        <div style={{ padding: 24, fontFamily: "sans-serif", color: "#b91c1c" }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ marginBottom: 8, color: "#7f1d1d" }}>
            An unexpected error occurred. Please try again.
          </p>
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
