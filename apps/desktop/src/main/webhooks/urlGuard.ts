/**
 * Webhook egress guard (P3.0, Increment 10) — SSRF prevention.
 *
 * A webhook endpoint is a URL the platform will POST signed event payloads to. Left
 * unrestricted, a registrant could point it at loopback, link-local (cloud metadata
 * 169.254.169.254), or private-range hosts and turn the server into an SSRF proxy /
 * internal-data exfiltration primitive. This pure classifier rejects everything that
 * is not a public HTTPS endpoint; the store rejects at registration and the dispatcher
 * re-checks before every POST (defense-in-depth against a URL that became internal, and
 * against rows stored before this guard existed). DNS-rebinding across the check is the
 * documented residual — mitigated by re-checking at send time.
 */

export interface UrlVerdict {
  ok: boolean;
  reason?: string;
}

/** Internal-resolution TLD suffixes (NOT `.test`, which is reserved but non-resolving). */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa'];

function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number];
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** Loopback / private / link-local / CGNAT / unspecified / multicast + reserved. */
function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved (224.0.0.0+)
  return false;
}

function isPrivateIpv6(addr: string): boolean {
  const h = addr.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // fe80::/10
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is a classic SSRF bypass, and the URL parser may
  // normalize the dotted quad to hex (::ffff:7f00:1), so reject the whole mapped range.
  if (h.startsWith('::ffff:')) return true;
  // Any other embedded dotted IPv4 in a private range.
  if (h.includes('.')) {
    const v4 = parseIpv4(h.slice(h.lastIndexOf(':') + 1));
    if (v4 && isPrivateIpv4(v4)) return true;
  }
  return false;
}

/** Classify a webhook target URL. Only public HTTPS endpoints are allowed. Pure. */
export function classifyWebhookUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'endpoint must use https' };
  if (url.username || url.password) return { ok: false, reason: 'embedded credentials are not allowed' };

  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return { ok: false, reason: 'missing host' };
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'internal hostname is not allowed' };
  }
  const v4 = parseIpv4(host);
  if (v4) {
    if (isPrivateIpv4(v4)) return { ok: false, reason: 'private/loopback/link-local address is not allowed' };
    return { ok: true };
  }
  if (host.includes(':')) {
    if (isPrivateIpv6(host)) return { ok: false, reason: 'private/loopback/link-local address is not allowed' };
    return { ok: true };
  }
  return { ok: true };
}

/** Throwing variant for registration paths. */
export function assertSafeWebhookUrl(raw: string): void {
  const verdict = classifyWebhookUrl(raw);
  if (!verdict.ok) throw new Error(`Invalid request: webhook URL rejected — ${verdict.reason}`);
}
