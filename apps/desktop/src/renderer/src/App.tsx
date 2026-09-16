import { useState } from 'react';
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
import { LocalModeBanner } from '@renderer/shell/LocalModeBanner';
import { LocalModeConnectProvider } from '@renderer/shell/localModeConnect';
import type { LocalPrincipal, Session } from '@neuropause/shared';

/**
 * A clearly-synthetic DISPLAY session for a device-local principal (S17). It is
 * NOT a credential and claims no authentication — App renders it only inside the
 * `local` branch, and its email is the non-routable `@device.invalid` namespace,
 * so nothing downstream can mistake it for a real account.
 */
function localDisplaySession(principal: LocalPrincipal): Session {
  return {
    user: {
      id: principal.id,
      email: `local-${principal.id}@device.invalid`,
      displayName: principal.displayName,
      avatarUrl: null,
      createdAt: principal.createdAt,
      updatedAt: principal.createdAt,
    },
    accessTokenExpiresAt: 0,
  };
}

/** The full application shell + its provider stack, shared by the authenticated
 *  and local branches. An optional banner renders above the shell. */
function Shell({ session, banner }: { session: Session; banner?: JSX.Element }): JSX.Element {
  return (
    <ScaleProvider>
      <ServicesProvider>
        <WorkspaceScopedShellProvider>
          <DashboardProvider>
            <ToastProvider>
              <ConnectionProvider>
                <ErrorBoundary name="shell">
                  {banner}
                  <AppShell session={session} />
                </ErrorBoundary>
              </ConnectionProvider>
            </ToastProvider>
          </DashboardProvider>
        </WorkspaceScopedShellProvider>
      </ServicesProvider>
    </ScaleProvider>
  );
}

/**
 * Root of the renderer. Chooses the top-level surface from the auth status held
 * in the main process:
 *   - while learning the initial status → a quiet loading state
 *   - authenticated                     → the full application shell
 *   - local (S17)                       → the full shell + a "working locally"
 *     affordance; choosing "connect" reveals the sign-in surface
 *   - anything else                     → the login screen (which also renders
 *     the "authenticating" and "error" states)
 */
export default function App(): JSX.Element {
  const { status, initializing } = useAuth();
  const [connecting, setConnecting] = useState(false);

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
    return <Shell session={status.session} />;
  }

  // S17 local-first: a device-local principal gets the FULL product (no wall).
  // The one affordance offers to connect a cloud account; choosing it reveals the
  // real sign-in surface, which can be dismissed back to local mode.
  if (status.state === 'local') {
    if (connecting) return <LoginScreen onDismiss={() => setConnecting(false)} />;
    return (
      <LocalModeConnectProvider value={() => setConnecting(true)}>
        <Shell
          session={localDisplaySession(status.principal)}
          banner={<LocalModeBanner onConnect={() => setConnecting(true)} />}
        />
      </LocalModeConnectProvider>
    );
  }

  return <LoginScreen />;
}
