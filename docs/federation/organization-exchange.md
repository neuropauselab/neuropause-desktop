# Organization Exchange

A shared catalog of publishable, **signed**, **versioned** artifacts that
organizations across the federation can publish and consume.

## Artifact kinds

Six kinds: AI workers, connector packs, governance policies, workflow templates,
knowledge packages, and dashboard templates.

## Versioning, ratings, verification, rollback

- **Versions.** Each artifact has an ordered version list and a current version
  pointer. Publishing a new version appends and advances the pointer.
- **Rollback.** Rolling back marks the current version `rolled_back` and moves
  the pointer to the previous published version.
- **Ratings.** A running average with a count; rating is monotonic and clamped
  to 1–5.
- **Verification.** `unverified` → `verified` → `official`, surfaced as a badge.

## Digital signatures (real Ed25519)

Every version is signed. The store generates an Ed25519 keypair on first run,
derives a key id from the public key's SHA-256 (`npfed_…`), and persists both
keys as PEM so signatures verify across restarts. Signing canonicalizes the
artifact manifest (kind, name, publisher org, scope, version) to a stable JSON
string, hashes it (SHA-256), and signs the digest. `verifyVersion` recomputes
the digest and verifies the signature against the public key — a tampered
manifest (any field changed) fails verification.

This is the same cryptographic primitive the Phase 8 marketplace pipeline uses;
the exchange is a federation-scoped instance of it.

## Marketplace scopes

Each artifact carries a visibility **scope** — `private`, `public`, `partner`,
or `regional` — which is exactly the Enterprise Marketplace dimension. Changing
scope changes who across the federation can discover and install the artifact;
`regional` additionally pins it to a data-residency region. The Marketplace
panel is the exchange viewed and controlled by scope.

## IPC

`fed:exchange.*` — `artifacts`, `summary`, plus audited `publish`,
`publishVersion`, `setVerification`, `rollback`, `install`, and `rate`;
`verifyVersion` returns a boolean. `fed:marketplace.*` — `scopes` and the
audited `setScope`.
