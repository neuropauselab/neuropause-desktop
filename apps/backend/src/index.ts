import 'dotenv/config';
import type { Server } from 'node:http';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { enabledProviderIds } from './auth/providers/registry';
import { logger } from './config/logger';
import { runMigrations } from './db/migrate';
import { assertRuntimeSecurityContract } from './pilot/securityContract';
import { pilotPool } from './db/pilotPool';
import { pilotGovernancePool, pilotGovernanceWriterConfigured } from './db/pilotGovernancePool';
import { seedStoreIfEmpty } from './db/seed';
import { closePool, pingDatabase } from './db/pool';
import { closeRedis } from './cache/redis';
import { installWebhookAlertSink } from './observability/alertWebhookSink';

async function main(): Promise<void> {
  const env = loadEnv();

  // Optional operational alerting: route dependency health transitions to an
  // external webhook when ALERT_WEBHOOK_URL is set (no-op otherwise). Registered
  // before the server accepts traffic so the first /health poll is covered.
  installWebhookAlertSink();

  /*
   * D-034-3 — RUNTIME DATABASE SECURITY CONTRACT SELF-CHECK, AT STARTUP, BEFORE TRAFFIC.
   *
   * Runs only when the pilot module is enabled, by the same literal-'true' rule the mount gate
   * uses: a product-only boot declares no pilot configuration and must start unaffected.
   *
   * FAIL CLOSED: `assertRuntimeSecurityContract` THROWS, main() has no catch around this, so an
   * invalid contract means the process does not reach app.listen. That is deliberate — D-034-3
   * requires the check to fail closed, and there is no caller at boot to hand a refusal to.
   * A deployment whose runtime credential can still write governance state does not serve.
   *
   * It grants nothing and repairs nothing: every statement is a catalog read, and a wrong
   * contract is reported rather than fixed, because granting or revoking is a human act.
   */
  if (process.env.PILOT_MODULE_ENABLED?.trim() === 'true') {
    const writer = pilotGovernanceWriterConfigured() ? pilotGovernancePool() : null;
    const roles = await assertRuntimeSecurityContract(pilotPool(), writer);
    logger.info(
      { runtimeRole: roles.runtimeRole, governanceWriterRole: roles.writerRole },
      'pilot runtime database security contract verified',
    );
  }

  // Apply migrations on boot for single-instance / compose deploys. In a
  // multi-replica orchestrator (k8s), set RUN_MIGRATIONS_ON_BOOT=false and run
  // the one-off migrate Job instead so replicas don't race on migration.
  if (!env.RUN_MIGRATIONS_ON_BOOT) {
    logger.info(
      'RUN_MIGRATIONS_ON_BOOT=false — skipping boot migrations (run them as a separate step, e.g. the k8s migrate Job)',
    );
  } else if (await pingDatabase()) {
    try {
      /*
       * ENV04-B — BOOT MIGRATES THE PRODUCT STORE ONLY, AND SAYS SO.
       *
       * The target is explicit rather than defaulted, because "whatever runMigrations does" is
       * how a boot path silently acquires a second responsibility. The pilot store is
       * provisioned deliberately (`tsx src/db/migrate.ts --target=PILOT`), never as a side
       * effect of starting the product: a boot that migrated PILOT_DATABASE_URL would create a
       * pilot schema on any host that happened to have the variable set.
       */
      await runMigrations({ target: 'PRODUCT' });
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
    // A process must not state something false about itself. This printed
    // `${env.PUBLIC_BACKEND_URL} (port ${env.PORT})`, and PUBLIC_BACKEND_URL is a
    // configured value that does NOT track PORT — so a run on 4010 announced
    // "listening on http://127.0.0.1:4000 (port 4010)". The bound address is a fact;
    // the public URL is a declaration. They are now labelled as what they are, and
    // the declaration is only printed when it actually disagrees.
    const bound = `http://127.0.0.1:${env.PORT}`;
    logger.info(`NeuroPause backend listening on ${bound}`);
    if (!env.PUBLIC_BACKEND_URL.startsWith(bound)) {
      logger.info(`Public URL (declared, not bound): ${env.PUBLIC_BACKEND_URL}`);
    }
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
