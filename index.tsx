import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', background: '#fef2f2', color: '#991b1b', border: '1px solid #f87171', borderRadius: '0.5rem', margin: '2rem', fontFamily: 'sans-serif' }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong.</h2>
          <p>The application crashed. This sometimes happens due to browser-specific settings (like third-party cookie blocking in Chrome) or an unexpected error.</p>
          <pre style={{ background: '#fee2e2', padding: '1rem', borderRadius: '0.25rem', overflowX: 'auto', fontSize: '14px' }}>
            {this.state.error && this.state.error.toString()}
          </pre>
          <button style={{ background: '#ef4444', color: 'white', padding: '0.5rem 1rem', border: 'none', borderRadius: '0.25rem', cursor: 'pointer', marginTop: '1rem' }} onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);