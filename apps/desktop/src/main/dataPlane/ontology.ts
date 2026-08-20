/**
 * Phase 6 — Universal Enterprise Data Plane: canonical enterprise ontology.
 *
 * The ontology is the contract between "a column in someone's spreadsheet" and
 * "a field on a real NeuroPause enterprise module". Every entity here routes to
 * an EXISTING module id and EXISTING descriptor field keys — this layer adds a
 * routing vocabulary, it does not fork the ERP data model.
 *
 * SCOPE (honest): fourteen canonical entities are implemented — the original
 * eight (Finance, CRM, HR, Inventory, Procurement, Projects), two contributed
 * by the Medical Device pack, two transaction-class entities added by NP-010
 * §2 (payment, sales_order), and two AGGREGATION-SHAPED entities added by
 * NP-011 (journal_entry, bank_statement): their destination modules are
 * multi-line shapes, so dedicated extractors in aggregations.ts pre-fold the
 * source (Tally vouchers, bank-transaction tables) into flat rows whose
 * `Lines (JSON)` cell carries the shared line shapes the modules already
 * parse. Imported journal entries land as DRAFTS — the `post` action's full
 * guard is the GL gate. Adding a flat entity remains a data-only change below.
 */

export type CanonicalDomain =
  | 'finance'
  | 'crm'
  | 'hr'
  | 'inventory'
  | 'procurement'
  | 'projects'
  | 'sales'
  // Contributed by the Medical Device Manufacturing industry pack. A domain,
  // not a tenant: the entities below are what any device manufacturer keeps,
  // and nothing in them names a specific company.
  | 'medical_device';

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
    moduleId: 'crm',
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
    moduleId: 'finance',
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
  {
    // NP-010 §2 — transaction class. Customer receipts from bank/accounting
    // exports (Zoho/QuickBooks payment CSVs). Money → HIGH, never auto-imported.
    id: 'payment',
    label: 'Payment',
    plural: 'Payments',
    domain: 'finance',
    moduleId: 'finance-payments',
    titleField: 'paymentNumber',
    risk: 'high',
    nameHints: ['payment', 'payments', 'receipt', 'receipts', 'collection', 'collections', 'payments received', 'customer payment', 'settlement'],
    identityKeys: [['paymentNumber'], ['transactionRef'], ['invoiceRef', 'receivedDate', 'amount']],
    fields: [
      { key: 'paymentNumber', label: 'Payment #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['payment no', 'payment number', 'payment id', 'receipt no', 'receipt number', 'voucher no', 'reference'] },
      { key: 'invoiceRef', label: 'Invoice', type: 'text', required: true, synonyms: ['invoice', 'invoice no', 'invoice number', 'against invoice', 'invoice ref', 'bill no', 'bill number'] },
      { key: 'customer', label: 'Customer', type: 'text', synonyms: ['customer', 'customer name', 'party', 'party name', 'client', 'received from', 'payer'] },
      { key: 'amount', label: 'Amount', type: 'number', required: true, shape: 'money', synonyms: ['amount', 'payment amount', 'amount received', 'received', 'paid amount', 'value'] },
      { key: 'currency', label: 'Currency', type: 'text', shape: 'code', synonyms: ['currency', 'curr', 'ccy'] },
      { key: 'method', label: 'Method', type: 'text', synonyms: ['method', 'payment method', 'mode', 'payment mode', 'pay mode', 'instrument'] },
      { key: 'receivedDate', label: 'Received', type: 'date', shape: 'date', synonyms: ['payment date', 'received date', 'receipt date', 'date', 'transaction date', 'value date'] },
      { key: 'transactionRef', label: 'Transaction Ref', type: 'text', shape: 'code', synonyms: ['transaction ref', 'transaction id', 'txn id', 'utr', 'ref no', 'reference no', 'cheque no', 'cheque number'] },
      { key: 'bankAccount', label: 'Bank Account', type: 'text', synonyms: ['bank account', 'account', 'bank', 'deposit to', 'deposit account'] },
    ],
  },
  {
    // NP-011 — aggregation-shaped: one row per Tally voucher (or hand-built
    // journal sheet), ledger lines pre-folded to GlJournalLine JSON. Imports
    // land as DRAFTS; posting (the GL gate) re-validates everything.
    id: 'journal_entry',
    label: 'Journal Entry',
    plural: 'Journal Entries',
    domain: 'finance',
    moduleId: 'finance-journal-entries',
    titleField: 'entryNumber',
    risk: 'high',
    nameHints: ['journal', 'journals', 'journal entry', 'journal entries', 'voucher', 'vouchers', 'tally', 'day book', 'daybook'],
    identityKeys: [['entryNumber']],
    fields: [
      { key: 'entryNumber', label: 'Entry #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['entry number', 'entry no', 'voucher number', 'voucher no', 'journal number', 'journal no', 'je number', 'je no'] },
      { key: 'entryDate', label: 'Date', type: 'date', shape: 'date', synonyms: ['date', 'entry date', 'voucher date', 'journal date'] },
      { key: 'memo', label: 'Memo', type: 'text', synonyms: ['memo', 'narration', 'description', 'particulars'] },
      { key: 'lines', label: 'Lines (JSON)', type: 'text', required: true, synonyms: ['lines json', 'lines', 'journal lines', 'ledger entries json', 'entries json'] },
    ],
  },
  {
    // NP-011 — aggregation-shaped: one row per statement, transactions
    // pre-folded to BankStatementLine JSON (deposits positive). Reconciliation
    // stays the module's deterministic action.
    id: 'bank_statement',
    label: 'Bank Statement',
    plural: 'Bank Statements',
    domain: 'finance',
    moduleId: 'finance-bank-statements',
    titleField: 'statementNumber',
    risk: 'high',
    nameHints: ['bank statement', 'bank statements', 'statement', 'bank', 'account statement', 'passbook'],
    identityKeys: [['statementNumber']],
    fields: [
      { key: 'statementNumber', label: 'Statement #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['statement number', 'statement no', 'stmt no', 'stmt'] },
      { key: 'bankAccount', label: 'Bank Account', type: 'text', required: true, synonyms: ['bank account', 'account', 'account number', 'bank'] },
      { key: 'statementDate', label: 'Statement Date', type: 'date', shape: 'date', synonyms: ['statement date', 'date', 'period end', 'as of'] },
      { key: 'lines', label: 'Lines (JSON)', type: 'text', required: true, synonyms: ['lines json', 'lines', 'transactions json', 'transactions'] },
    ],
  },
  {
    // NP-010 §2 — transaction class. Closes the recorded limitation where an
    // orders CSV classified as CUSTOMERS and imported junk customer records
    // (see importToRelated.test.ts). Revenue-bearing document → HIGH.
    id: 'sales_order',
    label: 'Sales Order',
    plural: 'Sales Orders',
    domain: 'sales',
    moduleId: 'sales-orders',
    titleField: 'orderNumber',
    risk: 'high',
    nameHints: ['sales order', 'sales orders', 'order', 'orders', 'order book', 'open orders', 'so'],
    identityKeys: [['orderNumber']],
    fields: [
      { key: 'orderNumber', label: 'Order #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['order no', 'order number', 'so no', 'so number', 'sales order', 'sales order no', 'order id', 'document number'] },
      { key: 'customer', label: 'Customer', type: 'text', required: true, synonyms: ['customer', 'customer name', 'party', 'party name', 'client', 'buyer', 'account'] },
      { key: 'orderDate', label: 'Order Date', type: 'date', shape: 'date', synonyms: ['order date', 'so date', 'date', 'document date', 'booking date'] },
      { key: 'expectedDeliveryDate', label: 'Expected Delivery', type: 'date', shape: 'date', synonyms: ['delivery date', 'expected delivery', 'ship by', 'promised date', 'due date'] },
      { key: 'product', label: 'Product (SKU)', type: 'text', shape: 'code', synonyms: ['product', 'sku', 'item', 'item code', 'product code', 'material'] },
      { key: 'orderedQty', label: 'Ordered Qty', type: 'number', synonyms: ['qty', 'quantity', 'ordered qty', 'order quantity', 'order qty'] },
      { key: 'warehouse', label: 'Warehouse', type: 'text', synonyms: ['warehouse', 'location', 'site', 'store'] },
      { key: 'total', label: 'Total', type: 'number', shape: 'money', synonyms: ['total', 'order total', 'amount', 'order value', 'grand total', 'value'] },
    ],
  },
  {
    id: 'medical_device_product',
    label: 'Medical Device Product',
    plural: 'Medical Device Products',
    domain: 'medical_device',
    moduleId: 'md-products',
    titleField: 'productName',
    // MEDIUM, not high. The device catalogue is master data and a corrupt row is
    // expensive to unwind — but it is not money or payroll, and forcing explicit
    // approval on every catalogue load would train people to approve without
    // reading, which is worse than the risk it removes. Lots ARE high, below.
    risk: 'medium',
    nameHints: ['product', 'products', 'device', 'devices', 'implant', 'implants', 'catalogue', 'catalog', 'item master', 'sku'],
    identityKeys: [['productCode']],
    fields: [
      { key: 'productCode', label: 'Product Code', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['product code', 'item code', 'catalogue number', 'catalog number', 'cat no', 'ref', 'reference', 'part number', 'sku', 'code'] },
      { key: 'productName', label: 'Product Name', type: 'text', required: true, synonyms: ['product name', 'description', 'item name', 'name', 'product', 'item description'] },
      { key: 'productFamily', label: 'Family', type: 'text', synonyms: ['family', 'product family', 'range', 'product group', 'group', 'division'] },
      { key: 'category', label: 'Category', type: 'text', synonyms: ['category', 'type', 'item type', 'product type', 'class'] },
      { key: 'anatomicalCategory', label: 'Anatomical Category', type: 'text', synonyms: ['anatomy', 'anatomical', 'anatomical category', 'body part', 'application'] },
      { key: 'material', label: 'Material', type: 'text', synonyms: ['material', 'material grade', 'alloy', 'composition', 'raw material'] },
      { key: 'size', label: 'Size', type: 'text', synonyms: ['size', 'length', 'diameter', 'dia', 'gauge'] },
      { key: 'dimensions', label: 'Dimensions', type: 'text', synonyms: ['dimensions', 'dimension', 'measurements'] },
      { key: 'sterileStatus', label: 'Sterility', type: 'text', synonyms: ['sterile', 'sterility', 'sterilisation', 'sterilization', 'sterile status'] },
      { key: 'packaging', label: 'Packaging', type: 'text', synonyms: ['packaging', 'pack', 'pack type', 'packing'] },
      { key: 'udi', label: 'UDI', type: 'text', shape: 'code', synonyms: ['udi', 'udi di', 'unique device identifier', 'gtin', 'di'] },
    ],
  },
  {
    id: 'medical_device_lot',
    label: 'Batch / Lot',
    plural: 'Batches / Lots',
    domain: 'medical_device',
    moduleId: 'md-lots',
    titleField: 'lotNumber',
    // HIGH. A lot is the unit a recall is executed in; a mis-imported batch
    // record is the one piece of master data whose corruption can put the wrong
    // material in front of a patient. It never imports without a person saying so.
    risk: 'high',
    nameHints: ['lot', 'lots', 'batch', 'batches', 'batch record', 'lot number', 'traceability'],
    identityKeys: [['lotNumber']],
    fields: [
      { key: 'lotNumber', label: 'Lot #', type: 'text', required: true, shape: 'code', identity: true, synonyms: ['lot', 'lot no', 'lot number', 'batch', 'batch no', 'batch number', 'batch code', 'lot code'] },
      { key: 'productCode', label: 'Product Code', type: 'text', required: true, shape: 'code', synonyms: ['product code', 'item code', 'catalogue number', 'catalog number', 'cat no', 'ref', 'part number', 'sku', 'product'] },
      { key: 'quantity', label: 'Quantity', type: 'number', required: true, synonyms: ['quantity', 'qty', 'batch quantity', 'lot quantity', 'produced quantity', 'received quantity'] },
      { key: 'unit', label: 'Unit', type: 'text', synonyms: ['unit', 'uom', 'unit of measure', 'units'] },
      { key: 'manufactureDate', label: 'Manufactured', type: 'date', shape: 'date', synonyms: ['manufacture date', 'manufactured', 'mfg date', 'mfg', 'production date', 'date of manufacture'] },
      { key: 'expiryDate', label: 'Expires', type: 'date', shape: 'date', synonyms: ['expiry', 'expiry date', 'expires', 'exp date', 'use by', 'best before', 'shelf life end'] },
      { key: 'warehouseId', label: 'Warehouse', type: 'text', shape: 'code', synonyms: ['warehouse', 'store', 'location', 'stock location', 'site'] },
      { key: 'manufacturingOrderId', label: 'Manufacturing Order', type: 'text', shape: 'code', synonyms: ['manufacturing order', 'production order', 'work order', 'mo', 'wo', 'order number'] },
      { key: 'supplierId', label: 'Supplier', type: 'text', shape: 'code', synonyms: ['supplier', 'vendor', 'supplier code', 'vendor code', 'source'] },
      { key: 'status', label: 'Status', type: 'text', synonyms: ['status', 'lot status', 'batch status', 'disposition', 'qc status'] },
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
