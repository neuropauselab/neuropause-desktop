import { LoginScreen } from '@renderer/screens/LoginScreen';
import { Spinner } from '@renderer/components/Spinner';
import { useAuth } from '@renderer/providers/AuthProvider';
import { ShellProvider } from '@renderer/state/ShellProvider';
import { DashboardProvider } from '@renderer/state/DashboardProvider';
import { AppShell } from '@renderer/shell/AppShell';

/**
 * Root of the renderer. Chooses the top-level surface from the auth status held
 * in the main process:
 *   - while learning the initial status → a quiet loading state
 *   - authenticated                     → the full application shell
 *   - anything else                     → the login screen (which also renders
 *     the "authenticating" and "error" states)
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
      <ShellProvider>
        <DashboardProvider>
          <AppShell session={status.session} />
        </DashboardProvider>
      </ShellProvider>
    );
  }

  return <LoginScreen />;
}
