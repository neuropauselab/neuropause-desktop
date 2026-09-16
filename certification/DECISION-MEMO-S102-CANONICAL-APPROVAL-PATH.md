# DECISION MEMO — S102: the canonical enterprise approval path (three subsystems reconciled; no false unification)

**Purpose.** Reconcile the three approval mechanisms S101 discovered, define the canonical approval path, and decide what may be safely wired vs what remains an operator ruling. S102 invents no policy and applies no threshold; no production code changed.

## The three approval subsystems — the map

| Subsystem | Owner / data model | Persistence | Who calls it | What it approves | What execution it unlocks | Live? |
|---|---|---|---|---|---|---|
| **1. Machine-owned status + governed action + RBAC** | each domain module's `runAction` + `descriptor.permissions.write` + a machine-owned/marker-derived `status` field | the module's `EnterpriseRecordStore` | every consequential ERP action (ship, invoice, issue, pay, approve PO, approve bill, complete production, post payroll, post adjustment…) | the document's own status transition | the economic effect (inventory / GL / AR / AP / payment) | **YES — the live path certified S94–S101** |
| **2. S20 workflow runtime** (`platform/workflow/`) | `ApprovalInstance {tenantId, targetModule, targetId, gatedCommand, requester, approver?, status: PENDING\|APPROVED\|REJECTED}` | `ApprovalInstanceStore` (DurableJsonStore) | `workflowRuntime.requestApprovalFor` / `decideApproval` | ONE hard-coded rule: `SubmitPurchaseRequest` on `procurement-requests` → REQUIRES_APPROVAL | dispatches `ApprovePurchaseRequest`/`RejectPurchaseRequest` (→ PR status) | **YES — the PR approval workflow** |
| **3. erp/approvalEngine** (`erp/approvalEngine.ts`) | `ApprovalPolicy {steps[role,minAmount], sod[]}`; `DEFAULT_SPEND_POLICY` ($10k/$100k tiers), `BILL_APPROVAL_POLICY` (creator_cannot_approve) | stateless evaluator; decision history in `erp/approvalStore.ts` | ONLY `ctx.canEnterStatus` at the generic `EnterpriseModuleUpdate` / `EnterpriseModuleSetStatus` doors (`moduleRegistry.ts:607-627, 674-689`) | a document status transition, IF the document is registered in `documentSpecs` (procurement-orders, finance-vendor-bills) | nothing directly — it is a GATE that permits/denies a status change at those two doors | **INFRASTRUCTURE — dormant on consequential paths (see below)** |
| **4. CST kernel Approval** | LiveBrain/proposal subsystem (`@neuropause/cst`) | kernel | the AI-proposal execution gate | AI-proposed actions | a governed proposal's single-use execution | separate subsystem, not ERP procurement |

## The decisive structural fact — the two approval-carrying documents differ, and neither is bypassed

`ctx.canEnterStatus` (subsystem 3) is wired in production (`enterprise/index.ts:978` → `documentIntegration.canEnterStatus`) and fires only at the Update/SetStatus doors. The two documents that carry a registered policy behave DIFFERENTLY — verified from source, not assumed:

- **finance-vendor-bills — the engine is DORMANT (single-door).** The status is **derived from action-stamped markers** (`approvedAt`), and the validate hook refuses editing those markers (`vendorBillModule.ts:142-156`: "Markers move only through the approve/cancel actions"). So Update/SetStatus can never set `approved`; `canEnterStatus` is **structurally unreachable** for bills, and `BILL_APPROVAL_POLICY` never fires. The **approve action + RBAC is the sole gate** — there is no dual-door inconsistency and no bypass, but also no live SoD on bill approval (see below).

- **procurement-orders — a DUAL-DOOR model (both doors RBAC-gated).** The PO module validate **deliberately does not fence** entering `approved`/`sent` (`purchaseOrderModule.ts:154-162`: "Entering approved/sent is ALREADY gated by the document-adapter approval engine (canEnterStatus, spend policy) at the update door"), so the Update door = **RBAC + `canEnterStatus(DEFAULT_SPEND_POLICY)`** (active in production), while the approve action = **RBAC + `poTransition`** state machine. Both doors authorize `procurement:manage` FIRST, so **RBAC is the consistent floor on both**; the difference is the Update door additionally applies the spend policy, the action door does not. The validate still fences the two real holes: hand-setting `convertedReceipt`, and `approved`/`sent → draft` reversal.

**Is the PO action door a bypass?** No — because no ADOPTED single authority is bypassed. The spend policy at the Update door is a STRICTER-but-optional alternative on top of the shared RBAC floor; its adoption as the EXCLUSIVE PO-approval authority (routing the action through it too, or applying the $10k/$100k tiers) is the explicit operator ruling S90 records — and the directive forbids inventing/auto-applying those thresholds. So the effective PO-approval authority today is `procurement:manage` (the RBAC floor enforced on both doors), with the spend policy an additional edit-door constraint. **No governance bypass exists** on either document; what remains open is the operator ruling on whether to make the spend policy the exclusive gate.

## PHASE 2 decision — the canonical approval path

**Do NOT force a false unification.** The three subsystems operate at three different layers and are not duplicates:
- Subsystem **1** is the canonical, live authority for consequential ERP economic transitions. **This is the answer to "who is authorized to cause each economic action": the holder of the module's write scope, acting through the governed action, on a machine-owned status no other door can forge.**
- Subsystem **2** is the durable request→approval-instance lifecycle, canonical for the ONE flow it governs (PR approval). It composes with subsystem 1 (its APPROVED state is the precondition the PR→PO conversion gate reads).
- Subsystem **3** is reusable policy infrastructure (threshold + SoD) that is dormant on consequential paths. **Adopting it (routing an action through the policy) is an explicit operator ruling** — see below — not a wiring S102 performs.
- Subsystem **4** is a separate subsystem (AI proposal execution), out of the ERP procurement scope.

Unifying 1/2/3 into one engine would be a false unification: 2 is a stateful workflow instance, 3 is a stateless status-policy evaluator, 1 is the domain action itself. They are correctly separate.

## Why the threshold/SoD engine is NOT wired to PR/PO/bill approval (operator ruling, not defect)

The repository DECLARES `DEFAULT_SPEND_POLICY` (POs) and `BILL_APPROVAL_POLICY` (bills, `sod: creator_cannot_approve`) in `documentSpecs`, but they are unenforced on the live action path. This is **POLICY-OPEN**, not a defect, for two independent reasons:
1. **The repository's own memo (S90) states adoption is an operator ruling:** "Multi-step spend-policy approval chain (manager/finance/executive by amount) — engine exists, unwired; adopting it is an operator ruling + gate."
2. **Adopting the bill creator≠approver SoD would break the certified single-operator P2P flow.** In S94/S96/S100 and the real P2P journeys, ONE operator creates the vendor bill and approves it (`ApproveSupplierInvoice`). Enforcing creator≠approver would refuse that flow and require a second principal for every AP approval — a real operational policy choice the operator must make. This is the material distinction from the **expense-claim** SoD (S57/S101), which is safely enforced because expense approval is inherently a two-party flow (employee submits, a different operator approves) and enforcing it broke nothing.

The directive's warning — "do not automatically apply the existing $10k/$100k thresholds unless repository policy explicitly proves those thresholds are intended for that operation" — is honored: they are not applied. The threshold constants are reusable infrastructure, not adopted ERP policy.

## Authority / SoD / threshold matrices (classification)

- **A implemented + certified:** machine-owned-status + governed-action + RBAC authority (all consequential ERP actions); expense-claim creator≠approver SoD; S20 PR approval-instance workflow (idempotent, tenant-scoped, single-flight, terminal); payment-reversal + economic-delete guards; period-close immutability; server-resolved unforgeable actor.
- **C policy-open (declared/infrastructure, adoption = operator ruling; NOT invented):** PO/bill creator≠approver SoD (declared, unenforced — would break single-operator P2P); PO/bill spend thresholds ($10k/$100k); PR/PO threshold tiers + role hierarchy; expense multi-level authority; payment-reversal SoD; period-reopen dual-control.
- **D not-implemented (economic mechanics real; authority layer absent):** payroll/disbursement approval + SoD; stock-adjustment/cycle-count approval + materiality; manufacturing variance/scrap approval + materiality.

## The founder-level answer

*Who is authorized to cause each consequential ERP economic action?* — The holder of the domain module's write permission (`<domain>:manage`), acting through the governed action, whose actor is server-resolved and whose target status is machine-owned. *What approval is required?* — For PR: a durable S20 approval instance (APPROVED) before conversion. For expense claims: a different operator (creator≠approver). For everything else: the RBAC scope is the authority, and second-party approval (SoD/thresholds) is declared infrastructure awaiting an operator ruling. *Can any other door bypass that authority?* — **No.** The Update/SetStatus/delete doors are fenced (machine-owned statuses, economic-delete guards), the approvalEngine is dormant (never reachable on these paths), the actor cannot be forged, and cross-tenant/replay/terminal attempts fail closed (proven S46/S55/S61/S95/S97/S98/S101/S102).

## No production change

S102 changes no production code. It reconciles the subsystems, names the canonical path, records the operator rulings required to adopt the dormant policy engine, and re-certifies the authority matrix + approval-record integrity.
