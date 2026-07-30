import { LoginScreen } from '@renderer/screens/LoginScreen';
import { Spinner } from '@renderer/components/Spinner';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { useAuth } from '@renderer/providers/AuthProvider';
import { ScaleProvider } from '@renderer/state/ScaleProvider';
import { ServicesProvider } from '@renderer/services/ServicesProvider';
import { WorkspaceScopedShellProvider } from '@renderer/state/WorkspaceContextProvider';
import { DashboardProvider } from '@renderer/state/DashboardProvider';
import { ToastProvider } from '@renderer/state/ToastProvider';
import { ConnectionProvider } from '@renderer/state/ConnectionProvider';
import { AppShell } from '@renderer/shell/AppShell';

/**
 * Root of the renderer. Chooses the top-level surface from the auth status held
 * in the main process:
 *   - while learning the initial status → a quiet loading state
 *   - authenticated                     → the full application shell
 *   - anything else                     → the login screen (which also renders
 *     the "authenticating" and "error" states)
 *
 * Provider order: ScaleProvider (UI scaling) and ServicesProvider (data sources)
 * are outermost; DashboardProvider sits inside ServicesProvider because the
 * dashboard reads through the repository layer.
 */
export default function App(): JSX.Element {
  const { status, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="app-bg flex h-screen w-screen items-center justify-center">
        <div className="app-drag absolute inset-0" />
        <div className="text-muted relative flex flex-col items-center gap-3">
          <Spinner size={22} />
          <span className="text-sm">Starting NeuroPause…</span>
        </div>
      </div>
    );
  }

  if (status.state === 'authenticated') {
    return (
      <ScaleProvider>
        <ServicesProvider>
          <WorkspaceScopedShellProvider>
            <DashboardProvider>
              <ToastProvider>
                <ConnectionProvider>
                  <ErrorBoundary name="shell">
                    <AppShell session={status.session} />
                  </ErrorBoundary>
                </ConnectionProvider>
              </ToastProvider>
            </DashboardProvider>
          </WorkspaceScopedShellProvider>
        </ServicesProvider>
      </ScaleProvider>
    );
  }

  return <LoginScreen />;
}
