/**
 * Phase 6 — Universal Enterprise Data Plane: canonical enterprise ontology.
 *
 * The ontology is the contract between "a column in someone's spreadsheet" and
 * "a field on a real NeuroPause enterprise module". Every entity here routes to
 * an EXISTING module id and EXISTING descriptor field keys — this layer adds a
 * routing vocabulary, it does not fork the ERP data model.
 *
 * SCOPE (honest): eight canonical entities are implemented, chosen to cover the
 * cross-domain import journey (Finance, CRM, HR, Inventory, Procurement,
 * Projects). The remaining canonical entities named in the Phase 6 charter are
 * NOT implemented here; adding one is a data-only change to ONTOLOGY below,
 * which is the point of the design.
 */

export type CanonicalDomain =
  | 'finance'
  | 'crm'
  | 'hr'
  | 'inventory'
  | 'procurement'
  | 'projects';

/**
 * Import risk. Drives whether a human must explicitly approve.
 * HIGH covers money, payroll, banking and master data whose corruption is
 * expensive to unwind — these can never be auto-imported.
 */
export type ImportRisk = 'low' | 'medium' | 'high';

export type FieldType = 'text' | 'number' | 'date' | 'boolean';

export interface CanonicalField {
  /** Target descriptor field key on the destination module. */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Normalized header synonyms (lower-case, alphanumeric words). */
  synonyms: readonly string[];
  /** Value-shape hint used as an independent classification signal. */
  shape?: 'email' | 'phone' | 'date' | 'money' | 'code' | 'url';
  /**
   * Header words that CONTRADICT this field even when the rest of the name
   * matches. "Annual Salary" must not map to a monthly field — that is a 12x
   * payroll error, exactly the kind of confident-looking mistake this layer
   * exists to prevent.
   */
  conflicts?: readonly string[];
  /** Field is expected to be unique across rows (identity column). */
  identity?: boolean;
  /** Sensitive: never auto-mapped at HIGH confidence without review. */
  sensitive?: boolean;
}

export interface CanonicalEntity {
  id: string;
  label: string;
  plural: string;
  domain: CanonicalDomain;
  /** Destination enterprise module id (must already exist in the registry). */
  moduleId: string;
  /** Descriptor field used as the record title. */
  titleField: string;
  risk: ImportRisk;
  /** Words that, in a sheet or file name, indicate this entity. */
  nameHints: readonly string[];
  fields: readonly CanonicalField[];
  /** Fields whose combination identifies a duplicate. First match wins. */
  identityKeys: readonly (readonly string[])[];
}

const EMAIL: Pick<CanonicalField, 'type' | 'shape'> = { type: 'text', shape: 'email' };
const PHONE: Pick<CanonicalField, 'type' | 'shape'> = { type: 'text', shape: 'phone' };

export const ONTOLOGY: readonly CanonicalEntity[] = [
  {
    id: 'customer',
    label: 'Customer',
    plural: 'Customers',
    domain: 'crm',
    moduleId: 'crm-customers',
    titleField: 'name',
    risk: 'high', // customer master drives invoicing; corruption is expensive
    nameHints: ['customer', 'customers', 'client', 'clients', 'account', 'accounts', 'buyer', 'debtor'],
    identityKeys: [['customerCode'], ['email'], ['name']],
    fields: [
      { key: 'name', label: 'Customer Name', type: 'text', required: true, synonyms: ['customer name', 'customer', 'client name', 'client', 'account name', 'party name', 'buyer', 'company name', 'name'] },
      { key: 'customerCode', label: 'Customer Code', type: 'text', shape: 'code', identity: true, synonyms: ['customer code', 'customer id', 'client code', 'client id', 'account code', 'account number', 'code'] },
      { key: 'company', label: 'Company', type: 'text', synonyms: ['company', 'organisation', 'organization', 'firm'] },
      { key: 'primaryContact', label: 'Primary Contact', type: 'text', synonyms: ['primary contact', 'contact person', 'contact name', 'attention'] },
      { key: 'email', label: 'Email', ...EMAIL, synonyms: ['email', 'e mail', 'email address', 'mail', 'contact email'] },
      { key: 'phone', label: 'Phone', ...PHONE, synonyms: ['phone', 'telephone', 'phone number', 'mobile', 'contact number', 'tel'] },
      { key: 'creditLimit', label: 'Credit Limit', type: 'number', shape: 'money', synonyms: ['credit limit', 'credit', 'limit'] },
      { key: 'outstandingBalance', label: 'Outstanding', type: 'number', shape: 'money', synonyms: ['outstanding', 'outstanding balance', 'balance due', 'receivable'] },
      { key: 'industry', label: 'Industry', type: 'text', synonyms: ['industry', 'sector', 'vertical'] },
      { key: 'gstNumber', label: 'GST Number', type: 'text', shape: 'code', synonyms: ['gst', 'gst number', 'gstin', 'tax id', 'vat number'] },
      { key: 'pan', label: 'PAN', type: 'text', shape: 'code', synonyms: ['pan', 'pan number'] },
    ],
  },
  {
    id: 'contact',
    label: 'Contact',
    plural: 'Contacts',
    domain: 'crm',
    moduleId: 'crm-contacts',
    titleField: 'name',
    risk: 'medium',
    nameHints: ['contact', 'contacts', 'people', 'person'],
    identityKeys: [['email'], ['name', 'company']],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, synonyms: ['name', 'contact name', 'full name', 'person', 'contact person'] },
      { key: 'company', label: 'Company', type: 'text', synonyms: ['company', 'organisation', 'organization', 'account', 'employer'] },
      { key: 'email', label: 'Email', ...EMAIL, synonyms: ['email', 'e mail', 'email address', 'mail'] },
      { key: 'phone', label: 'Phone', ...PHONE, synonyms: ['phone', 'telephone', 'phone number', 'tel'] },
      { key: 'mobile', label: 'Mobile', ...PHONE, synonyms: ['mobile', 'cell', 'cell phone', 'mobile number'] },
      { key: 'city', label: 'City', type: 'text', synonyms: ['city', 'town'] },
      { key: 'state', label: 'State', type: 'text', synonyms: ['state', 'province', 'region'] },
      { key: 'country', label: 'Country', type: 'text', synonyms: ['country', 'country code', 'nation'] },
      { key: 'industry', label: 'Industry', type: 'text', synonyms: ['industry', 'sector'] },
      { key: 'website', label: 'Website', type: 'text', shape: 'url', synonyms: ['website', 'web', 'url', 'site'] },
    ],
  },
  {
    id: 'lead',
    label: 'Lead',
    plural: 'Leads',
    domain: 'crm',
    moduleId: 'crm-leads',
    titleField: 'name',
    risk: 'low',
    nameHints: ['lead', 'leads', 'prospect', 'prospects', 'enquiry', 'inquiries'],
    identityKeys: [['email'], ['name']],
    fields: [
      { key: 'name', label: 'Lead Name', type: 'text', required: true, synonyms: ['lead name', 'lead', 'name', 'prospect', 'prospect name'] },
      { key: 'company', label: 'Company', type: 'text', synonyms: ['company', 'organisation', 'organization'] },
      { key: 'contactPerson', label: 'Contact Person', type: 'text', synonyms: ['contact person', 'contact', 'contact name'] },
      { key: 'email', label: 'Email', ...EMAIL, synonyms: ['email', 'e mail', 'email address'] },
      { key: 'phone', label: 'Phone', ...PHONE, synonyms: ['phone', 'telephone', 'mobile', 'tel'] },
      { key: 'leadScore', label: 'Score', type: 'number', synonyms: ['score', 'lead score', 'rating'] },
      { key: 'industry', label: 'Industry', type: 'text', synonyms: ['industry', 'sector'] },
      { key: 'campaign', label: 'Campaign', type: 'text', synonyms: ['campaign', 'source campaign'] },
    ],
  },
  {
    id: 'employee',
    label: 'Employee',
    plural: 'Employees',
    domain: 'hr',
    moduleId: 'hr-employees',
    titleField: 'name',
    risk: 'high', // personal data + pay
    nameHints: ['employee', 'employees', 'staff', 'personnel', 'headcount', 'roster', 'payroll'],
    identityKeys: [['employeeNumber'], ['workEmail'], ['name']],
    fields: [
      { key: 'employeeNumber', label: 'Employee #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['employee id', 'employee number', 'emp id', 'emp no', 'staff id', 'employee code', 'payroll id'] },
      { key: 'name', label: 'Name', type: 'text', required: true, synonyms: ['name', 'full name', 'employee name', 'staff name'] },
      { key: 'role', label: 'Role', type: 'text', synonyms: ['role', 'designation', 'title', 'job title', 'position'] },
      { key: 'department', label: 'Department', type: 'text', synonyms: ['department', 'dept', 'team', 'division', 'function'] },
      { key: 'managerRef', label: 'Manager', type: 'text', synonyms: ['manager', 'reports to', 'supervisor', 'line manager'] },
      { key: 'workEmail', label: 'Work Email', ...EMAIL, synonyms: ['work email', 'email', 'official email', 'company email', 'e mail'] },
      { key: 'joinDate', label: 'Joined', type: 'date', shape: 'date', synonyms: ['join date', 'date of joining', 'joined', 'doj', 'start date', 'hire date'] },
      { key: 'monthlySalary', label: 'Monthly Salary', type: 'number', shape: 'money', sensitive: true, conflicts: ['annual', 'yearly', 'annum', 'ctc'], synonyms: ['monthly salary', 'salary', 'gross salary', 'monthly pay', 'pay'] },
      { key: 'workState', label: 'Work State', type: 'text', synonyms: ['work state', 'state', 'location state'] },
    ],
  },
  {
    id: 'supplier',
    label: 'Supplier',
    plural: 'Suppliers',
    domain: 'procurement',
    moduleId: 'procurement-suppliers',
    titleField: 'name',
    risk: 'high', // vendor master feeds payments
    nameHints: ['supplier', 'suppliers', 'vendor', 'vendors', 'creditor', 'partner'],
    identityKeys: [['gst'], ['email'], ['name']],
    fields: [
      { key: 'name', label: 'Company', type: 'text', required: true, synonyms: ['supplier name', 'supplier', 'vendor name', 'vendor', 'company', 'company name', 'name', 'party name'] },
      { key: 'contactPerson', label: 'Contact', type: 'text', synonyms: ['contact', 'contact person', 'contact name', 'representative'] },
      { key: 'email', label: 'Email', ...EMAIL, synonyms: ['email', 'contact email', 'e mail', 'email address'] },
      { key: 'phone', label: 'Phone', ...PHONE, synonyms: ['phone', 'telephone', 'mobile', 'tel'] },
      { key: 'gst', label: 'GST', type: 'text', shape: 'code', synonyms: ['gst', 'gstin', 'gst number', 'tax id', 'vat number'] },
      { key: 'pan', label: 'PAN', type: 'text', shape: 'code', synonyms: ['pan', 'pan number'] },
      { key: 'leadTime', label: 'Lead Time (days)', type: 'number', synonyms: ['lead time', 'lead time days', 'delivery days'] },
      { key: 'vendorRating', label: 'Rating', type: 'number', synonyms: ['rating', 'vendor rating', 'score'] },
    ],
  },
  {
    id: 'product',
    label: 'Product',
    plural: 'Products',
    domain: 'inventory',
    moduleId: 'inventory-products',
    titleField: 'name',
    risk: 'medium',
    nameHints: ['product', 'products', 'item', 'items', 'sku', 'catalog', 'catalogue', 'inventory', 'stock', 'material'],
    identityKeys: [['sku'], ['barcode'], ['name']],
    fields: [
      { key: 'sku', label: 'SKU', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['sku', 'item code', 'product code', 'material code', 'part number', 'part no', 'article'] },
      { key: 'name', label: 'Name', type: 'text', required: true, synonyms: ['product name', 'item name', 'name', 'description', 'material description', 'product'] },
      { key: 'category', label: 'Category', type: 'text', synonyms: ['category', 'group', 'product group', 'item group', 'type', 'family'] },
      { key: 'barcode', label: 'Barcode', type: 'text', shape: 'code', synonyms: ['barcode', 'ean', 'upc', 'gtin'] },
      { key: 'unit', label: 'Unit', type: 'text', synonyms: ['unit', 'uom', 'unit of measure', 'measure'] },
      { key: 'currentStock', label: 'On Hand', type: 'number', synonyms: ['on hand', 'stock', 'quantity', 'qty', 'current stock', 'stock on hand', 'available'] },
      { key: 'purchaseCost', label: 'Purchase Cost', type: 'number', shape: 'money', synonyms: ['purchase cost', 'cost', 'unit cost', 'buy price', 'cost price'] },
      { key: 'sellingPrice', label: 'Selling Price', type: 'number', shape: 'money', synonyms: ['selling price', 'unit price', 'price', 'sale price', 'mrp', 'list price'] },
      { key: 'reorderLevel', label: 'Reorder Level', type: 'number', synonyms: ['reorder level', 'reorder point', 'min stock', 'minimum stock'] },
    ],
  },
  {
    id: 'invoice',
    label: 'Invoice',
    plural: 'Invoices',
    domain: 'finance',
    moduleId: 'finance-invoices',
    titleField: 'number',
    risk: 'high', // money
    nameHints: ['invoice', 'invoices', 'bill', 'billing', 'receivable', 'receivables', 'sales invoice', 'ar'],
    identityKeys: [['number']],
    fields: [
      { key: 'number', label: 'Invoice #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['invoice no', 'invoice number', 'invoice', 'bill number', 'bill no', 'document number', 'voucher no', 'reference'] },
      { key: 'customer', label: 'Customer', type: 'text', required: true, synonyms: ['customer', 'customer name', 'client', 'party', 'party name', 'billed to', 'bill to', 'account'] },
      { key: 'amount', label: 'Subtotal', type: 'number', required: true, shape: 'money', synonyms: ['net amount', 'amount', 'subtotal', 'taxable value', 'invoice amount', 'value', 'net'] },
      { key: 'taxRate', label: 'Tax Rate %', type: 'number', synonyms: ['tax rate', 'gst rate', 'vat rate', 'tax percent', 'tax %'] },
      { key: 'taxAmount', label: 'Tax', type: 'number', shape: 'money', synonyms: ['tax', 'tax amount', 'gst amount', 'vat amount'] },
      { key: 'total', label: 'Total', type: 'number', shape: 'money', synonyms: ['total', 'invoice total', 'grand total', 'gross amount', 'total amount'] },
      { key: 'issueDate', label: 'Issued', type: 'date', shape: 'date', synonyms: ['invoice date', 'issue date', 'issued', 'date', 'document date'] },
      { key: 'dueDate', label: 'Due', type: 'date', shape: 'date', synonyms: ['due date', 'due', 'payment due', 'maturity date'] },
      { key: 'amountPaid', label: 'Amount Paid', type: 'number', shape: 'money', synonyms: ['amount paid', 'paid', 'received', 'settled'] },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    plural: 'Projects',
    domain: 'projects',
    moduleId: 'projects-projects',
    titleField: 'name',
    risk: 'low',
    nameHints: ['project', 'projects', 'engagement', 'engagements', 'job'],
    identityKeys: [['projectNumber'], ['name']],
    fields: [
      { key: 'projectNumber', label: 'Project #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['project number', 'project code', 'project id', 'job number', 'code', 'wbs'] },
      { key: 'name', label: 'Name', type: 'text', required: true, synonyms: ['project name', 'name', 'title', 'engagement', 'description'] },
      { key: 'customerRef', label: 'Customer', type: 'text', synonyms: ['customer', 'client', 'account', 'customer name'] },
      { key: 'manager', label: 'Manager', type: 'text', synonyms: ['manager', 'project manager', 'owner', 'lead'] },
      { key: 'budget', label: 'Budget', type: 'number', shape: 'money', synonyms: ['budget', 'approved budget', 'budget amount', 'cost budget'] },
      { key: 'startDate', label: 'Starts', type: 'date', shape: 'date', synonyms: ['start date', 'starts', 'begin date', 'kickoff'] },
      { key: 'endDate', label: 'Ends', type: 'date', shape: 'date', synonyms: ['end date', 'ends', 'finish date', 'due date', 'target date'] },
      { key: 'percentComplete', label: 'Complete %', type: 'number', synonyms: ['percent complete', 'complete', 'progress', 'completion'] },
    ],
  },
];

const BY_ID = new Map(ONTOLOGY.map((e) => [e.id, e]));

export function entityById(id: string): CanonicalEntity | null {
  return BY_ID.get(id) ?? null;
}

/** Domains that carry elevated approval requirements regardless of entity risk. */
export const HIGH_RISK_DOMAINS: readonly CanonicalDomain[] = ['finance', 'hr'];

/** A high-risk import can never be applied without an explicit human approval. */
export function requiresExplicitApproval(entity: CanonicalEntity): boolean {
  return entity.risk === 'high' || HIGH_RISK_DOMAINS.includes(entity.domain);
}
