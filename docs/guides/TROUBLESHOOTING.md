# NeuroPause Desktop — Troubleshooting Guide

Most issues can be diagnosed from **Operations → Release** and resolved from
**Operations → Recovery**. Start there, then use this guide.

## First step for any problem

1. Open **Operations → Release** and check **Component Health** — it shows what's
   degraded (backend, connectors, runtime, platform services).
2. Generate a **Support bundle** (same page) and attach it to your report. It's
   redacted by default (no tokens, keys, or emails).

---

## The app won't open ("unidentified developer")

The notarized build opens normally. If you see this block, you likely have the
wrong file — request the official `NeuroPause-1.0.0-rc.1-arm64.dmg` from your
pilot contact. (As a one-time workaround you can right-click the app → **Open**,
but the correct fix is the notarized DMG.)

## The window is blank or keeps crashing

1. Open **Operations → Recovery**.
2. **Enable Safe Mode**, then restart NeuroPause — it launches with plugins
   disabled, which isolates a misbehaving plugin. Your plugin preferences are
   preserved.
3. If a plugin is the cause, use **Disable Plugins**.
4. Recovery also surfaces **Recommendations** derived from recent crashes — follow
   the suggested action.

To leave Safe Mode, open Recovery again and **Disable Safe Mode**, then restart.

## Features are missing or the AI Store is empty

Some areas need the backend service. Check **Operations → Release → Component
Health**: if the database/backend check is degraded, the backend isn't reachable.
For the pilot, confirm with your contact whether the backend is part of your test
and that its address is configured. The local surfaces (diagnostics, recovery,
workspace, memory) work without it.

## A connector won't sync or shows an error

1. Go to **Connectors** and check the account's status.
2. Re-authorize the connection (sign in to the provider again).
3. If it keeps failing, note which connector and attach a support bundle.
   Connector tokens are stored securely and are **never** included in bundles.

## Settings look wrong or the app behaves oddly

From **Operations → Recovery**, run **Reset Settings**. This restores app settings
to defaults and **does not touch your data** (registry, knowledge graph, memory,
workspaces). A restart applies it.

## I think my data is corrupted

1. Open **Operations → Recovery → Backups**.
2. **Validate** a recent backup (checks integrity by checksum).
3. **Restore** it — a safety backup of the current state is taken first, so the
   restore is reversible.

Scheduled backups appear here automatically; you can also **Create backup** on
demand before trying anything risky.

## An update won't install

Updates never install silently. Open **Operations → Release → Updates** to see the
current state. If an update is stuck, quit and relaunch, then check again. Report
the update phase shown on that page.

## Reporting an issue

Include: what you did, what you expected, what happened, and a **support bundle**.
Categorize severity (Critical / High / Medium / Low) per the **Feedback Program**.
For anything involving data loss or a crash on launch, mark it **Critical**.
