import 'express-async-errors';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp, type Options } from 'pino-http';
import { logger } from './config/logger';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/error';
import { createAuthRouter } from './auth/router';
import { createStoreRouter } from './store/router';
import { createOrganizationsRouter } from './organizations/router';
import { createPgOrgRepository } from './organizations/repository';
import { createEmbeddingProvider } from './semantic/embedding/embeddingProvider';
import { loadEmbeddingConfig } from './semantic/embedding/embeddingConfig';
import { QdrantVectorStore } from './semantic/qdrant/qdrantVectorStore';
import { loadQdrantConfig } from './semantic/qdrant/qdrantConfig';
import { createPgEmbeddingStateRepository } from './semantic/pipeline/embeddingStateRepository';
import { createSemanticRouter } from './semantic/api/semanticRouter';
import { createBackfillRouter } from './semantic/api/backfillRouter';
import { createDevicesRouter } from './devices/router';
import { createPgDeviceRepository } from './devices/repository';
import { createBillingRouter } from './billing/router';
import { createBillingWebhookHandler } from './billing/webhookHandler';
import { createLicenseRouter } from './license/router';
import { razorpayGateway } from './billing/razorpayGateway';
import { createPgSubscriptionRepository } from './subscriptions/repository';
import { createSyncRouter } from './sync/router';
import { createPgSyncRepository } from './sync/repository';
import { requireAuth } from './auth/requireAuth';
import { createAccountRouter } from './auth/accountRouter';
import { createPgAuthAccountRepo } from './auth/accountRepository';
import { createLoggingMailer } from './auth/mailer';
import { hashPassword } from './auth/passwords';
import { rateLimit } from './middleware/rateLimit';
import { env } from './config/env';
import { pingDatabase, pool } from './db/pool';
import { pingRedis } from './cache/redis';
import { recordHttpRequest, renderMetrics } from './observability/metrics';
import { reportHealthSnapshot } from './observability/healthAlerts';

export function createApp(): Express {
  const app = express();

  // The desktop client talks from loopback origins (and from the main process
  // with no Origin header). Lock CORS to localhost during development.
  app.use(
    cors({
      origin: [/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/],
      credentials: false,
    }),
  );
  app.use(helmet());
  // The Razorpay webhook needs the exact raw body for signature verification, so
  // it is mounted before the JSON parser with a raw body parser.
  app.post(
    '/billing/webhook',
    express.raw({ type: '*/*', limit: '1mb' }),
    createBillingWebhookHandler({
      subscriptions: createPgSubscriptionRepository(),
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? null,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' })); // Apple form_post
  app.use(requestId);
  app.use(
    pinoHttp({
      logger: logger as unknown as Options['logger'],
      genReqId: (req) => (req as { id?: string }).id ?? 'unknown',
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  // Count real HTTP requests for /metrics (ops probes excluded to avoid self-noise).
  app.use((req, res, next) => {
    if (req.path !== '/metrics' && req.path !== '/health' && req.path !== '/live') {
      res.on('finish', () => recordHttpRequest(req.method, res.statusCode));
    }
    next();
  });

  // Liveness: is the process up? No dependency checks, so an orchestrator won't
  // restart the container for a transient database/redis blip. Use /health for
  // readiness (it checks dependencies).
  app.get('/live', (_req, res) => {
    res.json({ status: 'alive', uptime: process.uptime() });
  });

  app.get('/health', async (_req, res) => {
    const [db, cache] = await Promise.all([pingDatabase(), pingRedis()]);
    // TD-6: turn the polled dependency states into edge-triggered alerts
    // (fires only when a component transitions up<->down, not on every poll).
    reportHealthSnapshot({ database: db ? 'up' : 'down', redis: cache ? 'up' : 'down' });
    const healthy = db && cache;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      components: { database: db ? 'up' : 'down', redis: cache ? 'up' : 'down' },
      uptime: process.uptime(),
    });
  });

  // Prometheus metrics exposition (aggregate, non-sensitive). Network-restrict in prod.
  app.get('/metrics', (_req, res) => {
    res
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(renderMetrics({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
  });

  app.use('/auth', createAuthRouter());
  // Account flows: protect verification-request, rate-limit reset-request.
  app.use('/auth/request-verification', requireAuth);
  app.use(
    '/auth/request-password-reset',
    rateLimit({ bucket: 'password_reset', windowSeconds: 3600, max: 5 }),
  );
  app.use(
    '/auth',
    createAccountRouter({
      repo: createPgAuthAccountRepo(),
      mailer: createLoggingMailer(logger),
      hashPassword,
      appUrl: env.PUBLIC_BACKEND_URL,
    }),
  );
  app.use('/store', createStoreRouter());
  const orgRepo = createPgOrgRepository();
  const getMemberRole = async (orgId: string, userId: string) => {
    const m = await orgRepo.getMembershipByOrgUser(orgId, userId);
    return m && m.status === 'active' ? m.role : null;
  };
  app.use('/organizations', requireAuth, createOrganizationsRouter(orgRepo));
  app.use(
    '/devices',
    requireAuth,
    createDevicesRouter({ repo: createPgDeviceRepository(), getMemberRole }),
  );
  const subscriptionRepo = createPgSubscriptionRepository();
  app.use(
    '/billing',
    requireAuth,
    createBillingRouter({
      subscriptions: subscriptionRepo,
      gateway: razorpayGateway,
      getMemberRole,
    }),
  );
  app.use(
    '/license',
    requireAuth,
    createLicenseRouter({ subscriptions: subscriptionRepo, getMemberRole }),
  );
  app.use(
    '/sync',
    requireAuth,
    createSyncRouter({ repo: createPgSyncRepository(), getMemberRole }),
  );

  // ── V8.2 semantic memory: search + backfill (backend embeds; desktop never hits Qdrant) ──
  const embeddingProvider = createEmbeddingProvider(loadEmbeddingConfig(process.env), {
    fetchFn: (url, init) => fetch(url, init),
  });
  const vectorStore = new QdrantVectorStore(loadQdrantConfig(process.env), (url, init) => fetch(url, init));
  const embeddingStateRepo = createPgEmbeddingStateRepository();
  app.use(
    '/memory/semantic',
    requireAuth,
    createSemanticRouter({ embeddingProvider, vectorStore, getMemberRole }),
  );
  app.use(
    '/memory/semantic',
    requireAuth,
    createBackfillRouter({ embeddingProvider, vectorStore, stateRepo: embeddingStateRepo, getMemberRole }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
