/**
 * Product Integrity v1.0 — federation authenticity guardrails. With demo seeds OFF (production default), the
 * federation stores must be empty of fabricated activity: no fake peer orgs, exchange artifacts with invented
 * install/rating counts, usage history, named security events, DR metrics, audit entries, or pending
 * approvals. Legitimate CONFIG (governance policies, continuity targets) is retained.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FederationRuntimeStore } from './runtime/fedStore';
import { ExchangeStore } from './exchange/exchangeStore';
import { ObservabilityStore } from './observability/observabilityStore';
import { DrStore } from './dr/drStore';
import { GlobalGovStore } from './governance/globalGovStore';

beforeAll(() => { delete process.env.NP_DEMO_SEEDS; });

const tmp = (name: string): string => join(tmpdir(), `np-prod-${randomUUID()}-${name}`);

describe('federation stores — production seed (no demo data)', () => {
  it('FederationRuntimeStore has NO peer orgs (no fabricated topology)', async () => {
    const s = new FederationRuntimeStore(tmp('fed.json'), 'org-x', 'Acme');
    await s.load();
    expect(s.peers()).toHaveLength(0);
    expect(s.summary().peers).toBe(0);
  });

  it('ExchangeStore has NO seeded artifacts (no invented install/rating counts)', async () => {
    const s = new ExchangeStore(tmp('exchange.json'));
    await s.load();
    expect(s.listArtifacts()).toHaveLength(0);
  });

  it('ObservabilityStore has NO fabricated usage history or named security events', async () => {
    const s = new ObservabilityStore(tmp('obs.json'));
    await s.load();
    expect(s.usageSeries()).toHaveLength(0);
    expect(s.securityEvents()).toHaveLength(0);
  });

  it('DrStore has NO fabricated backups/replicas/validations and does not claim HA by default', async () => {
    const s = new DrStore(tmp('dr.json'));
    await s.load();
    expect(s.listBackups()).toHaveLength(0);
    expect(s.listValidations()).toHaveLength(0);
    expect(s.continuity().haEnabled).toBe(false); // no false HA/multi-region capability claim
    expect(s.continuity().multiRegion).toBe(false);
  });

  it('GlobalGovStore keeps policy definitions but has an empty audit trail + no pending approvals', async () => {
    const s = new GlobalGovStore(tmp('gov.json'), 'org-x', 'Acme');
    await s.load();
    expect(s.listPolicies().length).toBeGreaterThan(0); // real config, kept
    expect(s.listAudit()).toHaveLength(0); // no fabricated audit entry
    expect(s.listApprovals()).toHaveLength(0); // no fabricated pending approval
  });
});
