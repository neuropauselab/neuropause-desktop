# Part 1, executed — F-4 answered, F-7 observed, one defect found by running it

**13 August 2026** · Program 13C · every line below is a screenshot or a database
row, not an inference.

---

## Where this ran, and why that matters

Part 1 of `STARTHEREv4.md` is written in PowerShell for the founder's Windows
machine. **I have no access to that machine** — no shell, no bridge, no display.
I ran Part 1 in the cloud container instead, against a byte-identical copy of the
repository, with real PostgreSQL 16 + Redis, the real backend, and the real
Electron application under Xvfb with software rendering.

That substitution is honest for Steps 1–6 because nothing in them is
platform-specific: the same `runtimeCore`, the same `LoginScreen`, the same
`/auth/email/register`. It is **not** honest for Part 2 (the installed `.exe`) or
Step 7 label wording, and those remain untouched.

**Environment for every result below:**

```
ENVIRONMENT: Linux container, Electron 42.8.1 under Xvfb (software rendering),
             local backend on 127.0.0.1:4000 via NEUROPAUSE_BACKEND_URL,
             PostgreSQL 16 + Redis 7, clean --user-data-dir,
             round20b applied. NOT the shipped configuration.
```

---

## Step 3 — F-7 observed, and it was wrong the first time

The document says F-7's fix has 124 UI tests behind it and **no human has ever
seen it render.** That was the right thing to be suspicious about.

**First run, backend down.** The notice appeared — and printed
*"The connection could not be completed."*, the unclassified fallback, when the
truth was a refused connection. Pulling that thread found the defect:

The renderer asks for reachability the moment the login screen mounts. Nothing had
probed yet, so the main process returned its untouched initial state —
`{reachable:false, checkedAt:null, lastError:null}` — and the component rendered
`reachable:false` as a live outage.

**On a healthy machine that is a false outage banner at every single launch**,
which is worse than saying nothing at all. It would have shipped.

Every one of the 8 existing UI tests passed while this was broken, because every
one of them supplied a `checkedAt`. **They asserted the field and not the
meaning.** That is §2's evidence pattern, committed by the person writing the fix
for §2's evidence pattern, and caught only by looking at the screen.

**Fix (in `round20b.patch`, superseding round20):**

- `neuroCore.backendReachability()` now probes when `refresh` is asked for **or**
  when `checkedAt === null` — i.e. when nothing has answered yet this session.
- The notice treats `checkedAt === null` as *still checking* and stays silent.
- Two regression tests, written from the screenshot.

**Second run, backend down** — `EVIDENCE-1`:

> **NeuroPause cannot reach its AI service right now.**
> The service refused the connection.
> Sign-in needs the service. Nothing is wrong with this computer.
> `[ Retry ]`

Correctly classified, above the auth banner, no URL, no host, no port, no
instruction to run anything.

**Third run, backend healthy** — `EVIDENCE-2`: the notice is **absent**. No
false alarm.

F-7: **PASS**, observed in the product, in both directions.

---

## Step 5 — F-4 ANSWERED

Driven through the real UI with synthetic input (`xdotool`): click
*"Don't have an account? Create one"*, type an address, type a password, submit.

**Result — `EVIDENCE-3`: the application reached `FirstRunExperience`.**

> ### Your AI. Your Data. Your Control.
> Try NeuroPause free and experience AI that can work locally on your computer…
> `[ Try Free Locally ]` `[ Sign In ]`
> *Skip setup for now*

Corroborated in PostgreSQL, not just on screen:

```
71138345-c7e7-4f85-b199-6908be3d82c7 | founder.test@neuropause.local | 2026-08-13 07:56:06.628136+00
auth_sessions = 2
```

**The answer is YES.**

> F-4 means "requires an account and a reachable server." The founder was stopped
> by a dead host, not by a broken product.

This closes the question open since the founder was locked out. The product is
reachable. The path from a cold start to onboarding works: register → `AppShell`
→ `FirstRunExperience`. What blocked him was `api.neuropause033.com` no longer
existing, plus having no account on a server whose `users` table was empty.

Continuing one step further — `EVIDENCE-4` — the D-5 AI-mode choice renders
correctly, including its honest amber sub-notice: *"No local model server is
reachable right now — you can set one up later (for example, Ollama). Until then,
AI requests will fail on this device rather than being sent anywhere."*

That is the restriction notice behaving exactly as specified. Recorded as
observed, not converted to a gate PASS — the gate asks for more than one screen.

---

## Two findings I am NOT calling defects yet

**The submit button renders as a blank white bar** in all four screenshots — no
"Sign in" / "Create account" text visible. Consistent across runs, so not a
transient. `[Guessing]` whether this is real: software rendering under Xvfb may
be failing to resolve the accent CSS variable, giving white-on-white. **Look at
your own login screen and tell me whether the button has a label.** If it does,
this is my environment. If it does not, it is a contrast defect on the primary
action of the first screen anyone sees.

**Four OAuth buttons render although no provider is configured.** `PROVIDERS` in
`LoginScreen.tsx:15` is a hardcoded array; `/auth/providers` returns `[]`. So
Google, GitHub, Microsoft and Apple are all offered and none can work. The
founder's most likely first click was one of the four. `[Certain]` in code and on
screen; not yet traced to what the failure looks like when clicked.

---

## What I could not do, and what it costs

| Step | Status |
|---|---|
| 1–2 · databases, backend | **Done** — in the container, not on Windows |
| 3 · F-7 while down | **Done** — and found a defect |
| 4 · clean profile, local backend | **Done** — `--user-data-dir`, verified log line |
| 5 · first account, F-4 | **DONE — answered YES** |
| 6 · onboarding + one organization | **Partial** — reached the AI-mode step; stopped there |
| 7 · gates 4–7 | **NOT DONE** — needs A/B/C tenants and human judgement |
| 8 · record findings | this document |
| Part 2 · installed `.exe` | **IMPOSSIBLE HERE** — no Windows machine |

**Gates 4–7 are the honest gap.** They compare behaviour between tenants; I can
create tenants but I cannot judge whether an observed refusal is correct. That
needs a person who knows what the product is supposed to refuse.

**Step 6 stopped deliberately.** Choosing "Keep it on this device" versus "Allow
approved cloud AI" sets real routing and is a product decision, not mine to make
in someone else's install.

---

## Program 13C

| Gate | Before | Now |
|---|---|---|
| Backend-unreachable is legible (F-7) | FAIL | **PASS** — observed, both directions |
| Fresh-install onboarding reachable (F-4) | FAIL | **PASS (dev)** — reached, DB-corroborated |
| Native packaged launch (Windows) | FAIL | FAIL — unchanged, no Windows access |
| Backend availability | FAIL | FAIL — `api.neuropause033.com` still gone |
| Gates 4–7 | NOT TESTED | NOT TESTED |
| Everything else | unchanged | unchanged |

**PROGRAM 13C = NOT CERTIFIED.**

The two conversions above are labelled `(dev)` deliberately. They were observed
in a development run against a local backend, which is the configuration
§Environment names and not the one any founder has.
