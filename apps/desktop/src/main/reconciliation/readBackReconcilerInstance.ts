/**
 * NeuroPause OS — the read-back reconciler's COMPOSITION ROOT and its `BackgroundService` shell.
 *
 * The reconciler core (`readBackReconciler.ts`) is Electron-free, store-free and clock-free on purpose. This is
 * the one file that owns real I/O and real identity, so the core stays drivable by tests against real seams.
 *
 * ── WHY serviceManager AND NOT deliveryEngine (a correction, recorded) ───────────────────────────────────────
 * The envelope first proposed registering an `IntelligenceSource` on `deliveryEngine`, following the committed
 * `9cb933c` precedent. Reading the host disproved it: `DeliveryEngine.tick()` returns early on
 * `prefs.enabled === false` and skips any source listed in `prefs.mutedSources`. **That would let a NOTIFICATION
 * PREFERENCE silently switch off evidence production** — a user muting a "source" would stop verification and
 * nothing would say so. A delivery engine also expects sources to emit user-facing items, which a reconciler
 * must not do.
 *
 * `serviceManager` is the correct host and costs the same: its service list is NON-FROZEN, and
 * `serviceManager.startAll(...)` is ALREADY called from frozen `runtimeCore.ts:4072`. **Zero frozen lines are
 * added** (ruling J), and the reconciler owns its own cadence, answering to no user preference.
 */
import { app } from 'electron';
import { forEachTenantBackground } from '../enterprise/index';
import { actionRecord } from '../connectors/actionRecord';
import { makeM365GraphReader } from '../verification/m365ReadBack';
import { currentPrincipal } from '../tenancy/backgroundPrincipal';
import { createLogger } from '../logger';
import type { BackgroundService } from '../services/serviceManager';
import { reconcileTenant, type ReconcilableRecord, type ReconcilerDeps } from './readBackReconciler';

const log = createLogger('readback-reconciler');

/** Matches the other background cadences (sync, delivery, automation) — and IS the retry schedule. */
const TICK_MS = 60_000;

/**
 * The oracle identity, declared by the root that actually injects the reader — never guessed by the reconciler.
 * This is F-N16-4's disposition honored in code: the RULE (`verifyEffect`) and the READER
 * (`m365ReadBack:sentItems+inbox`) are two layers with two names, and the record names the reader.
 */
const ORACLE_ID = 'm365ReadBack:sentItems+inbox';

function realDeps(): ReconcilerDeps {
  return {
    query: (filter) => actionRecord.query(filter) as unknown as Promise<readonly ReconcilableRecord[]>,
    recordVerification: (tenantId, transitionId, terminal) =>
      actionRecord.recordVerification(tenantId, transitionId, terminal),
    readerFor: (record) => {
      // Inside the fan-out this runs under the tenant's own principal, so the workspace comes from there.
      const workspaceId = currentPrincipal()?.workspaceId ?? '';
      try {
        return makeM365GraphReader(workspaceId, record.connectorId, record.accountId);
      } catch {
        return null; // no vault token ⇒ no reader ⇒ UNKNOWN, never an assumption
      }
    },
    oracleId: ORACLE_ID,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

class ReadBackReconcilerService implements BackgroundService {
  readonly name = 'readback-reconciler';
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
    log.info('Read-back reconciler started', { intervalMs: TICK_MS });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One tick: one pass per operable tenant, each under that tenant's own principal.
   *
   * Never throws. The fan-out already isolates a failing tenant from the others
   * (`backgroundFanOut.ts:211-228`), so one tenant's expired token cannot silence another's reconciliation —
   * which is §2 #9's requirement provided structurally rather than by convention.
   */
  async tick(): Promise<void> {
    const deps = realDeps();
    /**
     * F-P42 · ACCOMMODATION, NOT DESIGN — the two lines that unblock F-P39.
     *
     * `perWorkspace: true` because the WRITER keys evidence by workspace id
     * (`connectors/index.ts:641` → `deps.workspaceId()`), and the non-perWorkspace branch supplies
     * `tenantId: organization.id` with `workspaceId: ''` — two different namespaces, separately seeded
     * (`workspace-default` vs `org-default`), with NO mapping at the query boundary. Reading
     * `run.scope.tenantId` therefore matched zero rows on every tick, forever.
     *
     * **The reader conforms to a deviating writer.** The convention across the repository is unanimous —
     * ~25 tenancy files and canonical `testScope.ts` all write `{tenantId: 'org-*', workspaceId: 'ws-*'}` —
     * so `connectors/index.ts:641` is the outlier, not this reader. We conform anyway BECAUSE re-keying
     * existing records is a migration that would retroactively change what every stored record means,
     * including the first real send. That is governance-class and is not done here.
     *
     * **THE WRITER'S DEVIATION REMAINS AN OPEN DEFECT WITH A MIGRATION OWED (F-P42).** What ends this
     * accommodation is that migration — its own gate, its own ruling. Not this line.
     *
     * Two other readers already conform: `liveBrain/brainProposeLane.ts:83` (with an explicit ALIGNMENT
     * comment) and the compile-stripped `e2e/s16VerifyRun.ts:68`. The two that do NOT conform are this
     * reconciler and the counter row (`m365WriteStates` via `unified/sync/index.ts`), and both read zero.
     */
    await forEachTenantBackground('readback-reconciler', async (run) => {
      const summary = await reconcileTenant(run.scope.workspaceId, deps);
      if (summary.considered > 0) {
        log.info('Reconciliation pass', { ...summary });
      }
    }, { perWorkspace: true });
  }
}

export const readBackReconciler = new ReadBackReconcilerService();

/**
 * DURABILITY ACROSS AN UNDRAINED SHUTDOWN (mandatory build 2) — the honest bound, stated rather than claimed.
 *
 * The background fan-out is absent from all seven shutdown-flush registrations and no scheduler is stopped at
 * quit, so a pass in flight at `will-quit` is torn down mid-probe. That is SAFE HERE, and the reason is
 * structural rather than lucky: this pass holds no state worth draining. Its only durable write is
 * `recordVerification`, which is per-record and monotonic (D3) — a torn-down pass leaves records simply
 * unverified, and the next tick reconsiders them from the store.
 *
 * What it CANNOT do is repair the stores beneath it: `holds.json` and `decision-records.json` write through an
 * unawaited, coalesced `drain()`, and `action-records.json` is written by a `void`-detached observer call at
 * frozen `connectors/index.ts:641`. **A record lost before its first persist is invisible to this reconciler and
 * always will be.** That is S20 territory and is NOT claimed closed by this slice.
 */
export function shutdownNote(): string {
  return 'readback-reconciler holds no cross-tick state; durability of the stores beneath it is S20, not this slice';
}

// Referenced so the module's Electron dependency is explicit at review time rather than incidental.
export const requiresElectronApp = typeof app !== 'undefined';
