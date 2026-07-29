import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createEnterpriseRuntime, type EnterpriseRuntime } from '@neuropause/runtime';
import { ManualClock, type CloudEvent } from '@neuropause/cloud-core';
import { buildAuthorizeUrl, buildTokenExchangeRequest, buildRefreshRequest, parseTokenResponse, OAUTH_PROVIDERS } from './oauth';
import { verifyGithubSignature, verifySlackSignature, verifyStripeSignature, WebhookReceiver } from './webhooks';

describe('OAuth request construction (ADAPTER VERIFIED)', () => {
  it('builds an authorize URL with state, scopes, and PKCE — never a secret', () => {
    const url = new URL(buildAuthorizeUrl(OAUTH_PROVIDERS.google!, { clientId: 'cid', redirectUri: 'https://app/cb', state: 'xyz', codeChallenge: 'chal' }));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.toString()).not.toContain('client_secret');
  });

  it('builds token exchange + refresh requests with secrets in the body', () => {
    const exchange = buildTokenExchangeRequest(OAUTH_PROVIDERS.github!, { code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'https://app/cb' });
    expect(exchange.method).toBe('POST');
    expect(exchange.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(exchange.body).get('grant_type')).toBe('authorization_code');
    expect(new URLSearchParams(exchange.body).get('client_secret')).toBe('sec');
    const refresh = buildRefreshRequest(OAUTH_PROVIDERS.github!, { refreshToken: 'rt', clientId: 'id', clientSecret: 'sec' });
    expect(new URLSearchParams(refresh.body).get('grant_type')).toBe('refresh_token');
  });

  it('parses a token response', () => {
    const t = parseTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer' });
    expect(t).toMatchObject({ accessToken: 'at', refreshToken: 'rt', expiresInSec: 3600, tokenType: 'Bearer' });
    expect(() => parseTokenResponse({})).toThrow(/access_token/);
  });
});

describe('webhook signature verification (real crypto — VERIFIED)', () => {
  it('GitHub HMAC-SHA256 accepts a valid signature and rejects tampering', () => {
    const secret = 'shh';
    const body = '{"action":"opened"}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyGithubSignature(secret, body, sig)).toBe(true);
    expect(verifyGithubSignature(secret, body + 'x', sig)).toBe(false);
    expect(verifyGithubSignature('wrong', body, sig)).toBe(false);
  });

  it('Slack verification enforces the timestamp window', () => {
    const secret = 'sk';
    const body = 'payload';
    const ts = '1700000000';
    const nowMs = 1_700_000_000_000;
    const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
    expect(verifySlackSignature(secret, body, ts, sig, nowMs)).toBe(true);
    expect(verifySlackSignature(secret, body, ts, sig, nowMs + 10 * 60 * 1000)).toBe(false); // stale
  });

  it('Stripe verification parses t/v1 and checks the HMAC', () => {
    const secret = 'whsec';
    const body = '{"id":"evt_1"}';
    const ts = '1700000000';
    const v1 = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(verifyStripeSignature(secret, body, `t=${ts},v1=${v1}`, 1_700_000_000_000)).toBe(true);
    expect(verifyStripeSignature(secret, body, `t=${ts},v1=deadbeef`, 1_700_000_000_000)).toBe(false);
  });
});

describe('WebhookReceiver — verify → bus → dedup, plus dead-letter + replay', () => {
  const secret = 'shh';
  const body = '{"action":"opened"}';
  const goodSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a verified webhook, publishes to the bus, and deduplicates', async () => {
    const clock = new ManualClock(0);
    const runtime = createEnterpriseRuntime({ clock });
    const published: string[] = [];
    runtime.events().subscribe('webhook.github', (e: CloudEvent) => void published.push((e.payload as { eventId: string }).eventId));
    const receiver = new WebhookReceiver(runtime, clock);
    const headers = { 'x-hub-signature-256': goodSig, 'x-github-delivery': 'd1' };

    const first = await receiver.receive('github', { headers, body, secret });
    expect(first.accepted).toBe(true);
    expect(published).toContain('d1');
    const dup = await receiver.receive('github', { headers, body, secret });
    expect(dup.deduped).toBe(true);
    const bad = await receiver.receive('github', { headers: { 'x-hub-signature-256': 'sha256=bad', 'x-github-delivery': 'd2' }, body, secret });
    expect(bad.accepted).toBe(false);
    expect(receiver.stats()).toMatchObject({ accepted: 1, deduped: 1, rejected: 1 });
  });

  it('dead-letters a delivery failure and replays it once the sink recovers', async () => {
    const clock = new ManualClock(0);
    let down = true;
    const fakeRuntime = {
      events: () => ({
        publish: async () => {
          if (down) throw new Error('bus down');
        },
      }),
    } as unknown as EnterpriseRuntime;
    const receiver = new WebhookReceiver(fakeRuntime, clock);
    const headers = { 'x-hub-signature-256': goodSig, 'x-github-delivery': 'd3' };
    const r1 = await receiver.receive('github', { headers, body, secret });
    expect(r1.accepted).toBe(false);
    expect(receiver.deadLetters()).toHaveLength(1);
    down = false;
    const replay = await receiver.replay(receiver.deadLetters()[0]!.id, secret);
    expect(replay.accepted).toBe(true);
    expect(receiver.deadLetters()).toHaveLength(0);
  });
});
