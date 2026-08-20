# P1 — CONTROLLED REPRODUCTION RUNBOOK
### Staged 20 Aug 2026 · **NOT AUTHORIZED — hand to the operator cold, at the start of a fresh sitting**

> **P1 = AWAITING CONTROLLED REPRODUCTION.** The historical A/B event of 18:16:59 is **CLOSED AS UNKNOWN** and is
> not reopened. This runbook answers the **MECHANISM** question only: *does a second handoff consumption produce a
> proposal attempt, and if it refuses, why?*
>
> **Required phrasing, unchanged:** *"A silent unresolved-TENANT-SCOPE branch EXISTS and is CAPABLE of producing
> the observed result, but the ceremony evidence does not establish that it occurred."*

---

## 0 · WHY THIS IS NOT RUN AT THE END OF A LONG SITTING

**PROTOCOL ITEM (operator, 20 Aug 2026): NO OPERATOR-IN-THE-LOOP STEP AT THE END OF A LONG SITTING.**

The 18:19 breach happened in exactly those conditions. F-P13's root cause was *a precondition without
verification*; this is its sibling and it is about **the human, not the machine**. It sits alongside the
process-list gate as a standing ceremony precondition.

## 1 · SAFETY CONFIGURATION — ALL FOUR BEFORE ANYTHING LAUNCHES

Discipline alone failed on 20 August. These are device-level, not discipline-level.

### 1.1 · QUIT r2 AND r3, VERIFIED BY PROCESS LIST — *F-P13's gate, applied rather than recorded*

```bash
pkill -f 'Electron.*--user-data-dir=.*NeuroPause-S54' || true
sleep 2
ps aux | grep -c '[E]lectron.*NeuroPause-S54'      # MUST print 0 — do not proceed otherwise
```

> **A per-profile safety device does not protect a multi-instance desktop.** The FG-4 latch is per-profile; a
> second instance on another profile carries its own absent one. **Verification is the gate, not the intention.**

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

### 1.3 · THE ARTIFACT ALREADY CARRIES P4-MIN — *verified by content, not filename*

Built **2026-08-20 22:18:45**. Do **not** rebuild unless source changes; if you do, re-verify by content:

```bash
A=apps/desktop/out/main/index.js
grep -c 'propose refused' $A          # MUST be 1 — P4-MIN's emitter
grep -c 'installE2eSeedPrincipal' $A  # MUST be 2 — the seed rail
```

`index.js` sha256 `ee5e8e99…0e138c0` · seed chunk `e2eSeed-NKS_iH8j.js` sha256 `a54bc5b2…daf29`.

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
*observed* r3 behaviour (the seed log line appeared, so `NEUROPAUSE_E2E=1` was set) — it is a reconstruction of the
conditions, not a transcript of them. **Step 1 remains the seed LOG LINE, not the window title.**

> **AMENDMENT 4 — THE CONSEQUENCE, SPELLED OUT RATHER THAN LEFT AS A CAVEAT:**
>
> **THE REPRODUCTION TESTS THE MECHANISM UNDER A RECONSTRUCTED ENVIRONMENT, NOT THE EPISODE. A NEGATIVE RESULT
> DOES NOT EXONERATE THE 20 AUGUST CONDITIONS.**
>
> If this run produces a proposal cleanly, that establishes the mechanism works *here*. It says nothing about what
> happened on 20 August, which is **CLOSED AS UNKNOWN** and stays closed.

## 3 · THE PROCEDURE

> **AMENDMENT 3 — EXACTLY ONE NAVIGATION MECHANISM, DECLARED IN ADVANCE.** On 20 August the mechanism was the
> uncontrolled variable, and that is precisely why the episode is unknowable. **The declared mechanism for this
> run is the assistant's "Open connectors" button, and nothing else.** Do not use the sidebar, a keyboard
> shortcut, a restored session, a deep link, or a back-navigation to reach the connectors section. If the section
> is reached by any other means, **the run is void — abandon it and restart on a fresh profile.**

1. Ask the assistant, in one turn, for a mail send — the same shape as 20 Aug.
2. Confirm the reply carries the navigation affordance.
3. Click **"Open connectors"** — **the one declared mechanism.** *(This is the button whose use on 20 Aug is
   permanently unknown. Using it here, and only it, is the point.)*
4. Select the **Microsoft** connector card in the connector list. The panel mounts only on the **detail** view,
   not on the section — so this click is required, and it is an **in-section selection**, not a second section
   navigation. On a fresh profile `selectedId` starts null and auto-selects the first connector, which may not be
   Microsoft; select it by clicking the card.
5. **OBSERVE AND STOP.** Record whether the eight-field review card renders, whether the compose form prefills,
   and what the log emits.

> **KEEP THE WINDOW QUIET.** From launch to observation, perform **no other activity in the app** — no other
> panel, no sync trigger, no settings change. Attribution in step 4's tree depends on it (see Amendment 2).

## 4 · PRE-REGISTERED DECISION TREE — *declared before the run*

```
DID A PROPOSAL ATTEMPT OCCUR?
  ├── `propose refused — <REASON>`            → P4-MIN fired. Record the EXACT reason.
  ├── `Brain proposal stashed …` (INFO)       → success. Follow the artifact / review path.
  ├── one of the lane's THREE warns           → :92 / :109 / :162. Record which.
  └── NEITHER LOGS  → AMENDMENT 1: this is not vague. It is EXACTLY TWO possibilities:
        (a) NO PROPOSE CALL WAS MADE  — the handoff was not consumed; or
        (b) brainProposeLane :81 FIRED — response.ok true, artifact non-null, the lane
            returned null on an unresolved TENANT SCOPE, and NOTHING is emitted on the
            propose path. P4-MIN closed the `!response.ok` half of the dual silence;
            :81 REMAINS SILENT and is queued as P4-MIN-b, deliberately not landed before
            this run.
      DISCRIMINATE (a) FROM (b) WITH THE RESOLVER LINES — see Amendment 2.
```

**Fifth row, which has paid off on every artifact read so far:** anything bearing on something **other** than this
question is recorded as **its own finding**, never forced into the tree.

> **AMENDMENT 2 — THE :81 BRANCH IS COVERED BUT UNCORRELATED.**
>
> The resolver logs **every** tenant refusal through its single `refuse()` helper, and suppression cannot hide a
> `firstRefusalAfterSuccess: true` line. **So if :81 fires, a resolver WARN WILL appear.**
>
> **But that WARN says a tenant refusal occurred — NOT that it occurred FOR THE PROPOSE.** That is P2's absence
> again: no correlation identity ties a resolver line to a propose call.
>
> **PRE-REGISTERED, so it cannot be over-read after the fact:**
> - Resolver tenant lines are **part of the observation set** and are recorded verbatim.
> - **A resolver WARN is NOT evidence of a propose refusal.** It is evidence that *something* could not resolve a
>   tenant.
> - Attribution is **BY EXCLUSION ONLY**, and only because the window is kept quiet: with no other activity, a
>   resolver line in the window is *most plausibly* the propose — **plausibly, not established.**
> - **No resolver line + no propose emission ⇒ branch (a)**, no propose call was made.

**Read the emission with:**
```bash
grep -nE 'propose refused|brain-propose-lane|Tenant refused|Tenant resolution RECOVERED' \
  $PROFILE/logs/app.log
```
Then read **every line** of the window rather than only the greps — that discipline has surprised us three times.

**REFUSAL OBSERVED ≠ GOVERNANCE CORRECTNESS ≠ EXECUTION ≠ EXTERNAL EFFECT ≠ VERIFICATION.** The emitter
establishes that a refusal **occurred**. It cannot establish that the refusal was **correct**, and it certainly
cannot establish that the external world **changed**.

## 5 · THE BUILD BOUNDARY APPLIES TO WHATEVER THIS PRODUCES

The 20 Aug log came from a **five-emitter** build; this artifact has **six**. Silence at the propose boundary now
means *"no refusal occurred"* — **which it did not mean on 20 August.** Do not compare the two logs' silences.
**RUN A ≠ RUN B UNLESS THE EVIDENCE CHAIN ESTABLISHES THEIR RELATIONSHIP.**

## 6 · AFTERWARDS

Snapshot the whole profile directory with a per-file sha256 manifest **before reading anything from it**.
Preserve first, read second — the directory, not a list.
