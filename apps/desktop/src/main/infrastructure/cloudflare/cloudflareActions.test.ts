/**
 * P6.7 — Cloudflare automation actions through the SHARED confirmation-gated executor. Proves: the gate refuses a
 * mutation without `confirmed` (and never calls Cloudflare), each action builds the correct relative path / verb /
 * body (purge POST, dev-mode + pause PATCH, DNS create POST + delete DELETE), the 32-hex id + record validators
 * fail closed BEFORE any request, the started→completed|failed audit fan-out, and 403 classification. Pure-node;
 * the bearer transport is faked (envelope responses).
 */
import { describe, expect, it } from 'vitest';
import type { DiscoveryHttp, DiscoveryRequest, PlatformEventInput } from '@neuropause/shared';
import { AuthError } from '../../unified/sync/http';
import { InfraActionExecutor } from '../executor';
import { CLOUDFLARE_ACTIONS } from './cloudflareActions';

const NOW = '2026-07-13T00:00:00.000Z';
const ZONE = 'abcdef0123456789abcdef0123456789';
const REC = '00112233445566778899aabbccddeeff';
const OK = JSON.stringify({ success: true, result: {} });

function harness(router: (req: DiscoveryRequest) => { status?: number; text?: string; error?: Error }) {
  const events: PlatformEventInput[] = [];
  const requests: DiscoveryRequest[] = [];
  const http: DiscoveryHttp = {
    getJson: async () => ({ data: {}, status: 200, headers: {} }),
    send: async (req) => {
      requests.push(req);
      const r = router(req);
      if (r.error) throw r.error;
      return { status: r.status ?? 200, headers: {}, text: r.text ?? OK };
    },
  };
  const exec = new InfraActionExecutor(
    { makeHttp: () => http, publish: (e) => events.push(e), regionFor: () => null, ownsAccount: () => true, /* P13C R7 — these suites act AS the owning tenant; cross-tenant refusal is asserted in infrastructureTenancy.test.ts */ now: () => NOW },
    CLOUDFLARE_ACTIONS,
  );
  return { exec, events, requests };
}
const types = (events: PlatformEventInput[]): string[] => events.map((e) => e.type);

describe('confirmation gate', () => {
  it('refuses a mutating action without confirmation and NEVER calls Cloudflare', async () => {
    const { exec, events, requests } = harness(() => ({ text: OK }));
    const res = await exec.execute('cloudflare', 'default', 'cf_dns_delete', { zoneId: ZONE, recordId: REC }, false);
    expect(res.ok).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
    expect(requests).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('zone actions', () => {
  it('Purge Cache POSTs purge_everything and audits started→completed', async () => {
    const { exec, events, requests } = harness(() => ({ text: OK }));
    const res = await exec.execute('cloudflare', 'default', 'cf_purge_cache', { zoneId: ZONE }, true);
    expect(res.ok).toBe(true);
    expect(requests[0]).toMatchObject({ method: 'POST', url: `/zones/${ZONE}/purge_cache` });
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ purge_everything: true });
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_completed']);
  });

  it('Development Mode PATCHes the setting value', async () => {
    const { exec, requests } = harness(() => ({ text: OK }));
    await exec.execute('cloudflare', 'default', 'cf_development_mode', { zoneId: ZONE, enabled: 'on' }, true);
    expect(requests[0].method).toBe('PATCH');
    expect(requests[0].url).toBe(`/zones/${ZONE}/settings/development_mode`);
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ value: 'on' });
  });

  it('Pause Zone PATCHes the paused flag', async () => {
    const { exec, requests } = harness(() => ({ text: OK }));
    await exec.execute('cloudflare', 'default', 'cf_pause_zone', { zoneId: ZONE, paused: 'true' }, true);
    expect(requests[0].url).toBe(`/zones/${ZONE}`);
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ paused: true });
  });
});

describe('DNS record actions', () => {
  it('Create DNS Record POSTs the record body (type upper-cased, ttl/proxied coerced) and returns the id', async () => {
    const { exec, requests } = harness(() => ({ text: JSON.stringify({ success: true, result: { id: REC } }) }));
    const res = await exec.execute('cloudflare', 'default', 'cf_dns_create', { zoneId: ZONE, type: 'a', name: 'www.example.com', content: '203.0.113.10', ttl: '1', proxied: 'true' }, true);
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ recordId: REC, type: 'A' });
    expect(requests[0]).toMatchObject({ method: 'POST', url: `/zones/${ZONE}/dns_records` });
    expect(JSON.parse(requests[0].body ?? '{}')).toEqual({ type: 'A', name: 'www.example.com', content: '203.0.113.10', ttl: 1, proxied: true });
  });

  it('Delete DNS Record DELETEs the record path', async () => {
    const { exec, requests } = harness(() => ({ text: OK }));
    await exec.execute('cloudflare', 'default', 'cf_dns_delete', { zoneId: ZONE, recordId: REC }, true);
    expect(requests[0].method).toBe('DELETE');
    expect(requests[0].url).toBe(`/zones/${ZONE}/dns_records/${REC}`);
  });
});

describe('validators + classification', () => {
  it('rejects a non-hex zone id, a bad DNS type, and a bad TTL BEFORE any request', async () => {
    const { exec, requests, events } = harness(() => ({ text: OK }));
    const badZone = await exec.execute('cloudflare', 'default', 'cf_purge_cache', { zoneId: 'not-a-hex-id' }, true);
    expect(badZone.message).toContain('Invalid zone id');
    const badType = await exec.execute('cloudflare', 'default', 'cf_dns_create', { zoneId: ZONE, type: 'bad!', name: 'x', content: 'y' }, true);
    expect(badType.message).toContain('Invalid DNS record type');
    const badTtl = await exec.execute('cloudflare', 'default', 'cf_dns_create', { zoneId: ZONE, type: 'A', name: 'x', content: 'y', ttl: '5' }, true);
    expect(badTtl.message).toContain('Invalid TTL');
    expect(requests).toHaveLength(0);
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed', 'infrastructure.action_started', 'infrastructure.action_failed', 'infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('a provider 403 becomes a least-privilege message and audits started→failed', async () => {
    const { exec, events } = harness(() => ({ error: new AuthError('Forbidden', 403) }));
    const res = await exec.execute('cloudflare', 'default', 'cf_purge_cache', { zoneId: ZONE }, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied by the cloud provider');
    expect(types(events)).toEqual(['infrastructure.action_started', 'infrastructure.action_failed']);
  });

  it('lists exactly the five high-privilege Cloudflare actions', () => {
    const { exec } = harness(() => ({ text: OK }));
    const cat = exec.list('cloudflare');
    expect(cat.map((a) => a.id).sort()).toEqual(['cf_development_mode', 'cf_dns_create', 'cf_dns_delete', 'cf_pause_zone', 'cf_purge_cache'].sort());
    expect(cat.every((a) => a.mutates && a.platformId === 'cloudflare')).toBe(true);
    expect(cat.filter((a) => a.risk === 'high').map((a) => a.id).sort()).toEqual(['cf_dns_create', 'cf_dns_delete', 'cf_pause_zone'].sort());
  });
});
