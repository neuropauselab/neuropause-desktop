# D-6 — AUTHORIZATION ERROR CONTRACT

**Date:** 2026-08-31 · **Branch:** `cert/data-import-cst-integration` · **Base HEAD:** `f1dbb0e`
**Gate:** D-6 (PROGRAM-13C-GATE-MATRIX line 25) · **Previous status:** `NOT TESTED — Not implemented`
**New status:** **CODE-COMPLETE · TEST-VERIFIED** (no external machine required)

---

## THE DEFECT, verbatim

> **D-6 open** — authorization outcomes are distinguishable only by matching
> English prose. Rewording a message silently changes renderer behaviour.
> — `PROGRAM-13C-FINAL-CERTIFICATION.md:285`

## ROOT CAUSE — not "unimplemented"

The record said *"Not implemented."* Measured at HEAD `f1dbb0e`, that is not the
shape of the defect. **The main process already models authorization denials
correctly:**

| Typed carrier | Location | Carries |
|---|---|---|
| `AuthorizationError` | `enterprise/authz.ts:25-30` | `readonly permission: EnterprisePermission` |
| `TenantContextError` | `enterprise/authzGate.ts:66-73` | `readonly reason: TenantRefusalReason` (8 values) |

**The structure is destroyed exactly one frame before it becomes useful.**
`secureBridge.ts`'s handler catch reduced every rejection to
`new IpcError(err.message)`, and — as `lib/ipcError.ts`'s own header already
recorded — *"Electron's IPC only serializes an error's `message`, so no custom
property survives the trip."*

So the renderer received a sentence and nothing else, and each surface that had
to distinguish *"you may not"* from *"it is broken"* grew its own regex over
whatever wording main happened to use.

**The record undercounted the blast radius.** It said "3 renderer sites"; the
measured count at HEAD is **8** (522-file renderer sweep, exact-substring
counter, not the ugrep-aliased shell `grep`):

```
business/BusinessView.tsx:172              /not authorized|permission|forbidden|denied/i
enterprise/EnterpriseView.tsx:312          (same regex)
enterprise/modules/RelatedRecordsPanel.tsx:77   /not authori|permission|Sign in/i
opportunities/OpportunitiesView.tsx:109,111     /not authori|permission|procurement:read|Sign in/i
dataCommandCenter/dataCommandCenterModel.ts:598 /sign in/i
dataCommandCenter/dataCommandCenterModel.ts:605 /permission|not permitted|data:approve|data:import/i
medicalDevices/medicalDevicesModel.ts:335       /permission/i
understanding/HoldsView.tsx:79-81               ← WORSE: no test at all
```

`HoldsView` set `denied = true` on **any** rejection, so a crash or a timeout
told the user their role lacked access — a confident false claim about their
account. That site was found by an independent review agent, not by the regex
sweep, precisely because it matches no pattern.

Corroborating measurement: a 432-file renderer scan for all eight
`TenantRefusalReason` values and all six canonical denial sentences returned
**zero** hits. The renderer had no discriminant of any kind.

## SOLUTION

Since only `message` crosses, the discriminant travels in the message and is
taken off at the renderer's existing single chokepoint — the same `invoke`
frame that already attaches channel attribution.

```
AuthorizationError / TenantContextError   (typed, main)
      ↓ classifyDenial()  — reads the TYPE, never the wording
secureBridge catch → stampDenial()        "NPDENY:missing-permission|<clean message>"
      ↓ Electron IPC (message only)
lib/ipc.ts invoke → attributeDenialCode() — strips the stamp, restores the message,
      ↓                                      attaches err.ipcDenialCode
8 renderer sites → isDeniedError() / denialCodeOf()
```

**Four properties make this safe rather than merely clever:**

1. **The stamp is transport, never content.** The renderer restores the message
   byte-for-byte, so the ~80 sites rendering `err.message` are unaffected. A pin
   asserts the stamp never reaches the DOM.
2. **Prose survives as a FALLBACK, deliberately, and only when no code is
   present.** Not every denial flows through the stamping bridge — the REST
   gateway calls `runSecureHandler` directly — and deleting the prose path would
   turn a working denial banner into a blank screen, the exact failure Gate 15
   exists to prevent.
3. **The existing tenancy vocabulary is REUSED, not duplicated.**
   `TenantContextError.reason` is the canonical 8-valued answer and predates this
   contract, so `classifyDenial` reads it. **Only five of the eight are
   denials** — `not_loaded` is a cold start, `workspace_orphaned` is a data
   fault, `no_workspace` is neither. Reporting any of those as *"you do not have
   access"* would be a false claim, so they classify as `null` and surface as the
   faults they are.
4. **Unknown failures are never dressed as refusals.** A timeout, a validation
   failure, an `ENOENT` and an unrecognised tenancy reason all return `null`.

**Not touched:** `packages/shared/` (FROZEN — which is why the small vocabulary
is duplicated across the boundary rather than shared; the duplicate is held
identical by a test that reads both files, not by hope).

## FILES CHANGED

```
NEW  src/main/ipc/denialCode.ts                      the vocabulary, stamp, classifier
NEW  src/main/ipc/denialCodeContract.test.ts         20 pins
NEW  ui-tests/denialContractD6.test.tsx               5 pins (end-to-end)
MOD  src/main/ipc/secureBridge.ts                    classify + stamp in the catch
MOD  src/renderer/src/lib/ipcError.ts                unstamp, attribute, isDeniedError
MOD  src/renderer/src/lib/ipc.ts                     one line at the chokepoint
MOD  src/renderer/src/business/BusinessView.tsx      code-first (+ denied prop)
MOD  src/renderer/src/enterprise/EnterpriseView.tsx  code-first (+ denied prop)
MOD  src/renderer/src/enterprise/EnterpriseProvider.tsx   exposes `denied`
MOD  src/renderer/src/enterprise/modules/RelatedRecordsPanel.tsx
MOD  src/renderer/src/opportunities/OpportunitiesView.tsx
MOD  src/renderer/src/dataCommandCenter/dataCommandCenterModel.ts
MOD  src/renderer/src/medicalDevices/medicalDevicesModel.ts
MOD  src/renderer/src/understanding/HoldsView.tsx    any-rejection-is-denial → classified
```

## TESTS AND CHECKS

| Check | Result |
|---|---|
| `denialCodeContract.test.ts` | **20/20** |
| `denialContractD6.test.tsx` (end-to-end) | **5/5** |
| Full main suite | **913 files / 9542 passed / 7 skipped** (was 912/9522 — delta exactly +1 file/+20) |
| Full UI suite | **59 files / 359 passed** (was 58/354 — delta exactly +1 file/+5) |
| `tsc` node / web | clean / clean |
| `eslint src` | clean but for the pre-existing frozen `cst/` unused-import already in the defect log |
| `electron-vite build` | **exit 0**, built in 2.80s |

**Negative controls, both restored byte-identically (sha256 equal):**
`classifyDenial`'s typed branch neutered ⇒ 2 contract pins fail ⇒ restored ⇒ 20/20.
`attributeDenialCode` removed from the chokepoint ⇒ 1 end-to-end pin fails ⇒ restored ⇒ 5/5.

## USER WORKFLOW VERIFIED

Not unit behaviour alone. `denialContractD6.test.tsx` drives the **real
`BusinessView`** over the **real `invoke` chokepoint** and the real IPC harness.
The central pair sends the *same* sentence — `"Your role does not include this
capability."`, which matches **none** of the replaced regexes — twice:

- **stamped** → the denial state renders ("You don't have access to Business",
  no useless retry button);
- **unstamped** → the fault state renders ("Try again").

Same words, different answers, and the only difference is the machine code. A
guard assertion fails the test if that sentence ever starts matching the old
regex, so it cannot pass for the wrong reason. Two further pins hold the legacy
prose path working and an ordinary fault still reading as a fault.

## FINDINGS RECORDED, NOT FIXED

1. **VOCABULARY COLLISION (classify, do not normalize).** `TenantRefusalReason`
   (8 values, frozen `packages/shared`) and `DENIAL_CODE` (5 values) overlap
   semantically. This fix MAPS one onto the other at a single point and does not
   merge them — merging would require an FG gate on a frozen surface, and the
   F-N16-3/F-N16-4 discipline is to classify before normalizing.
2. **The literal-message branch in `classifyDenial` is a migration aid, not the
   contract.** Four denial sites still throw bare `Error`s; each is a candidate
   for conversion to a typed error, after which those branches can be deleted.
3. **14 test locations across 8 files assert production authorization prose** on
   real paths and would break if that copy changed. They are the honest half of
   the brittleness this gate names, and are untouched here.

## STATUS

**CODE-COMPLETE and TEST-VERIFIED. No external machine is required** — this gate
is renderer/main logic and is fully exercisable in CI. It is NOT
MACHINE-VERIFIED in the Gate-20 sense and makes no runtime claim about a
packaged Windows or macOS build.
