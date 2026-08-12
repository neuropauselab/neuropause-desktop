# NeuroPause OS — Founder Acceptance Checklist
## Windows Test Build

Work through this in order. It takes roughly forty minutes.

**For every problem, record five things.** A one-line note in this format is
worth more to the team than a paragraph:

```
SCREEN     where you were
ACTION     what you clicked or typed
EXPECTED   what you thought would happen
ACTUAL     what happened
SEVERITY   blocker / major / minor / cosmetic
```

A screenshot beats a description. Windows: **Win + Shift + S**.

**Severity, defined so we all mean the same thing:**

- **Blocker** — you cannot continue. The product is unusable at this point.
- **Major** — you can continue, but something important is wrong or missing.
- **Minor** — wrong, but you would work around it.
- **Cosmetic** — it looks wrong, it works fine.

---

## A · Installation

| | Check | Result |
|---|---|---|
| A1 | The installer runs and completes | ☐ |
| A2 | The SmartScreen warning appeared, and the install guide explained it before you saw it | ☐ |
| A3 | A Start Menu entry named **NeuroPause** exists | ☐ |
| A4 | A desktop shortcut exists, with the NeuroPause icon (not a generic one) | ☐ |
| A5 | The app appears in Settings → Apps with a sensible name and version | ☐ |
| A6 | No terminal or console window opened at any point | ☐ |
| A7 | Nothing asked you for a developer tool, a password, or a file path | ☐ |

**How long did the installer take?** ______

---

## B · First launch

| | Check | Result |
|---|---|---|
| B1 | The app opens without an error | ☐ |
| B2 | The first screen is readable — nothing overlapping, nothing transparent | ☐ |
| B3 | It says what it is, and what version | ☐ |
| B4 | No debug panels, no placeholder text, no "TODO", no developer branding | ☐ |

**How long from double-click to a usable screen?** ______ seconds

---

## C · Onboarding — take this slowly

| | Check | Result |
|---|---|---|
| C1 | *Try Free Locally* moves you forward | ☐ |
| C2 | The AI routing screen explains the two choices well enough to decide | ☐ |
| C3 | **Keep it on this device** — the app moves on to the next step | ☐ |
| C4 | The workspace step offers Personal / Professional / Business | ☐ |
| C5 | The questions about your work are answerable without guessing what is wanted | ☐ |
| C6 | What the app says it understood about you is *actually right* | ☐ |
| C7 | Anything it guessed is visibly marked as a guess, not stated as fact | ☐ |
| C8 | You can correct a wrong guess, and the correction sticks | ☐ |
| C9 | Onboarding finishes and lands you in the product | ☐ |

**The question that matters most: at the end of onboarding, did the app
understand your business?** Write a sentence.

---

## D · The AI routing choice — test both

Do C again from a clean state to test the other path. To reset: quit the app,
delete `%APPDATA%\@neuropause\desktop`, and relaunch.

| | Check | Result |
|---|---|---|
| D1 | **Allow approved cloud AI** — an **amber message** appears saying the installation has not enabled external processing | ☐ |
| D2 | That message is understandable to a non-engineer | ☐ |
| D3 | A **Continue** button appears and moves you forward — you are not stuck | ☐ |
| D4 | The app did **not** silently move on as if the setting took effect | ☐ |

D1 and D4 are a deliberate design decision: the app must never accept a setting
it cannot honour without telling you. If it moved straight past with no amber
message, that is a **blocker** — report it.

---

## E · Asking NeuroPause something

| | Check | Result |
|---|---|---|
| E1 | Ask NeuroPause opens | ☐ |
| E2 | Ask it a simple factual question about your own data | ☐ |
| E3 | The answer says **where it ran** — on your device, or externally | ☐ |
| E4 | If no AI is available, it says so plainly instead of failing silently or hanging | ☐ |
| E5 | Ask a follow-up. Does it remember the first question? | ☐ |
| E6 | Ask something it cannot know. Does it say so, or invent an answer? | ☐ |

**E6 is the one to be hardest about.** An invented answer is a blocker.

---

## F · The product surfaces

Open each. Mark **works / empty / broken**. "Empty" is a fair answer on a fresh
install and is useful information — but an empty screen should *say* it is
empty, not just be blank.

| Surface | works / empty / broken | Note |
|---|---|---|
| Mission Control | | |
| Today's Intent | | |
| Search | | |
| Assistant | | |
| Work Hub | | |
| Ask NeuroPause | | |
| Understand | | |
| Holds | | |
| Enterprise | | |
| Business | | |
| Organization | | |
| Collaboration | | |
| Workspace | | |
| AI Workforce | | |
| Knowledge | | |
| Data | | |
| AI Memory | | |
| Notifications | | |
| Settings | | |
| AI Store | | |

---

## G · Business mode

Only if you chose Business / Enterprise during onboarding.

| | Check | Result |
|---|---|---|
| G1 | You can create or view an organization | ☐ |
| G2 | Roles and permissions are visible and comprehensible | ☐ |
| G3 | An action you are not permitted to take is **refused with an explanation** | ☐ |
| G4 | Knowledge and Data show your organization's information, not a demo tenant's | ☐ |

**G3 matters more than it looks.** A refusal with no explanation is a major
issue even though nothing crashed.

---

## H · Quit, reopen, and restart

| | Check | Result |
|---|---|---|
| H1 | Create something — a workspace, a note, an answer you want to keep | ☐ |
| H2 | Quit the app completely | ☐ |
| H3 | Reopen it. Your work is still there | ☐ |
| H4 | Your AI routing choice is still what you chose | ☐ |
| H5 | Onboarding does **not** run again | ☐ |
| H6 | Restart Windows, reopen the app, check again | ☐ |

---

## I · Making it fail on purpose

The product is judged as much on how it fails as on how it works.

| | Do this | The app should | Result |
|---|---|---|---|
| I1 | Turn off Wi-Fi, then ask NeuroPause something | Say it cannot reach what it needs — not hang, not pretend | ☐ |
| I2 | Try an action your role is not allowed | Explain the refusal | ☐ |
| I3 | Submit an empty or nonsense input where it expects something | Say what it needed | ☐ |
| I4 | In Settings → AI, change the AI mode | Either change it, or say why it cannot | ☐ |

**I4 is a known weak point** — on a fresh install this action is refused at the
platform level. It should now tell you so. If the control silently snaps back
with no message, report it as **major**.

Across all four: no silent failure, no false success, no spinner that never
finishes.

---

## J · Uninstall and reinstall

| | Check | Result |
|---|---|---|
| J1 | Uninstall from Settings → Apps completes cleanly | ☐ |
| J2 | The Start Menu entry and desktop shortcut are gone | ☐ |
| J3 | Reinstall works | ☐ |
| J4 | After reinstall your data is still there (this is intended) | ☐ |

---

## K · The three questions that actually matter

Answer these in your own words. They are worth more than every checkbox above.

**1. Would you use this?** If not, what is missing?

**2. Where did you get confused, lost, or stuck?** Name the exact screen.

**3. Did the product ever tell you something that was not true** — claimed
success when nothing happened, claimed a setting was on when it was not, or
gave an answer it could not actually know?

Question 3 is the one the engineering team most needs answered honestly.

---

## Please also record

- Windows version: ______
- Machine (make / RAM): ______
- Roughly how long you spent: ______
- Anything that felt slow: ______
