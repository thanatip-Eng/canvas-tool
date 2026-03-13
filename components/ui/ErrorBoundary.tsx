'use client';

import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackLabel?: string;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-2xl py-12 px-4">
          <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-6">
            <h2 className="text-lg font-bold text-[var(--color-danger)]">
              {this.props.fallbackLabel || 'เกิดข้อผิดพลาด'}
            </h2>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-4 text-xs text-[var(--color-text-muted)]">
              {this.state.error?.message}
              {'\n\n'}
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-bg-primary)] transition hover:opacity-90"
            >
              ลองใหม่
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
