# NeuroPause — Industry Solution Pack Catalog

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: evaluators & buyers
>
> Generated from the repository's Industry SDK (`packages/industry`). Machine-readable source: [`INDUSTRY-CATALOG.json`](INDUSTRY-CATALOG.json).
>
> **Maturity: PREVIEW.** The **20** packs are defined and their declarations are live-verified; per-vertical business data is pending and regulated operations are external. Catalog version `0.0.0-preview.1`. **Desktop:** Industry Center (Advanced, Preview). **Mobile:** companion exists, backend-dependent (Preview). **API:** no public HTTP industry API. **SDK:** in-process (`defineIndustrySolution`).

## What an Industry Solution Pack is

A pack is a **vertical bundle that reuses the enterprise core** (the 104 modules / 13 families) and declares the vertical-specific pieces: **objects, workflows, KPIs, compliance packs, connectors, AI skills, and document templates**. Packs don't fork the platform — they configure it. There is no per-pack maturity flag; maturity is catalog-wide (preview).

## The 20 packs

### Healthcare
| ID | Name | Scope |
|---|---|---|
| `healthcare` | Healthcare | Hospital / Clinic / Lab / Pharmacy / Telemedicine / Radiology |
| `medical-device` | Medical Device Manufacturing | Device manufacturing operations |
| `pharmaceutical` | Pharmaceutical | GMP / Batch Records / Stability / QA / QC |

### Financial
| ID | Name | Scope |
|---|---|---|
| `banking` | Banking & Financial Services | Lending / Deposits / Treasury / AML / KYC |
| `insurance` | Insurance | Policies / Claims / Underwriting / Broker Network |

### Commerce
| ID | Name | Scope |
|---|---|---|
| `retail` | Retail & E-Commerce | POS / Catalog / Orders / Fulfillment / Loyalty |
| `hospitality` | Hospitality | Hotels / Restaurants / Reservations / Events / Housekeeping |
| `real-estate` | Real Estate | Properties / Leasing / Facilities / Tenants |
| `media` | Media & Entertainment | Content / Production / Licensing / Advertising |
| `professional-services` | Professional Services | Consulting / Legal / Accounting / Auditing |

### Industrial
| ID | Name | Scope |
|---|---|---|
| `manufacturing` | Manufacturing | Factory Ops / Planning / Quality / Maintenance / OEE / Digital Twin |
| `logistics` | Logistics & Supply Chain | Fleet / Warehouses / Routes / Shipments / Cold Chain |
| `construction` | Construction | Projects / BOQ / Contracts / Equipment / Site Safety |
| `energy` | Energy & Utilities | Power / Water / Gas / Assets / Field Operations |
| `automotive` | Automotive | OEM / Dealers / Service / Warranty / VIN / Parts |
| `aviation` | Aviation | Aircraft / Fleet / Maintenance / Crew / Flight Operations |
| `agriculture` | Agriculture | Farms / Crops / Livestock / Irrigation / Supply Chain |

### Public
| ID | Name | Scope |
|---|---|---|
| `government` | Government | Citizen Services / Permits / Cases / Benefits / Public Projects |
| `education` | Education | Students / Faculty / Admissions / Learning / Exams / Certificates |
| `telecom` | Telecommunications | Subscribers / Billing / Network Assets / Tickets / Service Orders |

## How to evaluate a pack

Open **Advanced → Industry Center**, browse the catalog, view a pack's metadata, and select it. Because packs reuse the enterprise core, the underlying ERP behavior is the same local-first capability certified across the product; the pack adds vertical objects/workflows/compliance framing. For a pilot, pick **one** representative pack for your vertical rather than evaluating all 20 — see the [Enterprise Pilot Guide](../enterprise/ENTERPRISE-PILOT-GUIDE.md).

## Honesty boundary

- Pack **declarations** (objects/workflows/KPIs/compliance/connectors/AI-skills/templates) are defined and verified as declarations.
- Real **per-vertical business data** is pending (you bring/seed your data).
- **Regulated operations** (e.g. clinical, GMP, AML/KYC) depend on external/regulated systems and are not certified by NeuroPause.
- Do not read this catalog as "20 production-deployed vertical products" — it is a defined, preview-stage pack catalog.
