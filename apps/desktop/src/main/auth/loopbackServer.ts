/**
 * Ephemeral loopback HTTP server used to catch the OAuth redirect, per the
 * native-app flow in RFC 8252. It binds to 127.0.0.1 on a random port, accepts
 * exactly one callback on an unguessable path, shows the user a "return to the
 * app" page, and then shuts down.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createLogger } from '../logger';

const log = createLogger('loopback');

export interface LoopbackResult {
  code?: string;
  state?: string;
  error?: string;
}

export interface LoopbackServer {
  /** The full redirect URI the backend should send the browser back to. */
  redirectUri: string;
  /** Resolves once the browser hits the callback (or rejects on timeout). */
  waitForResult(timeoutMs: number): Promise<LoopbackResult>;
  /** Tears the server down. Safe to call multiple times. */
  close(): void;
}

const RESPONSE_HTML = (ok: boolean): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NeuroPause</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
    background:#0b0b0f; color:#f5f5f7; }
  .card { text-align:center; padding:48px 56px; border-radius:20px;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); }
  h1 { font-size:20px; font-weight:600; margin:0 0 8px; }
  p { margin:0; color:#a1a1a6; font-size:14px; }
  .dot { font-size:34px; margin-bottom:12px; }
</style></head>
<body><div class="card">
  <div class="dot">${ok ? '✓' : '⚠️'}</div>
  <h1>${ok ? 'You are signed in' : 'Sign-in could not be completed'}</h1>
  <p>You can close this tab and return to NeuroPause.</p>
</div></body></html>`;

export async function startLoopbackServer(options: { port?: number } = {}): Promise<LoopbackServer> {
  // Unguessable callback path adds entropy beyond the random port.
  const path = `/callback/${randomBytes(16).toString('hex')}`;

  let resolveResult: ((r: LoopbackResult) => void) | null = null;
  let settled = false;
  const resultPromise = new Promise<LoopbackResult>((resolve) => {
    resolveResult = resolve;
  });

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== path) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const error = url.searchParams.get('error') ?? undefined;
    const result: LoopbackResult = {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      error,
    };

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(RESPONSE_HTML(!error && Boolean(result.code)));

    if (!settled && resolveResult) {
      settled = true;
      resolveResult(result);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (options.port && err.code === 'EADDRINUSE') {
        reject(new Error(`Loopback port ${options.port} is in use. Close whatever is using it and try connecting again.`));
      } else {
        reject(err);
      }
    });
    // A pinned port when the provider requires a registered callback; otherwise
    // port 0 => OS assigns a free ephemeral port. Bind to loopback only.
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${address.port}${path}`;
  log.debug('Loopback server listening', { redirectUri });

  const close = (): void => {
    if (server.listening) server.close();
  };

  const waitForResult = (timeoutMs: number): Promise<LoopbackResult> =>
    new Promise<LoopbackResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Timed out waiting for the browser sign-in to complete'));
        }
      }, timeoutMs);

      void resultPromise.then((r) => {
        clearTimeout(timer);
        resolve(r);
      });
    });

  return { redirectUri, waitForResult, close };
}
