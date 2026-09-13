# Closure plan

## A. MACHINE-CLOSABLE NOW (done this seam)
- AI gateway envelope invariant widened (grant_authority, human_approved, admin_override, execute, confirmation_waived; tampered envelope refused) — apps/backend/src/ai/gateway.ts
- Human decisions single-use per run — apps/desktop/src/main/ai/gatewayAgentLoop.ts
- 8 adversarial phrases pinned in text / arguments / tool output; stale-approval tests — gatewayAuthorityPhrases.test.ts
- Re-measured: mac artifact (15/15 universal, signed, timestamp, NOT notarized), Windows (unsigned), negative controls (6/6), version coherence, DNS/HTTPS/whois, dependency audit

## B. MACHINE-CLOSABLE AFTER HUMAN INFRASTRUCTURE INPUT
- Notarize + staple the exact DMG/ZIP once a notarytool keychain profile exists (B01)
- Sign Windows once a certificate is configured (B02)
- Provider mailer once a mail provider is chosen (B18)
- Production AI provider config (AI_GATEWAY_PROVIDER/MODEL + key in the backend env) (G17 production)
- Observability wiring once destination/retention chosen (B10)
- Account deletion + export endpoints once authorized (B19)
- npm audit fix for non-major findings once authorized (B11)

## C. HUMAN DECISION REQUIRED
- RELEASE_VERSION (B14) · push branch (B15) · dependency acceptance (B11) · intended use (B12) · regulatory review (B13) · privacy/legal (B19) · PUBLIC_RELEASE_AUTHORIZATION (B16)

## D. EXTERNAL PROVIDER REQUIRED
- Apple notarization service (B01) · certificate authority / Azure Artifact Signing (B02) · Cloudflare DNS (B03) · origin/tunnel host (B04, B20) · GoDaddy renewal before 2026-09-15 (B05) · mail provider (B17/B18)

## E. NOT MEASURABLE FROM CURRENT ENVIRONMENT
- Clean-machine install (B06) · update transition (B07) · rollback exercise (B08) · Intel runtime (B09) · production host inventory (B20)
