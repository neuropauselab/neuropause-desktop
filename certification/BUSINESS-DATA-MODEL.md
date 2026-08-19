# BUSINESS-DATA-MODEL — what the app can hold TODAY (NP-010 §1)
### Read-only schema census, 2026-08-20. Every claim carries its source path; nothing inferred.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

## The one-paragraph truth

NeuroPause can hold **parties, documents, transactions, invoices, orders, inventory, and employees TODAY** — in a
106-module, tenant-scoped, offline-first record registry on the desktop (per-module atomic JSON under Electron
`userData`). A real governed ingestion pipeline (the Data Plane) already exists end-to-end — parse → classify →
review → **approve-before-write** → per-field provenance → relationship resolution → manifest-governed export — but
reaches only **10 of the 106 record types**. The Postgres backend holds **no business objects at all** (identity,
tenancy, app marketplace, billing, config-sync, embeddings only; the sync whitelist is a closed CHECK constraint).
Tax is a single flat rate with GSTIN capture — **not** GST-compliant filing. NP-010 §2/§3 are therefore mostly
EXTENSION jobs over real substrate, not new builds.

## 1 · The enterprise record registry (106 modules)

- **Store:** one `EnterpriseRecordStore` per module — flat `EnterpriseEntity` (`title` + `fields` + `tags` +
  `metadata` + `status`), atomic JSON at `enterprise-module-<id>.json` under `userData`, cap 50,000 records/owner
  (`enterprise/framework/enterpriseRecordStore.ts`, `framework/index.ts:30-32`).
- **Registration (authoritative):** exactly 106 `registerModule(...)` calls at `enterprise/index.ts:1247-1356`;
  `assertEveryModuleScoped()` **throws at boot** if any store is unbound.
- **Lifecycle:** one generic IPC surface (`enterprise:module.*`) — RBAC → validate/coerce → persist → audit →
  platform event → renderer broadcast (`framework/moduleRegistry.ts`).

| Family | Types | Record types |
|---|---|---|
| Finance | 21 | invoice, payment, ledger account, journal entry, accounting period, tax report, AR aging, bank statement, budget, vendor bill, AP aging, fixed asset, credit note, debit note, vendor payment, exchange rate, financial ratios, cash flow statement, FX revaluation, FX exposure, treasury position |
| HR | 15 | employee, payroll run, salary structure, statutory rule, salary disbursement, payslip, payroll register, statutory filing, attendance, leave, holiday calendar, candidate, OKR, expense claim, shift |
| Manufacturing | 12 | BOM, BOM explosion, production order, work center, machine, schedule, routing, shop-floor event, execution, quality inspection, costing, schedule proposal |
| Maintenance | 10 | asset category, asset, plan, preventive, corrective, work order, technician, history, spare part, downtime |
| CRM | 8 | contact, lead, customer, opportunity, activity, customer health, customer timeline, campaign |
| Warehouse | 8 | zone, bin, transfer order, pick list, packing, shipping, cycle count, stock adjustment |
| Sales | 7 | quote, order, contract, pricing rule, commission plan, commission statement, revenue forecast |
| Inventory | 7 | product, warehouse, stock movement, lot, reservation, valuation, serial |
| Procurement | 7 | supplier, vendor contract, purchase request, purchase order, goods receipt, RFQ, supplier performance |
| Projects | 4 | project, task, time entry, billing run |
| Executive | 3 | BI report, executive decision, execution proposal |
| Medical Devices | 2 | device product, device lot (+ 9-state lot lifecycle, trace-edge store) |
| Documents / Helpdesk | 1+1 | document registry entry (append-only versions; stores `draftRef`, not bytes) · ticket |

**Transactional-document overlay** (`erp/documentSpecs.ts`): 8 modules gain line items + derived totals +
approval/SoD + **GL auto-posting** (`finance/glPosting.ts`): purchase orders, goods receipts, vendor bills, quotes,
sales orders, shipping, invoices, manufacturing executions. The other ~98 are master data / derived registers.

## 2 · The Data Plane — the ingestion spine that ALREADY EXISTS

- **Parsers** (`dataPlane/parsers.ts`): `xlsx, csv, tsv, json, xml, docx, txt` supported; **PDF detected by magic
  bytes and honestly REFUSED** (`kind: 'unsupported'`). Cap 200,000 rows/table.
- **Ontology** (`dataPlane/ontology.ts`): **10 canonical entities**, each routed to a real module —
  customer, contact, lead, employee, supplier, product, invoice, project, medical_device_product, medical_device_lot.
  `HIGH_RISK_DOMAINS = ['finance','hr']` → explicit approval required. **No transaction/payment/order/journal-entry
  canonical entity yet** — the modules exist; no import routes into them.
- **Approve-before-write is structural** (`dataPlane/importer.ts` header + `:347-354`): unapproved tables are
  reported `awaiting_approval` and not touched; approving high-risk needs the distinct `data:approve` permission
  (SoD, `dataPlane/index.ts:566-574`); high-risk failures are compensating-rolled-back (`softDelete`, `:618-625` —
  honestly documented as NOT ACID).
- **Provenance** (store `dataplane-provenance`, TENANT): per-record `{recordId, moduleId, planId, sourceFile,
  sourceTable, sourceRow, confidence, approvedBy, importedAt}` + per-field `{field, column, original,
  transformation}`; records stamped with the idempotency `importKey` = `sourceFile::table::row`; connector-origin
  rows share the store via `externalKey`. Caps 100k provenance rows / 500 runs per tenant.
- **Mapping memory** (`mappingMemory.ts`, TENANT): header-set-keyed remembered mappings, 5k/tenant, nothing pooled
  across tenants.
- **Relationships** (`relationshipModel.ts` et al.): **36 declared keys** across order-to-cash, procure-to-pay and
  product-flow chains; links stored alongside records (source text never rewritten); unresolved refs PARK as
  PENDING so import order doesn't matter. Caps 200k links / 20k pending per tenant.
- **Export governance** (`exporters.ts`, `exportManifest.ts`): csv/xlsx/json, every export carries a manifest
  (actor, tenant, scope, counts, included/excluded fields with reasons, `dataFileSha256`, provenance coverage) and
  zero business values.
- **Landing zone:** approved rows go **directly into the enterprise module stores** (`importer.ts:264,357,582`) and
  replay the normal lifecycle fan-out (`notifyImported`).

## 3 · Backend Postgres — deliberately empty of business data

12 migrations; tables cover identity/auth, organizations/memberships/workspaces, the app marketplace, own-SaaS
billing/subscriptions, `connector_accounts`, `sync_state` + `devices`, `embedding_state`.
**`sync_state.entity_type` is a closed CHECK constraint** (`0009_sync_state.sql:12`, widened once in `0011`):
organization, membership, workspace_settings, connected_account, connector_config, org_prefs, memory.
**No invoice, party, transaction, order or employee table exists — and the whitelist structurally forbids syncing
one without a migration.** All ERP data is local-first on the desktop.

## 4 · Adjacent stores and contracts

- **Unified store** (`unified/unifiedStore.ts`, TENANT): the connector/productivity plane — 16 kinds (task,
  message, document, event, contact…); no ERP kinds.
- **Medical-device pack:** products/lots through the same module seam + `medical-device-trace-edges` (TENANT);
  shared contracts `medicalDevice*.ts` (9-state lot lifecycle, 8 trace node types, each edge written by exactly one
  named service operation).
- **Shared business contracts:** ~70 business-object type files under `packages/shared/src/types/` (finance:
  `generalLedger.ts`, `vendorBills.ts`, `cashFlow.ts`…; CRM/sales, HR incl. Indian statutory, inventory/warehouse,
  procurement, manufacturing/MES/MRP, projects, helpdesk). Note: invoice types live in `types/finance.ts`
  (`FinanceInvoice`), not an `invoices.ts`.

## 5 · Tenancy (one line)

Every business record is stamped `tenantId`+`workspaceId` at `create()` from a runtime-resolved `TenantScope`;
unbound scope **DENIES** rather than returning unfiltered; enforced by `tenantOwnedStore.ts` +
`storeScope.ts` (closed scope enum + mandatory retention declaration) and `assertEveryModuleScoped()` at boot.

## 6 · Honest answers for the §0 frame

| Object | Held today? | Where |
|---|---|---|
| Parties | YES | crm-customers/crm/crm-leads, procurement-suppliers, hr-employees (+ technicians, candidates) |
| Documents | YES ×2 senses | registry entries w/ versioning (not bytes) · 8 transactional doc types w/ lines+approvals+GL |
| Transactions | YES | journal entries (double-entry, balance-guarded), payments, vendor payments, stock movements, bank statements |
| Invoices | YES | `finance` module — lifecycle, derived totals/outstanding, GL auto-posting, credit/debit notes, AR aging |
| Orders | YES | sales orders, quotes, POs, requests, receipts, transfer/production/work orders, RFQs |
| Inventory | YES | products, warehouses, movements, lots, serials, reservations, valuations (+ device lot genealogy) |
| Employees | YES | HR modules incl. payroll and genuinely-Indian statutory (ECR/PF, ESI, PT, 24Q) |

## 7 · The caveats the outside world must hear (claim honesty)

1. **JSON, not a database** — atomic files, compensating rollback (not ACID), no referential integrity, 50k/module.
2. **Ingestion reaches 10 of 106 types.** The other 96 are keyboard/IPC entry only. PDF is detected and refused.
3. **Tax ≠ GST compliance** — single flat `taxRate`, GSTIN captured, reports derived from posted books, filing
   manual; NO CGST/SGST/IGST split, HSN/SAC, place-of-supply, GSTR-1/3B, e-invoice/IRN, e-way bill (verified
   absent by grep). HR statutory, by contrast, IS genuinely Indian.

## 8 · What this means for NP-010 §2/§3 (scout verdict — proposals, not builds)

- **§2 is an extension, not a new spine:** add canonical entities for the transaction classes (bank-statement
  line, journal entry, payment, order), add Tally-XML / bank-CSV / GST-file front-ends onto the existing parser →
  ontology → approve → provenance path, and add the per-object honesty label (UNVERIFIED-SOURCE vs VERIFIED) onto
  the existing provenance record.
- **§3 is largely wiring + lineage surfaces:** AR/AP aging, GL, cash-flow, tax-report modules already compute;
  the work is the Intelligence-tile law ("computed over N invoices from source X") and feeding them from ingestion
  instead of keyboard-only.
