/**
 * Automation run-history store (V4.7) — a bounded in-memory ring of recent run
 * records, plus a derived monitor snapshot. In-memory by design (runs are
 * high-frequency and ephemeral); the durable per-rule outcome lives on the rule's
 * lastRun via AutomationStore.recordRun. Pure + testable.
 */
import type { AutomationMonitor, AutomationRunRecord, TenantScope } from '@neuropause/shared';
import { TenantOwnership } from '../tenancy/tenantOwnedStore';

const MAX_HISTORY = 200;

/** A run record with the owner this store adds. */
type OwnedRun = AutomationRunRecord & { tenantId?: string };

export class AutomationRunHistory {
  /**
   * P13C ROUND 8 — FINDING 1. THE RECORD ITSELF HAS AN OWNER NOW.
   *
   * `AutomationRunRecord` had no tenant field, so `automation:history` returned
   * every organization's run history — `ruleName`, `triggeredBy`, the action
   * outcomes and the error text — on `operations:read`, while `AutomationList`
   * beside it was properly scoped. `monitor()` aggregated the same array.
   *
   * The round was explicit that a renderer-side or read-side filter is not the
   * fix: the persisted record must carry an authoritative boundary. So the owner
   * is stamped from the resolver at `add()`, and every read and the aggregate go
   * through `onlyMine`.
   */
  private readonly tenancy = new TenantOwnership('automation-run-history');

  /** Bind the tenant boundary. UNBOUND DENIES. Chainable. */
  bindScope(source: () => TenantScope | null): this {
    this.tenancy.bindScope(source);
    return this;
  }
  hasScope(): boolean {
    return this.tenancy.hasScope();
  }

  private records: OwnedRun[] = [];
  private paused = 0;

  /** Append a run record, evicting the OWNER'S oldest beyond the cap. */
  add(record: AutomationRunRecord): void {
    const owner = this.tenancy.scopeOrDeny()?.tenantId;
    this.records.unshift(owner === undefined ? record : { ...record, tenantId: owner });
    /**
     * PER TENANT. `slice(0, MAX_HISTORY)` was install-wide: one tenant's
     * automation volume pushed another tenant's runs out of the ring. Seventh
     * install-wide cap this program has found. A retention cap is a write —
     * in-memory here, so the loss is a view rather than durable data, and it is
     * still one tenant deciding what another can see.
     */
    const mine = this.records.filter((r) => r.tenantId === owner);
    if (mine.length > MAX_HISTORY) {
      const doomed = new Set(mine.slice(MAX_HISTORY));
      this.records = this.records.filter((r) => !doomed.has(r));
    }
  }

  /** The CALLER'S history, most-recent-first. Was every organization's. */
  list(limit = 50): AutomationRunRecord[] {
    return this.tenancy.onlyMine(this.records).slice(0, limit);
  }

  /** Let the monitor reflect how many rules are currently paused. */
  setPaused(count: number): void {
    this.paused = count;
  }

  /** Derived monitor snapshot for the Automations screen. Pure. */
  /**
   * The CALLER'S monitor snapshot.
   *
   * Scoped in the same commit as the listing. A count over a scoped collection
   * that is not itself scoped is the same query with the rows dropped — the
   * pattern behind five separate findings in this program.
   */
  monitor(): AutomationMonitor {
    const mine = this.tenancy.onlyMine(this.records);
    const completed = mine.filter((r) => r.ok).length;
    const failed = mine.filter((r) => !r.ok).length;
    const durations = mine.map((r) => r.durationMs);
    const averageRuntimeMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    return {
      running: 0, // runs are synchronous today; no long-running queue yet
      completed,
      failed,
      paused: this.paused,
      lastExecution: this.records[0]?.completedAt,
      averageRuntimeMs,
    };
  }
}
