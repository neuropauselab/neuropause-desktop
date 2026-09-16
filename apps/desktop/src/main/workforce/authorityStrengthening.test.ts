/**
 * P13C Phase I-A.1 — Boundary-A authority strengthening.
 *
 * The approval/rejection seams must bind the AUTHORITATIVE approver principal from
 * the trusted `deps.actor()` accessor (the authService session `user.id`), never the
 * literal `'user'` and never a renderer-supplied value, and must FAIL CLOSED when no
 * authenticated principal exists — with no fallback identity.
 *
 * `resolveAuthoritativeApprover` is the extracted fail-closed contract; the runtime
 * recording of `decidedBy`/`decidedAt` (actor + authoritative clock when `now` is
 * omitted) is already exercised by `runtime/workerRuntimeExecution.test.ts`
 * (`approveProposal(..., 'alice', null)`).
 */
import { describe, it, expect } from 'vitest';
import { resolveAuthoritativeApprover } from './approverAuthority';

describe('Phase I-A.1 — authoritative approver resolution (Boundary A)', () => {
  it('returns the trusted principal (stable user.id) when authenticated', () => {
    expect(resolveAuthoritativeApprover(() => 'user-abc-123', 'approval')).toBe('user-abc-123');
    expect(resolveAuthoritativeApprover(() => 'user-abc-123', 'rejection')).toBe('user-abc-123');
  });

  it('reads ONLY from the trusted accessor — the principal is whatever authService returns', () => {
    // The function takes the DI accessor, not a payload; there is no path for a
    // renderer-supplied actor to influence the result.
    const fromAuthService = () => 'user-from-session';
    expect(resolveAuthoritativeApprover(fromAuthService, 'approval')).toBe('user-from-session');
  });

  it('FAILS CLOSED when no authenticated principal exists (approval)', () => {
    expect(() => resolveAuthoritativeApprover(() => null, 'approval')).toThrow(
      /Approval requires an authenticated principal/,
    );
  });

  it('FAILS CLOSED when no authenticated principal exists (rejection)', () => {
    expect(() => resolveAuthoritativeApprover(() => null, 'rejection')).toThrow(
      /Rejection requires an authenticated principal/,
    );
  });

  it('NEVER substitutes a fallback identity — a null principal throws instead of returning any marker', () => {
    let returned: string | undefined;
    try {
      returned = resolveAuthoritativeApprover(() => null, 'approval');
    } catch {
      returned = undefined;
    }
    // No value is produced on null: not 'user', not 'system', not 'unknown', nothing.
    expect(returned).toBeUndefined();
    for (const forbidden of ['user', 'system', 'unknown', 'owner', '']) {
      expect(returned).not.toBe(forbidden);
    }
  });
});
