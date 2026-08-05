# NeuroPause Desktop — Release Notes

## 1.0.0-rc.1 — Release Candidate 1

The first production-quality build, distributed to a controlled group of
technical testers. NeuroPause Desktop is an **AI Operating Layer** for macOS — a
workspace to discover and launch AI products, connect AI SaaS accounts, build an
AI memory of your work, and automate repetitive workflows, with explicit
permission and human approval throughout.

**Platform:** macOS on Apple Silicon (arm64).
**Channel:** Release Candidate (beta update channel).
**Signing:** Developer ID signed and Apple notarized.

### What's in this build

**Foundation**
- Secure Electron shell with context isolation and a validated IPC bridge.
- Authentication via OAuth/OpenID Connect (Google, GitHub, Microsoft, Apple) and
  email, with secure session handling.

**Workspace & Store**
- Dashboard, sidebar, multi-surface workspace, command palette, global search,
  light/dark themes following the Apple HIG.
- AI Store: browse, search, and manage AI products by category, with install and
  launch, bookmarks, ratings, and reviews.

**Connectors & Intelligence**
- 16 connectors (ChatGPT, Claude, Gemini, Perplexity, Cursor, GitHub, Notion,
  Slack, Canva, Figma, Jira, Linear, Zapier, Google Drive/Calendar, Microsoft
  365) over official OAuth where available — never bypassing authentication.
- Enterprise Intelligence: a Unified Data Model, knowledge graph, timeline, daily
  summaries, and reminders. The intelligence is **deterministic on-device
  analysis** (no model calls), so results are fast and private.

**AI Workforce & Enterprise OS**
- An AI Workforce of workers, skills, and governance policies — every
  side-effecting action is propose-only and requires human approval.
- Enterprise Operating System: organization structure, isolated workspaces, and
  governance.
- Developer, Marketplace, Ecosystem, Cloud, and Federation layers (signed
  artifacts, trust-gated sharing).

**Reliability & Release Engineering (the focus of Release 1.0)**
- Production packaging, hardened-runtime signing, and Apple notarization.
- A self-update service with stable / beta / internal channels.
- A migration engine (ordered, backup-before, restore-on-failure, audit log).
- Backup & recovery with sha256 integrity, selective restore, and scheduled
  backups.
- Crash reporting (opt-in, on-device, never uploaded) with recovery
  recommendations.
- **Operations → Release**: a comprehensive diagnostics page (build, signing,
  notarization, update status, component/database/connector health) with export,
  copy, and redacted support-bundle generation.
- **Operations → Recovery**: Safe Mode, disable plugins, reset settings, restore
  backup, repair installation, verify integrity, and rebuild search/graph.

### Notes for testers

- Full functionality (e.g. the AI Store catalog) expects the backend service; the
  local surfaces — diagnostics, recovery, workspace, memory — work without it.
- The app auto-updates from the Release Candidate (beta) feed.
- Please read `KNOWN-LIMITATIONS.md` before filing issues, and attach a support
  bundle (Operations → Release → Support bundle) to any report.

### Known limitations

See `KNOWN-LIMITATIONS.md` for the full list (backend dependency, seeded
federation peers, sandboxed disaster-recovery, single-platform scope).

### Security

No secrets ship in the build. Support bundles redact tokens, API keys, and email
addresses by default, and never include connector credentials. Native crash
capture is opt-in and stays on your device.
