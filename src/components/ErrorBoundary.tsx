import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed && typeof parsed.error === 'string') {
          friendly = `${parsed.error} (${parsed.operationType} on ${parsed.path || 'database'})`;
        }
      } catch {
        // plain error message
      }

      return (
        <div className="min-h-screen bg-[#050508] text-zinc-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#0C0E14] border border-white/10 rounded-xl p-6 space-y-4">
            <h2 className="text-xl font-semibold text-amber-400">
              Something went wrong
            </h2>
            <p className="text-sm text-zinc-300 leading-relaxed break-words">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
