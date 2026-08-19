# NEUROPAUSE OS MASTER READINESS REPORT (§58)
### Read-only recon, 2026-08-20 · HEAD `8ec36f6` · branch `cert/data-import-cst-integration` · tree clean · FREEZE INTACT `BASELINE-1ac1c6b0bbbb`

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

Sources: three read-only code auditors (Live Brain §6 checklist · product/website · identity/registries) + the
committed censuses (`APP-LIVELINESS-CENSUS-2026-08-19.md`, `CONNECTOR-REALITY.md`, `BUSINESS-DATA-MODEL.md`,
`LAUNCH-READINESS.md`). Every classification is from code, never docs. Machine-readable companions:
`LIVE_BRAIN_READINESS.json` · `PRODUCT_EXPERIENCE_READINESS.json` · `CONNECTOR_PLATFORM_READINESS.json`.

## A · LIVE BRAIN (18-stage classification, §6)

**TEST-VERIFIED (mock, in-app) — 12:** state acquisition (`composeLiveBrainState`, five-valued certainty,
zero-runtime-import pinned) · capability awareness (certified-only graph, live-wired predicate) · proposal
generation (`buildProposal`, refusal-first) · proposal provenance (evidence must resolve tenant-matching or
BLOCKED) · brain-review surface FG-9 (eight display-only fields rendered) · expiry (10-min window, enforced at
confirm, EXPIRED→observable DENIED) · fingerprint (re-derivable stash key; edit→SKIP pinned) · authority
derivation (single shared `deriveAuthority` — coarse per-connector 1-bit today, per-capability = S23 horizon) ·
governance handoff (data-only ADMIT_FOR_ASK projection) · ASK boundary S5.1 (structural — no ALLOW branch exists) ·
execution-gate handoff FG-10 (single-use, in frozen `connectors/index.ts:606`, in-app e2e) · memory boundaries
(§2#15 by construction; re-derivation at execute; observer-direction invariant pinned).

**PARTIAL — 4 (the real Phase-A gaps):**
1. **Context construction (S2)** — `assembleBrainContext` is built + tested but has **no production caller**; the
   lane goes mandate → state → buildProposal, skipping it.
2. **Reasoning (S3)** — `reason()` likewise built + tested, **no production caller**.
3. **Workspace awareness** — L1 aggregate real, but the production lane feeds `moduleStore: () => null`
   (`capabilityProposeIpc.ts:72`) → every domain reads honest-UNAVAILABLE instead of real counts.
4. **Verification handoff** — `verifyGovernedSend` ships de-gated but its only callers are compile-stripped e2e
   triggers; `deriveOracle` honestly stamps `productionWired: false`; **the S22 reconciler (the stated production
   caller) does not exist.**

**RECORDED-NOT-ENTERED — 2:** relationship awareness (LB-10/S35) · experience recording (LB-6 — zero code, by
explicit operator order). All LB-6…LB-12 stages are docs-only.

**LIVE — 0 Brain stages.** The S15/S16 live chain (one real send + read-back VERIFIED_SUCCESS) was NOT
Brain-proposed. The first Brain-proposed real effect is exactly NP-000, pending.

**§6's final question** — *can Live Brain produce a truthful structured proposal from real system context and hand
it to governance without acquiring authority?* **YES, mock-proven and pinned** (zero runtime import Brain→
governance/execution across 6 pin tests; the only crossing is the authorized FG-10 direction execution→Brain),
**with the four PARTIALs above as the honest qualifiers** — "real system context" is today real-substrate state
MINUS S2/S3 enrichment and MINUS real workspace counts.

## B · PRODUCT EXPERIENCE (§46 classes)

| Experience | Class | Load-bearing evidence |
|---|---|---|
| Public (website) | **PARTIAL — 11 claims FAIL the truthfulness bar** | see E |
| Personal | IMPLEMENTED | 15-section curation, all LIVE honest-empty or GATED |
| Professional | IMPLEMENTED | 8 platform sections hidden, rest shows |
| Enterprise | PARTIAL/MOCK mix | full nav but reveals the 14 Preview surfaces; seeded org inside labels |
| Connector | IMPLEMENTED UI; **certification dimension MISSING** | connection-state rich + honest; but capability chips green-check everything — governed-vs-uncertified is invisible renderer-side (§14 gap; behavior still safe: nothing executes without confirm) |
| Proposal | IMPLEMENTED (mock beyond the one live send) | assistant handoff → panel prefill → FG-9 fields verbatim |
| Approval | IMPLEMENTED | two-step confirm, single-confirmation architecture intact |
| Verification | IMPLEMENTED display | five truthful states; renderer ceiling ACKNOWLEDGED, never fake VERIFIED |
| History | PARTIAL | HoldsView lifecycle real; ActionRecord `query()` main-side only — "what happened to my email?" not user-visible (S34a fence) |
| Unknown-state | IMPLEMENTED display; reconciliation PARTIAL | OUTCOME_UNKNOWN distinct + "do not blindly retry"; holds resolve manually (S22 not shipped) |

## C · CONNECTOR FOUNDATION (§47 vs the seven-identity model)

- CONNECTOR_ID **IMPLEMENTED** (static manifests, display-only version) · CONNECTION_ID **IMPLEMENTED**
  (store/vault split, workspace-stamped, identity-pinned reconnect) · CAPABILITY_ID **IMPLEMENTED for M365 only**
  (real action ids; other connectors carry coarse category strings).
- SYSTEM_ID / INSTALLATION_ID **PARTIAL** — three uncoordinated fragments (buildInfo, local-principal UUID,
  livesync deviceId), none named as such. REGISTRATION_ID **PARTIAL** (cloud `/devices` upsert only; no
  local-first concept; **no RegistrationProvider/ManifestProvider abstraction exists — zero grep hits**).
- ORACLE_ID **MISSING as a registry** — one string inside a two-branch ternary + a 1-entry needs-map; the oracle
  FUNCTIONS are real (`verifyEffect`, LIVE once).
- Consent IMPLEMENTED (RFC 8252 + PKCE + granted-scope persistence) but **the S15 F-1 broad-scope finding is
  still live in code** (Entra manifest requests ~24 scopes incl. all write scopes up front). Credential boundary
  clean by construction (ciphertext-only vault, zero token IPC exposure) — but desktop logger redaction is
  **convention-only**, no mechanical layer. Revocation PARTIAL + **one §4 orphan: `identityStore.revokeConnection`
  has no production caller**. Hard-coded org values: the strip-verified S15 allowlist (by design) + `TARGET_DOMAIN`
  constants in two DEAD packages (§16 note, not runtime-reachable).

## D · EXISTING M365 PROOF — the exact boundary

ONE capability: **`mail.send`** — S23 kit-complete, LIVE-VERIFIED **once** (S15 send, Graph 202 + provider-side
Sent Items; S16 read-back **VERIFIED_SUCCESS** with captured internetMessageId), operator-executed, latch spent
and renewed. The Brain-proposed loop over the same path: **TEST-VERIFIED mock-only** (real-Electron, all three
read-back terminals) — the ceremony (NP-000) converts exactly this from mock to live. The other 27 M365 write
actions: governed (CST) but UNCERTIFIED, refusing at the S5.1 line. 70 infrastructure write actions: same class,
outside the Connector Center. Destination delivery: NOT GOVERNED. Send-corroboration ≠ delivery.

## E · WEBSITE

**Currently implemented:** static `website/` (landing + download funnel + 5 docs); deploy state to
neuropause033.com UNKNOWN (manual droplet upload). **Eleven claims fail §31**, headline items: "16 connectors"
(no 16 exists anywhere in code — 22 families / 13 adapters), "live sync today" (overstated), **hero features
dev-only surfaces that packaged builds deliberately hide** (Founder AI / Engineering AI), "sign up on first
launch" (contradicts the shipped S17 local-first door), phantom SSO, invented tier limits, stale rc.1 version,
unreachable SHA-256 page. **The site never advertises the one genuinely certified thing.** PASSES: on-device
Ollama, local-first privacy, keychain encryption, unsigned-app honesty.
**Required next (Phase B):** a website truth pass to the §52 language — the highest-leverage honesty fix outside
the app, since the app itself is now census-honest.

## F · CONNECTOR ROADMAP (tier inputs from CONNECTOR-REALITY.md)

- **Personal (Phase E):** google-workspace + M365 read families (mail/calendar/files/notes-adjacent) — adapters
  exist; capability-level entry only, consent at the operator's keyboard.
- **Professional (Phase F):** slack, atlassian, github, hubspot, salesforce — all READ-CAPABLE today.
- **Enterprise (Phase G):** sap, oracle, dynamics365, workday, servicenow (ERP-grade reads already adapter-backed)
  + the entra identity family.
- Every consequential WRITE enters one-by-one through the S23 kit (§24–28); `calendar.create` holds the presumed
  second-rung slot (kit dry-run done, oracle named, not yet real).

## Findings registry (new, from this recon)

F-MR-1 website ×11 failing claims · F-MR-2 S2/S3 built-but-unwired (lane bypass) · F-MR-3 lane workspace feed
null · F-MR-4 S22 reconciler missing (verification handoff mock-only) · F-MR-5 connector UI lacks the
certification dimension (§14) · F-MR-6 `identityStore.revokeConnection` orphan (§4) · F-MR-7 desktop logger
redaction convention-only · F-MR-8 Entra broad-scope consent (S15 F-1 still live) · F-MR-9 org-specific
`TARGET_DOMAIN` constants in two dead packages (§16 note).

## §45 GATE VERDICT

**Live Brain is NOT yet sufficiently complete for connector-platform expansion (M-008+).** Recommended Phase-A
order: **(1) NP-000 ceremony** (operator, converts the whole loop mock→live) · **(2) M-002a** wire S2 context +
S3 reasoning into the propose lane, or record the deliberate bypass as a decision · **(3) M-002b** feed the real
module registry into the lane's workspace snapshot · **(4) M-002c** the S22 reconciler as `verifyGovernedSend`'s
production caller (closes UNKNOWN→HOLD→reconciliation in production and feeds EXTERNALLY_OBSERVED). Phase-B
truth pass (website, F-MR-1/5) can proceed in parallel as it touches no Brain substrate.
