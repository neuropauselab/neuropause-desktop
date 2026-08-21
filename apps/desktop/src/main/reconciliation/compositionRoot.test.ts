/**
 * §19-6 — THE COMPOSITION ROOT. **RECORDED AS A GAP, NOT FORGOTTEN.**
 *
 * A SKIPPED TEST IS A RECORDED GAP; A DELETED TEST IS A FORGOTTEN ONE. This file exists to keep §19-6's
 * failure visible in the suite output rather than only in a document.
 *
 * ── THE EXACT BLOCKER ────────────────────────────────────────────────────────────────────────────────────────
 * `readBackReconcilerInstance.ts` cannot be imported under vitest. Importing it throws
 * `TypeError: Cannot read properties of undefined (reading 'getPath')` before any test body runs.
 *
 * Cause, measured — not inferred: the enterprise store singletons are constructed at **MODULE SCOPE** against
 * `app.getPath('userData')`, where `app` is undefined outside Electron —
 *   `enterprise/org/orgInstance.ts:10`            `new OrgStore(join(app.getPath('userData'), …))`
 *   `enterprise/workspace/workspaceInstance.ts:10`
 *   `enterprise/governance/governanceInstance.ts:10`
 *   `enterprise/personalization/personalizationInstance.ts:9`
 * The reconciler reaches them through `forEachTenantBackground`, exported by **`enterprise/index.ts`, which is
 * FROZEN**. Direct probe confirms all three levels are blocked: `enterprise/org/orgInstance`,
 * `enterprise/index`, and `services/executiveDelivery` (which imports it) all throw the same error.
 * **Zero test files in the repository import `enterprise/index` — not one, ever.**
 *
 * ── WHY THIS IS NOT ROUTED AROUND ────────────────────────────────────────────────────────────────────────────
 * Closing it needs either a frozen touch or converting the enterprise instances to lazy construction — a broad
 * behavioural change well outside F-P39's envelope. The standing rule is to stop at the freeze, not to route
 * around it for a green criterion. **§19-6 therefore stays PARTIAL, and this skip is its marker.**
 *
 * ── WHAT WOULD LET THIS RUN ──────────────────────────────────────────────────────────────────────────────────
 * Lazy construction of the enterprise store singletons (a getter, or construction at `initRuntimeCore` time)
 * so that importing `enterprise/index` no longer touches `app.getPath`. That is a separate slice with its own
 * gate. **26 non-test modules import `enterprise/index` directly and are untestable at the composition level
 * for the same reason** — this reconciler is one of them, not a special case.
 *
 * The import below is DYNAMIC and inside the test body on purpose: a top-level import would throw at collection
 * and turn this recorded gap into a permanently red file, which §2 #4 forbids as firmly as a fake green.
 */
import { describe, expect, it } from 'vitest';

describe('§19-6 · the composition root (BLOCKED — see docstring)', () => {
  it.skip('tick() with no argument executes realDeps() — BLOCKED: enterprise/index is unimportable under vitest', async () => {
    const { readBackReconciler } = await import('./readBackReconcilerInstance');
    await expect(readBackReconciler.tick()).resolves.toBeUndefined();
  });

  it.skip('tick(deps) drives the real forEachTenantBackground — BLOCKED by the same module-scope construction', async () => {
    const { readBackReconciler } = await import('./readBackReconcilerInstance');
    await expect(readBackReconciler.tick(undefined)).resolves.toBeUndefined();
  });

  /**
   * This one RUNS. It pins the blocker itself, so the day the enterprise instances become lazily constructed
   * this test fails and tells us the two skips above can be un-skipped. A gap that announces its own repair.
   */
  it('THE BLOCKER IS REAL — importing the composition root still throws on app.getPath', async () => {
    await expect(import('./readBackReconcilerInstance')).rejects.toThrow(/getPath/);
  });
});
