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
import { app } from 'electron';
import type { AuthStatus } from '@neuropause/shared';
import { looksLikeDefaultProfile, type E2eMode } from './e2eMode';
import { createLogger } from '../logger';
import { authService } from '../auth/authService';
import { workspaceStore } from '../enterprise/workspace/workspaceInstance';
import { connectorStore } from '../connectors/connectorStore';
import { connectorVault } from '../connectors/connectorVault';
import {
  createMockGraphState,
  mockGraphResponse,
  resolveVerifyOutcome,
  type MockGraphState,
} from './mockGraph';

export const E2E_SEED_SENTINEL = 'NEUROPAUSE_E2E_SEED_v1'; // grep target to prove the module is/ isn't in a bundle
const log = createLogger('e2e-seed');
const MOCK_ACCOUNT_ID = 'e2e-entra-acct';
const HOUR_MS = 3_600_000;

// The mock's captured-send state, shared with the compile-gated e2e verify runner so it can drive the READ-ONLY
// read-back over the same in-process mock (send → ACK → read-back → terminal, all in-process, zero real contact).
const mockGraphState: MockGraphState = createMockGraphState();
export function getMockGraphState(): MockGraphState {
  return mockGraphState;
}

/**
 * Redirect Microsoft Graph to an in-process mock: the send (202) AND the READ-BACK Sent Items / Inbox GETs, so the
 * REAL verification oracle reaches a real terminal in the e2e loop. Which terminal is chosen by NEUROPAUSE_E2E_VERIFY
 * (success | bounce | hold). All shaping lives in the pure, unit-tested `mockGraph` module; this only bridges `fetch`.
 */
function installGraphMock(): void {
  const outcome = resolveVerifyOutcome(process.env);
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const bodyText = typeof init?.body === 'string' ? init.body : null;
    const mock = mockGraphResponse(url, bodyText, mockGraphState, outcome, Date.now());
    if (mock) {
      log.info(`[${E2E_SEED_SENTINEL}] mock Graph intercepted: ${url} → HTTP ${mock.status}`);
      // Once a governed send is captured, and only when the harness asked for the read-back leg, fire the READ-ONLY
      // read-back over the REAL reader (its fetch loops back through this mock) so the circle closes in-process.
      if (/sendMail/i.test(url) && process.env.NEUROPAUSE_E2E_VERIFY) {
        setImmediate(() => {
          void import('./e2eVerifyRun')
            .then((m) => m.runE2eVerification())
            .catch((err) => log.error(`[${E2E_SEED_SENTINEL}] read-back trigger failed`, err));
        });
      }
      return new Response(mock.body, {
        status: mock.status,
        headers: { 'content-type': 'application/json', 'request-id': 'e2e-mock' },
      });
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
  // No offline public login exists (loginEmail hits the backend); drive the private setStatus so it also EMITS
  // 'statusChanged' — the main→renderer auth bridge relays that, and the renderer leaves the sign-in wall. This is
  // the identity-forging surface — it exists ONLY in this compile-stripped, NEUROPAUSE_E2E-gated module.
  (authService as unknown as { setStatus(s: AuthStatus): AuthStatus }).setStatus(status);
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

/**
 * Install the seams for the resolved mode. Called once, post-runtime-init, only under the compile gate.
 *  - full-e2e (Slice 14, mock): app principal + fake governed account + MOCK Graph.
 *  - app-principal (Slice 15, real send): ONLY the app principal is seeded — NO fetch mock, NO fake account. The REAL
 *    Microsoft OAuth connect creates the account and the REAL Graph is contacted; the first-real-send guard restricts it.
 */
export async function installE2eSeeds(mode: E2eMode): Promise<void> {
  if (mode === 'off') return;
  // Slice-15 isolation safety (fail closed): app-principal (real-send) mode must run on a DEDICATED, isolated userData
  // (`--user-data-dir=…`), never the real default profile — else the seeded principal collides with the real org
  // (not_a_member) and the real profile is touched. Refuse rather than send there.
  if (mode === 'app-principal' && looksLikeDefaultProfile(app.getPath('userData'))) {
    log.error(`[${E2E_SEED_SENTINEL}] app-principal (real-send) mode on the DEFAULT profile (${app.getPath('userData')}) — REFUSING. Relaunch with an isolated --user-data-dir=<dedicated S15 dir>.`);
    app.exit(1);
    return;
  }
  log.warn(`[${E2E_SEED_SENTINEL}] installing seeds — mode=${mode} — THIS MUST NEVER RUN IN A RELEASE BUILD`);
  // Both modes seed the app principal (the dead NeuroPause backend login; local-first is S17).
  seedAuthenticatedPrincipal();
  if (mode === 'full-e2e') {
    installGraphMock();
    await seedConnectedAccount();
  }
}
