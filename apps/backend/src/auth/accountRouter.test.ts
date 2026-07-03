import 'express-async-errors';
import { afterEach, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMemoryAuthAccountRepo, type MemUser } from './accountRepository.memory';
import type { Mailer } from './mailer';
import { createAccountRouter } from './accountRouter';
import { errorHandler, notFoundHandler } from '../middleware/error';

interface FakeMailer extends Mailer {
  verifications: { email: string; url: string }[];
  resets: { email: string; url: string }[];
}
function fakeMailer(): FakeMailer {
  return {
    verifications: [],
    resets: [],
    async sendEmailVerification(email, url) {
      this.verifications.push({ email, url });
    },
    async sendPasswordReset(email, url) {
      this.resets.push({ email, url });
    },
  };
}
const tokenFrom = (url: string): string => new URL(url).searchParams.get('token') ?? '';

interface Ctx {
  app: Express;
  users: MemUser[];
  mailer: FakeMailer;
}
function build(): Ctx {
  const users: MemUser[] = [
    { id: 'u1', email: 'user@acme.com', emailVerified: false, passwordHash: 'old-hash' },
  ];
  const mailer = fakeMailer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = req.header('x-test-user') || undefined;
    next();
  });
  app.use(
    '/auth',
    createAccountRouter({
      repo: createMemoryAuthAccountRepo(users),
      mailer,
      hashPassword: async (pw) => `hashed:${pw}`,
      appUrl: 'https://app.test',
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, users, mailer };
}

let server: Server | undefined;
let ctx: Ctx;
async function start(): Promise<string> {
  ctx = build();
  server = ctx.app.listen(0);
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
afterEach(() => {
  server?.close();
  server = undefined;
});

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic JSON response body under test
  body: any;
}
async function call(
  base: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.user) headers['x-test-user'] = opts.user;
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('POST /auth/request-verification', () => {
  it('emails the current user a link (202)', async () => {
    const base = await start();
    const res = await call(base, '/auth/request-verification', { user: 'u1' });
    expect(res.status).toBe(202);
    expect(ctx.mailer.verifications).toHaveLength(1);
  });

  it('requires authentication (401)', async () => {
    const base = await start();
    const res = await call(base, '/auth/request-verification');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});

describe('POST /auth/verify-email', () => {
  it('verifies the user with a valid token', async () => {
    const base = await start();
    await call(base, '/auth/request-verification', { user: 'u1' });
    const token = tokenFrom(ctx.mailer.verifications[0]!.url);

    const res = await call(base, '/auth/verify-email', { body: { token } });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(ctx.users[0]!.emailVerified).toBe(true);
  });

  it('rejects an invalid token (400)', async () => {
    const base = await start();
    const res = await call(base, '/auth/verify-email', { body: { token: 'nope' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('auth_invalid');
  });

  it('rejects a missing token with a validation error (400)', async () => {
    const base = await start();
    const res = await call(base, '/auth/verify-email', { body: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('POST /auth/request-password-reset', () => {
  it('emails a reset link for a known address (202)', async () => {
    const base = await start();
    const res = await call(base, '/auth/request-password-reset', {
      body: { email: 'user@acme.com' },
    });
    expect(res.status).toBe(202);
    expect(ctx.mailer.resets).toHaveLength(1);
  });

  it('returns 202 without emailing for an unknown address (no enumeration)', async () => {
    const base = await start();
    const res = await call(base, '/auth/request-password-reset', {
      body: { email: 'stranger@acme.com' },
    });
    expect(res.status).toBe(202);
    expect(ctx.mailer.resets).toHaveLength(0);
  });
});

describe('POST /auth/reset-password', () => {
  it('resets the password with a valid token', async () => {
    const base = await start();
    await call(base, '/auth/request-password-reset', { body: { email: 'user@acme.com' } });
    const token = tokenFrom(ctx.mailer.resets[0]!.url);

    const res = await call(base, '/auth/reset-password', {
      body: { token, password: 'a-strong-password' },
    });
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(true);
    expect(ctx.users[0]!.passwordHash).toBe('hashed:a-strong-password');
  });

  it('rejects a weak password (400)', async () => {
    const base = await start();
    await call(base, '/auth/request-password-reset', { body: { email: 'user@acme.com' } });
    const token = tokenFrom(ctx.mailer.resets[0]!.url);
    const res = await call(base, '/auth/reset-password', { body: { token, password: 'short' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('auth_weak_password');
  });

  it('rejects an invalid reset token (400)', async () => {
    const base = await start();
    const res = await call(base, '/auth/reset-password', {
      body: { token: 'nope', password: 'a-strong-password' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('auth_invalid');
  });
});
