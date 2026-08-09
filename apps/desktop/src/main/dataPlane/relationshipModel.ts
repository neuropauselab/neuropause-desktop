/**
 * Phase 6 — Cross-domain relationship model.
 *
 * The enterprise modules already reference each other, but NOTHING in the
 * codebase declares that they do: every link is an untyped `type: 'text'` field,
 * and three incompatible conventions are in use at once —
 *
 *   by display name   `finance-invoices.customer` = "ABC Hospital"
 *   by business code  `sales-orders.product`      = "SKU-1001"
 *   by record id      `finance-payments.invoiceRef` = a record id OR "INV-1001"
 *
 * This file is the missing declaration. Every entry below names a REAL module id
 * and REAL descriptor field keys, verified against the module descriptors; a
 * definition that named a field which does not exist would resolve nothing and
 * fail silently, so `assertRelationshipsAreDeclarable` exists to catch that at
 * boot rather than in production.
 */

/** How a value was matched to a target record. Ordered weakest-last. */
export type MatchMethod =
  | 'internal_id'
  | 'business_key'
  | 'normalized_key'
  | 'canonical_name'
  | 'manual';

export type RelationshipStatus = 'resolved' | 'ambiguous' | 'unresolved' | 'skipped';

/**
 * Whether a relationship may be resolved without a person looking at it.
 *
 * `financial` links (an invoice to a customer, a bill to a purchase order) are
 * never allowed to be created by a similarity match — a wrong one misstates who
 * owes money. They accept deterministic matches only; anything softer becomes a
 * proposal a human confirms.
 */
export type RelationshipSensitivity = 'financial' | 'operational';

export interface RelationshipDef {
  /** Stable key, used in links, audit entries and the review queue. */
  key: string;
  /** Module holding the referencing field. */
  fromModuleId: string;
  /** Exact descriptor field key on the source module. */
  field: string;
  /** Human label for the review UI. */
  label: string;
  /** Module the value points at. */
  toModuleId: string;
  /** Human label for the target, e.g. "Customer". */
  toLabel: string;
  /**
   * Descriptor field keys on the TARGET that a value may match, best first.
   * The record id is always tried before any of these.
   */
  keyFields: readonly string[];
  sensitivity: RelationshipSensitivity;
  /**
   * True when a record is not usable until the link resolves. Nothing in this
   * release is mandatory: an unresolved link parks in the review queue rather
   * than failing an import, which is what the charter requires.
   */
  mandatory?: boolean;
  /**
   * Allow a canonical-name proposal (e.g. "ABC Hospital Ltd." → "ABC Hospital
   * Limited"). Only meaningful for name-shaped references, and even then the
   * result is a PROPOSAL — never applied without a decision.
   */
  allowNameProposal?: boolean;
}

/**
 * The declared cross-domain relationships.
 *
 * Scope note: only links whose source field and target key field were both
 * verified to exist are declared. Several real-world references have no target
 * module in this build (warehouse codes, work centres, BOMs, budgets, vendor
 * contracts, bank statements) and are deliberately absent rather than declared
 * against a module that cannot answer them.
 */
export const RELATIONSHIPS: readonly RelationshipDef[] = [
  // ── Customer → order → delivery → invoice → payment ──────────────────────
  {
    key: 'invoice.customer',
    fromModuleId: 'finance-invoices',
    field: 'customer',
    label: 'Customer',
    toModuleId: 'crm-customers',
    toLabel: 'Customer',
    keyFields: ['customerCode', 'name'],
    sensitivity: 'financial',
    allowNameProposal: true,
  },
  {
    key: 'invoice.sourceOrder',
    fromModuleId: 'finance-invoices',
    field: 'sourceOrder',
    label: 'Source order',
    toModuleId: 'sales-orders',
    toLabel: 'Sales order',
    keyFields: ['orderNumber'],
    sensitivity: 'financial',
  },
  {
    key: 'order.customer',
    fromModuleId: 'sales-orders',
    field: 'customer',
    label: 'Customer',
    toModuleId: 'crm-customers',
    toLabel: 'Customer',
    keyFields: ['customerCode', 'name'],
    sensitivity: 'operational',
    allowNameProposal: true,
  },
  {
    key: 'order.contact',
    fromModuleId: 'sales-orders',
    field: 'contact',
    label: 'Contact',
    toModuleId: 'crm-contacts',
    toLabel: 'Contact',
    keyFields: ['name'],
    sensitivity: 'operational',
    allowNameProposal: true,
  },
  {
    key: 'order.product',
    fromModuleId: 'sales-orders',
    field: 'product',
    label: 'Product',
    toModuleId: 'inventory-products',
    toLabel: 'Product',
    keyFields: ['sku', 'barcode'],
    sensitivity: 'operational',
  },
  {
    key: 'order.sourceQuote',
    fromModuleId: 'sales-orders',
    field: 'sourceQuote',
    label: 'Source quote',
    toModuleId: 'sales-quotes',
    toLabel: 'Quote',
    keyFields: ['quoteNumber'],
    sensitivity: 'operational',
  },
  {
    key: 'quote.customer',
    fromModuleId: 'sales-quotes',
    field: 'customer',
    label: 'Customer',
    toModuleId: 'crm-customers',
    toLabel: 'Customer',
    keyFields: ['customerCode', 'name'],
    sensitivity: 'operational',
    allowNameProposal: true,
  },
  {
    key: 'shipment.salesOrder',
    fromModuleId: 'warehouse-shipping',
    field: 'salesOrder',
    label: 'Sales order',
    toModuleId: 'sales-orders',
    toLabel: 'Sales order',
    keyFields: ['orderNumber'],
    sensitivity: 'operational',
  },
  {
    key: 'shipment.product',
    fromModuleId: 'warehouse-shipping',
    field: 'product',
    label: 'Product',
    toModuleId: 'inventory-products',
    toLabel: 'Product',
    keyFields: ['sku', 'barcode'],
    sensitivity: 'operational',
  },
  {
    key: 'payment.invoice',
    fromModuleId: 'finance-payments',
    field: 'invoiceRef',
    label: 'Invoice',
    toModuleId: 'finance-invoices',
    toLabel: 'Invoice',
    keyFields: ['number'],
    sensitivity: 'financial',
  },
  {
    key: 'payment.customer',
    fromModuleId: 'finance-payments',
    field: 'customer',
    label: 'Customer',
    toModuleId: 'crm-customers',
    toLabel: 'Customer',
    keyFields: ['customerCode', 'name'],
    sensitivity: 'financial',
    allowNameProposal: true,
  },

  // ── Supplier → PO → goods receipt → bill ─────────────────────────────────
  {
    key: 'po.supplier',
    fromModuleId: 'procurement-orders',
    field: 'supplier',
    label: 'Supplier',
    toModuleId: 'procurement-suppliers',
    toLabel: 'Supplier',
    keyFields: ['gst', 'name'],
    sensitivity: 'financial',
    allowNameProposal: true,
  },
  {
    key: 'po.product',
    fromModuleId: 'procurement-orders',
    field: 'product',
    label: 'Product',
    toModuleId: 'inventory-products',
    toLabel: 'Product',
    keyFields: ['sku', 'barcode'],
    sensitivity: 'operational',
  },
  {
    key: 'receipt.purchaseOrder',
    fromModuleId: 'procurement-receipts',
    field: 'purchaseOrder',
    label: 'Purchase order',
    toModuleId: 'procurement-orders',
    toLabel: 'Purchase order',
    keyFields: ['poNumber'],
    sensitivity: 'financial',
  },
  {
    key: 'receipt.supplier',
    fromModuleId: 'procurement-receipts',
    field: 'supplier',
    label: 'Supplier',
    toModuleId: 'procurement-suppliers',
    toLabel: 'Supplier',
    keyFields: ['gst', 'name'],
    sensitivity: 'operational',
    allowNameProposal: true,
  },
  {
    key: 'receipt.product',
    fromModuleId: 'procurement-receipts',
    field: 'product',
    label: 'Product',
    toModuleId: 'inventory-products',
    toLabel: 'Product',
    keyFields: ['sku', 'barcode'],
    sensitivity: 'operational',
  },
  {
    key: 'bill.vendor',
    fromModuleId: 'finance-vendor-bills',
    field: 'vendor',
    label: 'Vendor',
    toModuleId: 'procurement-suppliers',
    toLabel: 'Supplier',
    keyFields: ['gst', 'name'],
    sensitivity: 'financial',
    allowNameProposal: true,
  },
  {
    key: 'bill.purchaseOrder',
    fromModuleId: 'finance-vendor-bills',
    field: 'sourcePurchaseOrder',
    label: 'Source purchase order',
    toModuleId: 'procurement-orders',
    toLabel: 'Purchase order',
    keyFields: ['poNumber'],
    sensitivity: 'financial',
  },

  // ── Manufacturing ────────────────────────────────────────────────────────
  {
    key: 'execution.product',
    fromModuleId: 'manufacturing-executions',
    field: 'product',
    label: 'Product',
    toModuleId: 'inventory-products',
    toLabel: 'Product',
    keyFields: ['sku', 'barcode'],
    sensitivity: 'operational',
  },

  // ── CRM conversion chain ─────────────────────────────────────────────────
  {
    key: 'customer.sourceLead',
    fromModuleId: 'crm-customers',
    field: 'sourceLead',
    label: 'Source lead',
    toModuleId: 'crm-leads',
    toLabel: 'Lead',
    keyFields: ['name'],
    sensitivity: 'operational',
  },
  {
    key: 'customer.sourceContact',
    fromModuleId: 'crm-customers',
    field: 'sourceContact',
    label: 'Source contact',
    toModuleId: 'crm-contacts',
    toLabel: 'Contact',
    keyFields: ['name'],
    sensitivity: 'operational',
  },
  {
    key: 'contact.sourceLead',
    fromModuleId: 'crm-contacts',
    field: 'sourceLead',
    label: 'Source lead',
    toModuleId: 'crm-leads',
    toLabel: 'Lead',
    keyFields: ['name'],
    sensitivity: 'operational',
  },

  // ── People and projects ──────────────────────────────────────────────────
  {
    key: 'employee.manager',
    fromModuleId: 'hr-employees',
    field: 'managerRef',
    label: 'Manager',
    toModuleId: 'hr-employees',
    toLabel: 'Employee',
    keyFields: ['employeeNumber', 'name'],
    sensitivity: 'operational',
  },
  {
    key: 'project.customer',
    fromModuleId: 'projects-projects',
    field: 'customerRef',
    label: 'Customer',
    toModuleId: 'crm-customers',
    toLabel: 'Customer',
    keyFields: ['customerCode', 'name'],
    sensitivity: 'operational',
    allowNameProposal: true,
  },
];

/** Every relationship whose source is this module. */
export function relationshipsFrom(moduleId: string): RelationshipDef[] {
  return RELATIONSHIPS.filter((r) => r.fromModuleId === moduleId);
}

/** Every relationship pointing AT this module — the backward-trace direction. */
export function relationshipsTo(moduleId: string): RelationshipDef[] {
  return RELATIONSHIPS.filter((r) => r.toModuleId === moduleId);
}

export function relationshipByKey(key: string): RelationshipDef | null {
  return RELATIONSHIPS.find((r) => r.key === key) ?? null;
}

/**
 * Verify every declaration against the live descriptors.
 *
 * A definition naming a field that does not exist resolves nothing, forever,
 * without erroring — the worst possible failure for this feature. Callers run
 * this at wiring time with the real descriptors so a typo is loud.
 */
export function assertRelationshipsAreDeclarable(
  descriptors: readonly { id: string; fields: readonly { key: string }[] }[],
): string[] {
  const byId = new Map(descriptors.map((d) => [d.id, new Set(d.fields.map((f) => f.key))]));
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const rel of RELATIONSHIPS) {
    if (seen.has(rel.key)) problems.push(`duplicate relationship key "${rel.key}"`);
    seen.add(rel.key);

    const from = byId.get(rel.fromModuleId);
    if (!from) {
      problems.push(`"${rel.key}": source module "${rel.fromModuleId}" is not registered`);
    } else if (!from.has(rel.field)) {
      problems.push(`"${rel.key}": source field "${rel.fromModuleId}.${rel.field}" does not exist`);
    }

    const to = byId.get(rel.toModuleId);
    if (!to) {
      problems.push(`"${rel.key}": target module "${rel.toModuleId}" is not registered`);
    } else {
      for (const keyField of rel.keyFields) {
        if (!to.has(keyField)) {
          problems.push(`"${rel.key}": target key "${rel.toModuleId}.${keyField}" does not exist`);
        }
      }
    }

    if (rel.keyFields.length === 0) problems.push(`"${rel.key}": declares no key fields`);
  }
  return problems;
}

/**
 * The traversal chains the graph view walks, in business order.
 *
 * These are presentation groupings over the definitions above — they add no new
 * links, so a chain can never show an edge the engine did not actually resolve.
 */
export const RELATIONSHIP_CHAINS: readonly { id: string; label: string; keys: readonly string[] }[] = [
  {
    id: 'order-to-cash',
    label: 'Order to cash',
    keys: ['quote.customer', 'order.customer', 'order.sourceQuote', 'shipment.salesOrder', 'invoice.sourceOrder', 'invoice.customer', 'payment.invoice'],
  },
  {
    id: 'procure-to-pay',
    label: 'Procure to pay',
    keys: ['po.supplier', 'receipt.purchaseOrder', 'receipt.supplier', 'bill.purchaseOrder', 'bill.vendor'],
  },
  {
    id: 'product-flow',
    label: 'Product flow',
    keys: ['po.product', 'receipt.product', 'execution.product', 'order.product', 'shipment.product'],
  },
];
