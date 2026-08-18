import type { ReactNode } from 'react';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Button } from '@renderer/components/ui/Button';
import { useLocalModeConnect } from './localModeConnect';

/**
 * S17 — HONEST cloud absence in local mode.
 *
 * A cloud-backed surface renders this INSTEAD of an error banner / infinite
 * spinner / red state when the app is working locally: the feature is
 * legitimately absent (no connected account), not broken. The truth is derived
 * from the auth state beneath (S19 UI-truth rule) — a surface shows this ONLY
 * when `useIsLocalMode()` is true. A genuine failure (authenticated + backend
 * unreachable) still renders as a failure; this is never used to paint over one.
 *
 * By default it offers the same "connect an account to sync" path the top-of-shell
 * banner does; pass `action` to override.
 */
export function CloudUnavailableLocal({
  feature,
  action,
}: {
  /** The feature name, e.g. "Organizations", "Billing", "Devices". */
  feature: string;
  /** Override the connect affordance. Omit for the standard "Connect an account" button. */
  action?: ReactNode;
}): JSX.Element {
  const connect = useLocalModeConnect();
  return (
    <EmptyState
      icon="globe"
      title={`${feature} is unavailable while working locally`}
      description="This needs a connected account. Your data stays on this device — connect an account to sync and turn it on."
      action={
        action ?? (
          <Button variant="primary" onClick={connect}>
            Connect an account to sync
          </Button>
        )
      }
    />
  );
}
