import { describe, it, expect } from 'vitest';
import type { AuthStatus, LocalPrincipal } from '@neuropause/shared';
import { sessionEmailFor, principalDisplayName } from './localIdentity';

const principal: LocalPrincipal = { id: '9f3c', displayName: 'Local User', createdAt: '2026-08-18T00:00:00.000Z' };
const local: AuthStatus = { state: 'local', principal };
const authed: AuthStatus = {
  state: 'authenticated',
  session: { user: { id: 'u', email: 'real@account.com', displayName: 'Real Name', avatarUrl: null, createdAt: '', updatedAt: '' }, accessTokenExpiresAt: 0 },
};

describe('sessionEmailFor (FG-6 condition 2)', () => {
  it('authenticated → the account email', () => {
    expect(sessionEmailFor(authed)).toBe('real@account.com');
  });
  it('local → synthetic, non-routable, derived from the stable id', () => {
    expect(sessionEmailFor(local)).toBe('local-9f3c@device.invalid');
  });
  it('no active principal → null (→ not_signed_in, deny-by-default)', () => {
    expect(sessionEmailFor({ state: 'unauthenticated' })).toBeNull();
    expect(sessionEmailFor({ state: 'authenticating', provider: 'microsoft' })).toBeNull();
    expect(sessionEmailFor({ state: 'error', message: 'x' })).toBeNull();
  });
  it('the local email is identical every call (owner-claim ⇄ membership match)', () => {
    expect(sessionEmailFor(local)).toBe(sessionEmailFor({ state: 'local', principal: { ...principal } }));
  });
});

describe('principalDisplayName', () => {
  it('authenticated → displayName (email fallback); local → the local display name', () => {
    expect(principalDisplayName(authed)).toBe('Real Name');
    expect(principalDisplayName(local)).toBe('Local User');
    expect(principalDisplayName({ state: 'unauthenticated' })).toBeNull();
  });
});
