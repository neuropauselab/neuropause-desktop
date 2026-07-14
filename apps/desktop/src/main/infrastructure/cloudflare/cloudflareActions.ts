/**
 * P6.7 — Cloudflare automation actions (HIGH PRIVILEGE).
 *
 * Confirmation-gated mutations against the Cloudflare API over the SAME bearer transport discovery uses: purge a
 * zone's cache, toggle Development Mode, pause / un-pause a zone, and create / delete a DNS record. Every one is
 * `mutates: true`, so the shared `InfraActionExecutor` refuses it without an explicit human confirmation and AI can
 * never reach it. Discovery runs read-only; these actions are the only writes, and Cloudflare's own API-token
 * scopes govern whether the token may run them (a denial surfaces as a least-privilege message).
 *
 * The transport is already pinned to `api.cloudflare.com`, so an action only builds RELATIVE paths. Every zone /
 * record id is a 32-hex Cloudflare id validated before use (defense-in-depth with the host pin); record
 * type/name/content/ttl/proxied go in the JSON body and are validated too.
 *
 * REST scope: Deploy Worker (a multipart script upload) and Rotate Tunnel Token (no single-call REST endpoint —
 * a secret-regeneration flow) are NOT simple parametrized actions and are documented as out of scope, rather than
 * shipping actions that can't run cleanly.
 */
import { cfMutate } from './cloudflareClient';
import { optStr, reqStr, InfraActionInputError, type InfraAction } from '../actionSdk';

type Rec = Record<string, unknown>;

/* ── strict validators (fail closed BEFORE any request) ──────────────────────────────────────────── */

/** A Cloudflare zone / record id — 32 hex chars, path-safe. */
const CF_ID_RE = /^[0-9a-fA-F]{32}$/;
function cfId(v: string, what: string): string {
  if (!CF_ID_RE.test(v)) throw new InfraActionInputError(`Invalid ${what} "${v}"`);
  return v;
}
/** A DNS record type (A, AAAA, CNAME, TXT, MX, HTTPS, …). */
const DNS_TYPE_RE = /^[A-Z][A-Z0-9]{0,9}$/;
function dnsType(v: string): string {
  const t = v.trim().toUpperCase();
  if (!DNS_TYPE_RE.test(t)) throw new InfraActionInputError(`Invalid DNS record type "${v}"`);
  return t;
}
/** A DNS record name (goes in the body): hostname charset incl. `@` (root) and `*` (wildcard). */
const DNS_NAME_RE = /^[@A-Za-z0-9_.*-]{1,255}$/;
function dnsName(v: string): string {
  if (!DNS_NAME_RE.test(v)) throw new InfraActionInputError(`Invalid DNS record name "${v}"`);
  return v;
}
function dnsContent(v: string): string {
  if (v.length < 1 || v.length > 2048) throw new InfraActionInputError('Invalid DNS record content');
  return v;
}
function ttl(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || (n !== 1 && (n < 60 || n > 86400))) throw new InfraActionInputError(`Invalid TTL "${v}" (use 1 for automatic, or 60–86400)`);
  return n;
}
function onOff(v: string): 'on' | 'off' {
  const t = v.trim().toLowerCase();
  if (t !== 'on' && t !== 'off') throw new InfraActionInputError(`Invalid value "${v}" (use "on" or "off")`);
  return t;
}
function boolParam(v: string, what: string): boolean {
  const t = v.trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  throw new InfraActionInputError(`Invalid ${what} "${v}" (use "true" or "false")`);
}

export const CLOUDFLARE_ACTIONS: InfraAction[] = [
  {
    id: 'cf_purge_cache', label: 'Purge Cache', platformId: 'cloudflare', domain: 'networking',
    description: "Purges everything in a zone's Cloudflare cache.", mutates: true, risk: 'medium', targetResourceType: 'zone',
    params: [{ key: 'zoneId', label: 'Zone', required: true, hint: '32-hex zone id' }],
    run: async (ctx, p) => {
      const zone = cfId(reqStr(p, 'zoneId'), 'zone id');
      await cfMutate(ctx.http, 'POST', `/zones/${zone}/purge_cache`, { purge_everything: true });
      return { ok: true, summary: `Purged all cache for zone ${zone}`, data: { zone } };
    },
  },
  {
    id: 'cf_development_mode', label: 'Set Development Mode', platformId: 'cloudflare', domain: 'networking',
    description: 'Turns a zone’s Development Mode on or off (bypasses cache for ~3 hours when on).', mutates: true, risk: 'medium', targetResourceType: 'zone',
    params: [
      { key: 'zoneId', label: 'Zone', required: true, hint: '32-hex zone id' },
      { key: 'enabled', label: 'On/Off', required: true, hint: 'on' },
    ],
    run: async (ctx, p) => {
      const zone = cfId(reqStr(p, 'zoneId'), 'zone id');
      const value = onOff(reqStr(p, 'enabled'));
      await cfMutate(ctx.http, 'PATCH', `/zones/${zone}/settings/development_mode`, { value });
      return { ok: true, summary: `Development mode ${value} for zone ${zone}`, data: { zone, value } };
    },
  },
  {
    id: 'cf_pause_zone', label: 'Pause Zone', platformId: 'cloudflare', domain: 'dns',
    description: 'Pauses (or resumes) Cloudflare on a zone — paused traffic bypasses Cloudflare entirely.', mutates: true, risk: 'high', targetResourceType: 'zone',
    params: [
      { key: 'zoneId', label: 'Zone', required: true, hint: '32-hex zone id' },
      { key: 'paused', label: 'Paused (true/false)', required: true, hint: 'true' },
    ],
    run: async (ctx, p) => {
      const zone = cfId(reqStr(p, 'zoneId'), 'zone id');
      const paused = boolParam(reqStr(p, 'paused'), 'paused');
      await cfMutate(ctx.http, 'PATCH', `/zones/${zone}`, { paused });
      return { ok: true, summary: `${paused ? 'Paused' : 'Resumed'} Cloudflare for zone ${zone}`, data: { zone, paused } };
    },
  },
  {
    id: 'cf_dns_create', label: 'Create DNS Record', platformId: 'cloudflare', domain: 'dns',
    description: 'Creates a DNS record in a zone.', mutates: true, risk: 'high', targetResourceType: 'dns_record',
    params: [
      { key: 'zoneId', label: 'Zone', required: true, hint: '32-hex zone id' },
      { key: 'type', label: 'Type', required: true, hint: 'A' },
      { key: 'name', label: 'Name', required: true, hint: 'www.example.com' },
      { key: 'content', label: 'Content', required: true, hint: '203.0.113.10' },
      { key: 'ttl', label: 'TTL (optional)', required: false, hint: '1' },
      { key: 'proxied', label: 'Proxied (optional true/false)', required: false, hint: 'false' },
    ],
    run: async (ctx, p) => {
      const zone = cfId(reqStr(p, 'zoneId'), 'zone id');
      const body: Rec = { type: dnsType(reqStr(p, 'type')), name: dnsName(reqStr(p, 'name')), content: dnsContent(reqStr(p, 'content')) };
      const ttlRaw = optStr(p, 'ttl');
      if (ttlRaw) body.ttl = ttl(ttlRaw);
      const proxiedRaw = optStr(p, 'proxied');
      if (proxiedRaw) body.proxied = boolParam(proxiedRaw, 'proxied');
      const result = await cfMutate(ctx.http, 'POST', `/zones/${zone}/dns_records`, body);
      const recordId = typeof result.id === 'string' ? result.id : null;
      return { ok: true, summary: `Created ${body.type as string} record ${body.name as string}${recordId ? ` (${recordId})` : ''}`, data: { zone, type: body.type as string, name: body.name as string, recordId } };
    },
  },
  {
    id: 'cf_dns_delete', label: 'Delete DNS Record', platformId: 'cloudflare', domain: 'dns',
    description: 'Deletes a DNS record from a zone.', mutates: true, risk: 'high', targetResourceType: 'dns_record',
    params: [
      { key: 'zoneId', label: 'Zone', required: true, hint: '32-hex zone id' },
      { key: 'recordId', label: 'Record', required: true, hint: '32-hex record id' },
    ],
    run: async (ctx, p) => {
      const zone = cfId(reqStr(p, 'zoneId'), 'zone id');
      const record = cfId(reqStr(p, 'recordId'), 'record id');
      await cfMutate(ctx.http, 'DELETE', `/zones/${zone}/dns_records/${record}`);
      return { ok: true, summary: `Deleted DNS record ${record} from zone ${zone}`, data: { zone, recordId: record } };
    },
  },
];

/** Bind the Cloudflare actions (used by the executor registration in the runtime composition root). */
export function cloudflareActions(): InfraAction[] {
  return CLOUDFLARE_ACTIONS;
}
