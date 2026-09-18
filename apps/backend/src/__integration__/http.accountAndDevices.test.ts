/**
 * FULL HTTP-PATH integration tests (NP-048 Option A supplementation, human
 * decision 2026-09-18).
 *
 * NP-047 closed the service-layer↔schema gap; the recorded residuals were that
 * export/deletion were exercised as functions and device PoP as pure crypto —
 * not as the HTTP contract the shipped client actually speaks. This file
 * removes those residuals: it boots the REAL app (createApp(), every
 * middleware including requireAuth's Redis-backed revocation check), binds an
 * ephemeral port, and drives it with fetch over localhost against REAL
 * Postgres (full migrations) + REAL Redis.
 *
 *   RESIDUAL-2  /auth/export + deletion routes through requireAuth ... closed
 *   RESIDUAL-3  device challenge → signed registration over HTTP ..... closed
 *
 * Excluded from the default run; invoked via `npm run test:integration` with
 * TEST_DATABASE_URL + reachable REDIS_URL (CI: backend-ci `integration` job).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test assertions over dynamic JSON bodies */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { closePool, query } from '../db/pool';
import { closeRedis } from '../cache/redis';
import { runMigrations } from '../db/migrate';
import { createApp } from '../app';

let server: Server;
let base: string;

beforeAll(async () => {
  await runMigrations();
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([closePool(), closeRedis()]);
});

beforeEach(async () => {
  await query(
    'TRUNCATE account_deletion_requests, devices, memberships, organizations, auth_tokens, auth_sessions, auth_identities, audit_log, users RESTART IDENTITY CASCADE',
  );
});

const PW = 'E2e-Http-Pass-4471';

async function http(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

/** Register a user THROUGH THE HTTP API and return their bearer token + id. */
async function registerViaHttp(email: string): Promise<{ token: string; userId: string }> {
  const r = await http('POST', '/auth/email/register', { body: { email, password: PW } });
  expect(r.status).toBe(201);
  return { token: r.json.tokens.accessToken as string, userId: r.json.user.id as string };
}

async function seedOrgWithMember(userId: string): Promise<string> {
  const org = await query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ('HTTP E2E Org', 'http-e2e-org') RETURNING id`,
  );
  const orgId = org.rows[0].id;
  await query(
    `INSERT INTO memberships (org_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
    [orgId, userId],
  );
  return orgId;
}

/** Client-side Ed25519 exactly as the desktop deviceKeys module produces it. */
function testKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
  return {
    publicKeyB64: Buffer.from(raw).toString('base64url'),
    sign: (nonce: string) => edSign(null, Buffer.from(nonce), privateKey).toString('base64url'),
  };
}

const DEVICE_INFO = {
  deviceId: 'http-e2e-dev-1',
  name: 'HTTP E2E Box',
  platform: 'desktop',
  os: 'win32',
  arch: 'x64',
  appVersion: '1.0.0',
};

describe('GET /auth/export over HTTP (requireAuth + real Postgres + real Redis)', () => {
  it('unauthenticated -> 401; authenticated -> 200 with own data only', async () => {
    const anon = await http('GET', '/auth/export');
    expect(anon.status).toBe(401);

    const alice = await registerViaHttp('http_alice@acme.test');
    const orgId = await seedOrgWithMember(alice.userId);
    await registerViaHttp('http_bob@acme.test'); // unrelated user

    const r = await http('GET', '/auth/export', { token: alice.token });
    expect(r.status).toBe(200);
    expect(r.json.export.user.email).toBe('http_alice@acme.test');
    expect(r.json.export.organizations).toHaveLength(1);
    expect(r.json.export.organizations[0]).toMatchObject({ orgId, role: 'owner' });
    // No cross-user leakage and no secret material in the payload.
    const raw = JSON.stringify(r.json);
    expect(raw).not.toContain('http_bob@acme.test');
    expect(raw).not.toContain('password_hash');
    expect(raw).not.toContain('token_hash');
  });

  it('a garbage bearer -> 401', async () => {
    const r = await http('GET', '/auth/export', { token: 'not-a-jwt' });
    expect(r.status).toBe(401);
  });
});

describe('account deletion over HTTP (two-step, requireAuth, real transaction)', () => {
  it('request -> confirm deletes; the deleted token is then rejected', async () => {
    const alice = await registerViaHttp('http_del@acme.test');
    await seedOrgWithMember(alice.userId);

    const req = await http('POST', '/auth/delete-account', {
      token: alice.token,
      body: { reason: 'http e2e' },
    });
    expect(req.status).toBe(200);
    const requestId = req.json.deletion.requestId as string;
    expect(req.json.deletion.status).toBe('pending');

    const confirm = await http('POST', '/auth/confirm-delete-account', {
      token: alice.token,
      body: { requestId },
    });
    expect(confirm.status).toBe(200);
    expect(confirm.json.deleted).toBe(true);

    const u = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
      alice.userId,
    ]);
    expect(u.rows[0].email).toContain('@deleted.neuropause.local');

    // The access token was revoked as part of deletion (user-level deny) —
    // exercised through requireAuth's real Redis-backed check.
    const after = await http('GET', '/auth/export', { token: alice.token });
    expect(after.status).toBe(401);
  });

  it('another user cannot confirm my deletion request', async () => {
    const alice = await registerViaHttp('http_victim@acme.test');
    const mallory = await registerViaHttp('http_mallory@acme.test');
    const req = await http('POST', '/auth/delete-account', { token: alice.token, body: {} });
    const requestId = req.json.deletion.requestId as string;

    const confirm = await http('POST', '/auth/confirm-delete-account', {
      token: mallory.token,
      body: { requestId },
    });
    expect(confirm.status).toBe(400);

    const u = await query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
      alice.userId,
    ]);
    expect(u.rows[0].email).toBe('http_victim@acme.test');
  });

  it('unauthenticated deletion request -> 401', async () => {
    const r = await http('POST', '/auth/delete-account', { body: {} });
    expect(r.status).toBe(401);
  });
});

describe('device challenge -> signed registration over HTTP (real PG + Redis)', () => {
  async function member(): Promise<{ token: string; userId: string; orgId: string }> {
    const u = await registerViaHttp('http_device@acme.test');
    const orgId = await seedOrgWithMember(u.userId);
    return { ...u, orgId };
  }

  it('the full PoP flow: challenge -> sign -> register -> 201; replay -> 400', async () => {
    const { token, orgId } = await member();
    const key = testKeypair();

    const ch = await http('POST', '/devices/challenge', {
      token,
      body: { deviceId: DEVICE_INFO.deviceId },
    });
    expect(ch.status).toBe(200);
    const nonce = ch.json.challenge as string;

    const reg = await http('POST', '/devices', {
      token,
      body: {
        orgId,
        ...DEVICE_INFO,
        publicKey: key.publicKeyB64,
        challengeNonce: nonce,
        challengeSignature: key.sign(nonce),
      },
    });
    expect(reg.status).toBe(201);
    expect(reg.json.device.deviceId).toBe(DEVICE_INFO.deviceId);
    expect(reg.json.device.publicKey).toBe(key.publicKeyB64);

    // Replay of the consumed nonce is refused (atomic one-time consumption).
    const replay = await http('POST', '/devices', {
      token,
      body: {
        orgId,
        ...DEVICE_INFO,
        publicKey: key.publicKeyB64,
        challengeNonce: nonce,
        challengeSignature: key.sign(nonce),
      },
    });
    expect(replay.status).toBe(400);
  });

  it('missing PoP fields -> 400 (strict schema); wrong signature -> 400', async () => {
    const { token, orgId } = await member();
    const key = testKeypair();

    const noPop = await http('POST', '/devices', {
      token,
      body: { orgId, ...DEVICE_INFO },
    });
    expect(noPop.status).toBe(400);

    const ch = await http('POST', '/devices/challenge', {
      token,
      body: { deviceId: DEVICE_INFO.deviceId },
    });
    const wrongSig = await http('POST', '/devices', {
      token,
      body: {
        orgId,
        ...DEVICE_INFO,
        publicKey: key.publicKeyB64,
        challengeNonce: ch.json.challenge,
        challengeSignature: testKeypair().sign(ch.json.challenge), // different key signs
      },
    });
    expect(wrongSig.status).toBe(400);
  });

  it('re-registration with a DIFFERENT key -> 403 device_key_mismatch; enrolled key -> 201', async () => {
    const { token, orgId } = await member();
    const enrolled = testKeypair();

    const ch1 = await http('POST', '/devices/challenge', {
      token,
      body: { deviceId: DEVICE_INFO.deviceId },
    });
    const first = await http('POST', '/devices', {
      token,
      body: {
        orgId,
        ...DEVICE_INFO,
        publicKey: enrolled.publicKeyB64,
        challengeNonce: ch1.json.challenge,
        challengeSignature: enrolled.sign(ch1.json.challenge),
      },
    });
    expect(first.status).toBe(201);

    // Attacker-shaped: valid signature with a NEW key for the enrolled device.
    const attacker = testKeypair();
    const ch2 = await http('POST', '/devices/challenge', {
      token,
      body: { deviceId: DEVICE_INFO.deviceId },
    });
    const mismatch = await http('POST', '/devices', {
      token,
      body: {
        orgId,
        ...DEVICE_INFO,
        publicKey: attacker.publicKeyB64,
        challengeNonce: ch2.json.challenge,
        challengeSignature: attacker.sign(ch2.json.challenge),
      },
    });
    expect(mismatch.status).toBe(403);
    expect(mismatch.json.error.code).toBe('device_key_mismatch');

    // The enrolled key still re-registers fine.
    const ch3 = await http('POST', '/devices/challenge', {
      token,
      body: { deviceId: DEVICE_INFO.deviceId },
    });
    const again = await http('POST', '/devices', {
      token,
      body: {
        orgId,
        ...DEVICE_INFO,
        publicKey: enrolled.publicKeyB64,
        challengeNonce: ch3.json.challenge,
        challengeSignature: enrolled.sign(ch3.json.challenge),
      },
    });
    expect(again.status).toBe(201);
  });

  it('unauthenticated challenge -> 401', async () => {
    const r = await http('POST', '/devices/challenge', {
      body: { deviceId: DEVICE_INFO.deviceId },
    });
    expect(r.status).toBe(401);
  });
});
