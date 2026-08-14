# NeuroPause for Windows — installation and first-use guide

**Version:** 1.0.0-rc.17 (beta)
**File:** `NeuroPause-Setup.exe` · 111 MB
**SHA-256:** `c48e63bf032d1d6669025d46306c7faf51946d37598bee8eecb157561377206e`
**Requires:** Windows 10 or 11, 64-bit · about 400 MB free disk space
**This is a release candidate, not a finished product.** Please read
"Known issues" before you start — some of what you will see is expected.

---

## 1. Download

Either use the link you were sent, or download directly:

https://github.com/dishantdobariya91-debug/neuropause-desktop/releases/tag/v1.0.0-rc.17

Download **`NeuroPause-Setup.exe`**. Ignore the other files — the `.zip` is a
portable variant and the `.yml` is used by the app's own updater.

If it came from Google Drive, you may see "Google Drive can't scan this file for
viruses." That is because the file is larger than 100 MB, not because anything
is wrong with it. Verify the hash instead — that is a stronger check than any
scanner.

---

## 2. Verify what you downloaded *(30 seconds, worth doing)*

Open **PowerShell** — press `Windows`, type `powershell`, press Enter — and run:

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\NeuroPause-Setup.exe" -Algorithm SHA256
```

The `Hash` it prints must match, exactly:

```
C48E63BF032D1D6669025D46306C7FAF51946D37598BEE8EECB157561377206E
```

Upper and lower case do not matter. Every other character does.

**If it does not match, stop and tell Dishant.** It means the file was damaged in
transfer or is not the file we published. Do not run it.

---

## 3. Install

Double-click `NeuroPause-Setup.exe`.

**Windows will show a blue warning: "Windows protected your PC."** This is
expected. The build is not yet code-signed, so Windows does not recognise the
publisher. Click **More info**, then **Run anyway**.

> This warning is Windows doing its job. You are choosing to trust this file
> because you verified its hash in step 2 and you know where it came from. Do
> not develop the habit of clicking through this for files you did not verify.

The installer takes about a minute. NeuroPause installs for your user account
only — it does not need administrator rights and does not touch other users on
the machine.

---

## 4. First launch

NeuroPause opens to a welcome screen and walks you through four short steps:

1. **Welcome** — choose "Try Free Locally" or "Sign In"
2. **How do you want to use NeuroPause?** — Personal / Professional / Business
3. **Where should your AI work?** — on this device, or approved cloud AI
4. **A few questions about you** — your role and the kind of work you do

Then you land in the main workspace.

**Sign in with the account you were given.** This matters more than it looks:
the organisation, its people and its permissions are tied to your account, and
signing in with a different address will leave most of the app unavailable. If
you are not sure which account to use, ask before signing in rather than after.

---

## 5. Finding your way around

The left sidebar is grouped by how often you need things.

| Section | What it is |
|---|---|
| **Mission Control** | Live overview — what is running, connector health, recent activity |
| **Search** | One search across records, documents, activity and business data |
| **Assistant** | Ask questions about your workspace, or ask it to do the work |
| **Work Hub** | Your day — briefs, meetings, tasks, approvals waiting |
| **Understand / Holds** | Explanations, and decisions the system has paused for a human |
| **Data** | Import, export, documents, relationships, history, quality |
| **Knowledge / AI Store / Workspace / AI Memory** | Your material and the AI tools acting on it |
| **Settings** | Account, appearance, preferences |

Nothing you click can delete production data. Actions with consequences stop and
ask for approval first — that is what **Holds** is for.

---

## 6. Known issues in this build

Please read this section. Most "bugs" you would otherwise report are already
here, and the one thing we genuinely need from you is at the end.

**The pages may go blank after a while.** Panels start showing "Unavailable" and
messages about an organisation you are not a member of. **This is a known defect
we are actively tracing.** Restarting NeuroPause fixes it until it happens
again.

> **If this happens, note the time and tell us.** How long the app ran before it
> broke is the single most useful piece of information you can give us — it is
> the measurement we are missing. "It broke around 3:40, I'd started it about
> 11" is more valuable than a screenshot.

**It needs the server.** NeuroPause talks to `api.neuropause033.com`, which
currently runs on a development machine. If that machine is asleep, sign-in and
most data will not work. This is temporary infrastructure, not the product
design.

**Windows may say the publisher is unknown.** Covered in step 3. Code signing is
planned, not done.

**The updater may report an error on startup.** The auto-update feed is not yet
hosted. Harmless — it does not affect anything else.

**Some panels show "Loading…" and stay there.** Same root cause as the first
item.

---

## 7. Reporting a problem

Send whatever you have — a screenshot is fine. If you can add the two things
below, it is much faster to diagnose.

**The time it happened**, and roughly how long the app had been running.

**The log file.** It is plain text and contains no passwords or keys:

```powershell
notepad "$env:APPDATA\@neuropause\desktop\logs\app.log"
```

Or copy it somewhere you can attach it:

```powershell
Copy-Item "$env:APPDATA\@neuropause\desktop\logs\app.log" "$env:USERPROFILE\Desktop\neuropause-log.txt"
```

Please do **not** send `vault.bin` or `connector-vault.bin` from that folder.
Those hold encrypted credentials and are never needed for a bug report.

---

## 8. Uninstalling

**Settings → Apps → Installed apps → NeuroPause → Uninstall.**

That removes the application but leaves your local data in place, so
reinstalling keeps your workspace. To remove the data as well, delete this
folder afterwards:

```
%APPDATA%\@neuropause\desktop
```

**Do not delete that folder while we are investigating the blank-pages issue** —
it is the evidence.

---

## 9. What this build is, honestly

A release candidate for internal review. The application installs, launches and
renders every screen; authentication, the organisation and the workspace all
resolve at startup. It is not signed, it depends on a development server, and it
has one defect that interrupts use until restarted.

It is worth your time if you are reviewing the product's shape, its information
architecture and its workflows. It is not ready to put in front of a customer.

**Questions, problems, or anything that looks wrong: Dishant.**
