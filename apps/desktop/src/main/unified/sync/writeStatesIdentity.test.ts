/**
 * F-P45 · THE COUNTER'S KEY — THE SECOND INSTANCE, AND ITS REGRESSION PIN.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────────────────────────
 * `unified/sync/index.ts` read the five write states with `activeTenantScope()?.tenantId` — the ORGANIZATION id —
 * from a store whose rows are written under the WORKSPACE id (`connectors/index.ts:641` → `deps.workspaceId()`).
 * Two separately-seeded namespaces, no mapping at the query boundary. **Every counter read zero on every call**,
 * and `EXTERNALLY_OBSERVED` was 0 BY CONSTRUCTION — no terminal the read-back reconciler could ever record would
 * have moved it. This is F-P45's other instance: same root, second symptom, exactly F-P24's shape.
 *
 * ── WHY THE PIN IS SHAPED THIS WAY ───────────────────────────────────────────────────────────────────────────
 * `readBackReconciler.test.ts` handed the SAME constant to writer and reader and stayed green for weeks while
 * production matched zero rows. §2 #17 — *pin against the real path, not a convenient shape.* So the key is
 * supplied ONCE, as a workspace row, and derived **independently twice**:
 *   WRITER — `currentPrincipal()?.workspaceId ?? ''`, the derivation `runtimeCore.ts:474-478` actually runs
 *   READER — `run.scope.workspaceId`, produced inside the REAL `forEachTenant` perWorkspace branch
 * Neither side is told the other's answer.
 *
 * ── THE HONEST BOUND, STATED SO NOBODY OVERREADS IT ──────────────────────────────────────────────────────────
 * The production call sites resolve their key through `activeTenantScope()`, which is exported by **FROZEN
 * `enterprise/index.ts` — unimportable under vitest** (F-P47: module-scope `app.getPath('userData')`). So this
 * pin drives the equivalent `TenantScope` derivation through the real `forEachTenant`, and **the two call sites
 * themselves remain unexecuted by any test.** That is F-P47's recorded gap, not a gap this file invents or hides.
 * What IS proven here: the store's key discipline, and that the old key finds nothing.
 *
 * NO EXTERNAL EFFECT: a temp dir, a real store, no Graph, no network, no send.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forEachTenant, type TenantFanOutDeps } from '../../tenancy/backgroundFanOut';
import { currentPrincipal } from '../../tenancy/backgroundPrincipal';
import { testOrganization, testWorkspace } from '../../tenancy/testScope';
import { actionRecord } from '../../connectors/actionRecord';
import { m365WriteStates } from '../../connectors/m365WriteStates';

const ORG = 'org-fp45-counter';
const WS = 'ws-fp45-counter';
const CONNECTOR = 'microsoft-entra';
const ACCOUNT = 'acct-1';
const TRANSITION = 'm365-send:idem-fp45-counter';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'np-fp45-counter-'));
  actionRecord.useDirForTests(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fanOut = (): TenantFanOutDeps => ({
  organizations: () => [testOrganization(ORG)],
  workspaces: () => [testWorkspace(WS, ORG)],
});

/** Write one governed-send record under the REAL per-workspace principal. Returns the key the WRITER chose. */
async function writeUnderRealPrincipal(): Promise<string> {
  let writerKey = '<never-derived>';
  await forEachTenant(
    'fp45-counter-write',
    fanOut(),
    async () => {
      // VERBATIM the production writer derivation — `runtimeCore.ts:474-478`.
      writerKey = currentPrincipal()?.workspaceId ?? '';
      await actionRecord.observe(
        {
          connectorId: CONNECTOR,
          accountId: ACCOUNT,
          actionId: 'mail.send',
          params: { to: ['alice@example.com'], cc: [], subject: 'Quarterly report', body: 'Attached.' },
        },
        {
          semanticOutcome: 'ACKNOWLEDGED',
          requestId: `req:idem-fp45-counter:${Date.now()}`,
          outcome: { transitionId: TRANSITION, verdict: 'ALLOW', executed: true },
        } as never,
        { actor: 'user:ops', tenantId: writerKey },
      );
    },
    { perWorkspace: true },
  );
  return writerKey;
}

/** Read the counters under a key produced by the REAL fan-out, selected by the caller's projection. */
async function readVia(pick: (scope: { tenantId: string; workspaceId: string }) => string): Promise<number[]> {
  const seen: number[] = [];
  await forEachTenant(
    'fp45-counter-read',
    fanOut(),
    async (run) => {
      const w = await m365WriteStates(pick(run.scope), CONNECTOR, ACCOUNT);
      seen.push(w.requested, w.providerAcknowledged, w.externallyObserved);
    },
    { perWorkspace: true },
  );
  return seen;
}

describe('F-P45 · the write-state counter must read the key the writer wrote', () => {
  it('THE ACCEPTANCE TEST — the WORKSPACE key finds the governed send; the counters are non-zero', async () => {
    const writerKey = await writeUnderRealPrincipal();
    expect(writerKey).toBe(WS);

    const [requested, acknowledged, observed] = await readVia((s) => s.workspaceId);
    expect(requested).toBe(1);
    expect(acknowledged).toBe(1);
    // Honest: no terminal has been recorded yet, so EXTERNALLY_OBSERVED is 0 for the RIGHT reason.
    expect(observed).toBe(0);
  });

  it('REGRESSION — the OLD key (organization id) finds NOTHING, so the fix is load-bearing', async () => {
    await writeUnderRealPrincipal();

    const [requested, acknowledged, observed] = await readVia((s) => s.tenantId);
    // Exactly the production symptom: five counters at zero while a real governed send sits in the store.
    expect(requested).toBe(0);
    expect(acknowledged).toBe(0);
    expect(observed).toBe(0);
  });

  it('the two keys are genuinely different namespaces — not a coincidence of one profile', async () => {
    const scopes: { tenantId: string; workspaceId: string }[] = [];
    await forEachTenant('fp45-counter-shape', fanOut(), (run) => {
      scopes.push({ tenantId: run.scope.tenantId, workspaceId: run.scope.workspaceId });
    }, { perWorkspace: true });

    expect(scopes).toEqual([{ tenantId: ORG, workspaceId: WS }]);
    expect(scopes[0].tenantId).not.toBe(scopes[0].workspaceId);
  });

  /**
   * THE POINT OF THE WHOLE SLICE: a recorded verification terminal must become visible to the counter.
   * Under the old key this assertion was UNSATISFIABLE — not merely failing, but unsatisfiable by construction,
   * because the query it reads through matched no row that any terminal could ever attach to.
   */
  it('EXTERNALLY_OBSERVED moves 0→1 when a success terminal is recorded under the workspace key', async () => {
    const writerKey = await writeUnderRealPrincipal();

    await actionRecord.recordVerification(writerKey, TRANSITION, {
      terminal: 'VERIFIED_SUCCESS',
      at: new Date().toISOString(),
      provenance: { source: 'test:fp45-counter', method: 'corroborated', oracle: 'test:injected' },
    } as never);

    const [, , observedNew] = await readVia((s) => s.workspaceId);
    expect(observedNew).toBe(1);

    // And it stays invisible under the old key — the counter's blindness was the whole defect.
    const [, , observedOld] = await readVia((s) => s.tenantId);
    expect(observedOld).toBe(0);
  });
});
