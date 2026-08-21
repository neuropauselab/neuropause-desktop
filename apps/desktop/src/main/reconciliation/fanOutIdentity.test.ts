/**
 * F-P42 / §19 ITEM 6 — TENANT IDENTITY THROUGH THE **REAL** FAN-OUT.
 *
 * ── WHY THIS FILE EXISTS, AND WHAT IT REFUSES TO DO ──────────────────────────────────────────────────────────
 * `readBackReconciler.test.ts` supplies the SAME `TENANT` constant to the writer and the reader. That is why it
 * stayed green for weeks while the production reconciler matched **zero rows on every tick**: the fixture was
 * more generous than reality, so the defect had nowhere to show. §2 #17 exactly — *pin against the real path,
 * not a convenient shape.*
 *
 * So this file supplies the key ONCE, as a workspace row, and then lets it be derived **independently twice**:
 *   WRITER  — `currentPrincipal()?.workspaceId ?? ''`, the two lines `runtimeCore.ts:474-478` actually runs
 *   READER  — `run.scope.workspaceId`, produced inside the REAL `forEachTenant` perWorkspace branch
 * Neither side is told the other's answer. If those two derivations ever diverge again, this file goes red.
 *
 * ── WHAT IS REAL HERE, STATED SO NOBODY OVERREADS IT ─────────────────────────────────────────────────────────
 * REAL: `forEachTenant` (its dep seam is its design — `deliveryEngine` and `backgroundFanOut.test.ts` both use
 * it), the perWorkspace branch, `tenantPrincipal`/`runAsPrincipal`, the `ActionRecordStore` on real fs.
 * NOT REAL: `realDeps()` (module-private) and `forEachTenantBackground`'s binding to the live org/workspace
 * singletons. **Therefore §19 item 6 is PARTIAL, not PASS** — and it is recorded that way rather than claimed.
 *
 * NO EXTERNAL EFFECT: the reader is an in-test function returning no rows. Nothing is sent, nothing is read
 * from Graph.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forEachTenant, type TenantFanOutDeps } from '../tenancy/backgroundFanOut';
import { currentPrincipal } from '../tenancy/backgroundPrincipal';
import { testOrganization, testWorkspace } from '../tenancy/testScope';
import { actionRecord } from '../connectors/actionRecord';
import { reconcileTenant, type ReconcilableRecord, type ReconcilerDeps } from './readBackReconciler';

const ORG = 'org-fp42';
const WS = 'ws-fp42';
const RECIPIENT = 'alice@example.com';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-fp42-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The real fan-out's designed dep seam — one org, one workspace under it. */
function fanOut(): TenantFanOutDeps {
  return { organizations: () => [testOrganization(ORG)], workspaces: () => [testWorkspace(WS, ORG)] };
}

/** Reconciler deps over the REAL store. The reader finds nothing — reachability is what is under test. */
function deps(): ReconcilerDeps {
  return {
    query: (f) => actionRecord.query(f) as unknown as Promise<readonly ReconcilableRecord[]>,
    recordVerification: (t, id, term) => actionRecord.recordVerification(t, id, term),
    readerFor: () => ({ readSentItems: async () => [], readInbox: async () => [] }),
    oracleId: 'test:injected-reader',
    now: () => Date.now(),
    sleep: async () => undefined,
  };
}

/**
 * WRITE one governed-send record under the REAL per-workspace principal, deriving the tenant key exactly the
 * way the production writer does. Returns the key the writer actually chose — never asserted into place.
 */
async function writeUnderRealPrincipal(): Promise<string> {
  let writerKey = '<never-derived>';
  await forEachTenant(
    'fp42-write',
    fanOut(),
    async () => {
      // VERBATIM the production derivation — `runtimeCore.ts:474-478`, reached through the real principal.
      writerKey = currentPrincipal()?.workspaceId ?? '';
      await actionRecord.observe(
        {
          connectorId: 'microsoft-entra',
          accountId: 'acct-1',
          actionId: 'mail.send',
          params: { to: [RECIPIENT], cc: [], subject: 'Quarterly report', body: 'Attached.' },
        },
        {
          semanticOutcome: 'ACKNOWLEDGED',
          requestId: `req:idem-fp42:${Date.now()}`,
          outcome: { transitionId: 'm365-send:idem-fp42', verdict: 'ALLOW', executed: true },
        } as never,
        { actor: 'user:ops', tenantId: writerKey },
      );
    },
    { perWorkspace: true },
  );
  return writerKey;
}

describe('F-P42 · the writer key and the reader key must MEET through the real fan-out', () => {
  it('THE ACCEPTANCE TEST — a record written under the real principal is FOUND by the real fan-out', async () => {
    const writerKey = await writeUnderRealPrincipal();

    const readerKeys: string[] = [];
    let considered = 0;
    await forEachTenant(
      'fp42-read',
      fanOut(),
      async (run) => {
        // THE FIX: the reconciler reads the WRITER's key, produced by the real perWorkspace branch.
        const readerKey = run.scope.workspaceId;
        readerKeys.push(readerKey);
        considered += (await reconcileTenant(readerKey, deps())).considered;
      },
      { perWorkspace: true },
    );

    // Derived independently on both sides, and they agree.
    expect(writerKey).toBe(WS);
    expect(readerKeys).toEqual([WS]);
    // THE ASSERTION F-P42 EXISTS FOR: the record is reachable. Before the fix this was 0.
    expect(considered).toBe(1);
  });

  it('REGRESSION — the OLD key (organization id) finds nothing, so the fix is load-bearing', async () => {
    await writeUnderRealPrincipal();

    let considered = 0;
    await forEachTenant(
      'fp42-old-key',
      fanOut(),
      async (run) => {
        // The pre-fix read: `run.scope.tenantId` is the ORGANIZATION id.
        considered += (await reconcileTenant(run.scope.tenantId, deps())).considered;
      },
      { perWorkspace: true },
    );

    expect(considered).toBe(0); // exactly the production symptom — zero rows, every tick
  });

  it('the two keys are genuinely different namespaces — not a coincidence of one profile', async () => {
    const scopes: { tenantId: string; workspaceId: string }[] = [];
    await forEachTenant('fp42-shape', fanOut(), (run) => {
      scopes.push({ tenantId: run.scope.tenantId, workspaceId: run.scope.workspaceId });
    }, { perWorkspace: true });

    expect(scopes).toEqual([{ tenantId: ORG, workspaceId: WS }]);
    expect(scopes[0].tenantId).not.toBe(scopes[0].workspaceId);
  });

  it('TENANT ISOLATION through the real fan-out — one workspace cannot see the other’s record', async () => {
    await writeUnderRealPrincipal(); // written under ws-fp42

    const other: TenantFanOutDeps = {
      organizations: () => [testOrganization(ORG)],
      workspaces: () => [testWorkspace('ws-other', ORG)],
    };
    let considered = 0;
    await forEachTenant('fp42-other', other, async (run) => {
      considered += (await reconcileTenant(run.scope.workspaceId, deps())).considered;
    }, { perWorkspace: true });

    expect(considered).toBe(0);
  });
});
