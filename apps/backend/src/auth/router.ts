import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { EmailCredentialsRequest, OAuthProviderIdSchema } from '@neuropause/shared';
import { loadEnv } from '../config/env';
import { logger } from '../config/logger';
import { redis } from '../cache/redis';
import { validateBody } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { audit } from '../middleware/audit';
import { AppError, badRequest, notFound } from '../middleware/error';
import { getProvider, enabledProviderIds } from './providers/registry';
import { hashToken, randomToken, sha256Base64url } from './pkce';
import { issueTokens, rotateTokens, revokeToken } from './session';
import { requireAuth } from './requireAuth';
import {
  authenticateEmailUser,
  registerEmailUser,
  resolveOAuthUser,
} from '../users/service';
import { findUserById } from '../users/repository';

const env = loadEnv();
const FLOW_TTL = 600; // seconds the browser flow may stay open
const CODE_TTL = 120; // seconds the one-time desktop code is valid

interface FlowState {
  provider: string;
  desktopRedirectUri: string;
  desktopState: string;
  codeChallenge: string;
}

interface OneTimeCode {
  userId: string;
  codeChallenge: string;
}

function callbackUrl(provider: string): string {
  return `${env.PUBLIC_BACKEND_URL}/auth/${provider}/callback`;
}

/** Only http loopback redirect targets are accepted from the desktop client. */
function isLoopbackRedirect(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

const StartQuery = z.object({
  redirect_uri: z.string().url(),
  state: z.string().min(8).max(256),
  code_challenge: z.string().min(20).max(256),
  code_challenge_method: z.literal('S256'),
});

const TokenExchange = z.object({
  code: z.string().min(10).max(256),
  code_verifier: z.string().min(20).max(256),
});

const RefreshRequest = z.object({ refreshToken: z.string().min(10).max(512) });

export function createAuthRouter(): Router {
  const router = Router();

  // Which providers are usable in this deployment.
  router.get('/providers', (_req, res) => {
    res.json({ providers: enabledProviderIds() });
  });

  // Step 1: desktop opens the system browser here.
  router.get('/:provider/start', async (req: Request, res: Response) => {
    const providerId = OAuthProviderIdSchema.parse(req.params.provider);
    const provider = getProvider(providerId);
    if (!provider.isEnabled()) throw notFound('provider_disabled', 'Provider is not configured');

    const q = StartQuery.parse(req.query);
    if (!isLoopbackRedirect(q.redirect_uri)) {
      throw badRequest('bad_redirect', 'redirect_uri must be a loopback address');
    }

    const flowState = randomToken(24);
    const flow: FlowState = {
      provider: providerId,
      desktopRedirectUri: q.redirect_uri,
      desktopState: q.state,
      codeChallenge: q.code_challenge,
    };
    await redis.set(`oauthflow:${flowState}`, JSON.stringify(flow), 'EX', FLOW_TTL);

    const url = provider.authorizeUrl({ state: flowState, redirectUri: callbackUrl(providerId) });
    res.redirect(url);
  });

  // Step 2: provider redirects (or form-posts) back here.
  const handleCallback = async (req: Request, res: Response): Promise<void> => {
    const providerId = OAuthProviderIdSchema.parse(req.params.provider);
    const provider = getProvider(providerId);

    const source = provider.usesFormPost ? req.body : req.query;
    const code = typeof source?.code === 'string' ? source.code : undefined;
    const state = typeof source?.state === 'string' ? source.state : undefined;
    const oauthError = typeof source?.error === 'string' ? source.error : undefined;

    if (!state) throw badRequest('missing_state', 'Missing state');

    const raw = await redis.get(`oauthflow:${state}`);
    if (!raw) throw badRequest('unknown_state', 'Unknown or expired login attempt');
    await redis.del(`oauthflow:${state}`);
    const flow = JSON.parse(raw) as FlowState;

    const redirectBack = (params: Record<string, string>): void => {
      const u = new URL(flow.desktopRedirectUri);
      Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
      res.redirect(u.toString());
    };

    if (oauthError || !code) {
      redirectBack({ error: oauthError ?? 'no_code', state: flow.desktopState });
      return;
    }

    try {
      const tokens = await provider.exchangeCode({ code, redirectUri: callbackUrl(providerId) });
      const profile = await provider.fetchProfile(tokens);
      const { user, isNew } = await resolveOAuthUser(providerId, profile);

      await audit(req, isNew ? 'auth.oauth.register' : 'auth.oauth.login', { provider: providerId }, user.id);

      // Mint a one-time code bound to the desktop's PKCE challenge.
      const oneTime = randomToken(24);
      const payload: OneTimeCode = { userId: user.id, codeChallenge: flow.codeChallenge };
      await redis.set(`oauthcode:${oneTime}`, JSON.stringify(payload), 'EX', CODE_TTL);

      redirectBack({ code: oneTime, state: flow.desktopState });
    } catch (err) {
      logger.error({ err, provider: providerId }, 'OAuth callback failed');
      redirectBack({ error: 'exchange_failed', state: flow.desktopState });
    }
  };

  router.get('/:provider/callback', handleCallback);
  router.post('/:provider/callback', handleCallback);

  // Step 3: desktop exchanges the one-time code (with PKCE verifier) for tokens.
  router.post('/token', validateBody(TokenExchange), async (req: Request, res: Response) => {
    const { code, code_verifier } = req.body as z.infer<typeof TokenExchange>;
    const raw = await redis.get(`oauthcode:${code}`);
    if (!raw) throw new AppError(400, 'invalid_code', 'Invalid or expired authorization code');
    await redis.del(`oauthcode:${code}`);
    const payload = JSON.parse(raw) as OneTimeCode;

    if (sha256Base64url(code_verifier) !== payload.codeChallenge) {
      throw new AppError(400, 'pkce_mismatch', 'PKCE verification failed');
    }

    const user = await findUserById(payload.userId);
    if (!user) throw notFound('user_not_found', 'User no longer exists');

    const tokens = await issueTokens(user.id, user.email, req.header('user-agent') ?? null);
    res.json({ user, tokens });
  });

  // Email/password registration.
  router.post(
    '/email/register',
    rateLimit({ bucket: 'register', windowSeconds: 3600, max: 10 }),
    validateBody(EmailCredentialsRequest),
    async (req: Request, res: Response) => {
      const { email, password } = req.body as z.infer<typeof EmailCredentialsRequest>;
      const user = await registerEmailUser(email, password);
      await audit(req, 'auth.email.register', { email }, user.id);
      const tokens = await issueTokens(user.id, user.email, req.header('user-agent') ?? null);
      res.status(201).json({ user, tokens });
    },
  );

  // Email/password login.
  router.post(
    '/email/login',
    rateLimit({ bucket: 'login', windowSeconds: 900, max: 20 }),
    validateBody(EmailCredentialsRequest),
    async (req: Request, res: Response) => {
      const { email, password } = req.body as z.infer<typeof EmailCredentialsRequest>;
      const user = await authenticateEmailUser(email, password);
      await audit(req, 'auth.email.login', { email }, user.id);
      const tokens = await issueTokens(user.id, user.email, req.header('user-agent') ?? null);
      res.json({ user, tokens });
    },
  );

  // Rotate a refresh token.
  router.post('/token/refresh', validateBody(RefreshRequest), async (req: Request, res: Response) => {
    const { refreshToken } = req.body as z.infer<typeof RefreshRequest>;
    const tokens = await rotateTokens(refreshToken, req.header('user-agent') ?? null);
    res.json({ tokens });
  });

  // Logout (revoke a single refresh token).
  router.post('/logout', validateBody(RefreshRequest), async (req: Request, res: Response) => {
    const { refreshToken } = req.body as z.infer<typeof RefreshRequest>;
    await revokeToken(refreshToken);
    await audit(req, 'auth.logout', { tokenHash: hashToken(refreshToken).slice(0, 12) });
    res.status(204).end();
  });

  // Current user (access-token protected).
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    const user = await findUserById(req.userId!);
    if (!user) throw notFound('user_not_found', 'User not found');
    res.json({ user });
  });

  return router;
}
