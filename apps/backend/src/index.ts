import 'dotenv/config';
import type { Server } from 'node:http';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { enabledProviderIds } from './auth/providers/registry';
import { logger } from './config/logger';
import { runMigrations } from './db/migrate';
import { seedStoreIfEmpty } from './db/seed';
import { closePool, pingDatabase } from './db/pool';
import { closeRedis } from './cache/redis';

async function main(): Promise<void> {
  const env = loadEnv();

  // Apply migrations on boot in dev; in production prefer an explicit step,
  // but running them here keeps a fresh checkout one command away.
  if (await pingDatabase()) {
    try {
      await runMigrations();
      await seedStoreIfEmpty();
    } catch (err) {
      logger.error({ err }, 'Migration on boot failed');
    }
  } else {
    logger.warn(
      'Database is not reachable. The API will start, but auth endpoints will fail until ' +
        'Postgres is up. Run `npm run infra:up` from the repo root.',
    );
  }

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(`NeuroPause backend listening on ${env.PUBLIC_BACKEND_URL} (port ${env.PORT})`);
    const oauthProviders = enabledProviderIds();
    logger.info(
      oauthProviders.length > 0
        ? `OAuth providers enabled: ${oauthProviders.join(', ')}`
        : 'OAuth providers enabled: none — set provider credentials (e.g. GOOGLE_CLIENT_ID/SECRET) to enable login',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await Promise.allSettled([closePool(), closeRedis()]);
      process.exit(0);
    });
    // Force-exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
