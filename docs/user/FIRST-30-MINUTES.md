# NeuroPause — Your First 30 Minutes

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: new users
>
> A guided first session. Every step uses capability that actually ships in this RC. Where a step depends on the cloud or a third-party, it's flagged so nothing surprises you.

## Before you start

You need NeuroPause installed and reachable sign-in (email + password works out of the box). If you're setting up the environment yourself, do the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) first (PostgreSQL + Redis + backend). This session assumes you can sign in.

## The 30-minute path

**00:00 — Install & launch.** Open NeuroPause; wait through the brief "Starting NeuroPause…" screen. *(See [Quick Start](QUICK-START.md) for install options.)*

**02:00 — Sign in.** Use email + password. If social sign-in buttons appear, your operator has configured those providers; if not, that's expected. You'll land on **Today**. *(Cloud: sign-in needs the backend.)*

**05:00 — Understand Today.** Read the three landing surfaces and what each is for:
- **Mission Control** — organization-wide operations at a glance.
- **Today's Intent** — the strategic priorities/outcomes for today.
- **Work Hub** — your personal day.

Hover any sidebar item to see its one-line description.

**08:00 — Open Work Hub.** This is your day: tasks, approvals, briefings, and recent work. Skim it to see how NeuroPause pulls your work into one place. *(Local-first.)*

**12:00 — Explore Business.** Open **Business** — your ERP workspace, grouped by family (Finance, Sales, CRM, HR, Projects, and more; 104 modules across 13 families). Open one family you care about (say **Finance** or **CRM**) and browse its records. If a module is empty, it shows an honest empty state — not fabricated data. *(Local-first.)*

**15:00 — Explore AI Workforce.** Open **AI Workforce**. Look at the workers, the approvals inbox, and how actions are governed: *intent → governance → permission → execution → evidence*. If you have an AI provider configured, try a governed action; if not, you'll see the honest "not configured" path rather than a fake result. *(Local-first governance; live AI = External dependency.)*

**18:00 — Explore Knowledge.** Open **Knowledge** — search, AI memory, and the knowledge graph in one lens. Run the search box. Text search works locally; smarter semantic ranking needs the external vector stack (it will say so if unavailable). *(Local-first; semantic = External dependency.)*

**22:00 — Explore Operations.** Open **Operations** — enterprise operational health, risk, dependencies, and incidents. Note the status indicator: it only shows "Live" when the underlying health data actually loaded (no false green). *(Local-first + backend health.)*

**25:00 — Open the Command Palette.** Press **⌘K**. Type a section name (try "Runtime" or "Industry"), then type part of a record. Notice it finds surfaces behind **Advanced** too, and each result shows a description. This is the fastest way to move around. *(Local-first.)*

**28:00 — Peek at Administration.** Open **Administration** — the read-only lens over security, identity, compliance, licensing, and configuration, with links out to the editors (Organization, Settings). Admins live here; everyone benefits from knowing where it is. *(Local-first + Cloud.)*

**30:00 — Complete one useful task.** Pick a real first task, for example:
- Create or open one record in a **Business** family you use, and confirm it persists (reopen it). *(Local-first.)*
- Save something to **AI Memory** and find it again via **Knowledge** search. *(Local-first.)*
- Pin the sections you use most and set your **startup experience** in **Settings → Workspace**. *(Local-first.)*

## What you should understand by minute 30

- Where to start (**Today**) and where your work lives (**Work Hub**, **Business**).
- That your enterprise data is **local-first** on your device.
- That **sign-in**, the **AI Store**, **sync**, and **semantic search** use the cloud plane, and **live AI** and **connectors** need third-parties you configure.
- That **Preview** surfaces are real code on seeded data — labeled so you can tell.

## Where to go next

- **[Where Do I Go?](WHERE-DO-I-GO.md)** — the full "I want to…" map.
- **[User Guide](NEUROPAUSE-USER-GUIDE.md)** — every section in depth.
- **[AI Workforce Guide](AI-WORKFORCE-GUIDE.md)** · **[Knowledge Guide](KNOWLEDGE-GUIDE.md)** · **[Connectors Guide](CONNECTORS-GUIDE.md)**
- **[FAQ](../support/FAQ.md)** · **[Troubleshooting](../support/TROUBLESHOOTING.md)**
