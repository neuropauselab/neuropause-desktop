# NeuroPause — Download Catalog

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: pilots, IT
>
> **Honest by design: this catalog contains no download links.** No signed/notarized packaged artifact is published for this build. Do not trust any third-party file claiming to be "NeuroPause" — there is no official download to compare it against.

## Current distribution status

| Target | Artifact | Status | How to run today |
|---|---|---|---|
| macOS (Apple Silicon) | Signed/notarized `.dmg`/`.app` | **NOT BUILT / NOT PUBLISHED** | **Run from source** for a pilot (see below) |
| macOS (Apple Silicon) | Unsigned local build | **Buildable, NOT VERIFIED here** | Local `npm` build; not certified |
| Windows | Installer | **PLANNED** (not in this build) | — |
| Linux | Package | **PLANNED** (not in this build) | — |

There are therefore **no download URLs and no published checksums** in this catalog, because there is no released artifact to link or hash. This is deliberate — publishing a link to a build that doesn't exist, or a checksum for a file we haven't produced, would be fabrication.

## How to run NeuroPause for a pilot (verified path)

Run from source on macOS (Apple Silicon):

```bash
npm install
npm run infra:up          # postgres:16 + redis:7
# create .env (root) and apps/backend/.env from .env.example; set a strong JWT_ACCESS_SECRET
npm run db:migrate        # 12 migrations
npm run dev               # backend + desktop
```

Verify `GET /health` returns `{"status":"ok"}` before onboarding users. The full pilot procedure — prerequisites, dependency gating, security checklist, acceptance criteria — is in the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md).

## Packaging & signing (process references)

Producing a distributable macOS build requires code signing and Apple notarization. The **process** is documented (the mechanics, not a released artifact):

- macOS packaging: [`docs/launch/LAUNCH-02-MAC-PACKAGING.md`](../launch/LAUNCH-02-MAC-PACKAGING.md)
- Signing & notarization: [`docs/release/PACKAGING-SIGNING-NOTARIZATION.md`](../release/PACKAGING-SIGNING-NOTARIZATION.md)
- Release-level known limitations: [`docs/release/KNOWN-LIMITATIONS.md`](../release/KNOWN-LIMITATIONS.md)

Until a signed/notarized artifact is actually built, verified, and published, this catalog will continue to list **NOT PUBLISHED** rather than a link.

## Integrity guidance

- Treat any "NeuroPause installer" from an unofficial source as untrusted — there is no official release to validate it against.
- When an official artifact is published, this catalog will carry its exact filename, version, and a published checksum. Verify both before running.

## Related
[Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md) · [RC Release Notes](../product/CURRENT-RC-RELEASE-NOTES.md) · [Document Manifest](DOCUMENT-MANIFEST.json)
