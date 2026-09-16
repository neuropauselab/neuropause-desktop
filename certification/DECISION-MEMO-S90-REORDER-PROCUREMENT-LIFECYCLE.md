# DECISION MEMO — S90 Reorder → Procurement Lifecycle (canonical paths reused; no policy invented)

**Outcome.** The S89 reorder-created draft Purchase Request continues through the **existing** governed procurement lifecycle with **zero production changes** — the lifecycle already exists, is wired to the UI, and the reorder PR is a normal PR record that flows through it. S90 is a certification/verification gate. No new approval engine, no second workflow, no bypass. No frozen change; no FG-S90 token.

## 1. Canonical lifecycle found (source-wins)

```
S89 draft PR (status 'draft', requestNumber PR-REORDER-<report>-<sku>, reason names the report)
  → SubmitPurchaseRequest   (command bus → PR module 'submit'  : draft → pending)
  → ApprovePurchaseRequest  (command bus → PR module 'approve' : draft/pending → approved; requires procurement:manage)
  → ConvertPurchaseRequestToPO (command bus → PR module 'createPurchaseOrder' → convertRequestToPurchaseOrder)
        guards: PR.status === 'approved' (else refused) AND no existing convertedOrder (idempotent)
        creates ONE PO (status 'draft', poNumber PO-<requestNumber>, sourceRequest = PR id)
        stamps PR: convertedOrder = PO id, status 'ordered'
  → PO (draft)   [S90 target ends here]
```

Every consequential transition runs through the durable command journal (Session 17/18) — idempotency + domain event (`PurchaseRequestSubmitted`/`Approved`/`ConvertedToPO`) + outbox + audit — and is authorized by `procurement:manage` (conversion additionally asserts the orders module's write scope). The UI already routes the PR detail's Submit/Approve/Create-Purchase-Order buttons through these exact commands (`EnterpriseModuleScreen` GOVERNED table, S49). Sources: `commandBus.ts`, `purchaseRequestModule.ts`, `conversion.ts`.

## 2. Approval policy actually applied (DEFINED) — and what is UNDEFINED (absent by design)

**DEFINED, and enforced on the live path:** *a Purchase Request requires human approval before it becomes a Purchase Order.* This is the deny-by-default gate: conversion refuses unless `status === 'approved'`, and `approved` can be reached only through the governed `ApprovePurchaseRequest` command (a `procurement:manage`-authorized, audited, journaled transition) — the edit door refuses to hand-set the approved/ordered boundary (`purchaseRequestModule` validate hook).

**UNDEFINED, and deliberately ABSENT (not invented — §22):** the workflow runtime states it verbatim — *"NO threshold, hierarchy, delegation, escalation, expiration or self-approval rule — those are undefined policy per §22 and are absent, not invented."* Therefore:
- There is **no multi-step spend-policy approval chain** on the live path. `DEFAULT_SPEND_POLICY` / `applicableSteps` (`erp/approvalEngine.ts`) is an *illustrative, operator-replaceable* engine that is **not wired** into the live PR approval command. S88's decision register named the required approval *steps* as informational for a future spend-policy wiring; S90 does not wire it (that would be inventing/adopting a policy — forbidden).
- There is **no segregation-of-duties / self-approval rule** on the live path. So S90 does **not** claim SoD is enforced; it records that SoD is an explicitly-undefined-and-absent policy. Adopting it (e.g. `creator_cannot_approve`) is an operator decision + its own gate, not part of S90.

This is consistent with S77/S88/S89: procurement authority reuses the existing spend-policy machinery **only where it is actually wired**, and the wired policy is the single human-approval gate. No thresholds/roles/authority were invented.

## 3. PO conversion / send path

Conversion (`convertRequestToPurchaseOrder`) is the S90 target terminus: it produces a **draft** PO with full reorder lineage (`poNumber = PO-PR-REORDER-<report>-<sku>`, `sourceRequest = PR id`, plus the Session-1 correlation metadata). The PO is **not** auto-approved or auto-sent.

**PO approve/send exists** as governed PO module actions (`assignSupplier`/`approve`/`send`/`cancel`/`receiveGoods`, guarded status machine, `budgetRef`/`contractRef` govern PO approval per FW-5/FW-7). These run through the module-action layer (RBAC + tenant + audit); they are **beyond the S90 target** (which ends at PO creation) and are **not** performed automatically. No PO-send policy is invented here.

## 4. Legacy-door status for the PR lifecycle (recorded, not changed)

The PR lifecycle actions (`submit`/`approve`/`reject`/`createPurchaseOrder`) are **not** in the Session-46 `GOVERNED_ONLY_ACTIONS` fence, so they remain reachable through the legacy `enterprise:module.action` door as well as the command bus. Both paths are governed at the module-action layer (RBAC `procurement:manage` + tenant scope + audit); the command-bus path additionally provides the durable journal / event / outbox / idempotency spine, and the UI uses it. Fencing the PR lifecycle to governed-only (reusing the existing S46 mechanism) would be a defensible future hardening — it is **recorded here as an option, not implemented in S90**, because S90's mandate is to reuse the canonical governance as-is and change nothing that is already defined.

## 5. Reorder identifiability (existing data — no UI change)

The reorder origin is visible through existing fields the UI already renders: the PR `requestNumber` (`PR-REORDER-<report>-<sku>`), the PR `reason` (`Reorder execution from <report> (<sku>) …`), and, after conversion, the PO `poNumber` (`PO-PR-REORDER-…`) and `sourceRequest`. No new UI surface is required to make the reorder PR identifiable; the minimum-UI-change requirement is satisfied by the existing lineage data.

## 6. HARD RULE compliance

S89 remains operator-confirmation-only; S90 adds **no** automation. No automatic approval, no automatic PO, no automatic supplier selection. Each downstream transition (Submit, Approve, Convert) is a separate explicit governed action. AI stays advisory (CLAUDE.md §13) — it holds no `procurement:manage` path and cannot approve, convert, or send.

## 7. Remaining policy gaps (documented, not implemented)

1. **Multi-step spend-policy approval chain** (manager/finance/executive by amount) — engine exists, unwired; adopting it is an operator ruling + gate.
2. **Segregation of duties / self-approval prohibition** — undefined and absent; adopting it is an operator ruling + gate.
3. **PO approve/send governance promotion** (command-bus commands + the S46 fence for PO consequential actions) — beyond the S90 target; a future gate.
4. **PR lifecycle legacy-door fencing** — optional hardening via the existing S46 mechanism.

None of these block S90's target (draft PR → approved → PO); each is an explicit future operator-gated decision, recorded rather than assumed.
