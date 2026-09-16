import { describe, it, expect } from 'vitest';
import {
  LOCAL_ACTOR_PREFIX,
  DEVICE_INVALID_DOMAIN,
  localActorId,
  isReservedLocalActor,
  localSessionEmail,
  isDeviceInvalidEmail,
} from './localNamespace';

describe('local namespace rules (FG-6 / D-12)', () => {
  it('actor id is self-disclosing and stable for a given principal id', () => {
    expect(localActorId('9f3c')).toBe('local:9f3c');
    // Stability (pin 3): the same id always yields the same actor string.
    expect(localActorId('9f3c')).toBe(localActorId('9f3c'));
    expect(LOCAL_ACTOR_PREFIX).toBe('local:');
  });

  it('recognises the reserved actor namespace (forgery detection, pin 1)', () => {
    expect(isReservedLocalActor('local:9f3c')).toBe(true);
    // A cloud id that forges the namespace is detected — the caller denies.
    expect(isReservedLocalActor('local:evil')).toBe(true);
    // Real cloud identities are NOT in the namespace.
    expect(isReservedLocalActor('user-owner')).toBe(false);
    expect(isReservedLocalActor('someone@example.com')).toBe(false);
  });

  it('never strips the prefix — the whole string is the identity (pin 2)', () => {
    const id = localActorId('abc');
    // No API returns a stripped id; the value round-trips verbatim.
    expect(id).toBe('local:abc');
    expect(id.replace(LOCAL_ACTOR_PREFIX, '')).not.toBe(id); // (only a test may inspect; production never does)
  });

  it('tenant email is synthetic and non-routable (.invalid)', () => {
    expect(localSessionEmail('9f3c')).toBe('local-9f3c@device.invalid');
    expect(DEVICE_INVALID_DOMAIN).toBe('device.invalid');
    // Same id → same email at every site (owner-claim ⇄ membership match).
    expect(localSessionEmail('9f3c')).toBe(localSessionEmail('9f3c'));
  });

  it('flags any address in the device-invalid domain as invalid-by-rule (D-12 addendum)', () => {
    expect(isDeviceInvalidEmail('local-9f3c@device.invalid')).toBe(true);
    expect(isDeviceInvalidEmail('  LOCAL-9f3c@Device.Invalid  ')).toBe(true); // case + whitespace tolerant
    expect(isDeviceInvalidEmail('neuropause033@gmail.com')).toBe(false);
    expect(isDeviceInvalidEmail('attacker@device.invalid.evil.com')).toBe(false);
  });
});
