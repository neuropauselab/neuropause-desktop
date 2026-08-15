# PHASE E — Application-Level Evidence (Data IMPORT through the frozen CST kernel)

**Scope of assurance (read first).** This document records what was observed when
the **built, launched Desktop application** drove the one governed consequential
action (Data IMPORT) through its real renderer → IPC → CST adapter → frozen
`@neuropause/cst 1.3.0` kernel → `applyImportPlan` path. **TEST PASS ≠ UNIVERSAL
ASSURANCE.** These runs demonstrate the governed behaviour of the six exercised
scenarios on this build, on macOS, on one authenticated tenant session. They do
not certify every input, every module, every tenant, or durability under crash
(see the preserved limitation in §E-LIMIT).

Nothing was committed. The **frozen baseline source** (NEUROPAUSE-FINAL: NPC-1.2,
NPMS-1.4, the `@neuropause/cst` kernel tarball) remains byte-identical — the CST
kernel was not modified. This is distinct from the **integration changes**, which
are real and confined to the declared Desktop working-tree footprint (see
E-FOOTPRINT). "Frozen baseline unmodified" ≠ "no application files changed" — the
integration necessarily edited a small, enumerated set of Desktop files.

---

## E-ENV — Immutable test environment (for reproducibility)

The environment in which E5-A … E5-F were observed, recorded so another engineer
can reconstruct it. The Node version in particular explains the durability
limitation (E-LIMIT).

| Field | Value |
|---|---|
| OS | macOS 26.5.2 (Darwin 25.5.0) |
| CPU architecture | `arm64` (Apple Silicon) |
| Node | v20.20.2 |
| npm | 10.8.2 |
| Electron | 42.8.1 (declared == installed) |
| Kernel package SHA-256 | `293d056047346631c72dd117b50733162b5ae08448f3c2bdedd73703cbceb431` |
| Git HEAD at test time | `2b37cba` (`2b37cba5ca6712b40b0bcfce3e07ba5ace1fa432`) |
| Working-tree state | uncommitted integration footprint (see E-FOOTPRINT) |
| Desktop build | `electron-vite` build of HEAD + uncommitted integration; `out/main/index.js` ~6.4 MB |
| Test profile mode | authenticated **copy** of dev profile via `--user-data-dir`, discarded post-run |
| Fixtures | `Projects` (low-risk), `Invoices` (high-risk), `Customers`+`Projects` (mixed) — xlsx bytes from `testFixtures.buildXlsx` |
| Run timestamps (UTC) | E3 probe `2026-08-15T18:53Z`; E5 run `2026-08-15T19:11Z` |
| Backup tag (intact) | `pre-final-source-update-20260815-154001` |

## E-FOOTPRINT — Declared working-tree footprint of the integration

The frozen baseline is byte-identical; these are the (real, uncommitted) Desktop
changes that constitute the integration. Nothing outside this list was touched by
the CST work:

**Tracked, modified (3 source files + lockfiles):**
- `apps/desktop/src/main/dataPlane/index.ts` (+29/−2 — the ONE CST call site)
- `apps/desktop/src/main/dataPlane/wiring.test.ts` (+26/−7 — 2 tests aligned to the invariant)
- `apps/desktop/package.json` (+1/−0 — `@neuropause/cst` file: dependency)
- `package-lock.json` (dependency lock)

**Untracked, new:**
- `apps/desktop/src/main/cst/importTransition.ts` (the adapter — sole new production module)
- `apps/desktop/src/main/cst/importTransition.negative.test.ts` (21 controls)
- `certification/source-update/*.md`, `desktop-*.md` (certification docs)

**Tracked via intentional `.gitignore` negation (was the CR-1 gap, now CLOSED):**
- `apps/desktop/vendor/neuropause-cst-1.3.0.tgz` (vendored frozen kernel) — the base
  rule `.gitignore:58 *.tgz` is overridden by the negation
  `!apps/desktop/vendor/neuropause-cst-1.3.0.tgz`, so a plain `git add` staged it and
  it is committed. Referenced by `package.json`
  (`"@neuropause/cst": "file:vendor/neuropause-cst-1.3.0.tgz"`). Fresh-clone install
  verified — see CR-1 below.
- `.gitignore` (+7 — the intentional negation)

---

## E-CR — Commit-readiness findings (for the pre-commit gate; NOT fixed here)

Recorded per the commit-readiness gate; none are altered now because **commit is not
authorized** and each is a commit-time decision.

- **CR-1 — FOUND → CLOSED (was BLOCKING).**
  - **Found.** The vendored frozen kernel `vendor/neuropause-cst-1.3.0.tgz` was
    gitignored (`.gitignore:58 *.tgz`) but is the resolution target of the
    `@neuropause/cst` dependency. As-is, a commit would have omitted it and a fresh
    clone's `npm install` would have failed. The system passed behavioural
    certification (Phase D/E) yet could not reproduce its certified dependency from
    a clean clone — a reproducibility gap, not a Data Import behaviour defect.
  - **Correction (minimal, durable).** A targeted `.gitignore` negation
    `!apps/desktop/vendor/neuropause-cst-1.3.0.tgz` (with rationale comment) — the
    long-term repository contract, not a one-off `git add -f`. The kernel stays
    truly frozen: **not** rebuilt, **not** inlined, **not** un-vendored, **not**
    swapped for registry resolution.
  - **Fresh-clone verification (the proof CR-1 exists to protect).** A clean
    `git clone` of the committed branch was checked out with no `node_modules` and
    no working-tree WIP. Verified: (1) `vendor/neuropause-cst-1.3.0.tgz` present and
    **tracked**; (2) SHA-256 `293d0560…ceb431` in the clean checkout; (3)
    `npm install` (exit 0) resolved `@neuropause/cst` from the vendored `file:`
    dependency — no external unpublished artifact; (4) installed `kernel.js`
    `7b7be2fb…` **byte-identical** to the vendored tarball; (5) `typecheck:node`
    clean and **239/239** CST + data-plane suites pass from the clean install.
  - **Status: CLOSED.** A clean checkout of the committed repository contains the
    frozen CST kernel required by the Desktop package and resolves it without any
    external unpublished artifact.
  - **Follow-up (recommended, not blocking).** Add a CI/release invariant: for every
    local `file:` dependency, assert the referenced file exists, is tracked, and its
    SHA-256 equals the declared frozen digest — converting this human audit into a
    permanent repository invariant.
- **CR-2 (advisory).** `desktop-update-plan.md`, `desktop-consequential-action-selection.md`,
  and `desktop-cst-integration-design.md` currently live at the repo root. Consider
  relocating under `certification/source-update/` for a clean commit tree (cosmetic;
  not blocking).

---

## E1 — Clean build

- `npm run build` from `apps/desktop` (Node v20.20.2 / npm 10.8.2).
- Artifacts: `out/main/index.js` (~6.4 MB), `out/preload/index.js`,
  `out/renderer/index.html`. Built in ~2.85 s, exit 0.

## E2 — Dependency integrity

- Vendored kernel `apps/desktop/vendor/neuropause-cst-1.3.0.tgz` SHA-256
  `293d056047346631c72dd117b50733162b5ae08448f3c2bdedd73703cbceb431`
  — **byte-identical** to the frozen NEUROPAUSE-FINAL tarball.
- Frozen source tree re-verified against `/tmp/neuropause-final-source-baseline.sha256`
  — **all match, zero drift** (NPC-1.2, NPMS-1.4, kernel tarball).
- Adapter compiled into `out/main/index.js` (`governedImport`, `VERIFIED_NOOP`,
  `importResolved`, `dataplane-import` all present). `node:sqlite` NOT in the
  bundle. The kernel is **externalised** to `node_modules/@neuropause/cst/dist/src/{kernel,stores,types}.js`
  (electron-vite externalises node_modules deps), and resolves at runtime.

## E3 — Actual application launch

- Launched the built artifact under Playwright `_electron` (real Electron main +
  renderer). `system:runtimeState` → `{ state: "ready", message: null }`.
- The `requireAuth: true` data-plane channels are **reachable**: `dp:analyze`
  resolved a real plan (`imp_…`) in the launched app — the authenticated tenant
  session on the profile satisfies the auth gate. (The auth gate is real and was
  NOT bypassed or faked; a session without a valid token would be refused before
  reaching the adapter.)

## E4 — Real IPC path exercised

- Every scenario below went through `window.neuropause.invoke('dp:analyze' | 'dp:import', …)`
  → preload bridge → `ipcMain` secure handler → `governedImport()` →
  `CstKernel.run()` → (on ALLOW) `applyImportPlan()`. No internal function was
  imported or called directly; the app was driven as a programmatic user.

## E-ISOLATION — No pollution of the operator's real profile

Imports write real records. To avoid mutating the operator's live dev profile,
the six scenarios ran against a **throwaway copy** of the profile
(`--user-data-dir=<copy>`, auth session preserved), which was **discarded** after
the run. The real profile was verified **clean of every fixture marker**
(`Globex`, `INV-1`, `Rollout`, `Atlas`, the emitted `imp_`/`rec_` ids) and no
data-plane record store was modified this session.

---

## E5 — The six governed scenarios (real runtime identifiers)

All identifiers below were emitted by the running app, not manufactured.

| # | Scenario | Plan (real id) | Verdict at app boundary | Effect | Outcome |
|---|---|---|---|---|---|
| E5-A | Low-risk authorized (Projects, `requiresApproval:false`) | `imp_dffe7238…` | ALLOW (import resolved) | `status:imported`, imported **2** — `rec_d96ab7ba…`, `rec_3289484c…` | **VERIFIED_SUCCESS** (real mutation) |
| E5-B | High-risk **unapproved** (Invoices, `requiresApproval:true`) | `imp_2ece19b3…` | **HOLD** — `dp:import` threw `Import HOLD by governance (APPROVAL_REQUIRED). Nothing was written.` | none | not verified (APPROVAL_REQUIRED) |
| E5-C | High-risk **approved** (Invoices) | `imp_e950e514…` | ALLOW | `status:imported`, imported **1** — `rec_9ab972db…` (module `finance`) | **VERIFIED_SUCCESS** |
| E5-D | Authorized **re-import** (Projects, already current) | `imp_ff3430ae…` | ALLOW | `status:nothing_imported`, imported **0**, **skipped 2**, duplicates 0, created 0 | **VERIFIED_NOOP** |
| E5-E | Mixed plan, one high-risk **unapproved** (Customers unapproved + Projects approved) | `imp_437615c3…` | **HOLD** — threw `APPROVAL_REQUIRED. Nothing was written.` | none — **atomic** | not verified |
| E5-F | Mixed plan, **all approved** (Customers + Projects) | `imp_f3aeb27a…` | ALLOW | `status:imported`, imported **2** — `rec_c64a7988…` (crm-customers), `rec_668b242b…` (projects-projects) | **VERIFIED_SUCCESS** |

## E6/E7 — Transition evidence & real identifiers

Each ALLOW produced a real `ImportResult` (`status`, `totals`, per-table
`createdRecordIds`); each HOLD produced the **kernel's own reason string** surfaced
through IPC, never a fabricated success. The `imp_…` plan ids and `rec_…` record
ids in the table above are the runtime's own — no identifier was invented where the
runtime did not produce one.

## E8 — NOOP semantics proven live (not "everything zero-write is failure")

E5-D re-imported the *identical* Projects data into a destination that already held
`P-1`/`P-2` from E5-A. The governed transition returned `nothing_imported` with
**skipped 2, duplicates 0, created 0** — authorized, zero mutation, zero failure.
This is the `VERIFIED_NOOP` refinement observed end-to-end: a legitimate no-op is
**not** reported as success (nothing was written) and **not** as failure (nothing
was wrong). It also did **not** duplicate the existing records.

## E-ATOMIC — Whole-transition HOLD: direct proof + application-level corroboration

E5-E (mixed, Customers high-risk **unapproved**, Projects low-risk **approved**)
HELD the whole transition. Two classes of evidence support the atomic boundary,
and they are deliberately kept distinct:

- **Direct evidence (Phase D).** The mutation-sensitive negative control MIXED-A
  in `importTransition.negative.test.ts` proves the atomic boundary *directly*: the
  effect does not run (`effectRuns` stays 0) and **both** destination stores are
  observed unchanged after the HOLD. That is the authoritative, direct proof that no
  partial write occurs.
- **Application-level corroborating evidence (Phase E, cross-run).** E5-F
  re-analyzed the *same* mixed book and its Projects table reported **created 1**
  (`rec_668b242b…`). Had E5-E partially written `P-9 "Atlas"`, E5-F's Projects would
  have matched an existing record and skipped it (created 0). Because E5-F created it
  fresh, `P-9` did not exist after E5-E. This is **corroborating** forensic evidence
  from the launched application — it is *consistent with* whole-transition atomicity
  by the absence of the Projects record after E5-E and its fresh creation during
  E5-F; it is not itself a direct measurement of `effectRuns`.

**Strongest combined claim:** *Phase D directly proves no effect under the
controlled negative test (`effectRuns=0`, both stores unchanged); Phase E
corroborates the same whole-transition behaviour through the launched application.*
This is the C3 Transition Integrity invariant (atomic boundary, no partial
execution) established directly in the negative-control suite and corroborated at
runtime.

## E9 — Governance path is the single verdict

On HOLD/DENY the handler surfaces the kernel's reason and asserts nothing about the
world (`governed.result === undefined` → throw). On ALLOW the effect
(`applyImportPlan`) runs unchanged, only inside the kernel's `effect`, only after a
won claim and pre-state revalidation. The six live outcomes match the frozen
contract in `C3-TRANSITION-INTEGRITY-INVARIANT.md` exactly.

## E-LIMIT — Preserved durability limitation (unchanged from Phase D)

The kernel's own durable evidence store uses `node:sqlite`, which requires Node ≥ 22;
the Desktop main process runs Node 20 (Electron 42). This build wires the adapter's
evidence/idempotency/claim/resource ports to the **in-memory** kernel stores, which
are process-lifetime, not crash-durable. Cross-restart durability of the kernel's
evidence ledger is therefore **out of scope for this build** and remains an open
item, exactly as recorded in Phase D. Nothing here claims crash-durable evidence.

---

## E10 — Phase E acceptance matrix

| Control | Status | Basis |
|---|---|---|
| Clean build | **PASS** | E1 (exit 0, artifacts present) |
| Dependency integrity (kernel byte-identical, source zero-drift) | **PASS** | E2 |
| Actual app launch (`ready`) | **PASS** | E3 |
| Real renderer→IPC→CST path (not a unit call) | **PASS** | E4 |
| Low-risk authorized ⇒ ALLOW ⇒ records written | **PASS** | E5-A |
| High-risk unapproved ⇒ HOLD ⇒ no effect | **PASS** | E5-B |
| High-risk approved ⇒ ALLOW ⇒ records written | **PASS** | E5-C |
| Authorized re-import ⇒ VERIFIED_NOOP (not success, not failure, no dup) | **PASS** | E5-D / E8 |
| Mixed unapproved ⇒ whole-transition HOLD, atomic (no partial write) | **PASS** | Direct: Phase D MIXED-A (`effectRuns=0`, both stores unchanged). Corroborated: E5-E/E5-F (E-ATOMIC) |
| Mixed all-approved ⇒ ALLOW ⇒ all tables written | **PASS** | E5-F |
| Real runtime identifiers captured (`imp_…`, `rec_…`) | **PASS** | E5 table |
| No pollution of operator's real profile | **PASS** | E-ISOLATION |
| Source immutability + kernel non-modification | **PASS** | E2 |
| Crash-durable kernel evidence ledger | **OUT OF SCOPE** | E-LIMIT (Node 20 vs node:sqlite) |

**Governance-logic breadth beyond the six app-driven scenarios** (unauthorized→DENY,
tenant-isolation→DENY, stale pre-state→HOLD, unobservable→UNKNOWN, reported-write-
absent→DEVIATION/FAILURE, evidence-stage failure, duplicate/replay idempotency,
recovery bypass) is proven by the **21/21** integration + kernel-boundary controls in
`importTransition.negative.test.ts`, which drive the *identical*
`governedImport → CstKernel.run → applyImportPlan` code path. Phase E establishes
that this same path **survives compilation, packaging, application startup, IPC
wiring, and authenticated execution** and behaves as specified on the six exercised
scenarios.

---

## E-FROZEN — Frozen assurance statement (Data Import)

> **Phase E PASS — Data Import.**
>
> The built NeuroPause Desktop application was launched under an authenticated
> development profile and exercised through its real renderer → preload bridge →
> IPC → Data Import → CST adapter → frozen CST kernel → preserved import effect →
> authoritative read-back → verification path.
>
> Six application-level scenarios demonstrated authorized low-risk execution,
> unauthorized high-risk HOLD, approved high-risk execution, verified no-op
> re-import, atomic whole-transition HOLD for mixed plans containing an unapproved
> high-risk table, and authorized mixed-plan execution.
>
> The test profile used for mutation scenarios was an authenticated copy of the
> development profile and was discarded after execution. The real development
> profile was checked for fixture leakage and remained free of test data.
>
> Frozen baseline source and vendored kernel integrity were independently
> re-verified as byte-identical; no modification to the frozen kernel was made.
> Integration changes are confined to the declared Desktop working-tree footprint.
>
> This is a scoped application-level test pass, not universal assurance. The
> evidence establishes the declared Data Import behaviour for the tested build,
> environment, fixtures and control scope. It does not establish universal
> transition coverage, multi-host ownership, durable cross-restart kernel-store
> persistence, or assurance for Desktop transitions outside Data Import.

### What Phase E does NOT establish or authorize
- **Universal transition coverage** — only the six Data Import scenarios above.
- **Durable cross-restart kernel evidence** — NOT established (Node 20 vs
  `node:sqlite`, see E-LIMIT). Not to be "solved" by treating in-memory persistence
  as durable.
- **Scope broadening** — Phase E does not extend to other Desktop actions,
  connectors, workflows, AI actions, runtimes, or environments.
- **Commit** — **NOT AUTHORIZED — awaiting explicit approval.**

The Data Import transition is now the **reference governed-transition pattern**
(REQUEST → CONSEQUENCE CLASSIFICATION → AUTHORIZATION → POLICY → CLAIM → PRE-STATE
REVALIDATION → EFFECT → AUTHORITATIVE OBSERVATION → POST-STATE VERIFICATION →
OUTCOME CLASSIFICATION → EVIDENCE), preserving SEEN ≠ CLAIMED ≠ EXECUTED ≠
EFFECT_CONFIRMED ≠ VERIFIED ≠ EVIDENCED, UNKNOWN ↛ VERIFIED, and ABSENCE ↛ PROOF.
Future governed transitions are to be compared against it; broadening is a
separate, future gate.
