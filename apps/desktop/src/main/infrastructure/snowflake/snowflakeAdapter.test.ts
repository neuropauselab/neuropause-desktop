/**
 * P6.8 — Snowflake key-pair JWT signing + account-profile resolution: the RS256 signature verifies against the
 * derived public key, the claims carry Snowflake's upper-cased `<ACCOUNT>.<USER>` + `SHA256:` fingerprint, the
 * fingerprint is the DER-SPKI SHA-256, and the env → profile / unconfigured / malformed-key paths behave. Pure
 * -node (a fresh RSA keypair is generated in-test); no live Snowflake, no request issued.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { makeSnowflakeHttp, publicKeyFingerprint, resolveSnowflakeBaseConfig, signSnowflakeJwt, snowflakeAdapter } from './snowflakeAdapter';
import { SnowflakeClient } from './snowflakeClient';
import type { RateGate } from '../../unified/sync/http';

const gate: RateGate = { acquire: async () => undefined, penalize: () => undefined };
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ENV_KEYS = ['NEUROPAUSE_SNOWFLAKE_ACCOUNT', 'NEUROPAUSE_SNOWFLAKE_USER', 'NEUROPAUSE_SNOWFLAKE_PRIVATE_KEY'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('signSnowflakeJwt', () => {
  it('signs a verifiable RS256 JWT with Snowflake claims (account/user upper-cased, SHA256 fingerprint)', () => {
    const { jwt, expSec } = signSnowflakeJwt({ account: 'myorg-myacct', user: 'svc_user', privateKey }, 1000);
    const [h, c, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString()) as { iss: string; sub: string; iat: number; exp: number };
    expect(claims.sub).toBe('MYORG-MYACCT.SVC_USER');
    expect(claims.iss).toMatch(/^MYORG-MYACCT\.SVC_USER\.SHA256:.+/);
    expect(claims.iat).toBe(1000);
    expect(expSec).toBe(1000 + 3540);
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('computes a SHA256: base64 fingerprint of the DER SPKI public key', () => {
    const fp = publicKeyFingerprint(privateKey);
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+=*$/);
  });

  it('strips the region from a legacy account locator in the JWT claims (not hyphenate)', () => {
    const { jwt } = signSnowflakeJwt({ account: 'xy12345.us-east-1', user: 'svc', privateKey }, 1000);
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as { sub: string };
    expect(claims.sub).toBe('XY12345.SVC'); // region after the first period is dropped
  });
});

describe('resolveSnowflakeBaseConfig / makeSnowflakeHttp', () => {
  it('returns null when unconfigured', () => {
    expect(resolveSnowflakeBaseConfig()).toBeNull();
    expect(makeSnowflakeHttp(gate, 'default')).toBeNull();
  });

  it('resolves a full profile (restoring PEM newlines) and builds a client', () => {
    process.env.NEUROPAUSE_SNOWFLAKE_ACCOUNT = 'myorg-myacct';
    process.env.NEUROPAUSE_SNOWFLAKE_USER = 'svc_user';
    process.env.NEUROPAUSE_SNOWFLAKE_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n'); // simulate a single-line env var
    const cfg = resolveSnowflakeBaseConfig()!;
    expect(cfg.account).toBe('myorg-myacct');
    expect(cfg.privateKey).toContain('\n'); // the escaped newlines were restored
    expect(makeSnowflakeHttp(gate, 'default')).toBeInstanceOf(SnowflakeClient);
  });

  it('degrades to null on a malformed private key rather than throwing', () => {
    process.env.NEUROPAUSE_SNOWFLAKE_ACCOUNT = 'myorg-myacct';
    process.env.NEUROPAUSE_SNOWFLAKE_USER = 'svc';
    process.env.NEUROPAUSE_SNOWFLAKE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----';
    expect(makeSnowflakeHttp(gate, 'default')).toBeNull();
  });
});

describe('snowflakeAdapter', () => {
  it('is one adapter (platform id snowflake) with the thirteen domain collectors', () => {
    expect(snowflakeAdapter.platformId).toBe('snowflake');
    expect(snowflakeAdapter.provider).toBe('snowflake');
    expect(snowflakeAdapter.collectors).toHaveLength(13);
  });
});
