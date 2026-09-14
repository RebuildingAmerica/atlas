import { Component, type ReactNode } from "react";

export interface CaptureRenderErrorProps {
  children: ReactNode;
  /** Receives whatever a child threw while rendering. */
  onError: (error: unknown) => void;
}

interface CaptureRenderErrorState {
  caught: boolean;
}

/**
 * Error boundary for tests that assert a component throws during render.
 *
 * TanStack Router answers a thrown `notFound()` from a boundary above the
 * route, so a component that throws one is behaving correctly. React 19 no
 * longer rethrows render errors out of `render()`, so a test needs a boundary
 * of its own to see what was thrown.
 */
export class CaptureRenderError extends Component<
  CaptureRenderErrorProps,
  CaptureRenderErrorState
> {
  override state: CaptureRenderErrorState = { caught: false };

  static getDerivedStateFromError(): CaptureRenderErrorState {
    return { caught: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.caught ? <div data-testid="render-error-caught" /> : this.props.children;
  }
}
