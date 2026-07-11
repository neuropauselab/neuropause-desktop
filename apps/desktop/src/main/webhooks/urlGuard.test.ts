/** P3.0 Increment 10 — webhook SSRF egress guard tests. */
import { describe, expect, it } from 'vitest';
import { assertSafeWebhookUrl, classifyWebhookUrl } from './urlGuard';

describe('classifyWebhookUrl', () => {
  it('accepts public HTTPS endpoints (incl. public IPs)', () => {
    for (const url of ['https://hooks.example.com/x', 'https://api.acme.io:8443/webhooks/np', 'https://93.184.216.34/hook', 'https://example.test/hook']) {
      expect(classifyWebhookUrl(url)).toEqual({ ok: true });
    }
  });

  it('rejects non-HTTPS schemes', () => {
    for (const url of ['http://hooks.example.com/x', 'ftp://example.com', 'file:///etc/passwd', 'gopher://x']) {
      expect(classifyWebhookUrl(url).ok).toBe(false);
    }
  });

  it('rejects loopback / localhost / internal hostnames', () => {
    for (const url of ['https://localhost/x', 'https://svc.internal/x', 'https://db.local/x', 'https://api.home.arpa/x']) {
      expect(classifyWebhookUrl(url).ok).toBe(false);
    }
  });

  it('rejects private, loopback, link-local, and metadata IPv4', () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '172.16.5.5', '172.31.9.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(classifyWebhookUrl(`https://${host}/x`).ok).toBe(false);
    }
  });

  it('allows public IPv4 just outside private ranges', () => {
    for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '8.8.8.8']) {
      expect(classifyWebhookUrl(`https://${host}/x`)).toEqual({ ok: true });
    }
  });

  it('rejects IPv6 loopback, ULA, link-local, and mapped-private', () => {
    for (const host of ['[::1]', '[fc00::1]', '[fd12:3456::1]', '[fe80::1]', '[::ffff:127.0.0.1]']) {
      expect(classifyWebhookUrl(`https://${host}/x`).ok).toBe(false);
    }
  });

  it('rejects embedded credentials and malformed URLs', () => {
    expect(classifyWebhookUrl('https://user:pass@example.com/x').ok).toBe(false);
    expect(classifyWebhookUrl('not a url').ok).toBe(false);
  });

  it('assertSafeWebhookUrl throws an Invalid request on rejection', () => {
    expect(() => assertSafeWebhookUrl('http://169.254.169.254/latest/meta-data')).toThrow(/Invalid request: webhook URL rejected/);
    expect(() => assertSafeWebhookUrl('https://hooks.example.com/x')).not.toThrow();
  });
});
