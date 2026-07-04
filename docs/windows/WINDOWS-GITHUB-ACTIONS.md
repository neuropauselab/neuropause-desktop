# WINDOWS-GITHUB-ACTIONS

Reference for the `windows-release` GitHub Actions workflow: secrets, variables,
signing conditions, and permissions.

## Repository configuration

**Settings → Secrets and variables → Actions**

Variables (non-secret):

| Name | Purpose | Default if unset |
| --- | --- | --- |
| `NEUROPAUSE_BACKEND_URL` | baked into the build | `https://api.neuropause033.com` |

Secrets (for signing — optional):

| Name | Purpose |
| --- | --- |
| `WIN_CSC_LINK` | base64 of the Windows `.pfx` (preferred) |
| `WIN_CSC_KEY_PASSWORD` | its password |
| `CSC_LINK` | generic cert fallback |
| `CSC_KEY_PASSWORD` | its password |

## Signing conditions (verified behavior)

The workflow passes all four cert variables into the `Package Windows` step's
environment. electron-builder's env-driven signing (Phase-4 finding) means:

- **Secrets present** → the installer is **Authenticode-signed** automatically.
- **Secrets absent/empty** → an **unsigned** installer is produced and the
  workflow **still succeeds** (no failure). GitHub substitutes an empty string
  for an undefined secret, which electron-builder treats as "no certificate".

This satisfies STEP 4 exactly: sign when secrets exist, unsigned-without-failing
when they don't. No conditional logic was hand-written — it is electron-builder's
built-in behavior, so nothing is duplicated.

## Permissions

`permissions: contents: write` — the minimum needed for
`softprops/action-gh-release` to create the Release and upload assets. No other
scope is granted (least privilege).

## Triggers recap

- `workflow_dispatch` — manual, artifacts only.
- `push` tag `v*` — build + publish Release.

## Actions used (pinned to major versions)

- `actions/checkout@v4`
- `actions/setup-node@v4` (Node from `.nvmrc`)
- `actions/upload-artifact@v4`
- `softprops/action-gh-release@v2`

## EV / cloud-HSM signing note

`WIN_CSC_LINK` covers a **`.pfx`** (standard/OV) certificate. **EV** certs are
hardware/cloud-HSM bound and sign via Azure Key Vault or a vendor token — that is
a different signer integration (env/config driven), added when you adopt an EV
cert. See WINDOWS-CERTIFICATE.md.

## Verifying a run

1. Actions tab → the `windows-release` run → confirm all steps green.
2. Tag run → the **Releases** page shows the new release with `.exe`/`.zip`/`.yml`.
3. Download the `.exe` on a Windows box → install → launch → sign in against the
   baked backend. (Full QA matrix: Phase 6.)
