# Marketplace

Where developers publish **AI apps, AI workers, connectors, plugins, automation
templates, and enterprise templates**, and where the organization installs them.
The marketplace owns the security-critical publishing pipeline.

## Listings and versions

A **listing** is the product (kind, slug, name, summary, category, pricing,
rating, install count, certified flag, and the pointer to its current published
version). A **version** carries a `manifest`, a `changelog`, and the artifacts of
the pipeline: a `scan` result, a `signature`, and a `review` record.

## The publishing pipeline

```
draft ──submit──▶ scanning ──▶ (scan) ──fail──▶ rejected
                                   │ pass / warn
                                   ▼
                                signing ──▶ (Ed25519 sign) ──▶ in_review
                                                                   │
                          ┌────────────────┬─────────────────────┘
                          ▼                ▼                ▼
                      approved          rejected      draft (changes requested)
                          │
                       publish ──▶ published  ◀──rollback── (reverts to prior published)
```

Driven by `marketplace/marketplaceStore.ts` using the pure
`marketplace/pipeline.ts`:

- **Security scan** — `securityScan(manifest)` is a deterministic static check.
  Rules: missing entry (critical), dangerous permission such as `system:exec` /
  `fs:write:all` / `secrets:read` (high), network capability with no declared
  domains (medium), suspicious dependency references — `..`, absolute, `file:`,
  `http:` (high), more than 8 permissions (low advisory), missing publisher
  metadata (info). Status is `fail` on any high/critical, `warn` on any
  medium/low, else `pass`. A `fail` auto-rejects the version.
- **Digital signing** — `signManifest` computes a SHA-256 digest over a
  **canonical** (sorted-key) manifest and signs it with the organization's
  **Ed25519** private key. `verifyManifest` checks the digest matches and the
  signature verifies against the public key. The keypair is generated and
  persisted (PEM) on first run; the key id is a fingerprint of the public key.
- **Review** — approve / reject / request changes, with a reviewer + notes.
- **Publish / rollback** — publishing sets the listing's current version;
  rollback reverts to the previous published version (by publish time) and marks
  the rolled-back version accordingly.

Every transition appends a `SubmissionEvent` to an audit trail surfaced in the
dashboard and the listing detail.

## Seeded examples

Five example listings (an AI worker, a GitHub connector, an inbox→Notion
automation, a SOC 2 governance pack, and a markdown-export plugin) are seeded
**through the real pipeline** — scanned, signed, reviewed, and published — so the
marketplace is populated and every published version carries a genuine
signature. Their names are suffixed "(Example)".

## IPC

`ipc.ecosystem.listings | listing | marketplaceStats | submissionEvents |
createListing | createVersion | submit | review | publish | rollback | install |
rate`.
