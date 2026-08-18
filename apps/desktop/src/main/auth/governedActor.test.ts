import { describe, it, expect } from 'vitest';
import type { AuthStatus, LocalPrincipal } from '@neuropause/shared';
import { hasActivePrincipal, resolveGovernedActor } from './governedActor';

const principal: LocalPrincipal = { id: '9f3c', displayName: 'Local User', createdAt: '2026-08-18T00:00:00.000Z' };
const local: AuthStatus = { state: 'local', principal };
const authed = (id: string): AuthStatus => ({
  state: 'authenticated',
  session: { user: { id, email: `${id}@example.com`, displayName: id, avatarUrl: null, createdAt: '', updatedAt: '' }, accessTokenExpiresAt: 0 },
});

describe('resolveGovernedActor (FG-6 condition 3 + pins)', () => {
  it('V-1 · local → self-disclosing local:<id>', () => {
    expect(resolveGovernedActor(local, (u) => u.id)).toBe('local:9f3c');
    // same for the mail.send pick (displayName??email) — local is ALWAYS local:<id>
    expect(resolveGovernedActor(local, (u) => u.displayName ?? u.email)).toBe('local:9f3c');
  });

  it('V-2 · authenticated → the picked cloud id', () => {
    expect(resolveGovernedActor(authed('user-owner'), (u) => u.id)).toBe('user-owner');
  });

  it('V-3 · a forged authenticated `local:` id is DENIED (pin 1, the S33 edge)', () => {
    expect(resolveGovernedActor(authed('local:evil'), (u) => u.id)).toBeNull();
    // even via the displayName pick, a `local:`-shaped value is refused
    const forged: AuthStatus = {
      state: 'authenticated',
      session: { user: { id: 'x', email: 'x@e.com', displayName: 'local:evil', avatarUrl: null, createdAt: '', updatedAt: '' }, accessTokenExpiresAt: 0 },
    };
    expect(resolveGovernedActor(forged, (u) => u.displayName ?? u.email)).toBeNull();
  });

  it('V-4 · deny-by-default: authenticating/error/unauthenticated → null → NO_ACTOR (pin 4)', () => {
    expect(resolveGovernedActor({ state: 'unauthenticated' }, (u) => u.id)).toBeNull();
    expect(resolveGovernedActor({ state: 'authenticating', provider: 'microsoft' }, (u) => u.id)).toBeNull();
    expect(resolveGovernedActor({ state: 'error', message: 'x' }, (u) => u.id)).toBeNull();
  });

  it('V-4b · an empty/blank picked id denies (no empty actor slips through)', () => {
    expect(resolveGovernedActor(authed(''), (u) => u.id)).toBeNull();
    expect(resolveGovernedActor(authed('   '), (u) => u.id)).toBeNull();
  });

  it('V-5 · correlation: the same local principal → the same actor string (pin 3)', () => {
    const again: AuthStatus = { state: 'local', principal: { ...principal } };
    expect(resolveGovernedActor(local, (u) => u.id)).toBe(resolveGovernedActor(again, (u) => u.id));
  });
});

describe('hasActivePrincipal (RBAC dispatch gate)', () => {
  it('accepts authenticated AND local; denies everything else (deny-by-default)', () => {
    expect(hasActivePrincipal(authed('u'))).toBe(true);
    expect(hasActivePrincipal(local)).toBe(true);
    expect(hasActivePrincipal({ state: 'unauthenticated' })).toBe(false);
    expect(hasActivePrincipal({ state: 'authenticating', provider: 'microsoft' })).toBe(false);
    expect(hasActivePrincipal({ state: 'error', message: 'x' })).toBe(false);
  });
});
