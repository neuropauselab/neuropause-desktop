import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { securityScan, signManifest, verifyManifest, digestManifest } from './pipeline';
import type { ListingManifest } from '@neuropause/shared';

function manifest(overrides: Partial<ListingManifest> = {}): ListingManifest {
  return {
    kind: 'connector',
    name: 'Test',
    version: '1.0.0',
    entry: 'connector/test.js',
    permissions: ['connectors:read'],
    capabilities: [],
    dependencies: [],
    network: [],
    metadata: { publisher: 'Tester' },
    ...overrides,
  };
}

describe('securityScan', () => {
  it('passes a clean manifest', () => {
    const r = securityScan(manifest());
    expect(r.status).toBe('pass');
    expect(r.findings).toHaveLength(0);
  });

  it('fails on a dangerous permission', () => {
    const r = securityScan(manifest({ permissions: ['system:exec'] }));
    expect(r.status).toBe('fail');
    expect(r.findings.some((f) => f.rule === 'permission.dangerous' && f.severity === 'high')).toBe(true);
  });

  it('fails on a missing entry point (critical)', () => {
    const r = securityScan(manifest({ entry: '' }));
    expect(r.status).toBe('fail');
    expect(r.findings.some((f) => f.rule === 'entry.missing' && f.severity === 'critical')).toBe(true);
  });

  it('warns on undeclared network use', () => {
    const r = securityScan(manifest({ capabilities: ['network'], network: [] }));
    expect(r.status).toBe('warn');
    expect(r.findings.some((f) => f.rule === 'network.undeclared')).toBe(true);
  });

  it('flags suspicious dependencies', () => {
    const r = securityScan(manifest({ dependencies: ['../evil', 'file:/etc/passwd'] }));
    expect(r.status).toBe('fail');
    expect(r.findings.filter((f) => f.rule === 'dependency.suspicious')).toHaveLength(2);
  });
});

describe('signing', () => {
  it('produces a stable digest regardless of key order', () => {
    const a = manifest({ permissions: ['a', 'b'], network: ['x.com', 'y.com'] });
    const b = manifest({ permissions: ['b', 'a'], network: ['y.com', 'x.com'] });
    expect(digestManifest(a)).toBe(digestManifest(b));
  });

  it('signs and verifies a manifest', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const m = manifest();
    const sig = signManifest(m, privateKey, 'npsign_test');
    expect(sig.algorithm).toBe('ed25519');
    expect(verifyManifest(m, sig, publicKey)).toBe(true);
  });

  it('rejects a tampered manifest', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const m = manifest();
    const sig = signManifest(m, privateKey, 'npsign_test');
    const tampered = manifest({ version: '9.9.9' });
    expect(verifyManifest(tampered, sig, publicKey)).toBe(false);
  });
});
