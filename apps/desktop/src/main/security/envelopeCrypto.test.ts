/**
 * S112 (H6) — envelope encryption + KEK/DEK rotation. Reproduces packages/security keys.ts semantics,
 * proves the §security adversarial matrix, tenant isolation, rotation, and restart durability via the
 * DurableKekProvider over an injected (fake, persisting) SecretStore.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvelopeCipher, InMemoryKekProvider, EnvelopeError, type Envelope } from './envelopeCrypto';
import { DurableKekProvider, type SecretStore } from './durableKekProvider';

/** A fake keychain that persists across provider instances (a simulated restart). */
function fakeStore(): SecretStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return { dump, get: async (k) => dump.get(k) ?? null, set: async (k, s) => void dump.set(k, s) };
}

describe('A. reproduces envelope encryption semantics', () => {
  it('round-trips plaintext; the envelope contains NO plaintext', () => {
    const cipher = new EnvelopeCipher(new InMemoryKekProvider());
    const env = cipher.encrypt('tenant-A', 'salary=100000');
    expect(cipher.decrypt('tenant-A', env)).toBe('salary=100000');
    expect(JSON.stringify(env)).not.toContain('salary');
    expect(JSON.stringify(env)).not.toContain('100000');
  });
});

describe('§security adversarial — envelope crypto fails closed', () => {
  it('TAMPERED ciphertext → integrity failure, never a silent success', () => {
    const cipher = new EnvelopeCipher(new InMemoryKekProvider());
    const env = cipher.encrypt('t', 'secret');
    const tampered: Envelope = { ...env, ciphertext: Buffer.from('evil-bytes').toString('base64') };
    expect(() => cipher.decrypt('t', tampered)).toThrow(EnvelopeError);
  });

  it('TAMPERED wrapped DEK → fail closed', () => {
    const cipher = new EnvelopeCipher(new InMemoryKekProvider());
    const env = cipher.encrypt('t', 'secret');
    expect(() => cipher.decrypt('t', { ...env, wrappedDek: Buffer.from('nope').toString('base64') })).toThrow(EnvelopeError);
  });

  it('CROSS-TENANT: tenant A KEK cannot decrypt tenant B envelope', () => {
    const provider = new InMemoryKekProvider();
    const cipher = new EnvelopeCipher(provider);
    const envB = cipher.encrypt('tenant-B', 'B-secret');
    // decrypt under tenant A: A's KEK differs → GCM unwrap fails → EnvelopeError (never returns B's plaintext)
    expect(() => cipher.decrypt('tenant-A', envB)).toThrow(EnvelopeError);
    expect(cipher.decrypt('tenant-B', envB)).toBe('B-secret');
  });

  it('UNKNOWN key version → fail closed (treated as revoked-by-default; never returns plaintext)', () => {
    const cipher = new EnvelopeCipher(new InMemoryKekProvider());
    const env = cipher.encrypt('t', 'x');
    // an unknown version is fail-closed: isRevoked defaults true ⇒ throws (never a silent decrypt)
    expect(() => cipher.decrypt('t', { ...env, keyVersion: 99 })).toThrow(EnvelopeError);
  });

  it('REVOKED key version cannot decrypt', () => {
    const provider = new InMemoryKekProvider();
    const cipher = new EnvelopeCipher(provider);
    const env = cipher.encrypt('t', 'x'); // version 1
    provider.revoke('t', 1);
    expect(() => cipher.decrypt('t', env)).toThrow(/revoked/);
  });

  it('CORRUPTED metadata (missing fields) → fail closed, typed error', () => {
    const cipher = new EnvelopeCipher(new InMemoryKekProvider());
    // @ts-expect-error deliberately malformed envelope
    expect(() => cipher.decrypt('t', { keyVersion: 1 })).toThrow(EnvelopeError);
  });
});

describe('§ rotation lifecycle', () => {
  it('ROTATE + REWRAP preserves decryptability under the new version; data unchanged', () => {
    const provider = new InMemoryKekProvider();
    const cipher = new EnvelopeCipher(provider);
    const env = cipher.encrypt('t', 'confidential'); // v1
    const v2 = cipher.rotate('t');
    expect(v2).toBe(2);
    const rewrapped = cipher.rewrap('t', env);
    expect(rewrapped.keyVersion).toBe(2);
    expect(rewrapped.ciphertext).toBe(env.ciphertext); // data seal untouched by re-wrap
    expect(cipher.decrypt('t', rewrapped)).toBe('confidential');
  });

  it('after rewrap to v2 and revoke of v1, the rewrapped envelope still decrypts', () => {
    const provider = new InMemoryKekProvider();
    const cipher = new EnvelopeCipher(provider);
    const env = cipher.encrypt('t', 'keep-me');
    cipher.rotate('t');
    const rewrapped = cipher.rewrap('t', env);
    cipher.revoke('t', 1);
    expect(cipher.decrypt('t', rewrapped)).toBe('keep-me'); // now on v2
    expect(() => cipher.decrypt('t', env)).toThrow(/revoked/); // the old v1 envelope is dead
  });
});

describe('§ restart durability (DurableKekProvider over a persisting keychain)', () => {
  it('RESTART: provision key → encrypt → new provider instance → recover key → decrypt', async () => {
    const store = fakeStore();
    const p1 = new DurableKekProvider(store);
    await p1.ensureTenant('t');
    const env = new EnvelopeCipher(p1).encrypt('t', 'durable-secret');
    // simulate a full restart: a brand-new provider instance loads from the same keychain blob
    const p2 = new DurableKekProvider(store);
    await p2.load();
    expect(new EnvelopeCipher(p2).decrypt('t', env)).toBe('durable-secret');
  });

  it('RESTART after rotation: the rotated key set survives', async () => {
    const store = fakeStore();
    const p1 = new DurableKekProvider(store);
    await p1.ensureTenant('t');
    await p1.rotateDurable('t'); // v2
    const env = new EnvelopeCipher(p1).encrypt('t', 'v2-secret');
    const p2 = new DurableKekProvider(store);
    await p2.load();
    expect(p2.currentVersion('t')).toBe(2);
    expect(new EnvelopeCipher(p2).decrypt('t', env)).toBe('v2-secret');
  });

  it('CORRUPT keychain blob → fail closed (no keys), never a fabricated key', async () => {
    const store = fakeStore();
    store.dump.set('neuropause.envelope.keks.v1', '{not valid json');
    const p = new DurableKekProvider(store);
    await p.load();
    expect(p.versions('t')).toEqual([]);
    expect(() => new EnvelopeCipher(p).encrypt('t', 'x')).toThrow(/no active key/);
  });

  it('TENANT ISOLATION persists: A cannot decrypt B across restart', async () => {
    const store = fakeStore();
    const p1 = new DurableKekProvider(store);
    await p1.ensureTenant('A');
    await p1.ensureTenant('B');
    const envB = new EnvelopeCipher(p1).encrypt('B', 'B-only');
    const p2 = new DurableKekProvider(store);
    await p2.load();
    expect(() => new EnvelopeCipher(p2).decrypt('A', envB)).toThrow(EnvelopeError);
    expect(new EnvelopeCipher(p2).decrypt('B', envB)).toBe('B-only');
  });
});

describe('§ structural — no renderer/secret exposure, no authority', () => {
  it('envelopeCrypto imports only node:crypto; durableKekProvider does not import electron/safeStorage directly', () => {
    const enc = readFileSync(join(__dirname, 'envelopeCrypto.ts'), 'utf8');
    const encImports = enc.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(encImports.every((l) => l.includes("'node:crypto'") || l.includes("'./envelopeCrypto'"))).toBe(true);
    for (const forbidden of ['electron', 'safeStorage', 'enterprise/authz', '/cst', 'commandBus', '@neuropause/security']) {
      expect(encImports.some((l) => l.includes(forbidden))).toBe(false);
    }
    const dur = readFileSync(join(__dirname, 'durableKekProvider.ts'), 'utf8');
    const durImports = dur.split('\n').filter((l) => /^\s*import\b/.test(l));
    // the durable provider takes an injected SecretStore — it does NOT import electron/safeStorage itself
    for (const forbidden of ['electron', 'safeStorage', 'enterprise/authz', '/cst', 'commandBus']) {
      expect(durImports.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it('an Envelope carries no key material and no plaintext', () => {
    const env = new EnvelopeCipher(new InMemoryKekProvider()).encrypt('t', 'topsecret');
    expect(env).not.toHaveProperty('kek');
    expect(env).not.toHaveProperty('dek');
    expect(JSON.stringify(env)).not.toContain('topsecret');
  });
});
