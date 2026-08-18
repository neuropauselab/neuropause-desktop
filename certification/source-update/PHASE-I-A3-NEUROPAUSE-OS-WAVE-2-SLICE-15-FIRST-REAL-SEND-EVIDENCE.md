# SLICE 15 — First real email · EVIDENCE

**Status: a single real-send ATTEMPT — LIVE-VERIFIED (Profile A) + EXTERNALLY OBSERVED.** Three separate outcomes, never
collapsed into "SUCCESS": **AUTHORIZED ✓ · SUBMITTED ✓ · EXTERNALLY OBSERVED** — the S16 read-back oracle returned
**VERIFIED_SUCCESS** (the message corroborated in the sender's Sent Items with its internetMessageId, bounce=none). One
real email sent to the operator's own address; the single-send latch is now spent, by design. Provider dispatched;
destination-side (Gmail receipt) recorded honestly below. Artifacts copied out to `certification/s15-artifacts/` before
any containment.

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
- **EXTERNALLY OBSERVED = VERIFIED_SUCCESS (S16 oracle, in-session, 2026-08-18T13:25:54.915Z).** The S16 read-back
  oracle independently read the mailbox back and returned **TERMINAL=VERIFIED_SUCCESS on the first poll (attempts=1),
  bounce=none**, with the full corroborated match tuple:
  - recipient `neuropause033@gmail.com` ✓ · subject "NeuroPause S15 first real send, 18 Aug 2026" ✓ · timestamp in the
    12:23 UTC window ✓ (matching the latch 12:23:02.996Z) · **internetMessageId
    `<PN2P287MB15972D7FE523C60B482881E1F8A62@PN2P287MB1597.INDP287.PROD.OUTLOOK.COM>`**.
  This is the **FIRST VERIFIED_SUCCESS in the product's history** — the message independently confirmed in the sender's
  Sent Items, with no bounce/NDR. Basis: provider-side read-back (Sent Items corroboration + id) + inbox bounce-scan
  (none). It is send-verification, not a positive DESTINATION receipt (Gmail); the earlier manual Outlook-web Sent Items
  screenshot corroborates it directly.

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

## The FIRST VERIFIED_SUCCESS (S16 oracle, in-session) — full tuple
```
[2026-08-18T13:25:54.915Z] TERMINAL=VERIFIED_SUCCESS
  internetMessageId=<PN2P287MB15972D7FE523C60B482881E1F8A62@PN2P287MB1597.INDP287.PROD.OUTLOOK.COM>
  bounce=none  attempts=1  — corroborated match in Sent Items (recipient + subject + timestamp)
```
- recipient `neuropause033@gmail.com` · subject "NeuroPause S15 first real send, 18 Aug 2026" (per the operator the sent
  subject carried a trailing quote; the oracle matched on the normalized subject fingerprint) · timestamp in the 12:23
  UTC window (latch 12:23:02.996Z) · internetMessageId as above. First poll (attempts=1), no bounce.

## Latch — intact (no durability issue)
`~/Library/Application Support/NeuroPause-S15/first-real-send.latch` is present (66 bytes, mtime = the send time),
content `{"at":"2026-08-18T12:23:02.996Z","to":["neuropause033@gmail.com"]}`. A `find "*latch*"` that returned empty was
a shell/terminal artifact — the file is verifiably present and unchanged. Copied to `certification/s15-artifacts/`.

## Destination-side (honest)
Provider **dispatched** the message (Sent Items + bounce=none). Destination-side receipt at Gmail is recorded as the
operator states: **[arrived in <folder> / still not present]**. Beyond dispatch + no-bounce, **destination-side spam/
filtering sits OUTSIDE our control boundary** — we do not and cannot certify what the receiving provider does with an
accepted message; that is explicitly NOT GOVERNED here.

## Evidence artifacts (copied out before containment)
`certification/s15-artifacts/`: `first-real-send.latch` (the send/verify record) · `s16-verify-terminal.log` (the
app.log excerpt with the VERIFIED_SUCCESS terminal line). There is no separate verification-store file — the oracle is
pure and LOGS its terminal outcome; the log line IS the record (a persisted verification store is a future increment).

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
