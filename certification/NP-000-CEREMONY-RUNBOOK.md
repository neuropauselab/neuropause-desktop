# NP-000 — THE CEREMONY RUNBOOK
### 21 Aug 2026 · **THE FIRST COMMITTED CEREMONY PROCEDURE THIS PROGRAMME HAS HAD** · ⛔ NOT AUTHORIZED

> ## PROVENANCE — READ THIS BEFORE THE PROCEDURE
>
> **THE ORIGINAL "NINE STEPS" ARE NOT RECONSTRUCTED HERE, AND CANNOT BE.** They were presented in a session and
> never committed (**F-P27**). A repo-wide search finds no runbook file and no `OPERATOR-ACTION` marker anywhere
> in `certification/`. **Nothing in this file is a recollection of them.**
>
> **This runbook is written from what is true NOW, against the ARTIFACT, from artifacts.** Where a step cannot be
> sourced it says **UNKNOWN** and names what would establish it. **RECORD SUPERSEDES RECOLLECTION** — including
> for us.
>
> **CLOSES F-P27 and F-P31.** *Closed* here means the correction was **VERIFIED**, not that a file exists: this
> was written against the built artifact rather than the source (**F-P10**), it names the real control path rather
> than the DEV-gated one (**F-P14**), and **every precondition below is checkable by a command whose expected
> output is stated.** A runbook whose preconditions cannot be checked would not close anything.

---

## 0 · WHEN THIS MUST NOT BE RUN

> **NO OPERATOR-IN-THE-LOOP STEP AT THE END OF A LONG SITTING.**

The 18:19 breach happened in exactly those conditions. F-P13's root cause was *a stated precondition without a
check*; this is its sibling and it is about **the human, not the machine**. A fresh sitting, a rested operator.

**Also true before step 1, and not negotiable:**
- **P1 must have closed** — attempt 2 run to a recorded result against `P1-REPRODUCTION-RUNBOOK-v2.md`. Until
  then the ceremony's central step cannot be demonstrated, which is why P1 is BLOCKS-SEND (b).
- **`first-real-send.latch` at `~/NeuroPause-S54-r3/` is SPENT and PRESERVED.** A real send is **structurally
  impossible** until the operator deliberately deletes it. That deletion is **the operator's alone**, is not part
  of this procedure, and is recorded as deferred. **Claude never deletes it, never re-arms it, and never asks for
  it to be deleted.**

---

## 1 · SAFETY CONFIGURATION

### 1.1 · QUIT AND VERIFY — MAINS ONLY, EXACT ZERO *(F-P13's gate, EXECUTED — it already exists)*

```bash
pkill -f 'Electron.*--user-data-dir=.*NeuroPause' || true
sleep 2
MAIN_COUNT=$(ps -axww -o pid=,command= \
  | grep '[E]lectron.*--user-data-dir=.*NeuroPause' \
  | grep -v -- '--type=' | wc -l | tr -d ' ')
echo "MAIN_COUNT=$MAIN_COUNT"
```
**VERIFY:** `MAIN_COUNT` prints **exactly `0`**. **AGAINST:** the live process table, mains only — `--type=`
helpers excluded, because counting them makes the gate fire for a harmless reason (**F-P29**), and *false
positives on a safety gate are dangerous through habituation, not through logic*.

> **EXPECT A DELAYED EXIT (F-P30).** On 20 Aug a main ran its shutdown barrier to completion, called `app.quit()`,
> **and kept running normal timers for ~6.5 minutes.** Re-check on a **60-second cadence up to ~10 minutes**
> before concluding anything. **Do not improvise a stronger termination** — SIGKILL escalation is ruled
> separately, with the process state in hand.

### 1.2 · SNAPSHOT BEFORE ANY SECOND QUIT — **THE FLUSH IS SPENT ONCE** *(F-P31)*

> **If a quit has already been attempted in this sitting, the shutdown flush has already run and WILL NOT RUN
> AGAIN.** `index.ts` latches `shutdownFlushed = true` after the first `will-quit` pass and early-returns
> thereafter.
>
> **THE CONSEQUENCE, stated here and not in a footnote: a second quit silently drains NOTHING.** Seven stores —
> `app-log`, `org-store`, `workspace-store`, `governance-store`, `enterprise-module-stores`, `platform-timeline`,
> `workspace-contexts` — keep whatever is in memory and lose it. **Up to one debounce interval of governed state,
> gone, with no error and no log line.** That is the exact defect P13C Round 37 built the barrier to fix,
> reappearing because the barrier is single-shot.
>
> **SO: SNAPSHOT THE PROFILE BEFORE THE SECOND QUIT, NOT AFTER.**

```bash
rsync -aH "$PROFILE/" "$EVIDENCE/snapshot-$(date +%H%M%S)/"
( cd "$EVIDENCE/snapshot-"* && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 > ../MANIFEST.sha256 )
```
**VERIFY:** the manifest lists a non-zero file count, and `grep -c "Shutdown flush" "$PROFILE/logs/app.log"`
tells you how many barrier passes have already occurred. **AGAINST:** `0` means no quit yet and the next one will
flush; **`1` or more means the barrier is spent and the next quit will not.**

### 1.3 · THE ARTIFACT — CONTENT-VERIFIED, NOT NAMED BY FILE

```bash
A=apps/desktop/out/main/index.js
grep -c 'propose refused' $A          # expect 1  — P4-MIN's refusal emitter
grep -c 'installE2eSeedPrincipal' $A  # expect 2  — the seed rail
```
**VERIFY:** both counts match. **AGAINST:** the 22:18:45 build — `index.js` sha256 `ee5e8e99…0e138c0`, seed chunk
`e2eSeed-NKS_iH8j.js` sha256 `a54bc5b2…daf29`.

> **⚠️ `npm run dev:desktop` OVERWRITES THIS ARTIFACT.** `electron-vite` declares no `outDir`. **Do not run it.**
> **CUSTODY COPY:** `~/NeuroPause-S54-r3-evidence/artifact-2218/` (87 files, manifest `b3c7a899…5e79fad`).
> **Restore from the copy rather than rebuilding — a rebuild is a different artifact.**

### 1.4 · THE TENANT — OPERATOR-ACTION, PARTLY UNKNOWN

The Azure app registration and consent are the operator's, performed outside this machine.

- **Recorded from the r3 sitting:** minimum delegated scopes were configured and admin consent granted; **all
  seven consent items showed green.**
- **UNKNOWN: the exact portal navigation for each step.** *What would establish it:* one performed run,
  transcribed verbatim into this file.
- **Recorded and unresolved (F-N16-5 / F-1):** the manifest requests **22** scopes and the tenant granted **21**
  — the delta is `offline_access`, which Microsoft consumes rather than echoes. **The consent screen shows fewer
  items than the manifest asks for**, and that gap is a known open finding, not a fault in this procedure.

---

## 2 · LAUNCH

```bash
cd /Users/saurabhpatel/Desktop/neuropause-desktop/apps/desktop
NODE_ENV=production NP_E2E_BUILD=1 NEUROPAUSE_E2E=1 \
  ../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  --user-data-dir=$PROFILE out/main/index.js
```

**VERIFY the rail is armed:** `grep -c 'E2E-SEED' "$PROFILE/logs/app.log"` returns **non-zero**.
**AGAINST:** the seed's own log line. **THE LOG LINE IS THE AUTHORITATIVE CHECK — the window title is a red
herring**, recorded as such after NP-007.

**HONEST BOUND:** the exact environment of the 20 Aug launch was never recorded. This line reproduces the
**observed** behaviour, not a transcript of the original.

---

## 3 · THE PROCEDURE — **THE REAL CONTROL PATH** *(this is F-P10 and F-P14 closing)*

> **THE DEV-GATED "Propose (dev)" BLOCK IS NOT THE CONTROL PATH.** `EntraConnectorPanel.tsx:274` wraps it in
> `import.meta.env.DEV`, so **in this production artifact it does not render.** Any procedure naming it is
> describing the repository, not the artifact. **It is not used here.**
>
> **AND "Open connectors" DOES NOT OPEN THE MICROSOFT PANEL.** It navigates to the connector **list**. The panel
> mounts only on the **detail** view, so step 4 is required and is a separate click.

1. **Ask the assistant, in one turn.** The r3 turn, verbatim from the stored conversation:
   > `Send an email to neuropause033@gmail.com about NeuroPause S5.4 Brain-proposed ceremony verification`
2. **VERIFY the reply carries the affordance.** The envelope must show `mailIntent` **and** `navigation`. Both are
   set together, and only in ask-mode (`assistantService.ts:363-368`). **AGAINST:** the reply's own text —
   *"I've prepared an email to … Open the Microsoft 365 panel in the Connector Center"*.
3. **Click "Open connectors"** — the one declared mechanism. **No sidebar, shortcut, restored session, deep link
   or back-navigation.** Any other route voids the run.
4. **Click the Microsoft connector card** in the list. This is an in-section **selection**, not a second
   navigation. On a fresh profile the first connector auto-selects and **may not be Microsoft**.
5. **OBSERVE AND STOP.** Record: whether the eight-field review card rendered · whether the compose form
   prefilled · what the log emitted.

> **F-P21 APPLIES HERE AND IS UNFIXED.** **The eight-field review leaves NO DURABLE TRACE.** `brainReview` crosses
> IPC, renders, and is never persisted. **So step 5's central observation rests on operator transcription — the
> weakest evidence source in the chain.** Photograph or screen-record the panel. This is stated rather than
> papered over: it is a Bucket-1 blocker whose fix is emitter work, authorized separately.

**READ THE EMISSION:**
```bash
grep -nE 'propose refused|brain-propose-lane|Tenant refused|Tenant resolution RECOVERED' "$PROFILE/logs/app.log"
```
Then **read every line of the window**, not only the greps — that discipline has surprised us four times.

---

## 4 · THE HARD STOP

**The procedure ends at the observation.** Confirm nothing. Send nothing.

**A real send requires, in this order and by the operator alone:** the latch decision (§0) · an explicit
step-by-step direction · and an explicit go. **Claude supplies no credential, no consent, no confirmation, and
never clicks Confirm.**

---

## 5 · IMMEDIATELY AFTER A REAL SEND — CONTAINMENT

**`certification/CONTAINMENT-PROCEDURE.md` is the immediate next step**, and it carries its own label, repeated
here so it is not mistaken for a validated procedure:

> **PREDICTIVE, NOT VALIDATED — sourced from CLAUDE §1, not from a performed run. No step in it has ever been
> performed.** Revoke consent → delete the app registration → remove the profile, each with a VERIFIED step, and
> **evidence copied out BEFORE containment**, because containment is destructive by design.

**It does not un-send.** Containment ends future reach; it does not reach backwards.

---

## 6 · WHAT IS UNKNOWN IN THIS RUNBOOK

Named rather than invented, per the standing rule:

| Unknown | What would establish it |
|---|---|
| The original nine steps | **Nothing available.** They exist in no file and cannot be reconstructed from artifacts. **Not attempted.** |
| Azure consent / registration navigation | one performed run, transcribed verbatim |
| The exact 20 Aug launch environment | it was never recorded; this file reproduces observed behaviour only |
| Whether revocation kills a live token or only prevents refresh | an observed attempt after revocation — itself an external action needing its own ruling |
| The ceremony's own success criterion beyond "VERIFIED_SUCCESS" | operator ruling |

**Everything else above is sourced from an artifact, a preserved log, or committed source, and every VERIFY names
what is checked and what it is checked against.**
