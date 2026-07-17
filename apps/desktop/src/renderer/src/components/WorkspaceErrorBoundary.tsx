/**
 * Recoverable workspace error boundary. It catches a real render-time crash in a major workspace, reuses
 * the EXISTING crash-report seam (`ipc.releaseOps.reportError`) so the error lands in diagnostics / the
 * support bundle, and renders a hooks-capable recovery surface (`ErrorFallback`) that reuses the Increment-2
 * toast system, the App-Shell navigation, and the shared redaction-safe error-report core. Actions are all
 * real: Retry remounts the workspace subtree, Copy details copies a redacted report, Open diagnostics
 * navigates to the real Diagnostics Center, Restart workspace recovers to Home, and Report error re-sends
 * the crash. Nothing is simulated — the boundary only appears when a workspace actually throws.
 */
import { Component, Fragment, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { buildErrorReport, formatErrorReport, workspaceLabel } from '@neuropause/shared';
import { createLogger } from '@renderer/lib/logger';
import { ipc } from '@renderer/lib/ipc';
import { useToast } from '@renderer/state/ToastProvider';
import { useShell } from '@renderer/state/ShellProvider';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';

const log = createLogger('workspace-error-boundary');

interface Props {
  /** The section/workspace id being guarded (e.g. 'enterprise', 'operations'). */
  name: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
  componentStack: string | null;
  resetKey: number;
}

export class WorkspaceErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error(`Unhandled error in workspace ${this.props.name}`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    // Reuse the existing crash-report channel — fire-and-forget, never cascade a failure.
    try {
      void ipc.releaseOps
        .reportError({ kind: `workspace:${this.props.name}`, message: error.message, stack: error.stack })
        .catch(() => undefined);
    } catch {
      /* best-effort */
    }
  }

  private handleRetry = (): void => this.setState((s) => ({ error: null, componentStack: null, resetKey: s.resetKey + 1 }));

  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback workspace={this.props.name} error={this.state.error} componentStack={this.state.componentStack} onRetry={this.handleRetry} />;
    }
    // Keyed so Retry remounts the workspace subtree fresh (same section, clean state).
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

/* ── the recovery surface (hooks-capable; lives inside the shell providers) ────────── */

function ErrorFallback({
  workspace,
  error,
  componentStack,
  onRetry,
}: {
  workspace: string;
  error: Error;
  componentStack: string | null;
  onRetry: () => void;
}): JSX.Element {
  const { success, error: toastError } = useToast();
  const { setSection, openOperations } = useShell();
  const [env, setEnv] = useState<{ version: string; platform: string } | null>(null);
  const [reported, setReported] = useState(false);

  // Surface the crash through the existing toast system + capture cheap real app info for the report.
  useEffect(() => {
    let alive = true;
    void ipc.app.getInfo().then((i) => { if (alive) setEnv({ version: i.version, platform: String(i.platform) }); }).catch(() => undefined);
    toastError(`${workspaceLabel(workspace)} hit an error`, {
      message: 'The workspace was isolated so the rest of the app keeps working. Retry, or copy the details.',
      dedupeKey: `boundary:${workspace}`,
      durationMs: 0,
    });
    return () => { alive = false; };
  }, [workspace, toastError]);

  const report = useMemo(
    () =>
      buildErrorReport({
        workspace,
        message: error.message,
        stack: error.stack,
        componentStack: componentStack ?? undefined,
        appVersion: env?.version,
        platform: env?.platform,
        timestampIso: new Date().toISOString(),
        url: window.location.href,
      }),
    [workspace, error, componentStack, env],
  );

  const copyDetails = (): void => {
    void navigator.clipboard.writeText(formatErrorReport(report)).then(() => success('Error details copied')).catch(() => toastError('Could not copy details'));
  };
  const openDiagnostics = (): void => openOperations('diagnostics');
  const restartWorkspace = (): void => { onRetry(); setSection('intent-home'); };
  const reportError = (): void => {
    void ipc.releaseOps
      .reportError({ kind: `workspace:${workspace}:userReport`, message: error.message, stack: error.stack })
      .then(() => { setReported(true); success('Error report sent to diagnostics'); })
      .catch(() => toastError('Could not send the report'));
  };

  return (
    <div className="app-bg flex h-full w-full items-center justify-center p-8">
      <div className="surface-raised flex w-full max-w-lg flex-col rounded-2xl p-6 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-syspink/15 text-syspink"><Icon name="info" size={22} /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{workspaceLabel(workspace)} hit an error</h2>
            <p className="text-sm text-muted">This workspace was isolated and recovered — the rest of the app is unaffected.</p>
          </div>
        </div>
        {report.message && (
          <pre className="mt-4 max-h-40 w-full overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] p-3 text-left text-[11px] text-muted">
            {report.message}{report.componentStack ? `\n${report.componentStack}` : ''}
          </pre>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" icon="refresh" onClick={onRetry}>Retry</Button>
          <Button variant="secondary" size="sm" icon="clipboard" onClick={copyDetails}>Copy details</Button>
          <Button variant="secondary" size="sm" icon="beaker" onClick={openDiagnostics}>Open diagnostics</Button>
          <Button variant="ghost" size="sm" icon="undo" onClick={restartWorkspace}>Restart workspace</Button>
          <Button variant="ghost" size="sm" icon="bolt" disabled={reported} onClick={reportError}>{reported ? 'Reported' : 'Report error'}</Button>
        </div>
      </div>
    </div>
  );
}
