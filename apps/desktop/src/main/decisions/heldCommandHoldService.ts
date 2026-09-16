/**
 * ERP Session 44 — the HELD-COMMAND HOLD surfacing service.
 *
 * S40 made the ambiguous crash boundary fail-closed: a crash-orphaned governed command intent becomes a
 * durable HOLD in `DurableCommandJournal` so the command is NEVER silently re-executed. But that HOLD lived
 * only in the journal's `.intents.json`, invisible to the operator — a fail-closed guard nobody could act on.
 *
 * This service closes exactly that gap and NOTHING more. It is a thin MAPPER, mirroring the M365
 * OUTCOME_UNKNOWN producer (`runtimeCore` → `buildM365UnknownHoldInput` → `raiseHold`): once per operable
 * tenant, under that tenant's own principal, it reads the journal's held intents (read-only) and raises a
 * canonical HOLD through the EXISTING `raiseHold` seam into the EXISTING tenant-scoped `HoldStore`. From
 * there the operator sees it in the existing Hold Center and resolves it through the existing `HoldResolve`
 * (`governance:manage`, audited, writes a Decision Record). There is no new hold store, no new decision
 * engine, no new audit sink, and NO execution: this service reads and maps; it never resolves a hold and
 * never touches the journal, the intent, the Sales Order, or the command bus.
 *
 * DEDUPE is free and deterministic: `HoldStore.open` returns the existing OPEN hold for a subject, and the
 * subject is the intent's idempotency key, so every tick after the first is a no-op for an already-surfaced
 * intent. That is why a 60s cadence (matching the other background services) is safe rather than noisy, and
 * why boot-timing does not matter — a tenant that is not yet operable is simply surfaced on a later tick.
 *
 * Electron-coupled ONLY through the injected `realDeps()` (the instance singletons); `tick(injected)` drives
 * the real fan-out with controlled deps, so the mapping + surfacing is provable under plain Node.
 */
import { forEachTenantBackground } from '../enterprise/index';
import { currentPrincipal } from '../tenancy/backgroundPrincipal';
import { governanceStore } from '../enterprise/governance/governanceInstance';
import { createLogger } from '../logger';
import type { BackgroundService } from '../services/serviceManager';
import { heldCommandIntentsFor } from '../ipc/handlers/platformCommandIpc';
import { createHoldRaiser } from './raiseHold';
import { decisionRecordStore, holdStore } from './instances';
import { buildHeldCommandHoldInput, type HeldCommandIntent } from './heldCommandHold';

const log = createLogger('held-command-holds');

/** Matches the other background cadences (delivery, readback). Held intents are rare; dedupe makes it cheap. */
const TICK_MS = 60_000;

export interface HeldCommandHoldDeps {
  /** Read-only held intents for the tenant currently in scope. */
  heldIntentsFor: (tenantId: string) => readonly HeldCommandIntent[];
  /** Raise (or dedupe to the existing) canonical hold. Runs under the tenant's active scope. */
  raise: (intent: HeldCommandIntent) => void;
}

/**
 * Surface every held intent of ONE tenant into the canonical HoldStore. The whole per-tenant body, extracted
 * so it is drivable directly in a test under a bound scope (the fan-out that pins the scope is the untestable
 * I/O root — this is the logic). Read + map only: it raises holds, it never resolves one and never executes.
 */
export function surfaceHeldHolds(tenantId: string, deps: HeldCommandHoldDeps): number {
  const held = deps.heldIntentsFor(tenantId);
  for (const intent of held) deps.raise(intent);
  return held.length;
}

/**
 * The production deps: the SAME journal reader the live handler publishes, and a `raiseHold` over the SAME
 * canonical HoldStore/DecisionRecordStore singletons the Hold Center reads. `actor` is `system` — this is a
 * background reconciliation with no interactive user — and the audit line is the existing governance sink.
 */
function realDeps(): HeldCommandHoldDeps {
  const raiseHold = createHoldRaiser({
    holds: holdStore,
    decisions: decisionRecordStore,
    actor: () => 'system',
    audit: (action, target, summary) =>
      governanceStore.record({
        actor: 'system',
        action,
        target,
        summary,
        workspaceId: currentPrincipal()?.workspaceId ?? '',
      }),
  });
  return {
    heldIntentsFor: heldCommandIntentsFor,
    raise: (intent) => raiseHold(buildHeldCommandHoldInput(intent)),
  };
}

class HeldCommandHoldService implements BackgroundService {
  readonly name = 'held-command-holds';
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
    log.info('Held-command hold surfacing started', { intervalMs: TICK_MS });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass: once per operable tenant, under that tenant's own principal (so the hold lands in that
   * tenant's scope and `raise` cannot cross tenants). Never throws — the fan-out isolates a failing tenant
   * from the others, so one tenant's corrupt ledger cannot silence another's surfacing.
   */
  async tick(injected?: HeldCommandHoldDeps): Promise<void> {
    const deps = injected ?? realDeps();
    await forEachTenantBackground('surface-held-command-holds', (run) => {
      const count = surfaceHeldHolds(run.scope.tenantId, deps);
      if (count > 0) log.info('Surfaced held-command holds', { tenantId: run.scope.tenantId, count });
    });
  }
}

export const heldCommandHoldService = new HeldCommandHoldService();
