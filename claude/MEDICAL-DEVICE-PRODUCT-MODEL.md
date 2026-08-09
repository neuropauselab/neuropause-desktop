# NeuroPause — Medical Device Product Model

**Date:** 2026-08-09 · **Build:** `1.0.0-rc.15`
**Gate:** `typecheck:release` PASS · `lint:release` PASS · `test:release` **6,148 / 6,148 across 646 files** (desktop), backend 418, cloud-core 44, companion-protocol 23 — **0 failures**
**Status: IMPLEMENTED — DEVICE VISUAL VERIFICATION PENDING.**

---

## The claim this document does not make

This pack models the **data** a medical device manufacturer keeps about its
products. It makes **no regulatory claim of any kind**. NeuroPause is not
validated software; it does not implement 21 CFR Part 11, ISO 13485, the EU MDR,
or any other standard; and storing a UDI string in a field is not the same as
being UDI-compliant.

That is not a disclaimer bolted on at the end — it shaped the model. Every
regulatory field is **optional and free-form**, because what is required differs
by device class, market and year, and a fixed schema would encode one
jurisdiction's rules as though they were universal. The sterility field records
*what the manufacturer says*, and the descriptor's help text says so on screen.

---

## Where this sits

```
NeuroPause Core          Enterprise Module Framework, record store, RBAC,
                         audit, Data Plane, relationship engine
        ↓
Industry Pack            vocabulary + modules for one industry
        ↓
Medical Device Mfg       products, batches, traceability   ← this stage
        ↓
Tenant Configuration     taxonomy narrowing/extension      ← not yet built
        ↓
Relife Ortho             a tenant                          ← not started
```

The rule that gives the layer its value: **a pack contains no tenant-specific
business logic.** "Relife only ships sterile implants" is tenant configuration,
not a Medical Device Pack fact. `IndustryPackManifest.taxonomies` is the seam a
tenant narrows or extends later; nothing in the pack names any company.

### Files

| File | Job |
|---|---|
| `packages/shared/src/types/industryPack.ts` | The pack contract: manifest, taxonomies, tenant-config shape, validation. |
| `packages/shared/src/types/medicalDevice.ts` | Pack identity, the five product taxonomies, the product model, the manifest. |
| `apps/desktop/src/main/industryPacks/registry.ts` | Registry. Validates a manifest at registration, not at first use. |
| `apps/desktop/src/main/medicalDevice/deviceProductModule.ts` | The product as an Enterprise Module. |
| `apps/desktop/src/renderer/src/medicalDevices/ProductsPanel.tsx` | List, detail, create, edit, history. |

`IndustryPackRegistry` has no medical-device knowledge. Adding a second pack
should require no change to it — if it does, the seam is in the wrong place.

---

## The product model

`MedicalDeviceProduct`, in `packages/shared/src/types/medicalDevice.ts`:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Record id. |
| `tenantId` | string | Stamped by the module, never renderer-supplied. |
| `productCode` | string | **Required.** Unique per tenant on a normalized key. |
| `productName` | string | **Required.** The record title. |
| `productFamily` | taxonomy | Trauma, Spine, Arthroscopy, … Extensible. |
| `category` | taxonomy | Implant, instrument, kit, raw material, … Extensible. |
| `anatomicalCategory` | taxonomy | Optional. Extensible. |
| `material` | taxonomy | 316L, Ti-6Al-4V, CoCr, PEEK, … Extensible. |
| `size`, `dimensions` | string | Free text — catalogue conventions vary too much to model. |
| `sterileStatus` | closed taxonomy | `sterile` · `non_sterile` · `sterilizable` · `not_specified`. |
| `packaging` | string | Free text. |
| `batchLotTracked` | boolean | **The switch the rest of the pack reads.** |
| `serialTracked` | boolean | Requires `batchLotTracked`. |
| `udi` | string | Optional. Empty is normal and is never an error. |
| `regulatoryMetadata` | `Record<string,string>` | Free-form JSON. No schema imposed. |
| `status` | enum | `active` · `inactive` · `discontinued`. |
| `createdAt` / `updatedAt` | ISO-8601 | From the record store. |

### Only two fields are required

A catalogue is populated over time. A form that refuses a product until its
anatomical category is chosen produces **guessed** data, and guessed
classification on a record a recall reads is worse than absent classification.

### Three rules the generic validator cannot express

1. **Product codes are unique per tenant**, compared on a normalized key
   (case, spaces, dots and dashes ignored), so `TR-1001`, `tr 1001` and
   `tr.1001` cannot coexist as three separate products.
2. **Regulatory metadata must parse as a JSON object**, refused with a readable
   message rather than silently stored as unparseable text.
3. **Serial tracking requires batch/lot tracking.** A serial number that cannot
   be attributed to a batch cannot be recalled by batch.

### A framework change the first rule forced

`EnterpriseRecordInput` gained an optional `recordId`, and the framework's
update handler now passes it. Without it, a `validate` hook enforcing uniqueness
has no way to tell *"this code is taken"* from *"this code is taken by me"* —
so every edit of an existing product would be refused for duplicating its own
code. It is a first-class field rather than a metadata key on purpose: metadata
is merged into the persisted record, so smuggling an id through it would write
bookkeeping into every module's stored data. Additive; all 104 existing modules
are unaffected, and `moduleRegistry.test.ts` stays green.

---

## Taxonomies are configuration, not claims

Five taxonomies ship with the pack. Listing "Hip Prosthesis" asserts that a
manufacturer may **file products under that heading**. It asserts nothing about
any product's approval, indication or performance.

| Taxonomy | Extensible | Why |
|---|---|---|
| `md.productFamily` | ✅ | Catalogues differ. |
| `md.category` | ✅ | Same. |
| `md.anatomicalCategory` | ✅ | Same. |
| `md.material` | ✅ | Alloys and polymers are open-ended. |
| `md.sterileStatus` | ❌ | Closed — downstream logic reads the value. |
| `md.lotStatus` | ❌ | Closed — the state machine switches on it. |

`resolveTaxonomy` **ignores** tenant additions to a closed list. Accepting one
would let a tenant invent a lot status the state machine cannot interpret,
which silently disables every later transition check.

---

## Persistence, permissions, audit

Products are an Enterprise Module. They therefore inherit — not re-implement —
offline-first atomic persistence, the generic CRUD IPC surface, RBAC, the audit
trail, timeline events, renderer broadcasts and the module rail.

**Permissions** (added to `EnterprisePermission`, the existing RBAC union):

| Scope | Held by | Gates |
|---|---|---|
| `medicalDevice:product.read` | Viewer and above | Reading the catalogue. |
| `medicalDevice:product.write` | Manager and above | Creating and editing products. |

The `scope:subject.action` shape keeps the existing `scope:action` convention
while carrying the extra subject the charter names. No second permission system
was introduced: these are values of the same union, seeded into the same
built-in roles, checked by the same `createAuthorize` gate.

**Audit.** Creation, update, status change and delete are audited by the
framework as `module.md-products.{created|updated|status_changed|deleted}`,
with actor, target and a human summary. The product detail's **History**
section renders those entries; an empty history is stated as such rather than
being rendered as a blank panel.

---

## Search

`md:product.search` searches **product code, name, family, category and
material** — the five fields the charter names — and nothing else.

It deliberately does **not** use `EnterpriseRecordStore.search()`, which is a
case-insensitive substring match over the string form of *every* field. That
would return a product because an unrelated note mentioned "steel", and a
catalogue search that returns confident nonsense is worse than one that returns
nothing. A test asserts that searching `blister` does not match a product whose
only occurrence of the word is in its packaging field.

Filters for family, category, material and status compose with the query. Every
result is tenant-scoped in the handler, not in the caller.

---

## UI

**Medical Devices → Products**, in the existing design system (`Card`, `Badge`,
`SegmentedTabs`, `DataTable`, `EmptyState`, the Data Command Center primitives).
No second design system was introduced.

- **List** — code, name, family, material, sterility, lot count, status. Search
  and family filter. Empty states distinguish *"you have none"* from *"your
  filter matched nothing"*.
- **Detail** — Overview · Identifiers · Classification · Material & dimensions ·
  Sterility & packaging · Traceability · Regulatory metadata · History.
- **Create / Edit** — writes through `ipc.enterpriseModules.create/update`, the
  same audited generic path every other module uses. Field errors come back from
  the module's own `validate` hook, so the message a user reads is the one the
  rule actually produced.
- **Documents** — deliberately absent. There is no document module in this
  build, so no placeholder is shown; the lot detail states this in words.

The bundle builds as its own lazy chunk (`MedicalDevicesView`, 81 kB).

---

## Tests

| Suite | Covers |
|---|---|
| `medicalDeviceModel.test.ts` (43) | Pack manifest validation, taxonomy resolution (open vs closed), product search field scoping, regulatory metadata round-trip and malformed degradation. |
| `medicalDeviceService.test.ts` (39) | Product creation, duplicate-code refusal across five spellings, self-collision on edit, metadata refusal, serial-without-batch refusal, cross-tenant non-collision. |
| `medicalDeviceAuthz.test.ts` (7) | Every `md:` channel's exact scope; reads never gate writes. |
| `medicalDeviceE2E.test.ts` (6) | Product create → search → detail through the real channel contracts. |
| `medicalDevicesModel.test.ts` (29, renderer) | Every judgement the panels make. |

---

## Limitations

| Item | Status |
|---|---|
| Device visual verification | **PENDING** — the app has not been launched since this work. The production bundle builds (`electron-vite build`, 1,197 main modules + all renderer chunks), and the renderer is covered by view-model tests, but no one has looked at the screen. |
| DOM-level renderer tests | **NOT POSSIBLE IN THIS REPO** — no DOM testing library is installed. Panel logic is covered by `medicalDevicesModel.test.ts`; layout is not. |
| Multi-tenant | **PARTIAL** — the isolation machinery is real and tested (every query filters on `tenantId`, every write stamps it, cross-tenant reads and writes are refused by test). What does not exist yet is a way to create a *second* tenant. `TENANT_ID = 'default'` in `instances.ts` is the single seam. |
| Product images / screenshots | **NOT IMPLEMENTED.** |
| Product-level document attachment | **NOT IMPLEMENTED** — depends on Document Control. |
| UDI validation | **NOT IMPLEMENTED, NOT CLAIMED.** The field stores a string. |
