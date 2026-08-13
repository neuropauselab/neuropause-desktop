/**
 * F22 COVERAGE IS WHAT PRODUCTION REGISTERS, NOT WHAT SOMEBODY WROTE.
 * P13C FINAL CERTIFICATION.
 *
 * THE FINDING THIS FILE EXISTS FOR
 *
 * Rounds 15, 16 and 17 reported F22 coverage as 3/18, then 5/18, then 5/19 and
 * 6/19, counting adapter FACTORIES that had been written. A census of the tree
 * during final certification found that `registerTenantDomainSource()` — the
 * only way a source reaches the archive — had **zero production call sites**.
 * All six factories were called exclusively from tests. Two of them
 * (`healthHistorySource`, `tenantAiPreferenceSource`) had no call site anywhere.
 *
 * In the shipped application the source map was therefore empty:
 * `registeredTenantDomains()` returned `[]`, `tenantArchiveCoverageGaps()`
 * returned all 19, and a tenant archive would have contained no domains at all.
 * Real production coverage was **0/19** while the reports said 6/19.
 *
 * This is the third registry in this programme discovered shipping empty, after
 * the channel→store registry (Round 13 to Round 17) and the startup gates that
 * ran above the code that binds them. The failure is always the same: a registry
 * exists, a population step is never written, and a count measures the wrong noun.
 *
 * WHAT THIS TEST LOCKS
 *
 * It asserts the SET the composition root registers, using the pure builder so
 * no Electron runtime is needed. It cannot prove the running app called the
 * wiring function — `runtimeCore.ts` needs Electron — so the boot log line
 * `Tenant archive sources registered { domains, uncovered }` is the runtime
 * evidence for that half, and it is deliberately a log rather than an inference.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TENANT_DERIVED_DOMAINS,
  __resetTenantDomainSourcesForTests,
  registeredTenantDomains,
  tenantArchiveCoverageGaps,
} from '../backup/tenantArchive';
import {
  REGISTERED_TENANT_DOMAINS,
  buildTenantDomainSources,
  registerTenantDomainSources,
} from '../backup/tenantDomainRegistration';

/** Minimal stand-ins: the registration path never reads them, only wraps them. */
const stubStore = {
  snapshotForGrant: () => [],
  mergeForGrant: async () => 0,
};
const stores = {
  decisions: stubStore,
  automations: stubStore,
  healthHistory: stubStore,
  workforceJobs: { snapshotForGrant: async () => [], mergeForGrant: async () => 0 },
  companionDevices: { snapshotForGrant: async () => [], mergeForGrant: async () => 0 },
  aiPreference: stubStore,
};

beforeEach(() => __resetTenantDomainSourcesForTests());
afterEach(() => __resetTenantDomainSourcesForTests());

describe('F22 — production archive coverage', () => {
  it('registers exactly the six domains that have a working adapter', () => {
    const registered = registerTenantDomainSources(stores);
    expect([...registered].sort()).toEqual([...REGISTERED_TENANT_DOMAINS].sort());
    expect(registeredTenantDomains().sort()).toEqual([...REGISTERED_TENANT_DOMAINS].sort());
  });

  it('every registered domain is a real member of the denominator', () => {
    // A source for a domain not in TENANT_DERIVED_DOMAINS would inflate coverage
    // with something the archive does not owe.
    for (const domain of REGISTERED_TENANT_DOMAINS) {
      expect(
        TENANT_DERIVED_DOMAINS as readonly string[],
        `${domain} is registered but is not a tenant-derived domain`,
      ).toContain(domain);
    }
  });

  it('reports the REMAINING gap honestly — 13 of 19 still uncovered', () => {
    registerTenantDomainSources(stores);
    const gaps = tenantArchiveCoverageGaps();
    expect(gaps.length).toBe(TENANT_DERIVED_DOMAINS.length - REGISTERED_TENANT_DOMAINS.length);
    expect(gaps.length).toBe(13);
    // The gap list must not contain anything we just registered.
    for (const domain of REGISTERED_TENANT_DOMAINS) expect(gaps).not.toContain(domain);
  });

  it('is 0/19 before registration — the state the application actually shipped in', () => {
    // The negative control for the finding itself. Without the wiring added at
    // the composition root, this is what every install had.
    expect(registeredTenantDomains()).toEqual([]);
    expect(tenantArchiveCoverageGaps()).toHaveLength(19);
  });

  it('is idempotent — a second registration replaces rather than duplicates', () => {
    registerTenantDomainSources(stores);
    registerTenantDomainSources(stores);
    expect(registeredTenantDomains()).toHaveLength(REGISTERED_TENANT_DOMAINS.length);
  });

  it('builds one source per registered domain, with matching storeName', () => {
    const sources = buildTenantDomainSources(stores);
    expect(sources).toHaveLength(REGISTERED_TENANT_DOMAINS.length);
    for (const s of sources) {
      expect(typeof s.ownerOf).toBe('function');
      expect(typeof s.snapshot).toBe('function');
      expect(typeof s.merge).toBe('function');
      expect(s.storeName.length).toBeGreaterThan(0);
    }
  });
});
