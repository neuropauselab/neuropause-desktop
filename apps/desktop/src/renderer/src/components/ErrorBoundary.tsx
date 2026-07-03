import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createLogger } from '@renderer/lib/logger';
import { ipc } from '@renderer/lib/ipc';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

const log = createLogger('error-boundary');

interface Props {
  children: ReactNode;
  /** Optional label for logs, e.g. the view name. */
  name?: string;
  /** When true, renders a compact inline fallback (for a single view). */
  inline?: boolean;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time errors in its subtree, logs them, and shows a graceful
 * recovery surface instead of a blank screen. Used around the whole shell and
 * around each lazily-loaded view, so one failing view never takes down the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error(`Unhandled error in ${this.props.name ?? 'app'}`, error, info.componentStack);
    // Forward to the crash store so renderer errors are visible in diagnostics /
    // the support bundle. Fire-and-forget; never let reporting cascade a failure.
    try {
      void ipc.releaseOps
        .reportError({
          kind: `errorBoundary:${this.props.name ?? 'app'}`,
          message: error.message,
          stack: error.stack,
        })
        .catch(() => undefined);
    } catch {
      // ignore — reporting is best-effort
    }
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div
        className={
          this.props.inline
            ? 'flex h-full items-center justify-center p-8'
            : 'app-bg flex h-full w-full items-center justify-center p-8'
        }
      >
        <div className="surface-raised flex max-w-md flex-col items-center rounded-2xl p-8 text-center shadow-card">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-syspink/15 text-syspink">
            <Icon name="info" size={24} />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Something went wrong</h2>
          <p className="mt-1.5 text-sm text-muted">
            {this.props.name ? `The ${this.props.name} view` : 'This screen'} hit an unexpected
            error. You can try again, or reload the app.
          </p>
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" onClick={this.reset}>
              Try again
            </Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
