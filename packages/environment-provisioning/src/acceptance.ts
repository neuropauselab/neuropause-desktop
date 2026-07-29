/**
 * EPIC 9 — Acceptance Validation. Produces a machine-readable acceptance report over API health,
 * database health, Redis, Kubernetes health, TLS, identity, monitoring, logging, and backup verification.
 * With no real infrastructure, every check is `pending` and carries the command that would verify it — no
 * pass is fabricated. It reuses the Program 1B validation runtime when wired in.
 */
import { ACCEPTANCE_CHECKS, type AcceptanceCheck } from './constants';
import type { EpContext } from './types';
import type { EnvironmentProvisioningGovernance } from './governance';

const ACCEPTANCE_COMMANDS: Record<AcceptanceCheck, string> = {
  'api-health': 'curl -fsSI https://api.<domain>/metrics',
  'database-health': 'pg_isready -h <host> -U <user> -d neuropause',
  redis: 'redis-cli -u <REDIS_URL> PING',
  'kubernetes-health': 'kubectl -n neuropause rollout status deploy/neuropause-backend',
  tls: 'openssl s_client -connect api.<domain>:443 | openssl x509 -noout -dates',
  identity: 'register + email/password login; each configured OAuth provider end-to-end',
  monitoring: 'prometheus target up{job="neuropause-backend"} == 1',
  logging: 'query the central log store for a fresh x-request-id',
  'backup-verification': 'scripts/backup-db.sh && gzip -t backups/*.sql.gz',
};

export interface AcceptanceReport {
  appliedToInfrastructure: false;
  reusedAutomation: boolean;
  checks: Array<{ check: AcceptanceCheck; status: 'pending'; command: string }>;
  json: string;
}

export class AcceptanceValidator {
  constructor(
    private readonly ctx: EpContext,
    private readonly gov: EnvironmentProvisioningGovernance,
    private readonly operator: string,
  ) {}

  checks(): readonly AcceptanceCheck[] {
    return ACCEPTANCE_CHECKS;
  }

  async report(): Promise<AcceptanceReport> {
    const checks = ACCEPTANCE_CHECKS.map((check) => ({ check, status: 'pending' as const, command: ACCEPTANCE_COMMANDS[check] }));
    const report: AcceptanceReport = {
      appliedToInfrastructure: false,
      reusedAutomation: Boolean(this.ctx.platformAutomation),
      checks,
      json: JSON.stringify({ appliedToInfrastructure: false, checks }, null, 2),
    };
    await this.gov.record({ operator: this.operator, environment: 'production', target: 'acceptance', epic: 'E9', operation: 'acceptance-report', result: 'pending', evidence: 'business-data-pending' });
    return report;
  }
}
