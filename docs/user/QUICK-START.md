# NeuroPause — Quick Start

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: new users
>
> Maturity of this release: **Release Candidate (RC)** — pilot-ready, not general-availability. Labels used below: **Local-first** (works on your device), **Cloud** (needs the NeuroPause backend), **External dependency** (needs a third-party you configure), **Preview** (real code, seeded/in-memory data — not yet live production capability).

## What is NeuroPause?

NeuroPause is an **AI-native enterprise operating system** for the desktop. Instead of jumping between a dozen separate business tools, you get one workspace that brings your business modules (finance, sales, CRM, HR, projects and more), AI workers, enterprise knowledge, and operations together in a single, coherent app.

Two things are worth knowing up front, because they shape everything:

- **NeuroPause is local-first.** Your enterprise data (ERP records, knowledge, AI memory, automations) is stored **on your device** by NeuroPause's local data layer. It does not require the cloud to hold your business data.
- **A small cloud plane handles account-level concerns.** Signing in, the AI Store, your organization/device records, billing, cross-device sync, and semantic-search infrastructure run through the NeuroPause backend. Most of these degrade gracefully when offline — with one important exception noted below.

## Who is it for?

Business users who want their work and their AI in one place; administrators who set up organizations, users, and security; developers who extend the platform; and enterprises evaluating an AI-native operating layer for a pilot.

## Download & install

**Maturity: Release Candidate.** The first target platform is **macOS (Apple Silicon)**.

- **Pilot from source (available today):** clone the repository, then `npm install` and `npm run dev` from the repo root — this launches the backend and the desktop app together. See the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) for the full setup (PostgreSQL + Redis).
- **Packaged desktop build:** produced with `npm run package:mac` (macOS, Apple Silicon). A **signed & notarized** pilot artifact is **not yet published** — code-signing identity is an operator action. See the [Download Catalog](../downloads/DOWNLOAD-CATALOG.md) for the current, honest artifact status (no invented download links).

> Windows and Linux are on the roadmap; macOS (Apple Silicon) is the first target. **Maturity: Planned** for other platforms.

## Launch & sign in

1. **Launch** NeuroPause. You'll see a brief "Starting NeuroPause…" screen.
2. **Sign in** on the login screen. Email + password works out of the box (**Cloud**). Social sign-in (Google, GitHub, Microsoft, Apple) is available **only if your operator has configured those providers** (**External dependency** — otherwise those buttons are simply not offered).
3. After sign-in you arrive at your landing surface (**Today**).

**What if the backend is unavailable?** Sign-in is the one hard requirement: NeuroPause authenticates through the backend, so **if the backend can't be reached at launch, you'll stay on the login screen** even though your data is local. This is a known limitation (**Known limitation**) — once you're signed in, most surfaces keep working offline. If you can't sign in, see [Troubleshooting → Cannot sign in](../support/TROUBLESHOOTING.md).

## Where do I start?

NeuroPause opens on **Today**, a small group of landing surfaces:

- **Mission Control** — organization-wide operations at a glance (your command landing).
- **Today's Intent** — your strategic priorities and the outcomes that matter today.
- **Work Hub** — your personal day: tasks, approvals, briefings, and recent work.

If you're not sure where a specific thing lives, open **[Where Do I Go?](WHERE-DO-I-GO.md)** — it maps "I want to…" to the exact section.

## Finding the big things

The sidebar is grouped so you can scan it: **Today**, **Business**, **Workspace**, **AI & Operations**, and **System**. Deeper platform, preview, and developer surfaces are tucked behind an **Advanced** disclosure at the bottom so the default view stays focused (about two dozen items, not forty).

| I want… | Go to | Notes |
|---|---|---|
| My work for today | **Work Hub** | Local-first |
| Company-wide status | **Mission Control** | Local-first |
| Finance / Sales / CRM / HR / Projects… | **Business** | Local-first (104 modules across 13 families) |
| AI workers | **AI Workforce** | Local-first governance; live AI needs a provider (External dependency) |
| Knowledge & memory | **Knowledge** | Local-first; deep fabric under **Enterprise Knowledge** (Preview) |
| Operational health | **Operations** | Local-first + backend health |
| Install AI apps | **AI Store** | Cloud (catalog) |
| Governed enterprise packages | **Enterprise Marketplace** | Preview |
| Integrations | **Connectors** | 13 connectable + 9 Preview; each needs its own sign-in (External dependency) |
| Security & configuration | **Administration** | Local-first + Cloud |
| Advanced platform / developer tools | **Advanced** disclosure | Mixed; several Preview |

## Command Palette

Press **⌘K** to open the Command Palette — the fastest way to jump anywhere. It lists **every** section (including the ones under Advanced), searches your content, and can hand a question to the Assistant. Each result shows a one-line description so you know where you're going.

## Sign out

Open **Settings** (bottom of the sidebar) → **Identity**, or use the Command Palette (**⌘K → "Sign out"**). Signing out revokes your session on this device.

## Next steps

- **[First 30 Minutes](FIRST-30-MINUTES.md)** — a guided first session.
- **[Where Do I Go?](WHERE-DO-I-GO.md)** — the "I want to…" map.
- **[User Guide](NEUROPAUSE-USER-GUIDE.md)** — every section explained.
- **[Glossary](GLOSSARY.md)** — plain-language definitions.
- **[FAQ](../support/FAQ.md)** · **[Troubleshooting](../support/TROUBLESHOOTING.md)**
