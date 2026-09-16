# P1 — CONTROLLED REPRODUCTION RUNBOOK **v2**
### Staged 20 Aug 2026 · **NOT AUTHORIZED** — hand to the operator cold, at the start of a fresh sitting

> ## LINEAGE
>
> **Predecessor:** `certification/P1-REPRODUCTION-RUNBOOK.md`, frozen at **`f309451`**.
> **Reason for this file:** **ATTEMPT 1 was executed against `f309451` and STOPPED AT §1.1** — the quit-and-verify
> assertion did not print 0. That attempt is a **closed record against `f309451` forever**, and `f309451` is
> **not edited**. A record of what was done must point at the document **as it was, not as it became** — F-P27's
> lesson applied to ourselves.
> **Changes from v1:** the §1.1 predicate (F-P29) and the shutdown expectations (F-P30). Everything else is
> carried over unchanged, including all four amendments.

---

## 0 · WHY THIS IS NOT RUN AT THE END OF A LONG SITTING

**NO OPERATOR-IN-THE-LOOP STEP AT THE END OF A LONG SITTING.** The 18:19 breach happened in exactly those
conditions. F-P13's root cause was *a precondition without verification*; this is its sibling and it is about
**the human, not the machine**.

## 1 · SAFETY CONFIGURATION — ALL FOUR BEFORE ANYTHING LAUNCHES

### 1.1 · QUIT AND VERIFY — **MAINS ONLY, EXACT ZERO** *(corrected — F-P29)*

```bash
pkill -f 'Electron.*--user-data-dir=.*NeuroPause-S54' || true
sleep 2
MAIN_COUNT=$(ps -axww -o pid=,command= \
  | grep '[E]lectron.*--user-data-dir=.*NeuroPause-S54' \
  | grep -v -- '--type=' | wc -l | tr -d ' ')
echo "MAIN_COUNT=$MAIN_COUNT"      # MUST be exactly 0 — do not proceed otherwise
```

> **F-P29 — PROCESS-IDENTITY GATE AMBIGUITY (the narrow statement, which must travel with it):**
> The v1 assertion counted Electron **helper** processes as well as the NeuroPause-S54 **main**, so a non-zero
> result did **not** establish that a main survives, while a churning helper population made the gate unstable.
> The gate must identify and count **only mains**, excluding `--type=` helpers, and require an **exact zero**.
>
> **F-P29 does NOT say the runbook was unsafe in outcome.** It says the **predicate was insufficiently
> discriminating**. In attempt 1 the gate **failed safely** — a main *was* in fact still alive. **IMPRECISE AND
> CORRECT.**
>
> **The sharpening:** the predicate **cannot produce a false negative** — a main is always counted — so it
> produces **only false positives**, and **FALSE POSITIVES ON A SAFETY GATE ARE DANGEROUS THROUGH HABITUATION,
> NOT THROUGH LOGIC.**
>
> **The law: A SAFETY GATE MUST TEST THE EXACT DANGEROUS STATE, NOT MERELY A CORRELATED PROCESS SIGNATURE.**
> Filed with **THE INSTRUMENT IS PART OF THE SYSTEM UNDER TEST**.

> **F-P30 — EXPECT A DELAYED EXIT, AND DO NOT IMPROVISE.** In attempt 1 the main process received SIGTERM, ran
> its `will-quit` barrier to completion (`Shutdown flush complete {"ran":7,"failed":[],"timedOut":[],
> "durationMs":2}`), called `app.quit()` — **and kept running normal supervisor timers for ~6.5 minutes before
> actually exiting**, leaving orphaned helpers that outlived it briefly.
>
> **So `MAIN_COUNT` may be non-zero simply because the exit is slow.** Re-check on a **60-second cadence up to
> ~10 minutes** before concluding anything. **Do NOT escalate to SIGKILL** — escalation is ruled separately, with
> the process state and shutdown behaviour in hand.
>
> **AND THE LATCHED-BARRIER DEFECT THAT RIDES WITH IT:** `index.ts` sets `shutdownFlushed = true` after the first
> pass and `will-quit` early-returns thereafter — so **a second quit issued during that window does NOT flush any
> store.** If a first quit has already been attempted, treat any subsequent quit as **non-flushing**, and snapshot
> before it rather than after.

### 1.2 · PRE-ARM THE LATCH — *make a send structurally impossible*

```bash
PROFILE=~/NeuroPause-P1-repro
mkdir -p "$PROFILE"
printf '{"at":"PRE-ARMED — P1 reproduction, no send permitted","to":[]}' > "$PROFILE/first-real-send.latch"
ls -la "$PROFILE/first-real-send.latch"            # MUST exist before launch
```

**Why this works, from source:** `firstRealSendGuard` checks `existsSync(latch)` and **returns before the
`writeFileSync`**, so a pre-placed latch makes any send refuse **and is not rewritten by the attempt**. The
20 Aug r3 latch is untouched by this and stays preserved.

### 1.3 · CONTENT-VERIFY THE ARTIFACT — *not filenames*

```bash
A=apps/desktop/out/main/index.js
grep -c 'propose refused' $A          # MUST be 1 — P4-MIN's emitter
grep -c 'installE2eSeedPrincipal' $A  # MUST be 2 — the seed rail
```

Built 2026-08-20 22:18:45 · `index.js` sha256 `ee5e8e99…0e138c0` · seed chunk `e2eSeed-NKS_iH8j.js` sha256
`a54bc5b2…daf29`. **Re-verify by content if anything is rebuilt; do not assume a hash changed or did not.**

> **⚠️ HAZARD — `npm run dev:desktop` OVERWRITES THIS ARTIFACT.** `electron-vite` declares no `outDir`, so dev
> mode builds straight into `apps/desktop/out/`. **Do not run it before attempt 2.** It was protected until
> 21 Aug only by nobody typing that command.
>
> **CUSTODY COPY:** `~/NeuroPause-S54-r3-evidence/artifact-2218/` — 87 files, manifest
> `MANIFEST-artifact-2218.sha256` (`b3c7a899…5e79fad`). The 16:12 predecessor is beside it at `artifact-1612/`
> (`d6e3a948…0fcae96`), so the pair brackets both builds: 16:12 has **zero** occurrences of `propose refused`,
> 22:18 has **one**. If `out/` is destroyed, restore from the 2218 copy rather than rebuilding — a rebuild is a
> different artifact.

### 1.4 · HARD STOP BEFORE SEND

**The run ends at the propose observation. Nothing is confirmed. Nothing is sent.** A second external effect is
PROHIBITED.

## 2 · LAUNCH

```bash
cd /Users/saurabhpatel/Desktop/neuropause-desktop/apps/desktop
NODE_ENV=production NP_E2E_BUILD=1 NEUROPAUSE_E2E=1 \
  ../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  --user-data-dir=$PROFILE out/main/index.js
```

**Honest bound:** the exact environment of the 20 Aug r3 launch was never recorded. This line reproduces the
*observed* behaviour (the seed log line appeared, so `NEUROPAUSE_E2E=1` was set). **Step 1 remains the seed LOG
LINE, not the window title.**

> **AMENDMENT 4 — THE CONSEQUENCE:** **THE REPRODUCTION TESTS THE MECHANISM UNDER A RECONSTRUCTED ENVIRONMENT,
> NOT THE EPISODE. A NEGATIVE RESULT DOES NOT EXONERATE THE 20 AUGUST CONDITIONS.**

## 3 · THE PROCEDURE

> **AMENDMENT 3 — EXACTLY ONE NAVIGATION MECHANISM, DECLARED IN ADVANCE.** On 20 August the mechanism was the
> uncontrolled variable. **The declared mechanism is the assistant's "Open connectors" button, and nothing else.**
> No sidebar, shortcut, restored session, deep link, or back-navigation. **Any other route voids the run —
> abandon it and restart on a fresh profile.**

1. Ask the assistant, in one turn, for a mail send — the same shape as 20 Aug.
2. Confirm the reply carries the navigation affordance.
3. Click **"Open connectors"** — the one declared mechanism.
4. Select the **Microsoft** connector card. The panel mounts only on the **detail** view, so this click is
   required; it is an **in-section selection**, not a second section navigation. On a fresh profile `selectedId`
   starts null and auto-selects the first connector, which may not be Microsoft.
5. **OBSERVE AND STOP.** Record whether the eight-field review card renders, whether the compose form prefills,
   and what the log emits.

> **KEEP THE WINDOW QUIET.** No other activity in the app from launch to observation. Attribution depends on it.

## 4 · PRE-REGISTERED DECISION TREE

```
DID A PROPOSAL ATTEMPT OCCUR?
  ├── `propose refused — <REASON>`            → P4-MIN fired. Record the EXACT reason.
  ├── `Brain proposal stashed …` (INFO)       → success. Follow the artifact / review path.
  ├── one of the lane's THREE warns           → :92 / :109 / :162. Record which.
  └── NEITHER LOGS  → AMENDMENT 1: EXACTLY TWO possibilities:
        (a) NO PROPOSE CALL WAS MADE  — the handoff was not consumed; or
        (b) brainProposeLane :81 FIRED — response.ok true, artifact non-null, the lane
            returned null on an unresolved TENANT SCOPE, and NOTHING is emitted on the
            propose path. P4-MIN closed the `!response.ok` half only; :81 REMAINS SILENT
            (P4-MIN-b, deliberately not landed before this run).
      DISCRIMINATE (a) FROM (b) WITH THE RESOLVER LINES — Amendment 2.
```

**Fifth row:** anything bearing on something **other** than this question is recorded as **its own finding**,
never forced into the tree. *(In attempt 1 this row carried the entire result.)*

> **AMENDMENT 2 — THE :81 BRANCH IS COVERED BUT UNCORRELATED.** The resolver logs every tenant refusal through
> its single `refuse()` helper and suppression cannot hide a `firstRefusalAfterSuccess: true` line, **so a :81
> event WILL produce a resolver WARN. But that WARN says a tenant refusal occurred — NOT that it occurred FOR THE
> PROPOSE.** Pre-registered: resolver lines are part of the observation set; **a resolver WARN is NOT evidence of
> a propose refusal**; attribution is **by exclusion only and plausible-not-established**; and **no resolver line
> + no propose emission ⇒ branch (a)**.

```bash
grep -nE 'propose refused|brain-propose-lane|Tenant refused|Tenant resolution RECOVERED' $PROFILE/logs/app.log
```
Then read **every line** of the window, not only the greps — that discipline has surprised us four times.

## 5 · THE BUILD BOUNDARY

The 20 Aug log came from a **five-emitter** build; this artifact has **six**. Silence at the propose boundary now
means *"no refusal occurred"* — **which it did not mean on 20 August.** Do not compare the two logs' silences.
**RUN A ≠ RUN B UNLESS THE EVIDENCE CHAIN ESTABLISHES THEIR RELATIONSHIP.**

## 6 · AFTERWARDS

Snapshot the whole profile directory with a per-file sha256 manifest **before reading anything from it**.
**Preserve first, read second — the directory, not a list.** Take it **after** a confirmed exit
(`MAIN_COUNT = 0`); if the exit is delayed or a quit has already been attempted once, snapshot **before** any
further quit, because a second quit does not flush (F-P30).
