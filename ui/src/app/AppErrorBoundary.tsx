import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ProxyManager render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-shell">
        <section className="fatal-panel" role="alert">
          <span className="fatal-icon"><TriangleAlert size={20} /></span>
          <div>
            <strong>控制台加载失败</strong>
            <p>{this.state.error.message}</p>
          </div>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            <RefreshCw size={15} />重新加载
          </button>
        </section>
      </main>
    );
  }
}
