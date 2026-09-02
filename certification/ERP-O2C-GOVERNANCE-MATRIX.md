# ERP O2C GOVERNANCE MATRIX — Session 45 (+ S46 closures)

**HEAD at certification:** see ERP-SESSION45-O2C-REAL-USER-CERTIFICATION.md · All rows measured from
source (file:line in the session report), not asserted. Vocabulary is the repository's own.

## S46 UPDATE — three material adversarial-door rows CLOSED (see ERP-SESSION46-O2C-UNCONDITIONAL-PILOT-GO.md)

- **warehouse-shipping `ship` → order status:** was MATERIAL (direct `store.update` hand-jump
  pending→fulfilled, bypassing the status machine). **NOW GREEN** — routed through the canonical
  `orderActionPatch` table (pending→shipped→fulfilled); illegal/closed/cancelled orders refused.
- **legacy `enterprise:module.action` accepts governed keys:** was KNOWN LIMIT ("no main-side
  boundary"). **NOW GREEN** — a server-side, unforgeable `INTERNAL_ACTION_ORIGIN` token admits the
  command bus only; the renderer path is `.strict()`-parsed and cannot forge it; external governed-key
  calls refused. RBAC unchanged.
- **payment pending→cleared EDIT (row 18):** was YELLOW (create pending → edit cleared mints cash GL).
  **NOW GREEN (fenced)** — the payment validate hook refuses the into-`cleared` edit; clearing goes
  through the governed `ReceiveCustomerPayment`. The `ClearCustomerPayment` policy question stays OPEN.

**Still YELLOW / pilot-fenced (defined-legacy, memo-tracked, NOT happy-path bypasses):** issued-invoice
economic-field edit GL adjustments; issued-invoice / cleared-payment DELETE GL reversals; importer
validate-bypass ingestion. **Remaining RED on the pilot-critical O2C workflow: none.**

Legend — **GREEN**: full governed path (UI → preload → `platform:command.dispatch` → Application
Boundary → command bus → per-command RBAC → durable journal/idempotency → event → outbox → audit →
UI). **YELLOW**: functional via legacy `enterprise:module.*` doors (RBAC + module guards + bridge
audit; no command journal) — recorded, not pilot-critical or policy-blocked. **N/A-POLICY**: the
operation's governing policy is undefined — decision memo filed, nothing invented. **CRUD-OK**:
master-data create/edit where module CRUD is the accepted canonical path (no economic effect).

| # | Operation | UI entry | Command | Status |
|---|-----------|----------|---------|--------|
| 1 | Create Customer | Customers module create form | — (module CRUD; `crm:manage`) | **CRUD-OK** — master data, no economic effect |
| 2 | Create Sales Order | Orders create form (S43) | `CreateSalesOrder` | **GREEN** (S43; re-proven live S45) |
| 3 | Edit Sales Order | Orders edit form | — (module CRUD, `sales:manage`) | **YELLOW** — non-status fields only; **status hand-set now REFUSED** (S45 guard, live-proven) |
| 4 | Submit Sales Order | — | — | **N/A-POLICY** (DECISION-MEMO-SALES-ORDER-APPROVAL) |
| 5 | Approve Sales Order | — | — | **N/A-POLICY** (same memo) |
| 6 | Reject Sales Order | — | — | **N/A-POLICY** (same memo) |
| 7 | Confirm Sales Order | — | — | **N/A-POLICY** — no confirm state exists in `OrderStatus`; orders are born `pending` |
| 8 | Reserve stock | Orders `Reserve Stock` action | — (module action) | **YELLOW** — reservation, reversible, non-GL |
| 9 | Quote → Sales Order | Quotes `Convert to Sales Order` | `ConvertQuoteToSalesOrder` **(NEW S45)** | **GREEN** — was RED (direct store.create around the governed create) |
| 10 | Ship Sales Order | Orders `Ship` action | `ShipSalesOrder` | **GREEN** **(S45 wiring)** — was RED (legacy action door; real stock issue) |
| 11 | Fulfill / Close / Cancel order | Orders actions | — (module actions, status machine) | **YELLOW** — status-machine-guarded; cancel-after-ship disposition unverified (recorded) |
| 12 | Shipment documents (warehouse-shipping ship/deliver, dispatch) | Shipping module actions | — | **YELLOW / N/A-POLICY** (DECISION-MEMO-O2C-REVERSAL-AND-SHIPMENT-DOCS §2) |
| 13 | Create Customer Invoice from order | Orders `Generate Invoice` | `InvoiceSalesOrder` | **GREEN** **(S45 wiring)** — was RED |
| 14 | Issue Customer Invoice (Dr AR / Cr Revenue) | Finance `Issue` action | `IssueCustomerInvoice` | **GREEN** **(S45 wiring)** — was RED (GL booked via legacy door) |
| 15 | Invoice cancel (GL reversal) | Finance `Cancel` action | — | **YELLOW / N/A-POLICY** (memo §1 — reversal commands unmodeled) |
| 16 | Record AR | — (derived) | — | **GREEN** — AR is derived from issue/receipt, never hand-entered |
| 17 | Record Customer Receipt (cleared) | Payments create form | `ReceiveCustomerPayment` | **GREEN** **(S45 wiring)** — was RED (user-selectable cleared status minted Dr Cash / Cr AR via CRUD) |
| 18 | Pending/void receipt create · pending→cleared edit | Payments form / edit | — | **YELLOW** (memo §3 — no GL at pending create; clearing-by-edit recorded) |
| 19 | Allocate / settle AR | — (derived) | — | **GREEN** — settlement derived from the real payment ledger (partials accumulate; over-allocation refused by module validate) |
| 20 | Journal / GL effects | — (derived) | — | **GREEN** — via the canonical `glPosting` seam on issue/receipt; no manual O2C journal entry |
| 21 | Hand-set order status via EDIT | Orders edit form | — | **CLOSED (was RED)** — status `readOnly` in form + validate-hook refusal, proven live in the real runtime |
| 22 | Hand-set invoice status via EDIT | Finance edit form | — | **CLOSED (was RED)** — same two layers; payment-state derivation (draft→partially_paid/paid from receipts) preserved as pinned defined behavior |
| 23 | Ambiguous durable outcome | Hold Center (S44) | journal HOLD → Decision Record | **GREEN** (S44; never re-executes) |

**Cross-cutting rows (apply to every GREEN row):** authorization = `PERMISSION_FOR_COMMAND` inside the
idempotency boundary · tenant = server-resolved principal, `claimedTenantId` rejected on mismatch
(proven live) · idempotency = stable key per gesture, replay proven live · durability = intent-first
journal (S40), crash HOLD (S37/S41) · events/outbox/audit = one atomic journal commit + S31 relay +
governance audit sink · **local-first mode = governed commands now accept the device-local principal
(S45 fix; previously UNAUTHENTICATED while legacy doors worked — the bypass-shaped defect).**

## Adversarially-found doors OUTSIDE the pilot-critical workflow (S45 verify fleet — recorded, not fixed)

These are **pre-existing, defined repository behaviors** the S45 adversarial sweep surfaced. None is on
the pilot happy path; every one is reachable in the wider UI and is therefore a **pilot fence condition**
(operator instruction — which per §2 #31 is a recorded condition, never a mechanical control):

| Door | Effect | Class |
|---|---|---|
| Data Command Center import (payments rows) | Books cleared-receipt GL (Dr Cash / Cr AR) + settles invoices around the command spine | **PRE-EXISTING · pilot fence** — import governance is the CST lane's own program |
| Issued-invoice ECONOMIC-field edit (amount/taxRate/exchangeRate) | Books real GL **adjustment** entries via the legacy update door (deliberate drift-correction design in `glPosting`) | **YELLOW** — defined behavior; S45 closed only the STATUS half of the edit door |
| DELETE door on issued invoices / cleared payments | Posts GL reversals (defined "voiding un-pays" behavior) | **YELLOW** — a second reversal path beside invoice `cancel`; memo §1 covers both |
| warehouse-shipping `ship` action | Issues real stock AND hand-writes the linked SALES ORDER's status pending→fulfilled via **direct store.update** — bypassing the order status machine and the S45 validate guard | **MATERIAL · pilot fence** — the sharpest adjacent hazard; memo §2 decision now includes it |
| Importer reviewer-'update' path | Bypasses `hooks.validate` for every module — both S45 guards and all economic guards do not run on import updates | **PRE-EXISTING** (SEAM-B.9 finding class) |
| Legacy `enterprise:module.action` channel | Still ACCEPTS the four governed keys from any authorized dispatcher — the S45 routing is renderer-side; **no main-side boundary exists**, and a naive guard cannot be added because the command bus re-enters the same module-action machinery | **KNOWN LIMIT** — follow-up: an origin discriminator at the action door |
| Payments **pending → cleared EDIT** | Mints the same Dr Cash / Cr AR as row 17 two clicks away (create pending → edit cleared) | **YELLOW** — row 18; the honest sibling of row 17's closed door (memo §3) |
| Actor attribution split (local mode) | Platform door stamps `local:<id>`; legacy doors stamp `local-<id>@device.invalid` — one person, two actor strings, both honest D-12 namespaces | **MINOR** — recorded; unify in a follow-up |

**Remaining RED rows on the pilot-critical O2C workflow itself: none known.** The workflow's every write
is governed and runtime-proven. The table above is what a pilot must be fenced from, stated as
conditions in ERP-SESSION45-O2C-REAL-USER-CERTIFICATION.md (which also records the sandbox validation
pipelines and REST/companion doors as non-renderer surfaces).
