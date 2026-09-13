# Human handoff (operational)

Never paste API keys, certificates, passwords, private keys, Apple or Windows signing secrets into chat.

| # | WHAT | WHY | EXACT INPUT REQUIRED | DO NOT SEND TO CHAT | EXPECTED OUTPUT | HOW CLAUDE VERIFIES |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Renew neuropause033.com | expires 2026-09-15T08:07:40Z; feed/API/mail depend on it | renew at GoDaddy | registrar password | new expiry date | `whois` read-only |
| 2 | Restore api origin + apex DNS | edge 530; apex has no record | fix tunnel/origin; add A/CNAME for apex+www | tunnel token, SSH key | /health 200; apex resolves | curl/dig read-only |
| 3 | Apple notarization credential (local path) | artifact signed but unnotarized | run `xcrun notarytool store-credentials np-notary --apple-id <id> --team-id J3G89MY3QG` on this Mac | app-specific password | keychain profile "np-notary" | `xcrun notarytool history --keychain-profile np-notary` (no secret shown) → then submit+staple the exact dmg/zip |
| 3b | Apple CI path | rc.29 keychain step failed | push branch; dispatch macos-release (macos-15 pin) or re-export .p12+password into secrets | .p12, password | signed+notarized CI artifact with submission id | download CI artifact; stapler validate |
| 4 | Windows certificate | installer unsigned | obtain Azure Artifact Signing or CA cert; set WIN_CSC_* or Azure action in CI | certificate/password | Authenticode signature with timestamp | PE cert table + signtool verify |
| 5 | Push branch | local-only commits; CI provenance | `git -C /Users/saurabhpatel/Desktop/np-public-launch push -u origin pilot/public-launch` (no tag) | — | branch on origin | `git ls-remote` |
| 6 | RELEASE_VERSION | rc.30 vs 1.0.0 | decision A/B | — | recorded decision | version:bump + re-verify if B |
| 7 | Dependency findings | js-yaml high + 4 moderate | accept (rationale) or authorize fixes | — | decision record | npm audit after fix |
| 8 | Production AI provider | gateway lane has no production provider | choose provider/model; set key in backend env only | API key | /ai/status configured:true on production | curl status (no key exposed) |
| 9 | Mail provider | reset mail undeliverable; support mailboxes unverified | choose provider; confirm support@/security@/privacy@ exist | SMTP/API secrets | staging reset email received | operator confirmation |
| 10 | Observability destination | no alert path | set ALERT_WEBHOOK_URL / metrics scraping | webhook secret | test alert fired | operator confirmation |
| 11 | Intended use + regulatory review | GATE-INTENDED-USE NOT_ESTABLISHED | complete/sign NP-GLOBAL-PILOT-003 form; reviewer determinations | — | signed form + review record | file present in custody |
| 12 | PUBLIC_RELEASE_AUTHORIZATION | no decision exists | fill + sign the template as a NEW file (not the template) | — | DECISION ≠ AWAITING, SIGNATURE present | verify command reads it; Claude never fills it |
