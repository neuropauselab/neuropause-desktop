# Regulatory Reviewer Briefing Pack — NeuroPause

**Prepared by:** COMPUTER_B (machine), read-only measurement · **Date:** 2026-09-12
**Purpose:** to let a qualified regulatory reviewer answer §7, §12, §13, §14 and §17 of
`NP-GLOBAL-PILOT-003-HUMAN-DECISION-FORM` without repeating the discovery work.

> **This pack makes no determination.** Every statement below is either a measurement (stated as such)
> or a quotation. The machine has not assigned a classification, has not decided medical purpose, and
> must not. Form §13 states it explicitly: *"Machine must not assign any class."*

---

## 1. What you are being asked to decide

Four fields are blocked on you, and nothing downstream moves until they are answered:

| Form § | Determination required |
| --- | --- |
| **§7** | Is there a **medical purpose**? `YES / NO / UNKNOWN-FURTHER-REVIEW` — and UNKNOWN must not be converted to NO |
| **§12** | **Qualification** per jurisdiction — does the function fall within each framework? |
| **§13** | **Classification** — US class · EU class (I/IIa/IIb/III) · India class (A/B/C/D). Only after §12 |
| **§14** | **Regulatory pathway** per jurisdiction, or a documented non-device basis |
| **§17** | Named reviewers: regulatory · clinical (if any clinical role) · data-protection/legal |

Closure rule (form §20): the gate closes only when §§1–17 are complete, §18 carries a genuine human
approval, no critical claim conflict is unresolved, and the record is traceable to a human authority.

---

## 2. Measured technical description of the product

From the repository at commit `f0ba0e8f` (tag `v1.0.0-rc.29`), branch `cert/data-import-cst-integration`:

- **`apps/desktop`** — the product. Electron main + preload + React renderer, ~223k LOC, 620+ test files.
  Self-described as *"a local-first enterprise desktop workspace: 104 certified business modules across
  13 families (Finance 21, HR 15, Manufacturing 12, Maintenance 10, CRM 8, Warehouse 8, Sales 7,
  Procurement 7, Inventory 7, Projects 4, Executive 3, Helpdesk 1, Documents 1)"*.
- **`apps/backend`** — optional Express peer: OAuth PKCE auth, store, orgs, devices, billing, license,
  sync, semantic search (Postgres 16 + Redis 7 + Qdrant). The desktop degrades gracefully without it.
- **`apps/mobile`, `apps/web`, `apps/cloud`** — present; `cloud` is a 91-line preview scaffold, not a
  running service.
- **`packages/`** — 45 packages. `packages/shared` is the one package the desktop imports.

**Measured this session:** 5,617 tracked files; source digest `a9afa5e1f91bf8aa…`;
`apps/backend` typecheck exit 0; 450/450 tests passing across 39 test files.

---

## 3. The finding that most affects your determination

The product ships a **medical device lot-traceability surface**.

- Location: `apps/desktop/src/renderer/src/medicalDevices/` — `MedicalDevicesView.tsx`,
  `medicalDevicesModel.ts`, `ProductsPanel.tsx`, `LotCenterPanel.tsx`, `TraceabilityPanel.tsx`.
- Shared types: `packages/shared/src/types/medicalDeviceLot.ts`, `medicalDeviceApi.ts`
  (`MedicalDeviceLot`, `DeviceLotListItem`, `DeviceLotPage`, `LotStatus`).
- **It is reachable in the shipping app**: routed in `apps/desktop/src/renderer/src/shell/AppShell.tsx`
  (`case 'medical-devices': return <MedicalDevicesView />`), declared in `shell/sections.ts`, and
  surfaced on the home view (`AiHomeView.tsx`, e.g. *"Batches in quarantine"*).
- Modelled lot statuses, verbatim from `medicalDevicesModel.ts`:
  `created · quarantined · released · blocked · partially_consumed · consumed · exhausted · expired · recalled`

**What this is:** inventory, lot/batch tracking, quarantine and recall handling **for** medical device
stock, with a traceability view.

**What the measurement does NOT show:** any diagnostic, therapeutic, monitoring, prediction, prognosis
or clinical-decision-support function. No patient data model, no physiological measurement, no clinical
algorithm was found.

**Why it still matters to you:** software that manages medical device *distribution and traceability*
can attract economic-operator, UDI and record-keeping obligations independently of whether it is itself
a device — EU MDR Art. 13/14 (importer/distributor), FDA establishment registration and device listing
for distributors, and India MDR 2017 distribution/traceability duties. That is a separate question from
SaMD qualification, and the repository cannot answer it: it depends on who deploys this, in what role,
and in which supply chain.

---

## 4. The "governance/computation-only" basis, and its limits

Form §9 carries this machine OBSERVATION:

> *"repository evidence supports **governance/computation-only** as the current technical description;
> it neither supports nor refutes any clinical claim (none present). This is an observation, **not** a
> determination."*

That observation is accurate as far as it goes, and I reproduced it: a lexical sweep for
`diagnos|clinical|patient|therapy|treatment|symptom|biomarker|prescription` across `apps/*/src` and
`packages/*/src` returns 239 files, and spot-checking shows these are overwhelmingly non-clinical uses
(`healthcheck` endpoints, error `treatment`, settings text).

**Its limits, stated plainly:**
1. It is a statement about *code as measured*, not about *intended use*. Intended use is §3 and is yours.
2. Absence of a clinical claim is not a non-device basis. Form §9's own rule and the record's
   `no_absence_based_classification` field both forbid converting *"no clinical claim found"* into
   *non-medical / research-only / exempt*.
3. It predates the medical-device lot surface described in §3 above being brought to a reviewer's
   attention.

---

## 5. Jurisdiction register

Scoped set is US, EU, India (`NP-002`). Adding others is a separate human scope decision (form §11).

| Jurisdiction | Framework named in the record | Entry determinant |
| --- | --- | --- |
| **US** | FDA device definition; Digital Health Policy Navigator **Step 1** | *Is the software function intended for a medical purpose?* — an intended-use question, not a code fact |
| **EU** | MDR 2017/745 **Art. 2** software qualification; **Rule 11** classification | qualification precedes classification |
| **India** | CDSCO SaMD guidance under **Medical Devices Rules 2017** | class A/B/C/D |

These framework references are quoted from the A-authored form and readiness records as of 2026-09-09.
**Confirm currency yourself** — I performed no network access and cannot verify they are current.

---

## 6. What evidence exists, and what does not

**Exists and is measured:**
- Source identity: HEAD, tree, branch, per-file digests over 5,617 tracked files
- Execution records: typecheck exit 0; pilot suite 32/32; full backend suite 450/450 — each bound to the
  exact tree digest and environment it ran against (`TR-GPR-03`)
- Authority enforcement: deny-by-default, with a positive control proving it is not merely always-denying
- A state snapshot object with every field the baseline requires (`TR-GPR-01`)

**Absent — and you should not assume otherwise:**
- No intended-use statement exists in any custody (form §3 observation)
- No **build invocation** record: `BUILD_INVOCATION_EXISTS: False`, `BUILDER_IDENTITY_EXISTS: False`
- No release or distribution record: `RELEASE_RECORD: 0`, `DISTRIBUTION_RECORD: 0`, `TAG: 0 tags in A custody`
- No signing, no key generation, no transparency log entry
- `SLSA_LEVEL_ASSIGNED: NONE`; `IN_TOTO_COMPLIANCE_CLAIMED: false`; `SIGSTORE_USED: false`
- Verification: `VERIFIER_IDENTITY = NOT_DESIGNATED`; A.157 `NOT_EXECUTED`
- Two of the four pilot claims (PC-02 NPC 1.2, PC-03 NPMS 1.4) depend on A-custody instruments
  (`verify_npc.py`, `verify_npms.py`) that are **not present on this machine** and therefore cannot be
  measured here at all
- The certification baseline on disk is frozen at commit `40616b9d` (2026-08-21, desktop `rc.20`) —
  **292 commits behind** current HEAD

---

## 7. What I did not do

- No classification, qualification, pathway or medical-purpose determination
- No network access of any kind; framework references are quoted, not verified
- No baseline designation — the snapshot object deliberately carries `DESIGNATED: false`
- No claim adoption — all four pilot claims remain `NEITHER_ADOPTED_NOR_EXCLUDED`
- No modification of the certified evidence baseline (HEAD `f0ba0e8f`, porcelain 16, digest `27302b87`
  remains reproducible in the original worktree)

---

## 8. Suggested order of work

1. Author **§3 intended use** first — §§7, 12, 13, 14 all follow from it and cannot be answered before it.
2. Decide **§2 product scope**: is this decision about the CST governance kernel only, the desktop
   product, or the integrated system? The answer changes whether §3 above is even in scope.
3. Then §7 medical purpose, then §12 qualification per jurisdiction, then §13 classification, then §14 pathway.
4. Record §17 reviewers and §16 evidence relied upon; the operator signs §18.

Classification follows intended use, never the reverse.
