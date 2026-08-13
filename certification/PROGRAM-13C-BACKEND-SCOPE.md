# PROGRAM 13C — BACKEND SCOPE DETERMINATION

The brief required this to stop being an ambiguity. It is decided here on
evidence, not preference.

## The determination

**`apps/backend` is INSIDE the NeuroPause production security boundary.**

## The evidence

The desktop application resolves organizations and authentication through it:

```
apps/desktop/src/main/organization/orgClient.ts:43   ${config.backendUrl}/organizations${path}
apps/desktop/src/main/auth/backendClient.ts:40       ${config.backendUrl}${path}
apps/desktop/src/main/license/transport.ts:33        deps.baseUrl ?? config.backendUrl
apps/desktop/src/main/runtimeTelemetry.ts:67         ${config.backendUrl}/health
```

The backend URL is baked into every shipped artifact by
`scripts/generate-build-info.cjs` and defaults to `https://api.neuropause033.com`
in both release workflows. Its migrations include `0003_organizations.sql` and
`0004_auth_hardening.sql`.

Organizations and authentication ARE the tenant boundary. A service that owns
them is not adjacent to the security boundary; it is part of it.

## What Program 13C has done about it

Nothing. Commits touching `apps/backend` since 10 August: **0**, against 716
file-touches in `apps/desktop` and 34 in `packages/shared`.

The backend has two suites, both green and both executed this run:

```
unit         37 files / 418 tests
integration   2 files /  17 tests   (real Postgres 16 + Redis 7)
```

The integration files are named `auth.test.ts` and `organizations.test.ts` —
precisely the boundary in question. Seventeen tests is a smoke test of that
boundary, not a certification of it. Until 12 August that suite ran in no
workflow and no release gate at all.

## The consequence, stated so it cannot be misread

**Program 13C does not certify the backend.** Whatever "CERTIFIED" is eventually
allowed to mean, it covers the Electron desktop application and
`packages/shared`. A customer or auditor reading a Program 13C certificate must
not infer that the service holding their organization records and credentials was
examined, because it was not.

Two honest options, and this document does not choose between them:

1. **Bring it into scope.** Certify backend tenant isolation with the same A/B/C
   discipline: API authentication, authorization, organization and membership
   isolation, resource reads and writes, mutation, export, background jobs, admin
   operations, and database-level tenant filtering, against real Postgres.
2. **Keep it out of scope, explicitly.** Then every certificate, report and
   customer-facing claim must name the exclusion in the same breath as the claim.

Silence is the only option that is not available, because silence is what has
been in force for seventeen rounds.
