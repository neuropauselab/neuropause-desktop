# NP-013 · CREDENTIAL-BOUNDARY COMPLETION — CLOSING EVIDENCE
## NP-012 §3 ruling, slice 1 of 6 (operator, 20 Aug 2026). Closes F-MR-7; lands the adversarial RULE-009 pin WITH its missing guard. Zero frozen touch.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**Status: TEST-VERIFIED.** Zero external effects; ceremony surfaces untouched; NP-000 = HOLD unchanged.

## What the recon proved before anything was built (D-15 fleet, 4 scouts, read-only)

- **No HIGH log leak exists today**: no site logs a token value, `process.env`, or a whole request/response/account
  object; all 38 Authorization-header-constructing modules contain zero logger calls. The real findings were
  SHAPES: (1) `connectorVault.get` had ONE try over decrypt+parse, so a decrypt-succeeds/parse-fails state put a
  V8 SyntaxError EMBEDDING AN EXCERPT OF DECRYPTED VAULT PLAINTEXT into console + app.log — the worst single site;
  (2) two `slackSocketMode` sites logged whole injected-dependency Errors adjacent to the xapp- token and the WSS
  ticket URL; (3) the desktop logger enforced nothing — "Never log tokens or credentials" was a comment (F-MR-7).
- **RULE-009 had NO runtime enforcement**: `connectors.json` is plain JSON; `upsert()` persists whatever it is
  handed; three ConnectedAccount fields (`label`, `error`, `grantedScopes`) are PROVIDER-CONTROLLED strings — a
  hostile provider could smuggle token bytes into plaintext disk, and a smuggled value round-tripped forever.
- **Idiom inventory**: the shared canonical `redactSensitive` (errorReport.ts) is the export/report rule (also
  strips emails/paths); `safeDetail` (semanticFailure.ts) is the call-site rule; `redactedEmailShape` is the
  round-31 source-side PII idiom. These BOUND the design below.

## What landed (all non-frozen)

1. **`logger.ts` — the enforced boundary (closes F-MR-7).** ONE credential-text rule (`redactCredentialText`)
   + the shared secret-key classifier (`classifyFieldName`) applied in `emit` to every message and meta, BEFORE
   both the console and the file sink; both now receive the SAME redacted payload. The rule is deliberately
   CREDENTIAL-only — NOT the shared `redactSensitive`, which would have double-redacted the round-31 W-7
   predicate (`12@example.com` → `<redacted-email>`) and destroyed the diagnostic it exists to carry; that
   divergence is documented at the rule and PINNED (the predicate must survive). Where it matters the rule is
   STRONGER than the shared one: camelCase JSON keys (`"accessToken":"…"` — exactly the V8 parse-excerpt shape)
   and TRUNCATED JWTs are caught; bare provider prefixes (xox-/xapp-/sk-/gh?_/AKIA/ya29) mirrored from
   supportBundle. Secret-classified KEYS lose their entire value (a raw opaque token matches no text pattern).
   FG-note recorded in-file: if a future gate opens packages/shared, the rule moves beside `redactSensitive`.
2. **`connectors/metadataCredentialGuard.ts` + `connectorStore.ts` — RULE-009 enforced at BOTH doors.**
   `scrubAccountMetadata` (pure, consumes the same ONE rule) scrubs every string field/string-array entry at
   `upsert` (the single write door — patch/setSync/persistConnected/e2e-seed all route through it) AND at `load`
   (a value already on disk is scrubbed and the FILE re-persisted clean — the round-trip is dead). Scrub, never
   refuse: a hostile provider must not DoS the connection flow with a token-shaped workspace name. The evidence
   line names the FIELD, never the value. An email label SURVIVES (pinned) — RULE-009 is credentials, not
   identifiers.
3. **`connectorVault.ts` — decrypt/parse try SPLIT.** The parse failure now logs the error NAME only; decrypted
   plaintext can no longer reach a log through a SyntaxError excerpt.
4. **`slackSocketMode.ts` — call-site redaction (mailer idiom)** through the existing `safeDetail` at both
   failure sites; and `safeDetail`'s URL-query rule extended `https?` → `(https?|wss?)` because writing the
   adversarial pin PROVED the gap: a `wss://…?ticket=…` Socket Mode ticket sailed through (wrong scheme, and an
   18-char ticket is below TOKEN_LIKE's 24-char floor). The strengthening benefits every existing safeDetail
   caller; existing pins unchanged.

## The pins (46 tests across 5 files, all RUN green)

`logger.redaction.test.ts` (9): the one rule per class incl. the V8-excerpt shape and truncated JWTs · key-based
whole-value redaction · Error-normalization interplay · no over-redaction · the W-7 SURVIVAL pin · the emit
boundary pin (neither console nor file sink receives the token; both receive the SAME payload).
`rule009CredentialBoundary.test.ts` (4): pure scrub pins (fields named, values never) · email-label survival ·
**the adversarial pins at the REAL disk path** (electron mocked to a temp dir, actual `connectors.json` bytes
read back): hostile upsert → account persists, credential bytes never reach disk; smuggled-on-disk token →
scrubbed at load AND the file itself cleaned.
`connectorVault.redaction.test.ts` (1): the exact decrypt-succeeds/parse-fails state driven through the real
`get()` — dropped, logged by name only, NO plaintext fragment in any console argument.
`slackSocketMode.test.ts` (+1): open/construction failures never log the app token or the WSS ticket.
`semanticFailure.test.ts` (+1): the wss ticket-URL pin.

## Honest bounds (what this slice does NOT claim)

- Renderer consoles are OUTSIDE this boundary: `AppShell.tsx:379` logs a main-supplied IPC error raw (recon
  note; renderer-side, low risk) — recorded, not fixed here.
- `ai/smoke.ts` (manual dev script, unbundled, 12 raw consoles) and test/bench files never ship — recorded.
- `loopbackServer.ts:106` logs the OAuth callback path at DEBUG (below file-sink threshold, filtered in
  production) — recorded, deliberately untouched.
- The boundary redacts CREDENTIAL shapes; it is not a PII boundary (source-side + export-side rules own that,
  by design, pinned).
- RULE-009 is enforced at the connector-metadata store; the ADJACENT identityStore raiseMatch path (provider
  field values, recon MEDIUM) is a candidate follow-up, not silently claimed.

## Verification (all RUN)

Targeted pins 46/46 · typecheck node clean · lint clean on all changed files · gate-detector PROCEED on all six
changed paths (zero frozen) · honesty scan 0 findings · **full main suite 866 files / 9035 passed / 3 skipped**
(was 863/9019/3 — the delta is exactly the three new pin files; zero regressions from the boundary).
