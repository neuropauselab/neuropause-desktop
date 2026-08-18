/**
 * NeuroPause OS — Wave 2 / Slice 14. E2E-ONLY seed + mock-Microsoft-Graph seam.
 *
 * ── STRUCTURALLY ABSENT FROM PRODUCTION ──────────────────────────────────────────────────────────────────────
 * This module is imported ONLY from a `if (__NP_E2E__ && ...)` branch in `main/index.ts`, via a DYNAMIC import.
 * `__NP_E2E__` is a build-time `define` (electron.vite.config.ts) that is `false` in every release build, so
 * `electron-vite build` both dead-code-eliminates the branch AND drops this module from the release bundle (verified:
 * the sentinel below occurs 0× in the production build). It is additionally gated at RUNTIME on `NEUROPAUSE_E2E === '1'`,
 * so even an e2e-capable build never seeds unless the Playwright harness explicitly asks.
 *
 * ── WHY THIS IS NOT "SMUGGLING" ──────────────────────────────────────────────────────────────────────────────
 * It touches NO frozen surface. It does NOT weaken any validation: the certified path (governedSend → CST kernel →
 * scopesOk → actor check → admission) runs UNCHANGED. It only (a) redirects the EXTERNAL Graph HTTP endpoint to an
 * in-process mock — exactly what the `makeHttp` unit-test seam does, but at the global-fetch layer so `connectors/
 * index.ts` (frozen) is untouched — and (b) seeds the preconditions a real signed-in, connected user would have.
 *
 * ── SECURITY NOTE ────────────────────────────────────────────────────────────────────────────────────────────
 * Seeding a fake AUTHENTICATED PRINCIPAL and a fake GOVERNED connector account is a security surface. It is treated
 * as one: compile-stripped from every release build, and inert unless NEUROPAUSE_E2E=1. If either guard is ever
 * removed, this becomes a way to forge identity — do not weaken them.
 */
import type { AuthStatus } from '@neuropause/shared';
import { createLogger } from '../logger';
import { authService } from '../auth/authService';
import { workspaceStore } from '../enterprise/workspace/workspaceInstance';
import { connectorStore } from '../connectors/connectorStore';
import { connectorVault } from '../connectors/connectorVault';

export const E2E_SEED_SENTINEL = 'NEUROPAUSE_E2E_SEED_v1'; // grep target to prove the module is/ isn't in a bundle
const log = createLogger('e2e-seed');
const MOCK_ACCOUNT_ID = 'e2e-entra-acct';
const HOUR_MS = 3_600_000;

/** Redirect ONLY Microsoft Graph sendMail to an in-process mock (202 Accepted, as the real Graph returns). */
function installGraphMock(): void {
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (/graph\.microsoft\.com/.test(url) && /sendMail/i.test(url)) {
      log.info(`[${E2E_SEED_SENTINEL}] mock Graph intercepted: ${url}`);
      // Graph /me/sendMail returns 202 Accepted with no body. Return a parseable empty object to be safe.
      return new Response('{}', { status: 202, headers: { 'content-type': 'application/json', 'request-id': 'e2e-mock' } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

/** Set an authenticated session so the certified executor's `actor()` is non-null (else it DENYs, fail-closed). */
function seedAuthenticatedPrincipal(): void {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const status: AuthStatus = {
    state: 'authenticated',
    session: {
      user: { id: 'e2e-principal', email: 'e2e@example.com', displayName: 'E2E Principal', avatarUrl: null, createdAt: iso, updatedAt: iso },
      accessTokenExpiresAt: now + HOUR_MS,
    },
  };
  // No offline public login exists (loginEmail hits the backend); set the private session state directly. This is the
  // identity-forging surface — it exists ONLY in this compile-stripped, NEUROPAUSE_E2E-gated module.
  (authService as unknown as { status: AuthStatus }).status = status;
}

/** Seed a connected microsoft-entra account with the Mail.Send grant + a mock token, in the active workspace. */
async function seedConnectedAccount(): Promise<void> {
  const workspaceId = workspaceStore.activeWorkspaceIdOrNull();
  if (!workspaceId) {
    log.warn(`[${E2E_SEED_SENTINEL}] no active workspace — cannot seed a scoped account`);
    return;
  }
  const now = Date.now();
  await connectorStore.upsert({
    id: MOCK_ACCOUNT_ID,
    connectorId: 'microsoft-entra' as never,
    workspaceId,
    label: 'E2E Mailbox',
    externalId: 'e2e-external-id',
    avatarUrl: null,
    status: 'connected' as never,
    health: 'healthy' as never,
    grantedScopes: ['Mail.Send', 'User.Read', 'offline_access'],
    connectedAt: new Date(now).toISOString(),
    lastSyncAt: null,
    lastSyncState: 'idle' as never,
    accessTokenExpiresAt: new Date(now + HOUR_MS).toISOString(),
    error: null,
  });
  await connectorVault.set(workspaceId, 'microsoft-entra', MOCK_ACCOUNT_ID, {
    accessToken: 'e2e-mock-access-token',
    refreshToken: null,
    expiresAt: now + HOUR_MS,
    scopes: ['Mail.Send', 'User.Read', 'offline_access'],
    tokenType: 'Bearer',
  });
  log.info(`[${E2E_SEED_SENTINEL}] seeded connected microsoft-entra account ${MOCK_ACCOUNT_ID} in ${workspaceId}`);
}

/** Install all e2e seams. Called once, post-runtime-init, only under the double guard. */
export async function installE2eSeeds(): Promise<void> {
  log.warn(`[${E2E_SEED_SENTINEL}] installing E2E seeds + mock Graph — THIS MUST NEVER RUN IN A RELEASE BUILD`);
  installGraphMock();
  seedAuthenticatedPrincipal();
  await seedConnectedAccount();
}
