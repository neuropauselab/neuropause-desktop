# NeuroPause — Download Catalog

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilots, IT
>
> **Honest by design: this catalog contains no download links.** No signed/notarized packaged artifact is published for this build. During the pilot, distribution is controlled by NeuroPause. Do not trust any third-party file claiming to be "NeuroPause" — there is no official public download to compare it against.

## Current distribution status

| Target | Artifact | Status | How to obtain today |
|---|---|---|---|
| macOS (Apple Silicon) | Signed/notarized `.dmg` / `.zip` | **NOT PUBLISHED** (signing config wired; credentials required) | **Pilot artifact — distribution controlled by NeuroPause**, or run from source |
| macOS (Apple Silicon) | Unsigned local build | **Buildable, NOT VERIFIED here** | Local `npm run package:dir` (unsigned); not certified |
| Windows (x64) | NSIS installer / portable | **PLANNED / packaging configured; signing credentials required** | — |
| Linux | Package | **PLANNED** (not in this build) | — |

There are **no download URLs and no published checksums** here, because there is no released artifact to link or hash. Publishing a link or checksum for a build that doesn't exist would be fabrication.

## Distribution model during the pilot

Pilot builds are **controlled artifacts**: NeuroPause provides the build directly to the pilot organization through the agreed channel. This catalog will list an actual filename, version, SHA-256 checksum, signature, and notarization status **only once a real signed artifact is built, verified, and released** (see Release Blockers [RB-1](../product/RELEASE-BLOCKERS.md), [RB-3](../product/RELEASE-BLOCKERS.md), [RB-10](../product/RELEASE-BLOCKERS.md)).

## Run from source (verified pilot path)

```bash
npm install
npm run infra:up          # postgres:16 + redis:7
# create .env (root) and apps/backend/.env from .env.example; set a strong JWT_ACCESS_SECRET
npm run db:migrate        # 12 migrations
npm run dev               # backend + desktop
```

Verify `GET /health` returns `{"status":"ok"}` before onboarding users. Full procedure: [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md).

## Packaging, signing & updates (status)

The release pipeline is configured and credential-gated — it fails open to an **unsigned** build until operator secrets are supplied:

- macOS signing + hardened runtime + notarization: wired (`electron-builder.yml`, `scripts/notarize.cjs`); needs Apple credentials — [RB-1](../product/RELEASE-BLOCKERS.md).
- Windows Authenticode: env-driven; needs a certificate — [RB-2](../product/RELEASE-BLOCKERS.md).
- Auto-update feed: `electron-updater` → `https://neuropause033.com/updates` (channel `beta`); needs a hosted feed + a signed build to serve — [RB-3](../product/RELEASE-BLOCKERS.md).

Process references: `docs/launch/LAUNCH-02-MAC-PACKAGING.md`, `docs/release/PACKAGING-SIGNING-NOTARIZATION.md`, `docs/release/KNOWN-LIMITATIONS.md`.

## Integrity guidance

- Treat any "NeuroPause installer" from an unofficial source as untrusted — there is no public release to validate it against.
- When an official artifact is published, this catalog will carry its exact filename, version, and a published SHA-256 checksum. Verify both before running.

## Related
[Pilot Release Notes](../product/PILOT-RELEASE-NOTES.md) · [Release Blockers](../product/RELEASE-BLOCKERS.md) · [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) · [Document Manifest](DOCUMENT-MANIFEST.json)
