/**
 * THE STRUCTURAL GATE — the test that matters more than any individual finding.
 *
 * Four security sweeps found the same defect in four different subsystems, and
 * each found it because somebody happened to walk that code. That approach
 * cannot converge: the risk was never in the audited files.
 *
 * `assertAllTenantStoresBound()` inverts it. A tenant-sensitive store registers
 * at construction; the composition root asserts at startup that every one has a
 * boundary. This suite tests the REGISTRY, not any particular store — so it
 * keeps protecting subsystems that do not exist yet.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertAllTenantStoresBound,
  resetTenantStoreRegistryForTests,
  tenantStoreRegistrations,
  TenantOwnership,
} from './tenantOwnedStore';
import { TEST_TENANT_SCOPE, OTHER_TENANT_SCOPE } from './testScope';

beforeEach(() => resetTenantStoreRegistryForTests());
afterEach(() => resetTenantStoreRegistryForTests());

describe('an unscoped tenant store cannot ship', () => {
  it('BOOT FAILS when a registered store was never bound', () => {
    new TenantOwnership('legacy-widget-store');
    expect(() => assertAllTenantStoresBound()).toThrow(/legacy-widget-store/);
  });

  it('BOOT SUCCEEDS once it is bound', () => {
    const t = new TenantOwnership('legacy-widget-store');
    t.bindScope(() => TEST_TENANT_SCOPE);
    expect(() => assertAllTenantStoresBound()).not.toThrow();
  });

  it('names EVERY unbound store, so one fix does not hide the next', () => {
    new TenantOwnership('store-a');
    new TenantOwnership('store-b');
    new TenantOwnership('store-c').bindScope(() => TEST_TENANT_SCOPE);

    try {
      assertAllTenantStoresBound();
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('store-a');
      expect(msg).toContain('store-b');
      expect(msg).not.toContain('store-c');
    }
  });

  /**
   * A system-global store is a CLAIM somebody wrote down, not an omission
   * nobody noticed — which is precisely the difference that let four sweeps
   * each miss a subsystem.
   */
  it('a SYSTEM-GLOBAL store passes, but only with a stated reason', () => {
    const t = new TenantOwnership('app-update-catalogue');
    t.declareSystemGlobal('Product release metadata; identical for every customer.');
    expect(() => assertAllTenantStoresBound()).not.toThrow();

    const row = tenantStoreRegistrations().find((r) => r.name === 'app-update-catalogue');
    expect(row?.classification).toBe('system-global');
    expect(row?.reason).toMatch(/every customer/);
  });

  it('refuses a system-global declaration with no reason', () => {
    const t = new TenantOwnership('mystery-store');
    expect(() => t.declareSystemGlobal('   ')).toThrow(/state its reason/);
  });

  it('the registry reports what is bound, for the startup report', () => {
    new TenantOwnership('bound-one').bindScope(() => TEST_TENANT_SCOPE);
    new TenantOwnership('unbound-one');
    const rows = tenantStoreRegistrations();
    expect(rows.find((r) => r.name === 'bound-one')?.bound).toBe(true);
    expect(rows.find((r) => r.name === 'unbound-one')?.bound).toBe(false);
  });
});

describe('the seam itself denies before it permits', () => {
  it('UNBOUND reads nothing and writes nothing', () => {
    const t = new TenantOwnership('x');
    expect(t.onlyMine([{ tenantId: 'org-a' }])).toEqual([]);
    expect(t.mine({ tenantId: 'org-a' })).toBe(false);
    expect(() => t.requireTenant()).toThrow(/no owner/i);
  });

  it('an UNRESOLVED scope reads nothing and writes nothing', () => {
    const t = new TenantOwnership('x').bindScope(() => null);
    expect(t.onlyMine([{ tenantId: 'org-a' }])).toEqual([]);
    expect(() => t.requireTenant()).toThrow(/no owner/i);
  });

  it('an UNOWNED record belongs to nobody, not to the reader', () => {
    const t = new TenantOwnership('x').bindScope(() => TEST_TENANT_SCOPE);
    expect(t.mine({})).toBe(false);
    expect(t.mine({ tenantId: null })).toBe(false);
    expect(t.mine({ tenantId: '' })).toBe(false);
    expect(t.onlyMine([{}, { tenantId: TEST_TENANT_SCOPE.tenantId }])).toHaveLength(1);
  });

  it('stamp takes the owner from the scope, never from the payload', () => {
    const t = new TenantOwnership('x').bindScope(() => TEST_TENANT_SCOPE);
    const stamped = t.stamp({ tenantId: OTHER_TENANT_SCOPE.tenantId, v: 1 });
    expect(stamped.tenantId).toBe(TEST_TENANT_SCOPE.tenantId);
  });
});

describe('retention is per tenant', () => {
  /**
   * The install-wide cap was a finding in its own right and a sharper one than
   * it looks: the caps are deterministic and oldest-first, so a noisy tenant
   * does not merely consume capacity — it CHOOSES which of another tenant's
   * records is destroyed.
   */
  it('a noisy tenant cannot evict the other tenant’s rows', () => {
    const t = new TenantOwnership('x').bindScope(() => TEST_TENANT_SCOPE);
    const rows = [
      { tenantId: OTHER_TENANT_SCOPE.tenantId, id: 'b-old', at: 1 },
      { tenantId: TEST_TENANT_SCOPE.tenantId, id: 'a-1', at: 2 },
      { tenantId: TEST_TENANT_SCOPE.tenantId, id: 'a-2', at: 3 },
      { tenantId: TEST_TENANT_SCOPE.tenantId, id: 'a-3', at: 4 },
    ];
    // A exceeds a cap of 2. B's row is the OLDEST overall — install-wide
    // pruning would have taken it first.
    const kept = t.pruneOwn(rows, 2, (x, y) => x.at - y.at);

    expect(kept.some((r) => r.id === 'b-old')).toBe(true);
    expect(kept.filter((r) => r.tenantId === TEST_TENANT_SCOPE.tenantId)).toHaveLength(2);
    expect(kept.some((r) => r.id === 'a-1')).toBe(false); // A's own oldest went
  });

  it('leaves everything alone when the caller is under the cap', () => {
    const t = new TenantOwnership('x').bindScope(() => TEST_TENANT_SCOPE);
    const rows = [{ tenantId: TEST_TENANT_SCOPE.tenantId, at: 1 }];
    expect(t.pruneOwn(rows, 10, (a, b) => a.at - b.at)).toHaveLength(1);
  });

  it('an unresolved caller prunes NOTHING rather than everything', () => {
    const t = new TenantOwnership('x').bindScope(() => null);
    const rows = [{ tenantId: 'org-a', at: 1 }, { tenantId: 'org-a', at: 2 }];
    expect(t.pruneOwn(rows, 1, (a, b) => a.at - b.at)).toHaveLength(2);
  });
});
