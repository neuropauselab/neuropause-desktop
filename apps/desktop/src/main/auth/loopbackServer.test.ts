import { describe, expect, it } from 'vitest';
import { startLoopbackServer } from './loopbackServer';

describe('startLoopbackServer', () => {
  it('uses an unguessable random path by default', async () => {
    const srv = await startLoopbackServer();
    try {
      expect(srv.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\/[0-9a-f]{32}$/);
    } finally {
      srv.close();
    }
  });

  it('uses the fixed path when callbackPath is given (port stays random)', async () => {
    const srv = await startLoopbackServer({ callbackPath: '/callback' });
    try {
      expect(srv.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    } finally {
      srv.close();
    }
  });

  it('resolves code and state on a callback hit and 404s other paths', async () => {
    const srv = await startLoopbackServer({ callbackPath: '/callback' });
    try {
      const wrong = await fetch(srv.redirectUri.replace('/callback', '/nope'));
      expect(wrong.status).toBe(404);
      const pending = srv.waitForResult(2000);
      const ok = await fetch(`${srv.redirectUri}?code=abc123&state=st-1`);
      expect(ok.status).toBe(200);
      const result = await pending;
      expect(result).toMatchObject({ code: 'abc123', state: 'st-1' });
    } finally {
      srv.close();
    }
  });
});
