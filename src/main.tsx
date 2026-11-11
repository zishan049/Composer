import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Global React Error Boundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: "100vh",
          width: "100vw",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0B0F19",
          color: "#F0F4F8",
          fontFamily: "Inter, sans-serif",
          padding: "24px",
          textAlign: "center"
        }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px", color: "#2457FF" }}>
            Composer Encountered an Interface Error
          </h2>
          <p style={{ fontSize: "12px", color: "#8B9BB4", maxWidth: "480px", marginBottom: "16px", lineHeight: 1.6 }}>
            {this.state.error?.message || "An unexpected error occurred while rendering the workspace view."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 16px",
              backgroundColor: "rgba(36, 87, 255, 0.18)",
              border: "1px solid rgba(36, 87, 255, 0.40)",
              color: "#DFF7FF",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Reload Interface
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </React.StrictMode>,
);
