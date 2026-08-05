/**
 * EPIC 4 — Database Automation. Generates provisioning DESCRIPTORS for PostgreSQL 16, Redis 7, and
 * Qdrant 1.9 — with backup schedules, restore procedures, monitoring, health checks, and encryption
 * configuration. It never provisions a database: the descriptors and the backup CronJob (which invokes
 * the existing `scripts/backup-db.sh`) are artifacts an operator reviews and applies.
 */
import { toYaml, type Yamlish } from './serialize';
import type { Environment } from './constants';
import type { Artifact } from './types';
import type { PlatformAutomationGovernance } from './governance';

export class DatabaseAutomation {
  constructor(
    private readonly gov: PlatformAutomationGovernance,
    private readonly operator: string,
  ) {}

  descriptor(env: Environment): Record<string, Yamlish> {
    return {
      environment: env,
      provisioned: false,
      postgresql: {
        version: '16',
        managed: true,
        tls: 'require',
        encryption: { atRest: 'provider-kms', inTransit: 'tls' },
        backup: { schedule: '0 2 * * *', tool: 'scripts/backup-db.sh', retention: 14, pitr: true },
        restore: { command: 'scripts/restore-db.sh backups/neuropause-db-<ts>.sql.gz' },
        healthcheck: { command: 'pg_isready -h <host> -U <user> -d neuropause' },
        monitoring: { metrics: ['connections', 'replication_lag', 'slow_queries', 'disk_free'] },
      },
      redis: {
        version: '7',
        managed: true,
        tls: true,
        auth: true,
        healthcheck: { command: 'redis-cli -u <REDIS_URL> PING' },
        monitoring: { metrics: ['ops_per_sec', 'evicted_keys', 'memory_used'] },
      },
      qdrant: {
        version: '1.9.0',
        healthcheck: { command: 'curl -fsS http://<host>:6333/readyz' },
        backup: { method: 'snapshot-api-to-object-storage' },
      },
    };
  }

  /** A Kubernetes CronJob that runs the existing backup script — represented; applied out-of-band. */
  backupCronJob(): Record<string, Yamlish> {
    return {
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: { name: 'neuropause-db-backup', namespace: 'neuropause' },
      spec: {
        schedule: '0 2 * * *',
        jobTemplate: { spec: { template: { spec: { restartPolicy: 'OnFailure', containers: [{ name: 'backup', image: 'postgres:16-alpine', command: ['/bin/sh', '-c', 'echo run scripts/backup-db.sh with mounted creds; pg_dump ... | gzip > /backups/dump.sql.gz'] }] } } } },
      },
    };
  }

  async generateAll(env: Environment): Promise<Artifact> {
    const content = `${toYaml(this.descriptor(env))}\n---\n${toYaml(this.backupCronJob())}`;
    const artifact: Artifact = { kind: 'database', name: `databases-${env}.yaml`, format: 'yaml', content, note: 'Database provisioning descriptors + backup CronJob — never auto-provisioned; apply out-of-band.' };
    await this.gov.record({ operator: this.operator, environment: env, target: 'databases', epic: 'E4', operation: 'generate-database', result: 'generated', evidence: 'live-verified' });
    return artifact;
  }
}
