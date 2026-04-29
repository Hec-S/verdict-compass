import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Friendly label for the section being guarded (e.g. "Synthesis report"). */
  label?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Inline error boundary: catches render errors inside `children` and shows
 *  a small recoverable error card instead of bubbling up to the global
 *  "Something went wrong" screen. The "Retry" button resets the boundary so
 *  the user can try again without a full page reload. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console for debugging; do not rethrow.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", this.props.label ?? "section", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const label = this.props.label ?? "this section";
      return (
        <div className="border border-destructive/40 bg-destructive/5 p-4 my-4">
          <p className="text-[13px] text-destructive font-medium mb-1">
            Could not render {label}.
          </p>
          <p className="text-[12px] text-foreground/80 font-mono break-words mb-3">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center h-7 px-3 text-[12px] text-foreground border border-foreground/80 hover:bg-foreground/[0.05] transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}