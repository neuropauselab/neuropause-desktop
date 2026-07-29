# NEMS Administrator Guide

For platform administrators onboarding the first enterprise customer onto NEMS.

## Environments
Dev → QA → Staging → Production → Disaster Recovery. Each is registered in the deployment foundation
with region, cluster, version, status, and health. **Production is never faked** — it starts
`not-deployed` until a real deployment succeeds.

## Provisioning a tenant
Composes on the Wave 13 commercial platform: register the customer, provision a tenant, issue
licenses, and onboard (workspace + AI workforce + industry pack). See the commercial docs.

## Security
Composes on the Wave 14 security platform: MFA, session policies, HSTS/CSP, secure cookies, key
rotation, and certificate registry. Configure per environment in `config/*.json`.

## Release management
Semantic versioning, approval-gated production promotion, rollback registry, and a compatibility
matrix — composed on the Wave 14 production release/upgrade platforms.

## Support
Support bundles, diagnostics, and incident packages compose on the Wave 14 support platform and the
Wave 12 incident registry.
