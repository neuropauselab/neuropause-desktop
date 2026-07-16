/**
 * P13 — Industry Solution Platform service tests: composition, snapshot + projection memoization,
 * and invalidation.
 */
import { describe, expect, it } from 'vitest';
import { IndustryPlatformService } from './industryService';
import type { IndustryPlatformState } from './industryModel';

function baseState(over: Partial<IndustryPlatformState> = {}): IndustryPlatformState {
  return {
    workerIds: ['worker:finance', 'worker:operations', 'worker:procurement'],
    supportedConnectorIds: ['sap', 'oracle', 'servicenow'],
    connectedConnectorIds: ['sap'],
    connectorLabels: { sap: 'SAP S/4HANA', oracle: 'Oracle Fusion Cloud ERP', servicenow: 'ServiceNow' },
    complianceRules: [
      { id: 'rule-audit', enabled: true },
      { id: 'rule-side-effects', enabled: true },
      { id: 'rule-chain', enabled: true },
    ],
    policyIds: ['pol:read-allow', 'pol:external-approval', 'pol:high-risk-approval', 'pol:write-trust'],
    publishedSlugs: ['soc2-governance-pack', 'markdown-export-plugin', 'inbox-to-notion-automation', 'research-analyst-worker', 'github-connector'],
    ...over,
  };
}

describe('IndustryPlatformService', () => {
  it('composes every projection from the injected reader', () => {
    const svc = new IndustryPlatformService({ readState: () => baseState() });
    expect(svc.overview().summary.totalSuites).toBe(12);
    expect(svc.suites()).toHaveLength(12);
    expect(svc.kpis().length).toBeGreaterThan(0);
    expect(svc.compliance().totalFrameworks).toBeGreaterThan(0);
    expect(svc.collections()).toHaveLength(12);
    expect(svc.readiness().entries).toHaveLength(12);
  });

  it('memoizes the snapshot + projections and recomposes only after invalidate()', () => {
    const box = { value: baseState() };
    let reads = 0;
    const svc = new IndustryPlatformService({
      readState: () => {
        reads += 1;
        return box.value;
      },
    });
    const c1 = svc.suites();
    expect(svc.suites()).toBe(c1); // same reference → O(1) cache hit
    expect(svc.collections()).toBe(svc.collections());
    expect(reads).toBe(1); // one composition across all reads

    box.value = baseState({ connectedConnectorIds: ['sap', 'oracle', 'servicenow'] });
    expect(svc.suites()).toBe(c1); // still cached
    svc.invalidate();
    expect(svc.suites()).not.toBe(c1); // recomposed
    expect(reads).toBe(2);
  });
});
