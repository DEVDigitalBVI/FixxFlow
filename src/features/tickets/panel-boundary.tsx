'use client';

import { Component, type ReactNode } from 'react';

import { RetryButton } from '@/components/ui/retry-button';

/** Unexpected client/descendant failures stay local to this independent panel. */
export class PanelBoundary extends Component<
  { children: ReactNode; label: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: Readonly<{ children: ReactNode; label: string }>) {
    if (this.state.failed && previous.children !== this.props.children)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <section className="settings-card">
        <p role="alert">
          {this.props.label} could not load. <RetryButton />
        </p>
      </section>
    ) : (
      this.props.children
    );
  }
}
