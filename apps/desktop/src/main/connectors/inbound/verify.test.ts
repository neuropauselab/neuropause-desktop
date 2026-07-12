/**
 * P5 — Increment 2: inbound webhook signature verification. Signatures are generated with node:crypto
 * in-test (never hard-coded), so a passing test proves the exact provider wire format.
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  graphValidationResponse,
  timingSafeHexEqual,
  verifyGitHubSignature,
  verifyGraphClientState,
  verifyNotionSignature,
  verifySlackSignature,
} from './verify';

const hmac = (secret: string, msg: string): string => createHmac('sha256', secret).update(msg).digest('hex');

describe('GitHub signature (X-Hub-Signature-256)', () => {
  const body = '{"action":"opened"}';
  const secret = 'gh-secret';

  it('accepts a correct sha256= signature', () => {
    expect(verifyGitHubSignature(body, `sha256=${hmac(secret, body)}`, secret).ok).toBe(true);
  });

  it('rejects a wrong secret, a tampered body, a missing header, and a scheme-less header', () => {
    const sig = `sha256=${hmac(secret, body)}`;
    expect(verifyGitHubSignature(body, sig, 'other').ok).toBe(false);
    expect(verifyGitHubSignature('{"action":"closed"}', sig, secret).ok).toBe(false);
    expect(verifyGitHubSignature(body, undefined, secret).reason).toBe('missing signature');
    expect(verifyGitHubSignature(body, hmac(secret, body), secret).reason).toBe('unsupported signature scheme');
  });
});

describe('Notion signature (X-Notion-Signature)', () => {
  it('accepts a correct signature and rejects a wrong verification token', () => {
    const body = '{"page":"x"}';
    const token = 'verif-token';
    expect(verifyNotionSignature(body, `sha256=${hmac(token, body)}`, token).ok).toBe(true);
    expect(verifyNotionSignature(body, `sha256=${hmac(token, body)}`, 'nope').ok).toBe(false);
  });
});

describe('Slack signature (X-Slack-Signature v0)', () => {
  const body = 'token=abc&team_id=T1';
  const secret = 'slack-signing';
  const ts = 1_700_000_000; // seconds
  const now = ts * 1000;
  const sign = (t: number): string => `v0=${hmac(secret, `v0:${t}:${body}`)}`;

  it('accepts a fresh, correct v0= signature', () => {
    expect(verifySlackSignature(body, sign(ts), String(ts), secret, now).ok).toBe(true);
  });

  it('rejects a timestamp outside the replay window', () => {
    const r = verifySlackSignature(body, sign(ts), String(ts), secret, now + 6 * 60_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stale timestamp');
  });

  it('rejects a signature bound to a different timestamp, missing parts, and a non-numeric ts', () => {
    expect(verifySlackSignature(body, sign(ts + 1), String(ts), secret, now).ok).toBe(false);
    expect(verifySlackSignature(body, undefined, String(ts), secret, now).reason).toBe('missing signature or timestamp');
    expect(verifySlackSignature(body, sign(ts), 'nan', secret, now).reason).toBe('bad timestamp');
  });
});

describe('Microsoft Graph', () => {
  it('echoes a validationToken as text/plain, and null when absent', () => {
    expect(graphValidationResponse('abc123')).toEqual({ status: 200, contentType: 'text/plain', body: 'abc123' });
    expect(graphValidationResponse(undefined)).toBeNull();
  });

  it('verifies clientState (constant-time), rejecting a mismatch or absence', () => {
    expect(verifyGraphClientState('shhh', 'shhh').ok).toBe(true);
    expect(verifyGraphClientState('nope', 'shhh').ok).toBe(false);
    expect(verifyGraphClientState(undefined, 'shhh').ok).toBe(false);
  });
});

describe('timingSafeHexEqual', () => {
  it('is true for equal digests and false for differing, length-mismatched, or empty inputs', () => {
    expect(timingSafeHexEqual('abcd', 'abcd')).toBe(true);
    expect(timingSafeHexEqual('abcd', 'abce')).toBe(false);
    expect(timingSafeHexEqual('abcd', 'ab')).toBe(false);
    expect(timingSafeHexEqual('', '')).toBe(false);
  });
});
