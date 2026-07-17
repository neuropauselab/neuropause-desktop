/**
 * Capability Completion v1.0 — registry tests. The registry is the SINGLE SOURCE OF TRUTH, so these lock:
 * every capability has exactly one valid state, ids are unique, not-yet-real capabilities carry an honest
 * reason (so the derived Settings inventory is never blank), maturity math is coherent, and the two recon
 * corrections (infrastructure discovery = managed; notification prefs = needs-ipc) are recorded truthfully.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_REGISTRY,
  HIDDEN_STATES,
  REAL_STATES,
  capabilitiesByState,
  computeMaturity,
  isReal,
  type CapabilityState,
} from './capabilityRegistry';
import { CAPABILITY_INVENTORY } from '@renderer/settings/settingsCatalog';

const ALL_STATES: CapabilityState[] = [
  'production-complete', 'managed', 'read-only', 'needs-ipc', 'needs-adapter', 'needs-backend', 'hidden', 'future-release', 'deprecated', 'removed',
];

describe('registry integrity — exactly one valid state, unique ids', () => {
  it('every capability has a valid state, a unique id, a runtime, and a label', () => {
    const ids = new Set<string>();
    for (const c of CAPABILITY_REGISTRY) {
      expect(ALL_STATES).toContain(c.state);
      expect(c.id.length).toBeGreaterThan(0);
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.runtime.length).toBeGreaterThan(0);
    }
  });

  it('REAL_STATES and HIDDEN_STATES partition the state space', () => {
    for (const s of ALL_STATES) {
      const real = REAL_STATES.includes(s);
      const hidden = HIDDEN_STATES.includes(s);
      expect(real !== hidden).toBe(true); // exactly one
    }
  });

  it('every not-yet-real capability carries an honest reason (no blank inventory rows)', () => {
    for (const c of CAPABILITY_REGISTRY) {
      if (!isReal(c)) expect((c.note ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('recon corrections are recorded truthfully', () => {
  it('infrastructure discovery is MANAGED (real, credential-gated) — not "unavailable"', () => {
    const infra = CAPABILITY_REGISTRY.find((c) => c.id === 'system.infrastructure')!;
    expect(infra.state).toBe('managed');
  });

  it('notification preferences are needs-ipc (backing exists, not surfaced) — not "no store exists"', () => {
    const notif = CAPABILITY_REGISTRY.find((c) => c.id === 'workspace.notification-prefs')!;
    expect(notif.state).toBe('needs-ipc');
    expect(notif.note?.toLowerCase()).toMatch(/exists/);
  });

  it('connectors: 13 real are production-complete; the 9 adapterless are preview/needs-adapter', () => {
    expect(CAPABILITY_REGISTRY.find((c) => c.id === 'integrations.connectors')!.state).toBe('production-complete');
    const preview = CAPABILITY_REGISTRY.find((c) => c.id === 'integrations.preview-connectors')!;
    expect(preview.state).toBe('needs-adapter');
    expect(preview.note).toMatch(/Preview/);
  });
});

describe('maturity math', () => {
  it('partitions total into real + hidden with coherent percentages', () => {
    const m = computeMaturity();
    expect(m.total).toBe(CAPABILITY_REGISTRY.length);
    expect(m.real + m.hidden).toBe(m.total);
    expect(m.real).toBe(m.productionComplete + m.managed + capabilitiesByState('read-only').length);
    expect(m.maturityPct).toBe(Math.round((m.real / m.total) * 100));
    expect(m.completionPct).toBeLessThanOrEqual(m.maturityPct);
    expect(m.maturityPct).toBeGreaterThan(0);
  });
});

describe('the Settings inventory derives from the registry (single source of truth)', () => {
  it('every inventory row corresponds to a non-production registry capability, with a reason', () => {
    const nonProd = CAPABILITY_REGISTRY.filter((c) => c.state !== 'production-complete');
    expect(CAPABILITY_INVENTORY.length).toBe(nonProd.length);
    for (const row of CAPABILITY_INVENTORY) {
      expect(row.reason.length).toBeGreaterThan(0);
      expect(['managed', 'unavailable']).toContain(row.state);
    }
    // managed inventory rows map to registry managed/read-only; unavailable rows map to the rest.
    const managedCount = CAPABILITY_INVENTORY.filter((r) => r.state === 'managed').length;
    const registryManagedish = CAPABILITY_REGISTRY.filter((c) => c.state === 'managed' || c.state === 'read-only').length;
    expect(managedCount).toBe(registryManagedish);
  });
});
