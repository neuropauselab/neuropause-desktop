# Security Policy

## Supported versions

NeuroPause is at **1.0.0-rc.1** (Enterprise Release Candidate). Security fixes are
applied to the latest release.

## Reporting a vulnerability

Please report suspected security vulnerabilities **privately and responsibly** — do
not open a public issue or PR. Contact the NeuroPause security team with:

- a description of the issue and its security impact,
- steps to reproduce (a proof-of-concept if available),
- the affected component and version.

We aim to acknowledge reports within a few business days and to keep you informed of
remediation progress. Please allow a reasonable time for a fix before any public
disclosure. Good-faith security research conducted under this policy — without
privacy violations, data destruction, or service disruption — will not be pursued
legally.

## Security posture

The platform's verified security controls (Electron hardening, fail-closed IPC + RBAC,
PKCE/rotation auth, keychain secret vaults, SSRF guard, Ed25519 supply-chain signing)
and the current, honestly-tracked hardening backlog are documented in
[`docs/guides/SECURITY-GUIDE.md`](docs/guides/SECURITY-GUIDE.md).
