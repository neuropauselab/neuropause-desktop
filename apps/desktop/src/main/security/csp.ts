/**
 * Content-Security-Policy for the renderer.
 *
 * The renderer performs no network I/O of its own — every privileged call goes
 * through IPC to the main process — so the policy can be tight. In development
 * we relax script/connect rules just enough for Vite's HMR to function; the
 * packaged build gets the strict policy.
 */
import { session } from 'electron';
import { config } from '../config';

function buildPolicy(): string {
  const scriptSrc = config.isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self'";

  // Vite's dev server talks over http + ws on localhost for module loading/HMR.
  const connectSrc = config.isDev
    ? "connect-src 'self' http://localhost:* ws://localhost:*"
    : "connect-src 'self'";

  return [
    "default-src 'self'",
    scriptSrc,
    // Inline styles are needed for Tailwind's injected sheet and for
    // animation libraries that set style attributes on elements.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    connectSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Attaches the CSP header to every response in the default session. */
export function installContentSecurityPolicy(): void {
  const policy = buildPolicy();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}
