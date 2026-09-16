# NeuroPause — Public support surface (readiness record)

| Function | State at launch commit | Where |
| --- | --- | --- |
| Help | in-app docs bundled (`docs/guides`, `docs/user`, `docs/legal` inside the app) | Settings → Help |
| Contact / bug report | `SUPPORT.md` in repo; public mailbox **not verified** | — |
| Security report | `SECURITY.md` in repo; public mailbox **not verified** | — |
| Account recovery | password-reset endpoint exists; **mail is not deliverable in production** (logging mailer) | `POST /auth/request-password-reset` |
| Device revocation | owner/admin via API; refused device fails closed | `POST /devices/:id/revoke` |
| Privacy request / data export | **absent** | — |
| Account deletion | **absent** (manual SQL only) | — |

No `support@`, `security@` or `privacy@` address is asserted in this document: the domain `neuropause033.com` had no apex DNS record and its edge answered HTTP 530 on 2026-09-12, and no mailbox could be verified. Publishing an unverified address would be fictional contact data (NP-GLOBAL-PUBLIC-LAUNCH-001 §33).

`SUPPORT-READINESS = FAIL` until: a verified support mailbox, a deliverable mailer, a data-export path and an account-deletion path exist.
