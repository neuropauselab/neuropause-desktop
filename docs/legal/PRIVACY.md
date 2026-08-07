# Privacy Notice — DRAFT

> **DRAFT for counsel review (Phase 8, 2026-08-07).** Describes the software's
> actual behavior, verified against the code; final language pending review.

**The short version: NeuroPause Desktop is local-first. Your business records never leave your machine unless you explicitly connect a service.**

**What stays on your machine.** All business records (invoices, employees, payroll, orders — every module), assistant conversations, automations, feedback you capture, audit logs, crash records, backups, and the application log. Stores live under your user profile, are covered by local backups, and are version-stamped.

**What can leave your machine, and only when you act.** OAuth connectors you explicitly authorize (tokens are held in the OS keychain-backed vault, never in plain text); the optional backend account/sync/licensing services if your build is configured with one; update checks against the release feed (a version query — no personal data). Support bundles are generated only when you click Generate, are redacted before writing (tokens, keys, emails, home-directory usernames), never include connector secrets, and go only where you send them.

**What does not exist.** There is no usage analytics/telemetry in this build. Crash reporting is opt-in, off by default, redacted at rest, and never uploaded (native crash dumps are configured un-uploadable).

**Consents presented in-product.** Crash-report opt-in (Settings), pilot participation (Getting Started), and this notice with the EULA at first run.

**Your controls.** Export or delete feedback; create/restore/delete backups; leave the pilot at any time; delete the app and its data folder to remove everything.
