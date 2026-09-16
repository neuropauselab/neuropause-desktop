# SESSION 48 — PACKAGED FIRST-USER RELEASE CERTIFICATION

## 1–2 · Baseline & commit

Baseline `84938e4` (S47), branch `cert/data-import-cst-integration`, worktree carrying only the
custody-protected `certification/baseline.json` (never staged; build provenance therefore stamps
`84938e4-dirty` — an honest stamp, same acceptance as B.13). Frozen surfaces untouched.

## 3–7 · The artifact

```
FILE        dist-seam-s48/NeuroPause-arm64.dmg
SHA-256     33d6ec1f29ed3c932e59be77ee424aeb93b3504915b957cee8448fd90f7d795f     135,577,901 B
UPDATE ZIP  NeuroPause-1.0.0-rc.21-arm64-mac.zip
            172f405f6593f0313568877126e7ddc498f53f3c739d9f1f14213f01f3702d0f     134,715,638 B
APP.ASAR    ea101cc58e575e875826846836d934f3d7923b6d5f1df7072c205bd10db1f5cd      59,173,638 B
VERSION     1.0.0-rc.21 (unspent; the S46 releaseDiscipline bump) · channel beta
PLATFORM    macOS arm64 · SIGNED (Developer ID J3G89MY3QG, hardened runtime) · NOT NOTARIZED
            (notarize:false configured; notarize.cjs skip-marker written — operator credentials
            required for notarization; local pilot install is unaffected)
BUILD       2026-09-02T16:54:39Z · commit 84938e4-dirty
COMMAND     generate-notices → generate-build-info → electron-vite build →
            electron-builder --mac --arm64 --publish never -c.directories.output=dist-seam-s48 →
            verify:release --dist dist-seam-s48
```

**Envelope respected:** `dist/` (rc.1–rc.20 history) byte-untouched — output overridden to
`dist-seam-s48` (B.13 precedent). `--publish never`. **Armed-build question measured MOOT before
building:** `out/` already carried zero e2e markers and no seed chunk at session start (a prior
session had rebuilt it as a plain release; hash `989b0584…`, mtime Sep 2 20:48) — nothing armed
remained to preserve, recorded not assumed.

## 8–9 · Freshness & content integrity (proven on bytes, then at runtime)

`verify:release` **8/8 PASS** (feed↔binary sha512 parity, version parity). Exact-substring counts
over the packaged `app.asar` (python, not the aliased shell grep):

```
ConvertQuoteToSalesOrder 5 · ShipSalesOrder 5 · IssueCustomerInvoice 5 · ReceiveCustomerPayment 6
platform:command.dispatch 7 · INTERNAL_ACTION_ORIGIN 3 (S46 boundary)
"Order status changes only through the lifecycle actions" 1  (S45 guard)
"Invoice status changes only through the Issue and Cancel actions" 1  (S45 guard)
"books general-ledger adjustment entries" 1  (S47 fence)
"Order shipped." 1 · "Quote converted to a sales order." 1  (S45 UI wiring)
E2E STRIP: NP_E2E_BUILD 0 · installE2eSeedPrincipal 0 · e2eSeed 0 · NEUROPAUSE_E2E_VERIFY 0
```

Freshness is certified by **runtime behavior**, not strings or timestamps (below).

## 10–11 · Fresh-profile packaged run + click-only real-user journey

`e2e/o2cUiJourney.e2e.cjs` with `NP_APP_BIN` = the packaged binary, fresh profile
`/tmp/np-s48-pilot-profile`, **no IPC calls, no seeding, no developer steps**:

**9/9 PASS** — launch → first-run onboarding (Try Free Locally → keep on device → Explore Business
→ skip discovery) → CRM New Customer → Sales New Sales Order (SO-PILOT-1) → Ship → Generate
Invoice → Finance Issue (INV-SO-PILOT-1) → New Payment (PAY-PILOT-1, cleared) → **invoice PAID on
screen**. Automation wall-clock ≈ 13 s (≈ 3–5 min human-paced). `app.isPackaged === true` asserted
from the running artifact (restart phase).

## 12 · Governance verification (durable evidence, not UI appearance)

Read back from the packaged profile's `platform-command-journal.json`:

```
5 records — SalesOrderCreated · SalesOrderShipped · SalesOrderInvoiced ·
            CustomerInvoiceIssued · CustomerPaymentReceived
tenant: org-default (server-resolved; single)      actor: local:<uuid> (D-12, server-resolved)
idempotency keys: unique · outbox entry on EVERY record · delivered-events sink on disk ·
action-records audit store present
```

Plus the full IPC-chain harness (`o2cRuntime.e2e.cjs`) against the **packaged binary**: **27/27
functional asserts** — governed create/ship/invoice/issue/receive + quote-conversion + replay
(`replayed:true`, one order ever) + settlement to paid/outstanding-0 + all six event types durable.

## 13 · Security verification (packaged)

Forged tenant → `TENANT_SCOPE_VIOLATION` (live, packaged) · pending-order invoice → `CONFLICT`
(live) · edit-door status hand-set → refused, status unchanged (live; the S45 guard in the shipped
artifact) · S46 origin boundary present in the asar and unweakened (source `.strict()` schema
verified at S47; no renderer-controlled privileged metadata introduced) · AI advisory-only
(S47 audit carried; no AI mutation path exists in this build's source).

## 14 · Durability verification (packaged)

`e2e/s48Restart.e2e.cjs` — relaunch the packaged app on the SAME profile: **4/4 PASS** — no
repeated onboarding (persisted first-run state) · SO-PILOT-1 survives · invoice still PAID ·
journal count unchanged 5→5 (**no duplicate accounting effects**). Crash/SIGKILL certification
carried from S41 (packaged, previously executed); not re-run this session and not re-claimed
beyond that record. One harness incident classified: orphaned journey processes held the
single-instance lock and the relaunch correctly quit — the B.24-measured enforcement working;
cleared, not a product defect.

## 15 · Pilot-fence verification (packaged)

The S47 issued-invoice fence string ships in the asar (count 1) and its 2 ui pins are green; the
S45 guard refusal proven live in the packaged runtime; economic-row import, shipment documents,
reversals, procurement remain runbook fences exactly as the S47 certification lists them —
none silently changed, no policy invented.

## 16 · Regression counts (final state, this session)

```
Full main   964 files · 10,103 passed · 7 skipped · exit 0     UI   77 files · 431 passed
Typecheck   node + web PASS · Lint clean (changed files) · Build exit 0 · verify:release 8/8
Packaged UI journey 9/9 · Packaged IPC chain 27/27 · Packaged restart 4/4
```

## 17 · Known limitations

NOT NOTARIZED (operator credentials; Gatekeeper will warn on other machines — local pilot install
by right-click-Open or `xattr` per operator runbook) · Windows GRAY/UNTESTED · notarization,
DR drill, procurement governance, reversal policy set — unchanged from S47 · reproducibility:
single build; a second-build content-equivalence check not performed (electron-builder embeds
nondeterministic metadata; recorded, not required).

## 18 · Windows status

**GRAY / UNTESTED.** No Windows artifact built or tested. Kept fully separate from the Mac result.

## 19 · Installation / handoff result

The handoff simulation IS the packaged journey + restart: launch from the built .app, onboard by
clicks, complete the full O2C cycle, close, reopen, data intact — **zero developer intervention,
zero source access, zero console**. First-launch experience clear; no broken buttons on the pilot
path; terminology quirk recorded (the invoices module is titled "Finance" inside the Finance
family — POST-PILOT rename candidate).

## 20 · Final decision

```
PACKAGING PASS · ARTIFACT FRESHNESS PASS · PACKAGED ELECTRON PASS · REAL USER JOURNEY PASS
GOVERNANCE PASS · SECURITY PASS · DURABILITY PASS · FINANCIAL INTEGRITY PASS · PILOT FENCES PASS

MAC PILOT: GO        WINDOWS: UNTESTED        UNRESTRICTED PRODUCTION: HOLD
FIRST REAL USER: GO — the artifact they will receive is the artifact that was tested.
```
