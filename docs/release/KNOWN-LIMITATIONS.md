# NeuroPause Desktop — Known Limitations (1.0.0-rc.1)

An honest list of what RC1 does and does not do, so feedback is well-targeted.
None of these are defects — they are the deliberate boundaries of this release.

## Platform

- **macOS on Apple Silicon (arm64) only.** Windows and Linux are designed for and
  structurally accounted for, but are not built or supported in this release.
  Intel Macs are not targeted.

## Backend dependency

- **Some features require the backend service** (`:4000`, with PostgreSQL and
  Redis). The AI Store catalog and a few related areas talk to it. The local
  surfaces — Release Diagnostics, Recovery Center, Workspace, AI Memory, the
  knowledge graph and timeline — work without the backend. When the backend is
  unreachable, those areas **degrade gracefully** and the state is shown in
  Component Health (they do not crash).

## Intelligence is deterministic (no model calls)

- The "AI" intelligence layers — summaries, the knowledge graph, reminders,
  recommendations, and the workforce's reasoning — are **deterministic on-device
  analysis**, not generative model output. This is intentional: results are fast,
  private, and reproducible. Do not expect free-form generative responses from
  these surfaces in this release.

## Connectors

- The 16 connectors use official OAuth where available, but each provider may
  require its own app credentials/configuration to fully exercise. Some connectors
  may operate in a **verify-only** mode (authenticate and report status) without a
  full data-sync adapter yet. No connector bypasses authentication.

## Federation, Cloud, and Disaster Recovery

- **Federation peers are seeded demo fixtures.** Trust evaluation, capability-
  gated sharing, artifact signing/verification, and governance are real and
  enforced, but the peer organizations themselves are sample data, not live remote
  orgs.
- **Disaster-recovery restore is sandboxed.** Backups and validation run as real
  operations, but recovery validation executes in a sandbox and does not mutate
  production state.

## Updates

- **Auto-update requires a configured feed host.** The update *mechanism* is
  complete and the RC build checks the beta channel; actually receiving an update
  depends on the feed being published to a real host. Updates never install
  silently — you choose when to download and install.

## Crash reporting

- **Native crash capture is opt-in and local.** Until you enable it (Operations →
  Release → Crash Reporting), only NeuroPause's own captured faults are recorded.
  Nothing is ever uploaded — there is no crash-ingest endpoint; crash data stays
  on your device and is shared only if you generate and send a support bundle.

## Scope of this release

Release 1.0 focuses on **reliability, recovery, diagnostics, and
distribution** — not new platform capabilities. New features are deliberately out
of scope until real deployment experience shows a clear need.
