# DECISION MEMO — S116 · ABAC ENFORCEMENT GATE (policy-open, NOT wired)

**Date:** 2026-09-04 · **Status:** BLOCKED-POLICY (do not wire without operator ruling + FG gate)

## Summary
The pure ABAC evaluator (`apps/desktop/src/main/security/abac.ts`, harvested S110, extended S116 with the advisory `explainAbacDecision`) is **currently inert** — no live authorization path imports it (verified: repo-wide the only importers are its own tests; a structural test pins that `abac.ts` imports nothing and references no authz/CST/store module). It evaluates and now EXPLAINS attribute policies; it grants nothing. Wiring it into live authorization CHANGES authorization semantics and therefore requires an explicit operator policy + an FG gate. This memo records exactly what must be defined first. **No business policy is invented here.**

## Enforcement point (measured, single choke point)
`runSecureHandler(def, rawPayload, deps)` in `apps/desktop/src/main/ipc/secureBridge.ts` — the transport-neutral core every gated channel AND the REST gateway pass through. RBAC is enforced there via `deps.authorize(def.permission)`; the permission is stamped by `withRuntimeAuthz` from `RUNTIME_CHANNEL_PERMISSIONS` (runtimeAuthz.ts). The architecturally correct ABAC insertion is **immediately AFTER the RBAC `deps.authorize` succeeds and BEFORE handler execution**, through `isAbacPermitted` (fail-closed) — so ABAC can only further RESTRICT an already-RBAC-permitted call, never widen it. Principle held: RBAC ∧ ABAC ∧ CST ∧ approval. ABAC may restrict; ABAC must never silently grant.

## Undefined inputs that require an operator ruling before enforcement
- **Subject attributes:** no mapping from the live authenticated principal to `AbacSubject.attributes` (role, tenantId, clearance, department…). Which fields exist and how they populate is undefined.
- **Resource attributes:** no adapter from an IpcChannel + payload (or a CST command / ERP record) to `AbacResource` (`type`, `attributes.classification`, owner, sensitivity). No classification taxonomy exists on live records.
- **Action attributes:** `action` is a bare string; no vocabulary and no mapping from the hundreds of `IpcChannel`/`DomainCommandType` values to ABAC actions, nor its relationship to the RBAC permission already gating the channel.
- **Environment:** `environment.*` (ip, time…) is read by path but populated by no live source.
- **Policy registry + persistence:** `RUNTIME_CHANNEL_PERMISSIONS` is the RBAC source of truth; there is NO equivalent ABAC policy registry. `AbacPolicySet` is in-memory only. Who authors policies, where they persist, how they version in production — undefined. (Explicitly NOT an AI-usable permission generator.)
- **Composition / deny semantics:** the RESTRICT-only rule must be pinned: a `not-applicable` result must mean "ABAC abstains, RBAC stands" — NOT "block". Wiring naively through `isAbacPermitted` would block an RBAC-permitted call on `not-applicable`. Ordering relative to CST/approval must be defined (before/after the command bus).
- **Tenant boundary:** today tenant isolation is enforced in the STORES; whether it moves into ABAC policy or stays in stores is a policy decision. The evaluator has no built-in tenant enforcement.
- **Audit contract:** the module is deliberately audit-free. On enforcement, ABAC deny/permit + `policyId`/`reason` must be recorded via the existing signed audit chain (S111/S115) under a defined contract.
- **Policy ownership + rollout:** who owns the policy set; fail-closed rollout (shadow/observe mode first, recording would-deny without enforcing) before hard enforcement.

## Recommendation
Keep ABAC **advisory** (evaluate / simulate / **explain**) — S116's `explainAbacDecision` is the safe operator-facing "why permitted/denied" surface with zero authority. Do NOT wire enforcement until the operator supplies the attribute-population contracts, the policy registry+persistence, the RESTRICT-only composition rule, the tenant-boundary decision, and the audit contract above — then via an FG gate at `runSecureHandler`, in shadow mode first.
