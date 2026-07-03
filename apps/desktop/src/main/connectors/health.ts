/**
 * Health derivation for connector accounts, and aggregation of per-account
 * state up to the connector-level status/health the dashboard shows.
 *
 * Health is computed structurally from connection status, token expiry, and the
 * last error — no provider is pinged here (a real round-trip belongs to sync).
 */
import type {
  ConnectedAccount,
  ConnectorHealth,
  ConnectorStatus,
} from '@neuropause/shared';

/** Treat a token as "expiring soon" within this window. */
const EXPIRY_SOON_MS = 5 * 60 * 1000;

/** Derives an account's health from its status, token expiry, and last error. */
export function accountHealth(account: ConnectedAccount): ConnectorHealth {
  if (account.status === 'error' || account.status === 'reauth_required') return 'down';
  if (account.status === 'disconnected' || account.status === 'unavailable') return 'unknown';
  if (account.status === 'connecting') return 'unknown';

  // Connected: judge by token freshness. A refresh token means expiry is benign.
  if (account.accessTokenExpiresAt) {
    const expiresIn = new Date(account.accessTokenExpiresAt).getTime() - Date.now();
    if (expiresIn <= 0) return 'degraded';
    if (expiresIn <= EXPIRY_SOON_MS) return 'degraded';
  }
  return 'healthy';
}

const HEALTH_RANK: Record<ConnectorHealth, number> = { healthy: 0, unknown: 1, degraded: 2, down: 3 };

/** The worst health across a connector's accounts (unknown when none). */
export function aggregateHealth(accounts: ConnectedAccount[]): ConnectorHealth {
  if (accounts.length === 0) return 'unknown';
  return accounts.reduce<ConnectorHealth>(
    (worst, a) => (HEALTH_RANK[a.health] > HEALTH_RANK[worst] ? a.health : worst),
    'healthy',
  );
}

/** The connector-level status shown in the catalog. */
export function aggregateStatus(accounts: ConnectedAccount[], configured: boolean): ConnectorStatus {
  if (!configured) return 'unavailable';
  if (accounts.length === 0) return 'disconnected';
  if (accounts.some((a) => a.status === 'connecting')) return 'connecting';
  if (accounts.some((a) => a.status === 'error')) return 'error';
  if (accounts.some((a) => a.status === 'reauth_required')) return 'reauth_required';
  if (accounts.some((a) => a.status === 'connected')) return 'connected';
  return 'disconnected';
}

/** Most recent successful sync timestamp across accounts, if any. */
export function latestSync(accounts: ConnectedAccount[]): string | null {
  let latest: string | null = null;
  for (const a of accounts) {
    if (a.lastSyncAt && (!latest || a.lastSyncAt > latest)) latest = a.lastSyncAt;
  }
  return latest;
}
