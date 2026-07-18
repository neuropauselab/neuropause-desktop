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

  // Apply migrations on boot for single-instance / compose deploys. In a
  // multi-replica orchestrator (k8s), set RUN_MIGRATIONS_ON_BOOT=false and run
  // the one-off migrate Job instead so replicas don't race on migration.
  if (!env.RUN_MIGRATIONS_ON_BOOT) {
    logger.info(
      'RUN_MIGRATIONS_ON_BOOT=false — skipping boot migrations (run them as a separate step, e.g. the k8s migrate Job)',
    );
  } else if (await pingDatabase()) {
    try {
      await runMigrations();
      if (env.SEED_STORE_ON_BOOT) {
        await seedStoreIfEmpty();
      } else {
        logger.info('SEED_STORE_ON_BOOT=false — starting with an empty store catalog (no demo seed)');
      }
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
