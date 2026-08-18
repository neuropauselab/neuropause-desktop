# SLICE 15 — First real email · EVIDENCE

**Status: a single real-send ATTEMPT — LIVE-VERIFIED (Profile A — acknowledged).** NOT a "success" claim. Three
separate outcomes, never collapsed: **AUTHORIZED ✓ · SUBMITTED ✓ · EXTERNALLY OBSERVED = pending the operator's
own-mailbox check** (the automated read-back is blocked — see finding F-3). One real email attempted to the operator's
own address; the single-send latch is now spent, by design.

## Run configuration
- Run mode A (app-principal): app principal seeded (the dead NeuroPause login, pending S17). **Microsoft identity,
  consent, token, send, and admission were REAL.** Isolated profile `~/Library/Application Support/NeuroPause-S15`
  (`--user-data-dir`), never the real profile.
- Account: `dishantdobariya@neuropauselabpvtltd.onmicrosoft.com` (test tenant), connected 2026-08-18T12:15:33Z.

## The three outcomes
- **AUTHORIZED ✓** — the send passed the FG-4 guard (allowlisted recipient) and the certified path admitted it: the
  single-send latch was written (guards run before governedSend), so the CST admitted and the executor ran.
- **SUBMITTED ✓** — per the operator's UI: the M365WritePanel showed **ACKNOWLEDGED** ("accepted by Microsoft Graph;
  queued; delivery not independently verified") — Graph 202. (No 202 log line exists; the certified path does not log
  it — see finding F-4.)
- **EXTERNALLY OBSERVED = PENDING** — the automated Graph read-back could not run (F-3). Interim proof is the operator's
  screenshot of the destination inbox (`neuropause033@gmail.com`); programmatic confirmation is S16's oracle.

## Confirmed params + exact UTC send time (from the latch, `first-real-send.latch`)
```
{"at":"2026-08-18T12:23:02.996Z","to":["neuropause033@gmail.com"]}
```
- Recipient: exactly `neuropause033@gmail.com` (allowlist), no cc/bcc. **Exact UTC send time: 2026-08-18T12:23:02.996Z**
  (the latch is written immediately before the send).

## Unscripted operator-side NEGATIVE proof (the guard fired live)
The operator first attempted a send to a NON-allowlisted address; FG-4 denied it ("only the compiled-in operator
address is permitted"). **Confirmed the latch was NOT written by that denial** — the allowlist check returns before the
latch write, and the latch that exists records only the allowlisted `neuropause033@gmail.com` at 12:23:02.996Z. So the
denial preserved the single attempt; the guard worked exactly as designed, in the field, unscripted.

## Findings
- **F-1 · SCOPE REALITY (least-privilege deviation).** The consent granted the FULL manifest scope set (~47 scopes:
  Users/Groups/Directory, Mail.Read/ReadWrite/**Send**, Calendars, Files, Contacts, Teams/Chat, etc.), driven by
  `manifests.ts` microsoft-entra `oauth.scopes`. **The "send-only token" claim is DEAD** — the S15 send occurred under
  a BROAD token, honestly recorded here. **Work item (connector-manifest minimization):** split write scopes / request
  least-privilege (e.g. Mail.Send-only for the send path, incremental consent for reads). Tracked for a future slice.
- **F-2 · Mail.Read IS granted → S16 needs NO re-consent.** From `connectors.json` grantedScopes: `Mail.Read` (and
  `Mail.ReadWrite`) present. Phase 3 changes: S16's read-back oracle can use the existing token; no consent expansion,
  no re-consent gate.
- **F-3 · Automated read-back BLOCKED by macOS Keychain.** The vault token is safeStorage-encrypted; an unattended
  process reports `isEncryptionAvailable:true` but cannot decrypt the ciphertext written by the operator's interactive
  session (keychain access control keys the encryption to that session). **The attempt failed before any HTTP call —
  zero external contact was made.** Consequence: S16's real read-back must run IN the operator's interactive session
  (or access the token at execute-time inside the app), not from an unattended harness. EXTERNALLY OBSERVED for S15 is
  therefore the operator's inbox/NDR screenshots.
- **F-4 · The certified send path + guard do not LOG their decisions** (audit gap). No AUTHORIZED/SUBMITTED/202 or
  DENIED line in `app.log`; evidence relies on the UI outcome + the latch. Future: log the guard decision + the send
  outcome for auditability (candidate for S34 universal action trace).
- **F-5 · Truthful-surfaces inconsistency (S19).** The "Microsoft 365 writes" counters read `never / 0` despite the
  acknowledged send (`recordWrite` does not update the sync snapshot; `lastWriteAt` null). Logged for S19; not fixed now.
- **F-6 · `org:list` "Sign in to manage organizations" on the isolated profile** — harmless, expected: org management
  requires backend auth (which is down); unrelated to the send path.

## Containment (DEFERRED — runbook §6)
Consent + app registration stay ALIVE until S16's read-back completes (the oracle needs them). The isolated S15 profile
holds the OAuth vault + the latch; deleting it after S16 is one-step containment. **The latch stays — no retry. Any
further real send is a deliberate future decision through Claude.**

## Operator evidence to fold in (pending)
- The destination inbox screenshot (`neuropause033@gmail.com`) — delivery confirmation (→ EXTERNALLY OBSERVED).
- The test mailbox inbox — any postmaster/NDR bounce + reason code (delivery diagnosis).
- Screenshots: consent, proposal, confirm, ACKNOWLEDGED; the screen-recording reference. (Exact UTC time already
  captured above from the latch.)

## Certification impact: NONE beyond the honest LIVE-VERIFIED (Profile A) label. No VERIFIED_SUCCESS is claimed.
