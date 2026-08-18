/**
 * NeuroPause OS — Wave 2 / Slice 14-15. E2E/real-send MODE resolution with HARD-FAIL coupling.
 *
 * PURE (no electron / no side effects) so the coupling is unit-testable. Compile-stripped from release along with the
 * rest of the e2e machinery (only reached from the `__NP_E2E__`-gated branch in `main/index.ts`).
 *
 * Three mutually-exclusive intents, each behind its own runtime flag:
 *   - full-e2e     (NEUROPAUSE_E2E=1)               — mock Graph + fake account + fake principal (Slice 14).
 *   - app-principal (NEUROPAUSE_S15_APPPRINCIPAL=1) — ONLY the app principal is seeded; Microsoft identity/consent/
 *                                                     token/send/admission are REAL (Slice 15, run mode A).
 *   - off                                           — no seeding.
 *
 * Coupling (Slice-15 binding condition 1): the app-principal seed may NEVER run with the send rail inert, and the mock
 * and real modes are mutually exclusive. Both are HARD-FAILS (throws → the caller exits at startup).
 */
export class E2eModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eModeError';
  }
}

export type E2eMode = 'full-e2e' | 'app-principal' | 'off';

export function resolveE2eMode(env: NodeJS.ProcessEnv): E2eMode {
  const e2e = env.NEUROPAUSE_E2E === '1';
  const appPrincipal = env.NEUROPAUSE_S15_APPPRINCIPAL === '1';
  const firstRealSend = env.NEUROPAUSE_FIRST_REAL_SEND === '1';

  // Mock (full-e2e) and the real-send rails are mutually exclusive — never mock a real send, never real a mock.
  if (e2e && (appPrincipal || firstRealSend)) {
    throw new E2eModeError(
      'NEUROPAUSE_E2E (mock Graph) is mutually exclusive with the real-send flags (NEUROPAUSE_S15_APPPRINCIPAL / NEUROPAUSE_FIRST_REAL_SEND).',
    );
  }
  // The app-principal seed may never run with the send rail inert (that would seed identity without the allowlist/latch).
  if (appPrincipal && !firstRealSend) {
    throw new E2eModeError(
      'NEUROPAUSE_S15_APPPRINCIPAL=1 requires NEUROPAUSE_FIRST_REAL_SEND=1 — the app-principal seed may not run with the first-real-send guard inert.',
    );
  }

  if (appPrincipal) return 'app-principal';
  if (e2e) return 'full-e2e';
  return 'off';
}
