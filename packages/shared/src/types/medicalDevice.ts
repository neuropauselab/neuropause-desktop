/**
 * Medical Device Manufacturing Pack — identity, taxonomy and the product model.
 *
 * SCOPE AND HONESTY (read this before extending):
 *
 * This pack models the DATA a medical device manufacturer keeps about its
 * products and batches. It makes **no regulatory claim whatsoever**. It is not
 * validated software, it does not implement 21 CFR Part 11, ISO 13485, the EU
 * MDR, or any other standard, and holding a UDI string in a field is not the
 * same as being UDI-compliant. Regulatory fields are therefore CONFIGURABLE and
 * OPTIONAL — nothing here is required, because what is required depends on the
 * device class, the market and the year, none of which this software knows.
 *
 * The product taxonomy (families, materials, sterility) is `IndustryTaxonomy`
 * data. Adding "Sports Medicine" is a data change. Nothing in this file names a
 * tenant; tenant configuration is a later layer.
 */
import type { EnterpriseEntity } from './enterpriseModule';
import type { IndustryPackManifest, IndustryTaxonomy } from './industryPack';

/* ── identity ──────────────────────────────────────────────────────────────── */

export const MEDICAL_DEVICE_PACK_ID = 'medical-device-manufacturing';
export const MEDICAL_DEVICE_PACK_VERSION = '1.0.0';

export const DEVICE_PRODUCTS_MODULE_ID = 'md-products';
export const DEVICE_PRODUCT_KIND = 'medical-device-product';
export const DEVICE_LOTS_MODULE_ID = 'md-lots';
export const DEVICE_LOT_KIND = 'medical-device-lot';

/** Taxonomy keys owned by this pack. */
export const MD_TAXONOMY = {
  family: 'md.productFamily',
  category: 'md.category',
  anatomical: 'md.anatomicalCategory',
  material: 'md.material',
  sterile: 'md.sterileStatus',
  lotStatus: 'md.lotStatus',
} as const;

/* ── taxonomies (configuration, not claims) ────────────────────────────────── */

const v = (value: string, label: string): { value: string; label: string } => ({ value, label });

/**
 * Product families for orthopaedic / general medical device manufacturing.
 *
 * These are FILING CATEGORIES for a manufacturer's own catalogue. Listing
 * "Hip Prosthesis" asserts that a manufacturer may file products under that
 * heading — it asserts nothing about any product's approval, indication or
 * performance.
 */
export const PRODUCT_FAMILY_TAXONOMY: IndustryTaxonomy = {
  key: MD_TAXONOMY.family,
  label: 'Product Family',
  description: 'The catalogue heading a device is filed under. A manufacturer may add its own.',
  extensible: true,
  values: [
    v('trauma', 'Trauma'),
    v('spine', 'Spine'),
    v('arthroscopy', 'Arthroscopy'),
    v('maxillofacial', 'Maxillofacial'),
    v('hand_and_foot', 'Hand & Foot'),
    v('hip_prosthesis', 'Hip Prosthesis'),
    v('external_fixators', 'External Fixators'),
    v('pins_and_wires', 'Pins & Wires'),
    v('orthopedic_instruments', 'Orthopedic Instruments'),
  ],
};

export const PRODUCT_CATEGORY_TAXONOMY: IndustryTaxonomy = {
  key: MD_TAXONOMY.category,
  label: 'Category',
  description: 'What kind of article this is, independent of the family it is filed under.',
  extensible: true,
  values: [
    v('implant', 'Implant'),
    v('instrument', 'Instrument'),
    v('kit', 'Kit / Set'),
    v('accessory', 'Accessory'),
    v('raw_material', 'Raw Material'),
    v('component', 'Component'),
    v('packaging', 'Packaging'),
  ],
};

export const ANATOMICAL_TAXONOMY: IndustryTaxonomy = {
  key: MD_TAXONOMY.anatomical,
  label: 'Anatomical Category',
  description: 'The anatomy the article is catalogued against. Optional.',
  extensible: true,
  values: [
    v('upper_extremity', 'Upper Extremity'),
    v('lower_extremity', 'Lower Extremity'),
    v('spine', 'Spine'),
    v('pelvis', 'Pelvis'),
    v('craniomaxillofacial', 'Craniomaxillofacial'),
    v('hand', 'Hand'),
    v('foot', 'Foot'),
    v('not_specified', 'Not specified'),
  ],
};

export const MATERIAL_TAXONOMY: IndustryTaxonomy = {
  key: MD_TAXONOMY.material,
  label: 'Material',
  description: 'The primary material of construction, as recorded by the manufacturer.',
  extensible: true,
  values: [
    v('stainless_steel_316l', 'Stainless Steel 316L'),
    v('titanium_alloy', 'Titanium Alloy'),
    v('commercially_pure_titanium', 'Commercially Pure Titanium'),
    v('cobalt_chrome', 'Cobalt Chrome'),
    v('peek', 'PEEK'),
    v('uhmwpe', 'UHMWPE'),
    v('ceramic', 'Ceramic'),
    v('polymer', 'Polymer'),
    v('not_specified', 'Not specified'),
  ],
};

/**
 * Sterility as a RECORDED STATE, not a certification. `sterile` means the
 * manufacturer records this article as supplied sterile; the software has no
 * way to verify that and does not claim to.
 */
export const STERILE_STATUS_TAXONOMY: IndustryTaxonomy = {
  key: MD_TAXONOMY.sterile,
  label: 'Sterility',
  description: 'The sterility state the manufacturer records for this article.',
  extensible: false,
  values: [
    v('sterile', 'Supplied sterile'),
    v('non_sterile', 'Supplied non-sterile'),
    v('sterilizable', 'Non-sterile, sterilizable by the user'),
    v('not_specified', 'Not specified'),
  ],
};

export type SterileStatus = 'sterile' | 'non_sterile' | 'sterilizable' | 'not_specified';
export const STERILE_STATUSES: readonly SterileStatus[] = [
  'sterile',
  'non_sterile',
  'sterilizable',
  'not_specified',
];

export type DeviceProductStatus = 'active' | 'inactive' | 'discontinued';
export const DEVICE_PRODUCT_STATUSES: readonly DeviceProductStatus[] = [
  'active',
  'inactive',
  'discontinued',
];

/* ── the product model ─────────────────────────────────────────────────────── */

/**
 * A medical device product master record.
 *
 * `batchLotTracked` / `serialTracked` are the two switches the rest of the pack
 * reads: a lot may only be created for a product whose `batchLotTracked` is on.
 * That is the one place where the product model constrains behaviour, and it is
 * a manufacturer's own configuration, not a regulatory rule.
 */
export interface MedicalDeviceProduct {
  id: string;
  /** Owning tenant. Every read and write in this pack is scoped by it. */
  tenantId: string;
  productCode: string;
  productName: string;
  productFamily: string;
  category: string;
  anatomicalCategory: string;
  material: string;
  size: string;
  dimensions: string;
  sterileStatus: SterileStatus;
  packaging: string;
  batchLotTracked: boolean;
  serialTracked: boolean;
  /**
   * Unique Device Identifier, when the manufacturer has one and has chosen to
   * record it. Empty is a legitimate, common state and is never an error.
   */
  udi: string;
  /**
   * Free-form regulatory metadata, e.g. `{ "riskClass": "IIb", "market": "EU" }`.
   * Deliberately unstructured: the required set differs by device, market and
   * year, and inventing a fixed schema would encode one jurisdiction's rules as
   * if they were universal.
   */
  regulatoryMetadata: Record<string, string>;
  status: DeviceProductStatus;
  createdAt: string;
  updatedAt: string;
}

/** Record field key holding the serialized regulatory metadata. */
export const REGULATORY_METADATA_FIELD = 'regulatoryMetadata';

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes';
}

/**
 * Parse the regulatory metadata field. A malformed or non-object payload yields
 * an EMPTY map rather than throwing: a bad value on one product must not make
 * the product list unreadable, and the raw string stays on the record.
 */
export function parseRegulatoryMetadata(raw: unknown): Record<string, string> {
  const text = str(raw).trim();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      out[k] = String(val);
    }
    return out;
  } catch {
    return {};
  }
}

/** Serialize regulatory metadata for storage. Empty maps store as an empty string. */
export function serializeRegulatoryMetadata(meta: Record<string, string>): string {
  const entries = Object.entries(meta).filter(([k]) => k.trim().length > 0);
  return entries.length === 0 ? '' : JSON.stringify(Object.fromEntries(entries));
}

/** Project a persisted record into the typed product shape. */
export function deviceProductFromRecord(record: EnterpriseEntity): MedicalDeviceProduct {
  const f = record.fields;
  const sterile = str(f.sterileStatus) as SterileStatus;
  const status = str(f.status) as DeviceProductStatus;
  return {
    id: record.id,
    tenantId: str(record.metadata?.tenantId),
    productCode: str(f.productCode),
    productName: str(f.productName),
    productFamily: str(f.productFamily),
    category: str(f.category),
    anatomicalCategory: str(f.anatomicalCategory),
    material: str(f.material),
    size: str(f.size),
    dimensions: str(f.dimensions),
    sterileStatus: STERILE_STATUSES.includes(sterile) ? sterile : 'not_specified',
    packaging: str(f.packaging),
    batchLotTracked: bool(f.batchLotTracked),
    serialTracked: bool(f.serialTracked),
    udi: str(f.udi),
    regulatoryMetadata: parseRegulatoryMetadata(f[REGULATORY_METADATA_FIELD]),
    status: DEVICE_PRODUCT_STATUSES.includes(status) ? status : 'active',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Case-insensitive, punctuation-tolerant key used for product-code identity. */
export function normalizeProductCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s._-]+/g, '');
}

/**
 * Does this product match a free-text query across code, name, family, category
 * and material? Used by the pack's search so the fields the charter names are
 * searched EXACTLY — not the store's generic substring-over-everything match,
 * which would return a product because an unrelated note mentioned the word.
 */
export function matchesProductSearch(product: MedicalDeviceProduct, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    product.productCode,
    product.productName,
    product.productFamily,
    product.category,
    product.material,
  ].some((field) => field.toLowerCase().includes(q));
}

/* ── pack manifest ─────────────────────────────────────────────────────────── */

export const MEDICAL_DEVICE_PACK_MANIFEST: IndustryPackManifest = {
  id: MEDICAL_DEVICE_PACK_ID,
  title: 'Medical Device Manufacturing',
  description:
    'Product master and batch/lot traceability for device manufacturing. Records what a manufacturer knows about its articles and batches; makes no regulatory or certification claim.',
  version: MEDICAL_DEVICE_PACK_VERSION,
  moduleIds: [DEVICE_PRODUCTS_MODULE_ID, DEVICE_LOTS_MODULE_ID],
  taxonomies: [
    PRODUCT_FAMILY_TAXONOMY,
    PRODUCT_CATEGORY_TAXONOMY,
    ANATOMICAL_TAXONOMY,
    MATERIAL_TAXONOMY,
    STERILE_STATUS_TAXONOMY,
  ],
  canonicalEntityIds: ['medical_device_product', 'medical_device_lot'],
  relationshipKeys: ['mdLot.product', 'mdLot.manufacturingOrder', 'mdLot.warehouse', 'mdLot.supplier'],
  notProvided: [
    'Quality Center (NCR, CAPA, inspection records) — not implemented in this stage.',
    'Document control lifecycle — not implemented in this stage.',
    'Lot merge — deliberately unsupported; see the traceability documentation for why.',
    'Electronic signatures and records validation (21 CFR Part 11) — not implemented, not claimed.',
    'Any regulatory certification. This software is not validated software.',
  ],
};
