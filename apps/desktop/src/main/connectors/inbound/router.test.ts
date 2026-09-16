/**
 * P5 — Increment 2: the inbound webhook router. Verified deliveries trigger a targeted sync; bad ones
 * trigger nothing; handshakes answer without syncing; pre-authenticated transports bypass verification.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { InboundWebhookRouter, type InboundWebhookPorts } from './router';

const hmac = (s: string, m: string): string => createHmac('sha256', s).update(m).digest('hex');
const SECRET = 'sekret';

function makeRouter(overrides: Partial<InboundWebhookPorts> = {}) {
  const requestSync = vi.fn(() => Promise.resolve(undefined));
  const ports: InboundWebhookPorts = {
    resolveSecret: () => SECRET,
    accountsFor: () => ['a1', 'a2'],
    requestSync,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return { router: new InboundWebhookRouter(ports), requestSync };
}

describe('InboundWebhookRouter.handle', () => {
  it('accepts a valid GitHub delivery and fans out a targeted sync to every connected account', async () => {
    const body = '{"action":"opened"}';
    const { router, requestSync } = makeRouter();
    const res = await router.handle({
      provider: 'github',
      connectorId: 'github',
      headers: { 'x-hub-signature-256': `sha256=${hmac(SECRET, body)}` },
      rawBody: body,
    });
    expect(res.accepted).toBe(true);
    expect(res.synced).toEqual(['a1', 'a2']);
    expect(requestSync).toHaveBeenCalledTimes(2);
    expect(requestSync).toHaveBeenCalledWith('github', 'a1');
  });

  // ── S114 (FG-S113-WEBHOOK-EVENT) — verified inbound webhook → ONE minimal read-only platform event ──
  it('emits exactly ONE minimal, credential-free platform event for a VERIFIED delivery (+ preserves sync)', async () => {
    const body = '{"action":"opened"}';
    const emitPlatformEvent = vi.fn();
    const { router, requestSync } = makeRouter({ emitPlatformEvent, resolveTenantId: () => 'workspace-A' });
    const res = await router.handle({
      provider: 'github',
      connectorId: 'github',
      headers: { 'x-hub-signature-256': `sha256=${hmac(SECRET, `secret-header ${body}`)}` , 'x-secret-token': 'super-secret' },
      rawBody: `secret-header ${body}`,
    });
    expect(res.accepted).toBe(true);
    expect(requestSync).toHaveBeenCalledTimes(2); // requestSync preserved
    expect(emitPlatformEvent).toHaveBeenCalledTimes(1); // exactly one event
    const evt = emitPlatformEvent.mock.calls[0][0];
    expect(evt.type).toBe('connector.online');
    expect(evt.category).toBe('connector');
    expect(evt.metadata).toMatchObject({ connectorId: 'github', provider: 'github', tenantId: 'workspace-A', kind: 'inbound_webhook' });
    expect(typeof evt.metadata.receivedAt).toBe('number');
    // CREDENTIAL-FREE: no secret / header / token / raw body anywhere in the emitted event
    const blob = JSON.stringify(evt);
    expect(blob).not.toContain('super-secret');
    expect(blob).not.toContain('secret-header');
    expect(blob).not.toContain(SECRET);
    expect(blob).not.toMatch(/x-hub-signature|x-secret-token|rawBody|authorization/i);
  });

  it('emits NO event for a REJECTED / forged delivery (event only after verification)', async () => {
    const emitPlatformEvent = vi.fn();
    const { router } = makeRouter({ emitPlatformEvent });
    const res = await router.handle({ provider: 'github', connectorId: 'github', headers: { 'x-hub-signature-256': 'sha256=deadbeef' }, rawBody: '{}' });
    expect(res.accepted).toBe(false);
    expect(emitPlatformEvent).not.toHaveBeenCalled();
  });

  it('emits NO event when the secret is not configured (unauthenticated)', async () => {
    const emitPlatformEvent = vi.fn();
    const { router } = makeRouter({ emitPlatformEvent, resolveSecret: () => null });
    await router.handle({ provider: 'github', connectorId: 'github', headers: {}, rawBody: '{}' });
    expect(emitPlatformEvent).not.toHaveBeenCalled();
  });

  it('no emit port wired → verified delivery still works (backward-compatible no-op)', async () => {
    const body = '{"ok":1}';
    const { router, requestSync } = makeRouter(); // no emitPlatformEvent
    const res = await router.handle({ provider: 'github', connectorId: 'github', headers: { 'x-hub-signature-256': `sha256=${hmac(SECRET, body)}` }, rawBody: body });
    expect(res.accepted).toBe(true);
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('a throwing emit port never breaks webhook handling (best-effort real-time signal)', async () => {
    const body = '{"ok":1}';
    const emitPlatformEvent = vi.fn(() => { throw new Error('bus down'); });
    const { router, requestSync } = makeRouter({ emitPlatformEvent });
    const res = await router.handle({ provider: 'github', connectorId: 'github', headers: { 'x-hub-signature-256': `sha256=${hmac(SECRET, body)}` }, rawBody: body });
    expect(res.accepted).toBe(true);
    expect(requestSync).toHaveBeenCalledTimes(2);
  });

  it('tenant scoping: the event carries the resolved workspace/tenant, not anything from the payload', async () => {
    const body = '{"action":"opened"}';
    const emitPlatformEvent = vi.fn();
    const { router } = makeRouter({ emitPlatformEvent, resolveTenantId: () => 'workspace-B' });
    await router.handle({ provider: 'github', connectorId: 'github', headers: { 'x-hub-signature-256': `sha256=${hmac(SECRET, body)}` }, rawBody: body });
    expect(emitPlatformEvent.mock.calls[0][0].metadata.tenantId).toBe('workspace-B');
  });

  it('rejects a tampered GitHub delivery and triggers NO sync', async () => {
    const { router, requestSync } = makeRouter();
    const res = await router.handle({
      provider: 'github',
      connectorId: 'github',
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
      rawBody: '{}',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('signature mismatch');
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('rejects when the connector has no configured webhook secret', async () => {
    const { router, requestSync } = makeRouter({ resolveSecret: () => null });
    const res = await router.handle({ provider: 'github', connectorId: 'github', headers: {}, rawBody: '{}' });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('webhook secret not configured');
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('answers the Slack url_verification handshake without syncing', async () => {
    const { router, requestSync } = makeRouter();
    const res = await router.handle({
      provider: 'slack',
      connectorId: 'slack',
      headers: {},
      rawBody: JSON.stringify({ type: 'url_verification', challenge: 'chal-123' }),
    });
    expect(res.accepted).toBe(true);
    expect(res.challenge).toEqual({ status: 200, contentType: 'text/plain', body: 'chal-123' });
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('echoes the Microsoft Graph validationToken handshake (before any signature check)', async () => {
    const { router } = makeRouter({ resolveSecret: () => null });
    const res = await router.handle({
      provider: 'microsoft',
      connectorId: 'microsoft-entra',
      headers: {},
      rawBody: '',
      query: { validationToken: 'vtok' },
    });
    expect(res.challenge).toEqual({ status: 200, contentType: 'text/plain', body: 'vtok' });
  });

  it('accepts a Graph notification only when every clientState matches', async () => {
    const { router, requestSync } = makeRouter();
    const good = await router.handle({
      provider: 'microsoft',
      connectorId: 'microsoft-entra',
      headers: {},
      rawBody: JSON.stringify({ value: [{ clientState: SECRET }, { clientState: SECRET }] }),
    });
    expect(good.accepted).toBe(true);
    expect(requestSync).toHaveBeenCalledWith('microsoft-entra', 'a1');

    requestSync.mockClear();
    const bad = await router.handle({
      provider: 'microsoft',
      connectorId: 'microsoft-entra',
      headers: {},
      rawBody: JSON.stringify({ value: [{ clientState: SECRET }, { clientState: 'wrong' }] }),
    });
    expect(bad.accepted).toBe(false);
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('rejects a malformed Graph notification (null element) without throwing or syncing', async () => {
    const { router, requestSync } = makeRouter();
    const res = await router.handle({
      provider: 'microsoft',
      connectorId: 'microsoft-entra',
      headers: {},
      rawBody: JSON.stringify({ value: [null] }),
    });
    expect(res.accepted).toBe(false);
    expect(requestSync).not.toHaveBeenCalled();
  });

  it('triggerSync bypasses verification for pre-authenticated transports (Socket Mode)', async () => {
    const { router, requestSync } = makeRouter();
    const synced = await router.triggerSync('slack');
    expect(synced).toEqual(['a1', 'a2']);
    expect(requestSync).toHaveBeenCalledWith('slack', 'a1');
  });
});
