import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Top-level safety net: a render error anywhere in the tree shows a calm recovery
 * screen instead of a blank white page. Wrap `<App />` in `main.tsx`.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className="page container center"
        style={{ minHeight: "60vh", display: "grid", placeItems: "center", textAlign: "center" }}
      >
        <div style={{ maxWidth: 420 }}>
          <p className="eyebrow">Something went wrong</p>
          <h1 style={{ fontSize: 28, marginTop: 8 }}>This page hit an unexpected error.</h1>
          <p className="muted" style={{ marginTop: 10 }}>
            Your session is still active. Reloading usually clears it.
          </p>
          <button
            className="btn btn--gold"
            style={{ marginTop: 22 }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
