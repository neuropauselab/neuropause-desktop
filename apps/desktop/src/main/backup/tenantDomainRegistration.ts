/**
 * THE F22 REGISTRY, ACTUALLY POPULATED. P13C FINAL CERTIFICATION.
 *
 * WHAT THIS FILE EXISTS TO FIX
 *
 * `registerTenantDomainSource()` had ZERO production call sites. Six adapter
 * factories were written across Rounds 15–17 — `executiveDecisionsSource`,
 * `automationRulesSource`, `healthHistorySource`, `workforceJobsSource`,
 * `companionDevicesSource`, `tenantAiPreferenceSource` — and not one of them was
 * ever called outside a test. In the running application the source map was
 * empty, so `registeredTenantDomains()` returned `[]`, every one of the 19
 * domains was `uncovered`, and a tenant archive would have contained nothing.
 *
 * Reports described this as "F22 5/19" and then "6/19", counting adapters that
 * EXISTED. Coverage is not whether an adapter was written; it is whether the
 * archive can reach the data. By that measure production coverage was 0/19.
 *
 * This is the third registry in this programme found shipping empty — after the
 * channel→store registry (empty from Round 13 until Round 17) and the startup
 * gates that ran above the code that binds. The shape repeats: a registry, a
 * population step nobody wrote, and a count that measured the wrong noun.
 *
 * WHY THE SPLIT
 *
 * `buildTenantDomainSources()` is pure and takes its stores as arguments, so the
 * gate test can assert the full set without an Electron runtime. The wiring
 * function below imports the module-level singletons and is the only part that
 * needs `app.getPath`. The same separation `tenantAiPreferenceCompose.ts` needed
 * for exactly the same reason: the rule that cannot be imported cannot be tested.
 */
import type { TenantDomain, TenantDomainSource } from './tenantArchive';
import { registerTenantDomainSource } from './tenantArchive';
import {
  automationRulesSource,
  companionDevicesSource,
  executiveDecisionsSource,
  healthHistorySource,
  tenantAiPreferenceSource,
  workforceJobsSource,
} from './tenantDomainSources';

/**
 * The six domains that have a working adapter today.
 *
 * Stated as a constant so the gate test asserts a NUMBER a human chose, not
 * whatever the code happens to produce. If a registration is deleted, the test
 * fails on the count before anyone has to notice the archive got quieter.
 */
export const REGISTERED_TENANT_DOMAINS: readonly TenantDomain[] = [
  'executive-decisions',
  'automation-rules',
  'enterprise-health-history',
  'workforce-jobs',
  'companion-device-registry',
  'tenant-ai-preference',
];

/* eslint-disable @typescript-eslint/no-explicit-any -- each store's row type is
 * private to its module; the adapters narrow via their own generic bounds, and
 * widening every store's public surface just to name the row here would be a
 * larger change than the wiring it serves. */
export interface TenantDomainStores {
  decisions: any;
  automations: any;
  healthHistory: any;
  workforceJobs: any;
  companionDevices: any;
  aiPreference: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Every source that can be built today, in a fixed order. Pure. */
export function buildTenantDomainSources(stores: TenantDomainStores): TenantDomainSource[] {
  return [
    executiveDecisionsSource(stores.decisions),
    automationRulesSource(stores.automations),
    healthHistorySource(stores.healthHistory),
    workforceJobsSource(stores.workforceJobs),
    companionDevicesSource(stores.companionDevices),
    tenantAiPreferenceSource(stores.aiPreference),
  ];
}

/**
 * Register every available source with the archive.
 *
 * Idempotent by construction — `registerTenantDomainSource` writes into a Map
 * keyed by domain, so a second call replaces rather than duplicates. Returns the
 * domains registered so the caller can log a number rather than assume one.
 */
export function registerTenantDomainSources(stores: TenantDomainStores): TenantDomain[] {
  const sources = buildTenantDomainSources(stores);
  for (const source of sources) registerTenantDomainSource(source);
  return sources.map((s) => s.domain);
}
