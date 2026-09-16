# FG-8 — GATE DOC · surface the Workspace Foundation domain snapshot (L1 Slice-2)

**Status: PRESENTED — awaiting the literal token. No frozen byte changes until the token arrives.**

## The token this gate waits for (verbatim)
```
AUTHORIZED: FG-8 — ExecutiveSnapshot workspaceDomain rollup, per gate doc
```
Only the token is consent. A diff that changes after the token needs a new token.

## Why this is a gate (the honest STOP)
Per the directive, L1's production surface should extend an existing non-frozen `enterprise:*` handler payload — NO new
channel. I checked: EVERY `enterprise:*` response is typed in FROZEN `packages/shared` (e.g. `enterprise:context` →
`EnterpriseContext`; `enterprise:dashboard` → `ExecutiveSnapshot`; `enterprise:modules` → `EnterpriseModuleSummary[]`).
There is NO non-frozen response to extend, and `enterprise:modules` is a bare array with no room for a workspace-level
field. So surfacing the domain snapshot requires changing a FROZEN response type. Per your instruction — STOP and present
the FG gate, never work around it — this is that gate. (The L1 domain aggregate itself — observable object + live wiring
+ local-mode honesty — is CLOSED non-frozen; this gate is only its renderer surface.)

## The frozen change — ONE additive optional field, verbatim
`packages/shared/src/types/enterprise.ts`, in `ExecutiveSnapshot` (the `enterprise:dashboard` response — a workspace-level
executive rollup, the natural home), after `operations`:
```
   operations: OperationsSummary;
+  /**
+   * OS-track L1 Workspace Foundation — the tenant-scoped domain rollup (people ·
+   * customers · projects · documents · … : per-domain scoped count + state), a
+   * READ/aggregate-only projection of the governed module stores. Present once
+   * wired; optional for older snapshots/builds. A domain with no store → state
+   * 'unavailable' (never a fabricated 0); unresolved scope → the field is absent.
+   */
+  workspaceDomain?: {
+    scopeResolved: boolean;
+    slices: {
+      domain: string;
+      moduleId: string;
+      label: string;
+      count: number;
+      state: 'present' | 'unavailable';
+    }[];
+  } | null;
 }
```
**Additive-only:** an optional field. Every existing producer/consumer compiles and behaves unchanged (absent ⇒ the
dashboard renders exactly as today); no field removed/renamed/retyped.

## Non-frozen accompaniment (NOT token-gated)
- The `enterprise:dashboard` handler (`computeExecutiveSnapshot`, non-frozen) joins
  `workspaceDomainSnapshot({ moduleStore: (id) => enterprise.modules.get(id)?.store ?? null, scope: activeTenantScope })`
  into `workspaceDomain` — one source of truth (the governed module stores), READ-only.
- LOCAL-MODE HONESTY carries through: under a local principal `activeTenantScope` resolves the local tenant; modules with
  no local store are `'unavailable'`, never an error or fake 0 (already pinned at the aggregate layer, `domainSources.test`).
- Renderer: the executive dashboard renders the domain rollup from `workspaceDomain`; absent → nothing (no fabrication).
- Truthful-surface test + the renderer full-suite rule (any renderer change runs the FULL main suite).

## Threat analysis — both directions
An additive optional field cannot break a producer/consumer (older snapshots omit it). It carries DERIVED counts + a
per-domain state only — no capability, authority, or content. The renderer merely displays it; nothing downstream gains
power from reading it. Populated ONLY by the non-frozen join from the governed module stores.

## Read-only confirmations for you
```bash
sed -n '666,680p' packages/shared/src/types/enterprise.ts   # ExecutiveSnapshot — the field is additive/optional
bash certification/verify-freeze.sh | tail -3               # INTACT
```

## Landing choreography (after the token)
Checkpoint (clean) → re-record → INTACT #1 → the §additive field + the non-frozen dashboard join + renderer + tests →
FULL main + UI + typecheck + lint + verify-e2e-strip green → isolated frozen commit → re-record → INTACT #2 → evidence
(token verbatim, both baselines, the truthful-surface derivation). Then L1 has a CLOSED renderer surface too.
