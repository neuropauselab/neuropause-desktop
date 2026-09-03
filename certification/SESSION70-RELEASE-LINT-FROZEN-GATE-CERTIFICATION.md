# SESSION 70 — RELEASE-LINT FROZEN-GATE CLEARANCE

## Executive result

**GREEN.** The two release-path lint blockers S69 discovered are cleared with a **two-line,
semantics-preserving, minimal** repair on two frozen surfaces, applied under the S70 directive's
explicit scoped authorization (FG-ERP-S70-RELEASE-LINT). `npm run lint:release` now passes with
**0 errors, 0 warnings** on the `8079ec7` lineage, and every release-pipeline validation dimension
is green (typecheck:release, cst targeted tests, the contract-consumer test, and the
`electron-vite build` step). No feature, policy, architecture, ESLint config, notarization config,
GitHub secret, or workflow behavior was touched. No push, no tag, no Actions trigger. The armed
`out/` build was not disturbed (the validation build used an alternate throwaway outDir, since
removed).

## 1 · Baseline / lineage

- **S70 baseline SHA (S68 clean release candidate):** `8079ec7` (build-info `8079ec7 · dirty:false`).
- **HEAD at S70 start:** `36332ca` (S69 distribution-trust cert) — a descendant of `8079ec7`
  carrying only docs. The two lint errors are present identically at both `8079ec7` and `36332ca`
  (the frozen files were unchanged between them), so the fix lands on the same lineage the
  directive names.
- Branch `cert/data-import-cst-integration`; remote at `fb8f320` (S62) — S63–S70 remain local-only
  (no push authorized).

## 2 · Frozen-gate authorization (directive §2)

- **gate-detector, run BEFORE any edit, on both files:**
  - `apps/desktop/src/main/cst/sendTransition.negative.test.ts` → **FROZEN** (surface
    `apps/desktop/src/main/cst/`).
  - `packages/shared/src/ipc/contracts.ts` → **FROZEN** (surface `packages/shared/`).
- **Authorization basis:** the S70 directive is the explicit, scoped operator authorization for
  this repair. It declares verbatim *"This is an authorized FROZEN-GATE repair only"*, names
  **exactly** these two files and the two exact fixes, and enumerates a prohibition list forbidding
  any scope expansion (no architecture/feature/policy/ESLint/ignore/rule/unrelated-frozen change,
  no workaround that hides the errors). Per CLAUDE §2.1, consent must be explicit and scoped, not
  inferred — this directive supplies exactly that: explicit, written, scoped consent to these two
  frozen edits. Recorded as gate **FG-ERP-S70-RELEASE-LINT**.
- **Change-control posture (CLAUDE §2.2):** applied as an isolated, minimal, frozen-only source
  change with full-suite-class validation green before commit. The `baseline.json` freeze re-record
  was **not** run: `baseline.json` is custody-protected and never staged (established S62→S68), so
  the gate-detector projection is the authorization instrument in force, exactly as for the recent
  ERP FG gates. `baseline.json` was left byte-untouched and unstaged.

## 3 · The two original errors (independently confirmed, exact)

1. `apps/desktop/src/main/cst/sendTransition.negative.test.ts:16`
   ```
   import { ActionInputError, type WriteAction, type WriteActionResult } from '../connectors/m365/actionSdk';
   ```
   `@typescript-eslint/no-unused-vars` — `WriteActionResult` is imported and never used
   (whole-file occurrence count = 1, the import itself). Genuinely unused.

2. `packages/shared/src/ipc/contracts.ts:2482`
   ```
   .object({ model: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:\/-]+$/) })
   ```
   `no-useless-escape` — the `\/` inside a regex **character class** is a useless escape (a forward
   slash needs escaping only as the pattern delimiter, never inside `[...]`).

Both are release-fatal under `lint:release`'s `--max-warnings 0`, and are exactly what killed every
prior `macos-release` run at the Lint step (S69 §3–4).

## 4 · The exact minimal fixes

```diff
--- a/apps/desktop/src/main/cst/sendTransition.negative.test.ts
+++ b/apps/desktop/src/main/cst/sendTransition.negative.test.ts
@@ -13,7 +13,7 @@
-import { ActionInputError, type WriteAction, type WriteActionResult } from '../connectors/m365/actionSdk';
+import { ActionInputError, type WriteAction } from '../connectors/m365/actionSdk';
```
```diff
--- a/packages/shared/src/ipc/contracts.ts
+++ b/packages/shared/src/ipc/contracts.ts
@@ -2479,7 +2479,7 @@ export type AiTestRequest = z.infer<typeof AiTestRequest>;
-  .object({ model: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:\/-]+$/) })
+  .object({ model: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:/-]+$/) })
```

- **Fix #1** removes ONLY the genuinely-unused `type WriteActionResult`; `ActionInputError` and
  `type WriteAction` (both used) are preserved. Test behavior is otherwise byte-for-byte identical
  (a type-only import removal executes no runtime code).
- **Fix #2** removes ONLY the useless `\` before `/` inside the character class. The intended
  contract/string semantics are exactly preserved — see §5. No refactor of the surrounding
  `AiPullModelRequest` contract; `.strict()`, bounds `min(1).max(128)`, and the anchors `^…$` are
  untouched.

**2 files changed, 2 insertions(+), 2 deletions(-). No other modification of any kind.**

## 5 · Semantics-preservation proof (Fix #2)

A JS regex character class treats `\/` and `/` identically. Proven exhaustively:
- **Membership over 12,288 codepoints (U+0000–U+2FFF):** `before.test(ch) === after.test(ch)` for
  every character — **0 disagreements**.
- **Realistic model ids:** `llama3.1`, `claude-fable-5`, `a/b_c.d:e-f`, `gpt-4o` all accepted by
  both; `has space`, `semi;colon`, a real backslash, and `""` all rejected by both — identical.
- Confirmed independently by the contract-consumer validation agent (§6): a genuine backslash id is
  rejected, all valid ids accepted, identically to the pre-change regex. (One agent's *literal*
  PART-B invocation printed a spurious red; it was diagnosed as a shell/JS double-escaping
  **instrument artifact** — the `back\slash` literal collapsed to `backslash` before reaching the
  regex — not a contract regression, per CLAUDE §2 #24. The corrected invocation, injecting a real
  `\` via `String.fromCharCode(92)`, is green.)

Character sets are equal: `{a-z, A-Z, 0-9, '.', '_', ':', '/', '-'}` in both. The class already
contained `/`; only its redundant escape was removed.

## 6 · Validation (directive §5) — all green

Run in parallel, each from its correct working directory, raw exit codes captured (no piping that
could swallow or manufacture output):

| Dimension | Command | Result |
|---|---|---|
| **`lint:release`** (acceptance gate) | `npm run lint:release` (root) | **EXIT 0 · 0 errors · 0 warnings.** ESLint produced no output under `--max-warnings 0`. Neither target file appears in any error (there are none). |
| **`typecheck:release`** | `npm run typecheck:release` (root, 6 workspaces) | **EXIT 0 · 0 `error TS`.** shared + companion-protocol + cloud-core + shared-cloud + backend + desktop (node+web) all compile clean — the import removal and the regex change break no consumer's types. |
| **cst targeted tests** | `npx vitest run src/main/cst/sendTransition.negative.test.ts` (from `apps/desktop`) | **EXIT 0 · Test Files 1 passed · Tests 16/16 passed.** (No `sendTransition.test.ts` sibling exists; the modified file is the whole cst send-transition suite.) Behavior unchanged. |
| **contract consumer** | `npx vitest run src/main/ai/aiConfigTestAuthority.test.ts` (from `apps/desktop`) + regex acceptance/rejection check | **EXIT 0 · Tests 10/10 passed;** regex semantics-preserving (§5). |
| **release build step** | `env -u NP_E2E_BUILD npx electron-vite build --outDir out-seam-s70` (from `apps/desktop`) | **EXIT 0.** main (1362 modules) + preload (243) + renderer (1858) all compiled. Armed `out/` untouched (built to a throwaway outDir, since removed). |

## 7 · Diff discipline (directive §6)

- **Files changed:** exactly two —
  `apps/desktop/src/main/cst/sendTransition.negative.test.ts` and
  `packages/shared/src/ipc/contracts.ts`.
- **Lines changed:** exactly two (one per file), each a single-line replacement (§4).
- **No unrelated modifications.** `git diff --name-only` over the source trees returns exactly the
  two files; gate-detector re-confirmed both are the same two frozen surfaces and no third file was
  touched.
- **`baseline.json`:** custody-protected, left byte-untouched, **not staged** (its pre-existing
  working-tree modification is unrelated to S70 and remains as-is).
- Frozen-gate authorization evidence: gate-detector FROZEN×2 (§2), directive-scoped consent
  (FG-ERP-S70-RELEASE-LINT).

## 8 · Final state

- **`git status` after commit:** clean but for the pre-existing, unstaged, custody-protected
  `certification/baseline.json` (unchanged by S70).
- **Final commit:** the commit carrying this certification + the two source fixes, parent
  `36332ca`. (SHA recorded in the commit log / the session report.)
- **NOT DONE, by directive:** no push, no tag, no GitHub Actions trigger.

## 9 · Classification / gate verdict

- **RED: 0** · **release-lint errors: 0** (was 2).
- **S70 GATE = GREEN.** `lint:release` passes cleanly on the `8079ec7` lineage; the single
  engineering prerequisite S69 named is cleared.

## 10 · Next gate (unchanged from S69, now unblocked at the engineering step)

The release workflow's Lint gate — the exact step that killed every prior `macos-release` run — no
longer fails. The next required action is the **controlled push of the clean S63–S70 chain** so
`8079ec7`+ reaches GitHub, followed by the **`v*` tag** that drives `macos-release` to build, sign,
and **notarize** (Apple credentials confirmed present in GitHub Secrets, S69). Both remain standing
human gates (push authorization + public-release/external-effect); neither is started here.
