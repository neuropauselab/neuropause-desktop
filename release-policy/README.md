# release-policy — release-authority admission (np-authority/1, Model E)

## What the authority object is
A statement issued and signed **outside the release subject** that names one exact release: `subject_repository`
(GITHUB_REPOSITORY_ID), `subject_ref` + `candidate_tag`, `subject_commit` (peeled from the tag object),
`subject_tree`, `manifest_digest`, `population_digest`, `policy_digest`, `build_policy_digest`,
`allowed_workflow` (= GITHUB_WORKFLOW_REF, e.g. `owner/repo/.github/workflows/x.yml@refs/tags/v1.2.3`),
`allowed_environment`, `scope`, `effective_from/until`, `reviewer_identity` + `reviewer_decision`,
`decision_timestamp`, a single-use `decision_nonce`, `authority_schema_version: "np-authority/1"`,
`signature_algorithm: "ed25519"` and `signature` (hex, over the canonical JSON of the signed fields —
see `SIGNED_FIELDS`/`REQUIRED` in `scripts/lib/np-authority.cjs`, ported unchanged from NP-R34.2-B.38).
This is subject **Model E**: nothing about the release is self-declared; only produced bytes remain
to be bound by a build record + attestation whose subjects include the authority digest.

`certification/public-launch/PUBLIC_RELEASE_AUTHORIZATION.template.json` is **not** this object
(no issuer, signature, manifest/population/policy/workflow/environment/reviewer/nonce fields).
The gate expects np-authority/1 and denies anything else (`SCHEMA_VERSION_UNSUPPORTED`).

## Who may issue it
Only an identity listed in `trusted_issuers` of `release-policy/authority-trust.json`, who cannot push
release tags, does not author the release workflows, does not run the build, and is not the reviewer.
The issuer takes every subject value by its **own** measurement of Git objects (never from a file the
subject hands it) and signs with an Ed25519 key whose private half never enters the repo or CI.
No script in this repository issues, signs or generates an authority; the gate only verifies.

## Where things live
- Trust list: `release-policy/authority-trust.json` — committed by a repo admin who is not the release
  subject, via reviewed PR, never by a script. `authority-trust.template.json` is treated as ABSENT.
- Population policy: `release-policy/population-policy.json` `{ id, version, include: [globs], exclude?: [globs] }`
  and build policy `release-policy/build-policy.json` (generated paths, toolchain pins) — read from
  **git objects at HEAD**; their canonical-JSON sha256 must equal `policy_digest` / `build_policy_digest`.
- Authority object: `certification/public-launch/PUBLIC_RELEASE_AUTHORIZATION.json`, materialised by the
  workflow at run time from an admin-controlled source (environment-scoped variable or fetched artifact).
  It cannot be committed into the tree it names — the authority names that tree's hash.
- Verifier captures (optional inputs): deployment review record (`source: "deployment_review_api"`,
  `captured_by_verifier: true`, `approver`, `run_id`, `run_attempt`, `approved_subject_digest`) and
  environment state (`source: "admin_api_capture"`, `captured_by_verifier: true`, `name`, `exists`,
  `required_reviewers`, `prevent_self_review`, `deployment_tag_pattern`). Without them the gate DENIES.

## What the gate measures (never the working tree)
commit `HEAD^{commit}`, tree `HEAD^{tree}`, the annotated tag object of GITHUB_REF and its peeled commit
(must equal HEAD; GITHUB_SHA must be the commit or the tag object), the workflow file's last author,
and the population: every blob at HEAD matched by the policy, as `{ path, blob, sha256 }` sorted by path,
with sha256 over `git cat-file -p HEAD:<path>`. Manifest bytes = canonical JSON
`{ schema: "np-b34-manifest/1", candidate_commit, candidate_tree, policy_digest, entries: population }`.
The workflow must fetch the tag object and history (`fetch-depth: 0`, `fetch-tags: true`).

## CLI exit contract
`node scripts/authority-admission.cjs --authority <path> --trust <path> --out <path>`
`[--review <capture.json>] [--environment <capture.json>] [--deployment-time <ISO-8601>]`
- `0` ADMIT — only when `admitAuthority()` returned ALLOW/AUTHORITY_ADMITTED; `--out` carries the verdict.
- `1` DENY — `--out` lists every code (`AUTHORITY_TRUST_ABSENT`, `AUTHORITY_ABSENT`, `AUTHORITY_MALFORMED`,
  `MEASUREMENT_FAILED`, `CANDIDATE_INCONSISTENT`, `SYNTHETIC_AUTHORITY_REJECTED`, `CAPTURE_MALFORMED`,
  or the predicate's code such as `SIGNATURE_INVALID`, `TREE_MISMATCH`, `AUTHORITY_REPLAYED`, …);
  UNKNOWN from the predicate is a DENY. One `::error::` line per code.
- `2` usage / I/O error — no verdict written. Library use: `require('./scripts/authority-admission.cjs')
  .admitFromEnvironment({ authorityPath, trustPath, now, cwd })` returns the same record and never throws;
  inputs fall back to `NP_AUTHORITY_PATH`, `NP_AUTHORITY_TRUST_PATH`, `NP_AUTHORITY_REVIEW_CAPTURE`,
  `NP_AUTHORITY_ENVIRONMENT_CAPTURE`, `NP_AUTHORITY_DEPLOYMENT_TIME`, then to the defaults above.
