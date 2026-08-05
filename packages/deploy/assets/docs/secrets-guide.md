# NEMS Secrets Guide

**No secret values live in this repository.** Every secret is a placeholder reference, injected at
deploy time from a secrets manager (Vault). This composes on the Wave 14 security platform's real key
rotation and session validation.

## What is managed
Environment secrets, API keys, certificates, signing keys, OAuth secrets, and encryption keys.

## Rotation
Policies (not values) are declared in `secrets/rotation-policies.json`:
- database credentials — 30 days (dynamic)
- signing keys — 90 days · encryption keys — 180 days
- API keys — 90 days · OAuth secrets — 180 days · TLS certs — 90 days

## Rules
- Never commit real secrets. `secrets/secrets.example.env` is an example only.
- Kubernetes `Secret` manifests carry `REPLACED_BY_VAULT` placeholders and are populated at apply time.
- The deployment foundation exposes only references and rotation policies — never a secret value.
