# PHASE A — CONSEQUENTIAL ACTION SELECTION (read-only)

**Direction:** NeuroPause final (frozen SOURCE) → NeuroPause Desktop (TARGET).
**Target:** `2b37cba`, `1.0.0-rc.20`. **No code was edited in this phase.**
**Purpose:** pick the single strongest *actually-implemented* consequential action
to route through `CstKernel.run(request, effect)` first, that can be honestly
exercised and verified **in this environment** without fabricating evidence.
**Source unmodified:** verified (Phase 18 baseline holds).

## Consequential-action inventory (implemented, not aspirational)

### Candidate 1 — Data IMPORT  ★ SELECTED
- **Action:** `dp:import` — approval-gated record insertion/update into tenant stores
- **Source file / call site:** `apps/desktop/src/main/dataPlane/importer.ts` `applyImportPlan()`; IPC `IpcChannel.DataPlaneImport` at `dataPlane/index.ts:553`
- **Actor / principal:** signed-in user
- **Authorization:** `data:import` **plus** the destination module's own WRITE scope (double gate — `data:import` alone cannot "wave through" writes; `dataPlane/index.ts:566,601`)
- **Existing governance path:** approval-gated import (per-table `approved` flags)
- **Existing idempotency:** **yes** — `externalKey` (connector+account+resource+row) is the idempotency boundary; "already imported this row" dedup; re-import does not duplicate (`importer.ts:98,471,495`)
- **Pre-state:** target tenant store contents + provenance index before the run
- **Transition:** create/update records for approved tables
- **Authoritative post-state:** the store contents, **read back after writing** ("reads what was written rather than trusting the return"); provenance rows recorded per created record
- **Reversibility:** **REVERSIBLE** (records removable; `deindex` path exists)
- **External side effect:** **none** — writes local tenant JSON stores
- **Evidence already emitted:** `ProvenanceStore` (source file/sheet/row per record) + audit entry
- **Recovery behavior:** partial-run rows recorded; re-run is idempotent per `externalKey`
- **Exercisable in THIS environment:** **YES** — no backend needed; exercised end-to-end offline (analyze→import→history→audit→export) in `e2e/productJourney.test.ts` and live on macOS
- **Needs cloud/backend:** **no**

### Candidate 2 — Backup RESTORE
- **Action:** `backup:restore` / `recovery:run` — overwrite every tenant store from an archive
- **Source file / call site:** `backup/backupManager.ts:288 restore()`; `releaseOps/index.ts:376,437`
- **Authorization:** maintenance boundary + `RestoreBoundaryAcknowledgement`
- **Idempotency:** per-restore safety snapshot; atomic tmp+rename copy (round 37)
- **Authoritative post-state:** the restored files — **but only observable AFTER a forced app relaunch** (`requiresRestart:true` → `scheduleRestoreRelaunch`)
- **Reversibility:** **DIFFICULT_TO_REVERSE** — live state replaced; a pre-restore safety backup exists (partial)
- **External side effect:** none (local FS), but **install-wide**
- **Exercisable in THIS environment:** partially — running it **destroys the running state** and its post-state is verifiable only in the *next* process, so the kernel's synchronous OBSERVE→VERIFY cannot cleanly close in-process
- **Needs cloud/backend:** no

### Candidate 3 — AI external execution
- **Action:** an AI action that "sends something external"
- **Authorization:** consent + provenance gating (rounds 34–35); `modelCannotSelfAuthorize` already a design goal
- **Authoritative post-state:** lives at an **external provider**
- **Exercisable in THIS environment:** **NO** — offline; a real external post-state cannot be observed without a live provider, and asserting one would be **fabricated evidence** (explicitly forbidden). Local-only routing has no external effect to govern as C3+.
- **Needs cloud/backend:** **yes**

### Candidate 4 — Enterprise mutations (createUser / deleteUser / deleteRole / provisionOrganization / workspace switch)
- **Source:** `enterprise/index.ts:1998–2323`
- **Consequence:** real (owner-row protection, tenancy) but **config-tier**, not the "deletes data / moves money / sends external" tier; already heavily guarded (rounds 32/40)
- **Exercisable offline:** yes — but lower raw consequence than Candidate 1

### Excluded — Payment
Preview-only / **REFUSED** until `PG-08` is evidenced against a real provider
(USE-20). Not a candidate; must stay refused.

## Ranking (by actual consequence, then honest verifiability here)

| Rank | Action | Raw consequence | Verifiable offline, no fabrication | First-call-site fit |
|---|---|---|---|---|
| — | Payment | C4 | n/a — REFUSED | excluded |
| 1(raw) | Backup RESTORE | C4 (install-wide, difficult-to-reverse) | **partial** — post-state only post-relaunch | poor (async, destroys state) |
| 1(raw) | AI external | C3+ | **NO** — needs live provider | impossible here without fabrication |
| **SELECTED** | **Data IMPORT** | **C3** (tenant data write, reversible) | **YES** — fully | **best** |
| 4 | Enterprise mutations | C2 | yes | ok, lower consequence |

## SELECTED FIRST ACTION: **Data IMPORT (`dp:import` / `applyImportPlan`)**

**Why:** the highest-consequence action that is genuinely implemented, tenant-
scoped, and **honestly exercisable and verifiable in this offline environment** —
and it already embodies, in ad-hoc form, exactly the CST primitives the kernel
formalizes: an **idempotency boundary** (`externalKey`), **evidence/provenance**
(`ProvenanceStore`), an **approval gate**, and an **authoritative post-state read
back after the write**. That makes it the cleanest one-call-site mapping onto
`CstKernel.run(request, effect)` (effect = the record write) with a real OBSERVE→
VERIFY that closes in-process, no external provider, no fabricated guarantee.

## Rejected, with reason
- **Backup RESTORE** — higher raw consequence, but its authoritative post-state is
  observable only after a forced relaunch; the kernel's in-process OBSERVE→VERIFY
  cannot honestly close, and exercising it destroys the running state.
- **AI external** — cannot be verified here without a live provider; asserting an
  external post-state would be fabricated evidence (forbidden hard-stop).
- **Enterprise mutations** — real but config-tier consequence; weaker demonstration.
- **Payment** — REFUSED until PG-08; not a candidate.

## Environment note (honest)
Node 20.20.2 here; the kernel manifest declares Node v22.22.2 + TS 6.0.3. The
prebuilt kernel suites pass in-scope (negative-controls 21/21, mutations 16/16,
erp 16/16); `self-tests` need Node 22 (`ERR_UNKNOWN_BUILTIN_MODULE`). This does
not affect exercising Data IMPORT, which runs on the Desktop's own toolchain.

## STATUS: PHASE B READY
Selected action: **Data IMPORT**. Awaiting your approval of this selection before
any Phase B design/integration. No code edited; source byte-for-byte unchanged.
