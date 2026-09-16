# Production requirements for the governed release path (`neuropause-release.yml`)

One workflow releases the whole monorepo (all workspaces) from one admitted commit. It is fail-closed: every
item below is checked by a script or by GitHub itself, and the run stops at the first missing one. Nothing in
this repository can create these items; a human with the right role must provide them. **Never paste a secret
value into a chat, an issue, a PR, or a file in this repository** — secrets go into the GitHub environment only.

## A. Human authority (cannot be automated — by design)

| # | Item | Who | Where it lands | Checked by |
|---|------|-----|----------------|------------|
| A1 | Authority issuer identity (who may authorise a public release; must not be the tagger or the release engineer) | org owner | `release-policy/authority-trust.json` (copy of the template with ≥1 `trusted_issuers` entry, committed via reviewed PR) | `scripts/authority-admission.cjs` → `AUTHORITY_TRUST_ABSENT` |
| A2 | Issuer signing key (public part in the trust list; private part never enters GitHub) | issuer | trust list `public_key` | signature verification in the gate |
| A3 | Signed `np-authority/1` record naming the exact tag name, commit, tree, manifest/population/policy/build-policy digests, workflow ref, environment, reviewer and a single-use nonce. The issuer measures the commit **independently** (fresh clone) and signs on their own machine with the Ed25519 private key. The record cannot live in the tree it names, so it is delivered as repository variable **`RELEASE_AUTHORITY`** (the JSON text; admin sets it) | issuer + repo admin | repo variable `RELEASE_AUTHORITY` | `authority-admission` job: `AUTHORITY_ABSENT` / `*_MISMATCH` / `SIGNATURE_INVALID` / `AUTHORITY_REPLAYED` |
| A3b | Environment capture: admin copies the API response of `GET /repos/{owner}/{repo}/environments/production-release` into `release-policy/environment-capture.json` (template provided; `exists`, `required_reviewers`, `prevent_self_review` all true, tag pattern `v*`) | repo admin | file in repo (reviewed PR) | `ENVIRONMENT_UNCAPTURED` / `ENVIRONMENT_UNPROTECTED` |
| A4 | Candidate designation: repository variables `RELEASE_CANDIDATE_TAG=v<version>` and `RELEASE_CANDIDATE_SHA=<40-hex commit>` | repo admin | repo variables | gate: `HUMAN_DECISION_REQUIRED` |
| A5 | The annotated tag push (`git tag -a v<version> <sha> && git push origin v<version>`) — **after** A3/A4 are in place, because the push starts the run | release engineer | Git | trigger; tag must equal root AND `apps/desktop` `package.json` version |
| A6 | Environment approval at each protected job by the reviewer the authority names (must not be the tagger, the run initiator or the workflow file's last author). **The first approval (job `authority-admission`) must carry the authority subject digest in the approval comment** — the 64-hex value the issuer tool prints; GitHub approves a job, so this comment is what binds the approval to the authority | required reviewer | GitHub UI | `REVIEWER_IDENTITY_MISMATCH` / `REVIEW_NOT_BOUND_TO_AUTHORITY_SUBJECT` / `REVIEWER_IS_SUBJECT` |
| A6b | After every admitted release the admin appends that authority's `decision_nonce` to `consumed_nonces` in the trust list (reviewed PR) so the record can never be replayed | repo admin | trust list | `AUTHORITY_REPLAYED` |
| A7 | Independent public verification on a second machine after the run: `EXPECT_VERSION=<version> bash scripts/independent-public-release-verifier.sh --full` | second person | outside GitHub | human |

## B. GitHub configuration (repo admin — the current session's principal is `admin:false`, so it cannot do these)

| # | Item | Exact value |
|---|------|-------------|
| B1 | Environment **`production-release`** | required reviewers ≥ 1 (not the tagger); *prevent self-review* ON; deployment branches/tags rule: tags matching `v*` only |
| B2 | Commit `release-policy/env-contract.json` (from `env-contract.template.json`) with `verifiedByAdmin: true` after checking B1 in the UI/API | file in repo |
| B3 | Move every secret below to the **environment** scope and delete the repo-scoped copies | GitHub → Settings → Environments → production-release → Secrets |
| B4 | Delete legacy secret `DEPLOY_SSH_KEY` and unset variable `PUBLISH_TO_SITE` (the scp/droplet publisher is gone) | repo settings |
| B5 | Branch protection on `main`: require PR + ≥1 review, dismiss stale reviews, require status checks `desktop-ci`, `backend-ci`, `certification-freeze`, `deploy-validation` | branch rules (currently NONE) |
| B6 | Actions → General → Workflow permissions = **Read repository contents** (default `GITHUB_TOKEN` read-only) | repo settings (endpoint returned 403 for this principal) |
| B7 | Allow the pinned third-party actions if an allow-list is enforced: `docker/setup-buildx-action`, `docker/build-push-action`, `azure/setup-helm`, `actions/attest-build-provenance` | repo settings |

## C. Secrets (environment `production-release` — values never leave GitHub)

| Name | What it is | Used by job |
|------|-----------|-------------|
| `APPLE_CSC_LINK` | base64 Developer ID Application `.p12` (re-export; rc.29 failed to unlock the temporary keychain with the current pair) | build-desktop-macos |
| `APPLE_CSC_KEY_PASSWORD` | password of that `.p12` | build-desktop-macos |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarization identity | build-desktop-macos |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows Authenticode certificate (`.pfx` base64) + password — **currently absent**; without it the Windows build fails closed | build-desktop-windows |
| `R2_INSTALLER_KEY_ID`, `R2_INSTALLER_SECRET` | R2 API token scoped to **write `staged/*` only** | stage-publication |
| `R2_FEED_KEY_ID`, `R2_FEED_SECRET` | R2 API token scoped to write `updates/*`, `downloads/*`, read `staged/*` | promote-publication |
| `CF_PURGE_TOKEN` | Cloudflare API token with **Zone → Cache Purge** only | promote-publication |
| `DO_REGISTRY_TOKEN` | DigitalOcean API token with registry **read/write** only (`registry.digitalocean.com/neuropause033`) | stage-publication |
| `KUBE_CONFIG_PRODUCTION` | base64 kubeconfig for a service account limited to namespace `nems-prod`: get/patch `deployments`, create/delete/get `jobs`, get `pods` | promote-backend |

The dashboard-issued R2 token that wrote rc.27 must be **revoked** (Cloudflare audit log is the evidence).

## D. Variables (repository or environment scope; non-secret)

| Name | Value |
|------|-------|
| `NEUROPAUSE_BACKEND_URL` | `https://api.neuropause033.com` |
| `PUBLIC_UPDATES_BASE` | `https://neuropause033.com/updates` |
| `PUBLIC_DOWNLOADS_BASE` | `https://neuropause033.com/downloads` |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | the bucket that fronts `neuropause033.com/updates` and `/downloads` |
| `CF_ZONE_ID` | zone id of `neuropause033.com` |
| `EXPECTED_WIN_SIGNER_CN` | exact Common Name of the Windows signing certificate |
| `EXPECTED_MAC_TEAM_ID` | Apple Team ID (10 characters) |
| `BACKEND_IMAGE` | `registry.digitalocean.com/neuropause033/backend` |
| `KUBE_NAMESPACE` | `nems-prod` |
| `KUBE_DEPLOYMENT` | `nems-backend` |
| `RELEASE_CANDIDATE_TAG`, `RELEASE_CANDIDATE_SHA` | set per release by the admin (A4) |

## E. Still open after everything above (decisions, not credentials)

| # | Question | Why it matters |
|---|----------|----------------|
| E1 | Where is `apps/web` served from in production? (Cloudflare Pages / R2 static / the droplet / nowhere yet) | the bundle is built, attested and **staged** but not promoted anywhere; give the target and the promotion step is one more job behind the same environment |
| E2 | Are `@neuropause/cli` and `@neuropause/sdk` (the only non-private packages) meant to be published to npm? | if yes: an `NPM_TOKEN` (granular, publish-only) and one more environment-bound job; if no: mark them `private` |
| E3 | Backend release ordering: migration Job → Deployment roll → desktop feeds. Confirm the migration for this version is backward compatible with the still-running pods (the rollback runbook says schema changes are deliberate) | the workflow will not roll back a migration |
| E4 | Two runs of the same tag are impossible (immutable `staged/<tag>/` and registry tag). A failed run therefore needs a **new** version + tag. Confirm this is acceptable | by design; no overwrite path exists |
