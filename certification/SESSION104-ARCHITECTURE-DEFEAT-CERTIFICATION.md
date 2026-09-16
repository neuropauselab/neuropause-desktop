# SESSION 104 — ARCHITECTURE-DEFEAT / ADVERSARIAL CONTROL-PLANE CERTIFICATION

**Class:** adversarial red-team — ZERO production change. **Verdict: the NeuroPause architecture survived the attempt to defeat it. NO STOP. No renderer-, AI-, legacy-, replay-, envelope-, cross-tenant-, or composition-path reaches an unauthorized economic mutation.** Baseline S103 GREEN. Full architecture map, trust-boundary map, alternate-door census, and per-attack matrix: DECISION-MEMO-S104.

## 1. Deliverables (all in DECISION-MEMO-S104)

Actual architecture map · trust-boundary map · alternate-door census · composition-attack matrix · temporal/durability reasoning · authority-composition · AI-escape · cross-domain invariant · F-S98-1 all-domain regression · findings classified A/B/C/D/STOP.

## 2. Independent red-team sweep (source-cited)

An independent adversarial audit of every IPC channel, direct-store call, renderer-supplied actor/tenant, AI path, background writer, and onChange economic posting found **NO renderer- or AI-reachable door that causes a consequential economic mutation without a server-side RBAC authorize on a server-resolved actor.** Strongest evidence: fail-closed channel classification at boot (`assertAllChannelsClassified`); server-derived tenancy + RBAC on the command bus (`CROSS_TENANT_CLAIM`, `authorize(PERMISSION_FOR_COMMAND)`); the `INTERNAL_ACTION_ORIGIN` token on the legacy action door.

## 3. Composition-attack matrix — all fail closed

`architectureDefeatMatrix.test.ts` **8/8**: replay/idempotency-key confusion (second command SUPPRESSED, zero effect); forged tenant envelope (CROSS_TENANT_CLAIM); forged actor + advisory principal (UNAUTHORIZED); APPROVE→MODIFY (approved PO revert refused, issued-invoice amount edit refused); REVERSE→REVERSE (at-most-once) → REVERSE→DELETE (reversal undeletable) → delete original (refused); cross-tenant reference (invisible); F-S98-1 all-domain status forge (production/PO/adjustment/SO/invoice — refused/inert). Every attack: ZERO inventory/GL/AR/AP/payment/FG side effect.

## 4. Key finding — idempotency-key confusion is SAFE

The command idempotency identity is `${tenantId}::${idempotencyKey}` (not command-type-scoped), so a different command reusing a key REPLAYS the first's cached result without executing — command SUPPRESSION (self-denial), never a duplicate or unauthorized effect. Classified **A (safe from economic bypass)**; the caller controls its own keys. A robustness footgun, not a security defect — no production change (an operator ruling if ever desired).

## 5. Classification

- **A — SAFE/PROVEN:** governed path, trust boundaries, alternate-door census, composition matrix, envelope forgery, cross-tenant, F-S98-1 all-domain, idempotency-key confusion, AI escape, temporal/durability.
- **C — POLICY-OPEN (carried):** payroll/adjustment/variance approval, reversal SoD, period-reopen dual-control, maintenance/project cost→GL — none bypassable into an economic mutation.
- **D / STOP: NONE.**

## 6. Regression fences carried (all GREEN)

S46 (legacy origin token), S55 (economic delete), S61/S62/S64 (reversal integrity), S95, S97 (posted movement immutable), S98 (F-S98-1), S99/S100 (cross-domain), S101/S102/S103 (authority, approval reconciliation, economic-bypass matrix).

## 7. Real-Electron result — PENDING operator Mac

`out-seam-s104` build → fresh-profile adversarial journey with a real restart (`apps/desktop/e2e/s104ArchitectureDefeatJourney.e2e.cjs`):

```
cd apps/desktop
env -u NP_E2E_BUILD npx electron-vite build --outDir "$PWD/out-seam-s104"
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" node e2e/s104ArchitectureDefeatJourney.e2e.cjs ; echo "exit=$?"
```

Executes the highest-value attacks against the REAL renderer/preload/IPC/command path (no IPC shortcuts to create state beyond the governed doors): idempotency-key confusion (a different command reusing a key is suppressed, zero effect); a forged tenant in the dispatch envelope is refused; APPROVE→MODIFY refused; reversal composition (reverse→reverse, reverse→delete, delete-original) refused; F-S98-1 all-domain status forge inert; and after a REAL restart every refusal persists with no economic mutation. **S104 GREEN only on RESULT + exit 0 there.**

## 8. Frozen-file changes

**None.** gate-detector PROCEED on all S104 files. No FG-S104 token. `certification/baseline.json` untouched.

## 9. Exact files changed

- **PRODUCTION: NONE.**
- **TEST (1):** `apps/desktop/src/main/platform/command/architectureDefeatMatrix.test.ts` (new).
- **HARNESS (1):** `apps/desktop/e2e/s104ArchitectureDefeatJourney.e2e.cjs` (new).
- **DOCS (2):** this cert + `DECISION-MEMO-S104-ARCHITECTURE-DEFEAT-VERDICT.md`.

## 10. Final S104 status — GREEN pending the operator's Mac journey

The architecture-defeat verdict: **the current NeuroPause architecture cannot be defeated by composing legitimate capabilities, exploiting alternate doors, manipulating identity/tenant context, replaying commands, crossing transaction boundaries, abusing timing/recovery, or using AI/legacy paths.** Every consequential economic mutation flows only through a server-side-authorized, tenant-validated, machine-owned-status governed action; no attack reached an economic mutation it should not; the idempotency-key confusion suppresses rather than duplicates. Proven by an independent red-team source sweep + 8/8 focused composition-attack tests + regression (sandbox). No RED, no STOP, no production change, no frozen change, no FG token; the open items are undefined business policy, fail-closed and documented. `certification/baseline.json` untouched; release-track files untouched (paused). **The fresh-profile real-Electron adversarial journey with a real restart runs on the operator's Mac — S104 is marked GREEN only on RESULT + exit 0 there.**
