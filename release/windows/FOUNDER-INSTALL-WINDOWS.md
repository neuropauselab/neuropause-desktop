# NeuroPause OS — Founder Test Build
## Installing on Windows

**This is a test build, not a finished product.** It is given to you to
evaluate, and it is expected that you will find things that are wrong. Please
record them — the checklist that comes with this file explains how.

You do **not** need any developer tools. No Node, no Git, no terminal.

---

## Step 1 — Check the file you received

You should have one file:

```
NeuroPause-Founder-Test-Setup.exe
```

and a small text file next to it ending in `.sha256`. That second file is a
fingerprint of the installer. If you want to confirm the file arrived intact,
open **PowerShell** (press Start, type `powershell`, press Enter) and run:

```powershell
Get-FileHash -Algorithm SHA256 "$HOME\Downloads\NeuroPause-Founder-Test-Setup.exe"
```

The long string it prints should match the one inside the `.sha256` file. If it
does not match, stop and tell the team — do not install it.

---

## Step 2 — Run the installer, and expect a warning

When you double-click the installer, **Windows will show a blue box** saying:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognised app from starting.

**This is expected, and here is exactly why.** Windows checks whether an
installer is signed with a code-signing certificate issued to a known company.
NeuroPause does not have that certificate yet — it is a commercial certificate
that has to be purchased and issued, and it has not been. Windows therefore has
no way to confirm who published this file, so it warns you. The warning is not
about the contents of the app; it is about the absence of a publisher signature.

**This is a limitation of the test build only.** A signed installer will not
show this warning, and the shipping product will be signed.

To continue: click **More info**, then **Run anyway**.

If you are not comfortable doing that, that is a completely reasonable
position — say so and wait for a signed build instead. The hash check in Step 1
is the only independent assurance available until then.

---

## Step 3 — Complete the installation

The installer will ask where to install. The default is fine.

It will create a Start Menu entry and a desktop shortcut called **NeuroPause**.

---

## Step 4 — First launch and onboarding

Launch NeuroPause from the desktop shortcut.

You will be asked a short series of questions:

1. **Welcome** — choose *Try Free Locally*.
2. **Where should your AI work?** — two choices, explained below.
3. **What kind of workspace?** — Personal, Professional, or Business.
4. **A few questions about your work** — answer in your own words.
5. **Here's what I've understood** — correct anything that is wrong, then continue.

---

## Step 5 — The AI routing choice

This is the most important screen in the product, so it is worth understanding
before you click.

**Keep it on this device.** All AI work stays on your computer. Nothing is sent
anywhere. If no local AI model is installed — and there will not be one on a
fresh machine — the app will tell you that AI is unavailable rather than
quietly sending your text somewhere. That refusal is the product working
correctly, not a failure.

**Allow approved cloud AI.** Your organisation permits an approved external AI
provider as a fallback. On this test build the *installation* has not enabled
external processing, so you will see an amber message saying so, and AI work
will still stay on your device. **That message appearing is the correct
behaviour** — it is the app refusing to pretend a setting took effect when it
did not.

Either choice lets you continue. Try both if you like; you can change it later
in **Settings → AI**.

---

## Step 6 — Explore

Everything in the left-hand navigation is open to you. Ask NeuroPause a
question. Create a workspace. Look at Knowledge, Data, AI Memory, Holds,
Notifications, Settings.

Some areas will have no data because this is a fresh install. Some will be
incomplete. Both are worth telling us about.

---

## Step 7 — Use the checklist

Open **FOUNDER-ACCEPTANCE-WINDOWS.md** and work through it. It takes about
forty minutes. Where something is wrong, write down what you did, what you
expected, and what actually happened. A screenshot is worth more than a
description.

---

## Uninstalling

Start → Settings → Apps → Installed apps → **NeuroPause** → Uninstall.

Your NeuroPause data lives in `%APPDATA%\@neuropause\desktop`. Uninstalling
does not remove it, so a reinstall picks up where you left off. To start
completely fresh, delete that folder before reinstalling.

---

## If something goes badly wrong

If the app will not start at all, or a screen is blank, note the time and tell
the team. There is a log at:

```
%APPDATA%\@neuropause\desktop\logs\app.log
```

Sending that file with your report makes the problem far easier to find.
