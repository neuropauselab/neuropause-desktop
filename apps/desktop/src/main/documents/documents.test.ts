/**
 * Document Intelligence — end to end, through the real handlers.
 *
 * The load-bearing assertions are the refusals, as always:
 *   - a PDF and an image are STORED and not read, with the reason on the
 *     record, and no text is invented for either;
 *   - every extracted value names the line it came from, and a value that
 *     cannot be located is absent rather than guessed;
 *   - an extraction whose arithmetic disagrees with itself goes to review
 *     rather than becoming a business record;
 *   - a link is confirmed by a person holding write access to the target, not
 *     produced by a name that happens to match;
 *   - a correction never overwrites what it replaced.
 *
 * Fixtures are real files built here — a real DOCX (a real ZIP with real
 * WordprocessingML), a real `%PDF-` header, a real PNG header — so the
 * parser's magic-byte detection is exercised rather than bypassed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type {
  DocumentCapabilities,
  DocumentDetail,
  DocumentSummary,
  DocumentUploadResult,
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  IpcChannelName,
} from '@neuropause/shared';
import { IpcChannel } from '@neuropause/shared';
import { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import { buildZip } from '../dataPlane/zipWriter';
import { initDocuments, type DocumentSubsystem } from './index';
import { classifyDocument, parseAmount, parseDocumentDate, validateInvoice } from './documentUnderstanding';

const ACTOR = 'priya@example.com';
const T0 = '2026-08-10T00:00:00.000Z';

/** The controlled invoice fixture the acceptance test calls for. */
const INVOICE_TEXT = [
  'ACME LTD',
  'TAX INVOICE',
  '',
  'Invoice Number: INV-0001',
  'Invoice Date: 2026-08-10',
  'Due Date: 2026-09-09',
  '',
  'Vendor: Acme Ltd',
  'Bill To: Borealis Trading',
  '',
  'Currency: INR',
  'Subtotal: 1000',
  'Total Tax: 180',
  'Grand Total: 1180',
].join('\n');

/** A real DOCX: a real ZIP carrying real WordprocessingML. */
function docxOf(paragraphs: readonly string[]): Buffer {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`)
    .join('');
  return buildZip([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    },
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    },
  ]);
}

const CUSTOMERS: EnterpriseModuleDescriptor = {
  id: 'crm-customers',
  title: 'Customers',
  singular: 'Customer',
  plural: 'Customers',
  icon: 'user',
  description: 'test',
  titleField: 'name',
  permissions: { read: 'crm:read', write: 'crm:manage' },
  fields: [{ key: 'name', label: 'Customer Name', type: 'text', required: true }],
};

const INVOICES: EnterpriseModuleDescriptor = {
  id: 'finance',
  title: 'Invoices',
  singular: 'Invoice',
  plural: 'Invoices',
  icon: 'doc',
  description: 'test',
  titleField: 'number',
  permissions: { read: 'operations:read', write: 'operations:manage' },
  fields: [
    { key: 'number', label: 'Invoice #', type: 'text', required: true },
    { key: 'customer', label: 'Customer', type: 'text' },
    { key: 'total', label: 'Total', type: 'number' },
  ],
};

const DESCRIPTORS = [CUSTOMERS, INVOICES];

describe('document intelligence', () => {
  let dir: string;
  let stores: Map<string, EnterpriseRecordStore>;
  let sub: DocumentSubsystem;
  let granted: Set<EnterprisePermission>;
  let audit: { action: string; target: string; summary: string }[];

  const call = async (channel: IpcChannelName, payload: unknown): Promise<unknown> => {
    const handler = sub.handlers.find((h) => h.channel === channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler.handler(handler.schema.parse(payload));
  };

  const upload = (filename: string, bytes: Buffer) =>
    call(IpcChannel.DocumentUpload, {
      filename,
      contentBase64: bytes.toString('base64'),
    }) as Promise<DocumentUploadResult>;

  const detail = (documentId: string) =>
    call(IpcChannel.DocumentDetail, { documentId }) as Promise<DocumentDetail>;

  beforeEach(async () => {
    dir = join(tmpdir(), `np-docs-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    audit = [];
    granted = new Set<EnterprisePermission>([
      'data:read',
      'data:import',
      'crm:read',
      'crm:manage',
      'operations:read',
      'operations:manage',
    ]);
    stores = new Map(
      DESCRIPTORS.map((d) => [d.id, new EnterpriseRecordStore(join(dir, `${d.id}.json`), d.id, d.id)]),
    );
    await Promise.all([...stores.values()].map((s) => s.load()));

    sub = initDocuments({
      userDataDir: dir,
      actor: () => ACTOR,
      now: () => T0,
      audit: (e) => audit.push(e),
      authorize: (permission) => {
        if (!granted.has(permission)) throw new Error(`Missing permission ${permission}`);
      },
      modules: () => DESCRIPTORS,
      storeFor: (id) => stores.get(id) ?? null,
    });
  });

  afterEach(async () => {
    await sub.store.flush();
    await Promise.all([...stores.values()].map((s) => s.flush()));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /* ── 1. Storage ──────────────────────────────────────────────────────── */

  describe('storage', () => {
    it('keeps the actual bytes, hashed, and can hand them back', async () => {
      const bytes = Buffer.from(INVOICE_TEXT, 'utf8');
      const { document } = await upload('invoice.txt', bytes);

      expect(document.sizeBytes).toBe(bytes.length);
      const stored = await sub.store.bytes(document.id);
      expect(stored).not.toBeNull();
      // Byte-for-byte. The whole point of keeping the file is that the
      // evidence is the file, not a summary of it.
      expect(stored!.equals(bytes)).toBe(true);

      const record = sub.store.get(document.id)!;
      expect(record.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    });

    it('the same file twice is one document, keeping the one that has history', async () => {
      const bytes = Buffer.from(INVOICE_TEXT, 'utf8');
      const first = await upload('invoice.txt', bytes);
      const again = await upload('invoice-copy.txt', bytes);

      expect(again.duplicate).toBe(true);
      expect(again.document.id).toBe(first.document.id);
      // Content-addressed, so renaming does not make it a different document
      // — and the existing record's links and corrections survive.
      expect(sub.store.all()).toHaveLength(1);
    });

    it('refuses an empty file rather than storing a document with nothing in it', async () => {
      await expect(upload('nothing.txt', Buffer.alloc(0))).rejects.toThrow(/empty/i);
    });

    it('a document with links cannot be deleted out from under them', async () => {
      const crm = stores.get('crm-customers')!;
      const customer = crm.create({
        title: 'Borealis Trading',
        fields: { name: 'Borealis Trading' },
        actor: ACTOR,
        now: T0,
      });
      await crm.flush();

      const { document } = await upload('invoice.docx', docxOf(INVOICE_TEXT.split('\n')));
      await call(IpcChannel.DocumentLink, {
        documentId: document.id,
        moduleId: 'crm-customers',
        recordId: customer.id,
        relationship: 'Document for this customer',
        basis: 'Bill To matches',
      });

      // Deleting the evidence under a record would leave that record citing a
      // source that no longer exists.
      await expect(call(IpcChannel.DocumentDelete, { documentId: document.id })).rejects.toThrow(
        /linked to 1 record/i,
      );
      expect(sub.store.get(document.id)).not.toBeNull();
    });
  });

  /* ── 2. The formats this build cannot read ───────────────────────────── */

  describe('formats it cannot read', () => {
    it('stores a PDF, refuses to read it, and invents no text', async () => {
      // A real `%PDF-` header, so the parser's magic-byte path runs.
      const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), Buffer.from('binary junk')]);
      const { document } = await upload('scan.pdf', pdf);

      expect(document.status).toBe('unsupported');
      expect(document.extractionStatus).toBe('unsupported');
      expect(document.unsupportedReason).toMatch(/PDF/i);
      expect(document.fieldCount).toBe(0);

      const record = sub.store.get(document.id)!;
      expect(record.textLength).toBe(0);
      expect(record.kind).toBe('unknown');
      // The bytes ARE kept. "We cannot read this" is not "we threw it away".
      expect(await sub.store.bytes(document.id)).not.toBeNull();
    });

    it('stores an image and says OCR is unavailable rather than producing empty text', async () => {
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64),
      ]);
      const { document } = await upload('receipt.png', png);
      expect(document.status).toBe('unsupported');
      expect(document.unsupportedReason).toMatch(/OCR/i);
    });

    it('states the OCR boundary as a capability, not as an empty result', async () => {
      const caps = (await call(IpcChannel.DocumentCapabilities, {})) as DocumentCapabilities;
      /**
       * "No text was found" and "this build cannot read that kind of file"
       * look identical on screen unless one of them says so. This is the
       * saying-so.
       */
      expect(caps.ocr.available).toBe(false);
      expect(caps.ocr.reason).toMatch(/no OCR engine/i);
      expect(caps.readableFormats).toContain('docx');
      expect(caps.readableFormats).not.toContain('pdf');
      expect(caps.unreadableFormats.map((f) => f.format)).toEqual(
        expect.arrayContaining(['pdf', 'image']),
      );
    });
  });

  /* ── 3. Classification ───────────────────────────────────────────────── */

  describe('classification', () => {
    it('recognises an invoice from its own words', async () => {
      const { document } = await upload('doc.docx', docxOf(INVOICE_TEXT.split('\n')));
      expect(document.kind).toBe('invoice');
      expect(document.kindConfidence).toBeGreaterThan(0.45);
      expect(sub.store.get(document.id)!.kindReasons.join(' ')).toMatch(/tax invoice|invoice number/i);
    });

    it('separates a purchase order from an invoice', () => {
      const po = classifyDocument(
        'PURCHASE ORDER\nPO Number: PO-77\nShip To: Warehouse 3\nExpected Delivery: 2026-09-01',
        'po.docx',
      );
      expect(po.kind).toBe('purchase_order');
    });

    it('refuses to name a type it cannot support, and says why', async () => {
      const { document } = await upload(
        'notes.txt',
        Buffer.from('Meeting notes\nWe discussed the roadmap and agreed to reconvene.', 'utf8'),
      );
      /**
       * A wrong classification is not a small error — it decides which
       * extractor runs, and therefore which fields get read. "Not recognised,
       * tell me what this is" costs one click.
       */
      expect(document.kind).toBe('unknown');
      expect(document.status).toBe('needs_review');
      expect(sub.store.get(document.id)!.kindReasons.join(' ')).toMatch(/please say which it is|no phrase/i);
    });

    it('a filename cannot outvote the contents', () => {
      const contract = classifyDocument(
        'SERVICE AGREEMENT\nThis contract is between the parties.\nGoverning law: India.\nSignature:',
        'invoice-final-v3.docx',
      );
      expect(contract.kind).toBe('contract');
    });

    it('a reviewer can correct the type, and the extraction is redone from the bytes', async () => {
      const text = ['Statement of account', 'Invoice Number: INV-9', 'Grand Total: 500'].join('\n');
      const { document } = await upload('ambiguous.txt', Buffer.from(text, 'utf8'));

      const after = (await call(IpcChannel.DocumentReclassify, {
        documentId: document.id,
        kind: 'invoice',
        reason: 'It is an invoice despite the heading.',
      })) as DocumentDetail;

      expect(after.document.kind).toBe('invoice');
      expect(after.document.kindMethod).toBe('reviewer');
      // The old reading is preserved in the reasons rather than erased.
      expect(after.document.kindReasons.join(' ')).toMatch(/previously read as/i);
      expect(after.document.fields.find((f) => f.key === 'invoiceNumber')?.value).toBe('INV-9');
    });

    it('reclassifying something that could not be read is refused, not faked', async () => {
      const pdf = Buffer.from('%PDF-1.7\n', 'ascii');
      const { document } = await upload('scan.pdf', pdf);
      await expect(
        call(IpcChannel.DocumentReclassify, { documentId: document.id, kind: 'invoice' }),
      ).rejects.toThrow(/could not be read/i);
    });
  });

  /* ── 4. Extraction and evidence ──────────────────────────────────────── */

  describe('extraction', () => {
    it('reads the invoice fields and names the line each came from', async () => {
      const { document } = await upload('invoice.docx', docxOf(INVOICE_TEXT.split('\n')));
      const record = sub.store.get(document.id)!;
      const by = new Map(record.fields.map((f) => [f.key, f]));

      expect(by.get('invoiceNumber')?.value).toBe('INV-0001');
      expect(by.get('invoiceDate')?.value).toBe('2026-08-10');
      expect(by.get('dueDate')?.value).toBe('2026-09-09');
      expect(by.get('currency')?.value).toBe('INR');
      expect(by.get('subtotal')?.value).toBe(1000);
      expect(by.get('tax')?.value).toBe(180);
      expect(by.get('total')?.value).toBe(1180);
      expect(by.get('customer')?.value).toBe('Borealis Trading');

      /**
       * EVERY field carries evidence. A value with no evidence is not an
       * extraction, it is an invention — so this is asserted for all of them,
       * not sampled.
       */
      for (const field of record.fields) {
        expect(field.evidence.snippet.length, `${field.key} has no snippet`).toBeGreaterThan(0);
        expect(field.confidence).toBeGreaterThan(0);
        expect(field.confidenceBasis.length).toBeGreaterThan(0);
      }
      // And the snippet is the ACTUAL source text, not a paraphrase.
      expect(by.get('total')?.evidence.snippet).toContain('1180');
      expect(by.get('total')?.evidence.line).toBeGreaterThan(0);
    });

    it('does not confuse the total tax with the grand total', async () => {
      const { document } = await upload('invoice.docx', docxOf(INVOICE_TEXT.split('\n')));
      const by = new Map(sub.store.get(document.id)!.fields.map((f) => [f.key, f]));
      // "Total Tax: 180" comes before "Grand Total: 1180" in the document, so
      // a naive search for "total" reads 180 as the invoice total.
      expect(by.get('total')?.value).toBe(1180);
      expect(by.get('tax')?.value).toBe(180);
    });

    it('omits a field it cannot find rather than emitting a guess', async () => {
      const partial = ['TAX INVOICE', 'Invoice Number: INV-2', 'Amount Due: 500'].join('\n');
      const { document } = await upload('partial.txt', Buffer.from(partial, 'utf8'));
      const record = sub.store.get(document.id)!;
      // No subtotal line exists, so there is no subtotal field — not a null
      // one, and certainly not `500 - tax`.
      expect(record.fields.some((f) => f.key === 'subtotal')).toBe(false);
      expect(record.fields.find((f) => f.key === 'total')?.value).toBe(500);
    });

    it('refuses an ambiguous date rather than picking a hemisphere', () => {
      // `12/08/2026` is 12 August or 8 December depending on where you are.
      // Guessing produces a date that is wrong four months a year without
      // ever looking wrong.
      expect(parseDocumentDate('12/08/2026')).toBeNull();
      expect(parseDocumentDate('2026-08-12')).toBe('2026-08-12');
    });

    it('refuses a number it cannot read rather than returning NaN or zero', () => {
      expect(parseAmount('₹1,180.00')).toBe(1180);
      expect(parseAmount('INR 1,180')).toBe(1180);
      expect(parseAmount('approximately 1000')).toBeNull();
      expect(parseAmount('')).toBeNull();
    });
  });

  /* ── 5. Validation ───────────────────────────────────────────────────── */

  describe('validation', () => {
    it('an invoice whose arithmetic disagrees goes to review', async () => {
      const broken = INVOICE_TEXT.replace('Grand Total: 1180', 'Grand Total: 1200');
      const { document } = await upload('broken.txt', Buffer.from(broken, 'utf8'));

      expect(document.status).toBe('needs_review');
      const record = sub.store.get(document.id)!;
      const error = record.issues.find((i) => i.severity === 'error');
      expect(error?.message).toMatch(/arithmetic does not agree/i);
      // It says WHICH three numbers disagree and does not pick a winner —
      // which of the three was misread is not knowable from here.
      expect(error?.message).toContain('1000');
      expect(error?.message).toContain('180');
      expect(error?.message).toContain('1200');
    });

    it('a clean invoice is not flagged', async () => {
      const { document } = await upload('good.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      expect(document.status).toBe('extracted');
      expect(sub.store.get(document.id)!.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('a missing required field is an error, not a silent absence', () => {
      const issues = validateInvoice([]);
      expect(issues.map((i) => i.fieldKey)).toEqual(expect.arrayContaining(['invoiceNumber', 'total']));
    });

    it('says so when the total could not be checked at all', () => {
      const issues = validateInvoice([
        {
          key: 'total',
          label: 'Total',
          value: 100,
          evidence: { method: 'labelled_value', snippet: 'Total: 100', line: 1, table: null },
          confidence: 0.95,
          confidenceBasis: 'x',
          corrected: false,
        },
      ]);
      // An unchecked total is a different state from a checked one, and the
      // difference matters to whoever acts on it.
      expect(issues.some((i) => i.message.includes('could not be checked'))).toBe(true);
    });
  });

  /* ── 6. Correction ───────────────────────────────────────────────────── */

  describe('correction', () => {
    it('keeps the original alongside the correction, with who and why', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      const after = (await call(IpcChannel.DocumentCorrect, {
        documentId: document.id,
        fieldKey: 'total',
        value: 11800,
        reason: 'The printed total is missing a digit; confirmed with the vendor.',
      })) as DocumentDetail;

      const field = after.document.fields.find((f) => f.key === 'total')!;
      expect(field.value).toBe(11800);
      expect(field.corrected).toBe(true);
      expect(field.confidence).toBe(1);
      expect(field.evidence.method).toBe('user_correction');

      const [correction] = after.document.corrections;
      expect(correction?.from).toBe(1180);
      expect(correction?.to).toBe(11800);
      expect(correction?.by).toBe(ACTOR);
      expect(correction?.reason).toMatch(/missing a digit/);
    });

    it('re-runs validation, so a correction can break the arithmetic too', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      const after = (await call(IpcChannel.DocumentCorrect, {
        documentId: document.id,
        fieldKey: 'total',
        value: 9999,
        reason: 'Testing that validation follows the correction.',
      })) as DocumentDetail;

      // Leaving the old issues would let a corrected document keep an error it
      // no longer has — or lose one it just acquired, which is this case.
      expect(after.document.status).toBe('needs_review');
      expect(after.document.issues.some((i) => i.message.includes('9999'))).toBe(true);
    });

    it('a correction with no reason is refused by the contract', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await expect(
        call(IpcChannel.DocumentCorrect, { documentId: document.id, fieldKey: 'total', value: 1, reason: '' }),
      ).rejects.toThrow();
    });

    it('cannot correct a field the document does not have', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await expect(
        call(IpcChannel.DocumentCorrect, {
          documentId: document.id,
          fieldKey: 'invented',
          value: 'x',
          reason: 'should fail',
        }),
      ).rejects.toThrow(/no “invented” field/i);
    });
  });

  /* ── 7. Relationships ────────────────────────────────────────────────── */

  describe('relationships', () => {
    const seedCustomer = async (name: string): Promise<string> => {
      const crm = stores.get('crm-customers')!;
      const rec = crm.create({ title: name, fields: { name }, actor: ACTOR, now: T0 });
      await crm.flush();
      return rec.id;
    };

    it('offers a customer it can support with evidence, and does not link it', async () => {
      await seedCustomer('Borealis Trading');
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      const view = await detail(document.id);

      const candidate = view.candidates.find((c) => c.moduleId === 'crm-customers');
      expect(candidate?.match).toBe('exact');
      expect(candidate?.basis).toContain('Borealis Trading');
      // OFFERED. A file that names a customer is not an instruction to attach
      // itself to them.
      expect(view.document.links).toHaveLength(0);
    });

    it('marks a name that only matches after normalising as exactly that', async () => {
      await seedCustomer('Borealis Trading Pvt Ltd');
      const text = INVOICE_TEXT.replace('Bill To: Borealis Trading', 'Bill To: Borealis Trading Private Limited');
      const { document } = await upload('invoice.txt', Buffer.from(text, 'utf8'));
      const view = await detail(document.id);
      expect(view.candidates[0]?.match).toBe('normalized');
    });

    it('a confirmed link is attributed, and the document then explains itself', async () => {
      const customerId = await seedCustomer('Borealis Trading');
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      const after = (await call(IpcChannel.DocumentLink, {
        documentId: document.id,
        moduleId: 'crm-customers',
        recordId: customerId,
        relationship: 'Invoice for this customer',
        basis: 'Bill To on the document names this customer exactly.',
      })) as DocumentDetail;

      const [link] = after.document.links;
      expect(link?.method).toBe('confirmed_by_person');
      expect(link?.by).toBe(ACTOR);
      expect(link?.recordTitle).toBe('Borealis Trading');
      // The relationship is explainable — the whole requirement.
      expect(link?.basis).toContain('Bill To');
      // …and it is no longer offered as a candidate.
      expect(after.candidates.some((c) => c.recordId === customerId)).toBe(false);
    });

    it('linking needs WRITE on the target, not merely read', async () => {
      const customerId = await seedCustomer('Borealis Trading');
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      granted.delete('crm:manage');
      /**
       * A link is an assertion ABOUT the customer record. Read access to a
       * customer is not authority to attach an invoice to them.
       */
      await expect(
        call(IpcChannel.DocumentLink, {
          documentId: document.id,
          moduleId: 'crm-customers',
          recordId: customerId,
          relationship: 'x',
          basis: 'y',
        }),
      ).rejects.toThrow(/crm:manage/);
    });

    it('a module you cannot read offers no candidates from it', async () => {
      await seedCustomer('Borealis Trading');
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      granted.delete('crm:read');
      const view = await detail(document.id);
      // A document must not become a way to enumerate a module the reader
      // cannot open.
      expect(view.candidates).toHaveLength(0);
    });

    it('will not link to a record that no longer exists', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await expect(
        call(IpcChannel.DocumentLink, {
          documentId: document.id,
          moduleId: 'crm-customers',
          recordId: 'rec_nonexistent',
          relationship: 'x',
          basis: 'y',
        }),
      ).rejects.toThrow(/no longer exists/);
    });
  });

  /* ── 8. Governance ───────────────────────────────────────────────────── */

  describe('governance', () => {
    it('proposes an invoice record; it never creates one', async () => {
      const customerId = await (async () => {
        const crm = stores.get('crm-customers')!;
        const rec = crm.create({
          title: 'Borealis Trading',
          fields: { name: 'Borealis Trading' },
          actor: ACTOR,
          now: T0,
        });
        await crm.flush();
        return rec.id;
      })();

      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await call(IpcChannel.DocumentLink, {
        documentId: document.id,
        moduleId: 'crm-customers',
        recordId: customerId,
        relationship: 'Invoice for this customer',
        basis: 'Bill To matches.',
      });

      const view = await detail(document.id);
      expect(view.proposal?.moduleId).toBe('finance');
      expect(view.proposal?.requiresApproval).toBe(true);
      expect(view.proposal?.blockedReasons).toHaveLength(0);
      expect(view.proposal?.fields.find((f) => f.key === 'total')?.value).toBe(1180);

      /**
       * Nothing was created. A document that resembles an invoice is not an
       * instruction to post one, and the person who approves is the person
       * who is accountable.
       */
      expect(stores.get('finance')!.list({ status: 'active', limit: 10 })).toHaveLength(0);
    });

    it('a proposal with unresolved errors states why it cannot proceed', async () => {
      const broken = INVOICE_TEXT.replace('Grand Total: 1180', 'Grand Total: 1200');
      const { document } = await upload('broken.txt', Buffer.from(broken, 'utf8'));
      const view = await detail(document.id);
      expect(view.proposal?.blockedReasons.join(' ')).toMatch(/unresolved errors/i);
      expect(view.proposal?.blockedReasons.join(' ')).toMatch(/not linked/i);
    });

    it('offers no proposal for a kind this build has nowhere to put', async () => {
      const { document } = await upload(
        'contract.txt',
        Buffer.from('SERVICE AGREEMENT\nThis contract is between the parties.\nGoverning law.\nSignature:', 'utf8'),
      );
      const view = await detail(document.id);
      // An empty map entry is the honest representation of "we cannot do
      // anything with this yet" — better than a proposal that goes nowhere.
      expect(view.proposal).toBeNull();
    });
  });

  /* ── 9. Access control and audit ─────────────────────────────────────── */

  describe('access control and audit', () => {
    it('uploading needs data:import, not merely data:read', async () => {
      granted.delete('data:import');
      await expect(upload('x.txt', Buffer.from('hello', 'utf8'))).rejects.toThrow(/data:import/);
    });

    it('reading needs data:read', async () => {
      granted.delete('data:read');
      await expect(call(IpcChannel.DocumentList, {})).rejects.toThrow(/data:read/);
    });

    it('every act on a document is audited by name', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await call(IpcChannel.DocumentCorrect, {
        documentId: document.id,
        fieldKey: 'total',
        value: 1181,
        reason: 'Rounding on the printed copy.',
      });

      const actions = audit.map((a) => a.action);
      expect(actions).toContain('documents.upload');
      expect(actions).toContain('documents.correct');
      const correction = audit.find((a) => a.action === 'documents.correct');
      // The audit line carries the before AND the after, so the trail can be
      // read without opening the document.
      expect(correction?.summary).toContain('1180');
      expect(correction?.summary).toContain('1181');
    });
  });

  /* ── 10. Search ──────────────────────────────────────────────────────── */

  describe('search', () => {
    it('finds a document by filename, by type and by an extracted value', async () => {
      await upload('acme-invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await upload('notes.txt', Buffer.from('Meeting notes about nothing in particular.', 'utf8'));

      const byName = (await call(IpcChannel.DocumentList, { search: 'acme' })) as DocumentSummary[];
      expect(byName).toHaveLength(1);

      const byValue = (await call(IpcChannel.DocumentList, { search: 'INV-0001' })) as DocumentSummary[];
      expect(byValue).toHaveLength(1);

      const byKind = (await call(IpcChannel.DocumentList, { kind: 'invoice' })) as DocumentSummary[];
      expect(byKind).toHaveLength(1);

      const needingReview = (await call(IpcChannel.DocumentList, {
        status: 'needs_review',
      })) as DocumentSummary[];
      expect(needingReview.map((d) => d.filename)).toEqual(['notes.txt']);
    });
  });

  /* ── 11. What the adversarial review found ───────────────────────────── */

  describe('regressions', () => {
    it('reads the grand total, not the sub total, when the words are spaced', async () => {
      /**
       * `Sub Total: 1000` contains the whole word `total`, so the bare label
       * matched it and read 1000 as the invoice total. With no tax line to
       * contradict it, `validateInvoice` had nothing to disagree with and the
       * wrong number shipped as a clean extraction.
       */
      const text = ['TAX INVOICE', 'Invoice Number: INV-7', 'Sub Total: 1000', 'Total: 1180'].join('\n');
      const { document } = await upload('spaced.txt', Buffer.from(text, 'utf8'));
      const by = new Map(sub.store.get(document.id)!.fields.map((f) => [f.key, f]));
      expect(by.get('total')?.value).toBe(1180);
      expect(by.get('subtotal')?.value).toBe(1000);
    });

    it('does not read `tax` out of `taxable value`', async () => {
      const text = ['TAX INVOICE', 'Invoice Number: INV-8', 'Taxable Value: 900', 'Total: 900'].join('\n');
      const { document } = await upload('taxable.txt', Buffer.from(text, 'utf8'));
      const by = new Map(sub.store.get(document.id)!.fields.map((f) => [f.key, f]));
      expect(by.get('subtotal')?.value).toBe(900);
      expect(by.has('tax')).toBe(false);
    });

    it('parses the dominant Indian money form', () => {
      // `\b` after an optional dot backtracked and left ". 1000" behind, so
      // `Rs. 1,000` returned null and the total silently went unread.
      expect(parseAmount('Rs. 1,000')).toBe(1000);
      expect(parseAmount('Rs 1,000')).toBe(1000);
    });

    it('refuses to name a type when two candidates tie', () => {
      /**
       * Folding the margin into the confidence let a strong score carry a zero
       * margin over the floor — quote 6 / report 6 scored 0.48 and was decided
       * by the order of the rules array.
       */
      const tie = classifyDocument(
        'Executive summary. Summary of findings. Quotation attached, valid until 30 days.',
        'thing.txt',
      );
      expect(tie.kind).toBe('unknown');
      expect(tie.reasons.join(' ')).toMatch(/too close to call/i);
    });

    it('does not read "reporting" as a report', () => {
      /**
       * Two defects in one fixture. Prefix matching read ` report` inside
       * ` reporting` at 0.98 confidence; and once that was fixed, three WEAK
       * phrases (analysis, conclusion, methodology) still named a kind on
       * their own. The kind decides which extractor runs, so circumstantial
       * evidence is not enough.
       */
      const r = classifyDocument(
        'Quarterly reporting requirements. Analysis and conclusion follow. Methodology described.',
        'q3.txt',
      );
      expect(r.kind).toBe('unknown');
      expect(r.reasons.join(' ')).toMatch(/names a document type outright/i);
    });

    it('still recognises a document that says what it is', () => {
      // The counterweight: requiring a strong phrase must not make the
      // classifier useless.
      expect(classifyDocument('EXECUTIVE SUMMARY\nSummary of findings follow.', 'x.txt').kind).toBe('report');
    });

    it('does not invent a vendor from the word "from"', async () => {
      // `Goods shipped from Mumbai warehouse` produced `vendor = "Mumbai
      // warehouse"` at 0.95 confidence, with a real snippet — the letter of
      // "no fabricated extraction", asserting what the document does not say.
      const text = ['TAX INVOICE', 'Invoice Number: INV-9', 'Goods shipped from Mumbai warehouse', 'Total: 10'].join('\n');
      const { document } = await upload('shipped.txt', Buffer.from(text, 'utf8'));
      expect(sub.store.get(document.id)!.fields.some((f) => f.key === 'vendor')).toBe(false);
    });

    it('a correction cannot launder a broken invoice by changing the type', async () => {
      const broken = INVOICE_TEXT.replace('Grand Total: 1180', 'Grand Total: 1200');
      const { document } = await upload('broken.txt', Buffer.from(broken, 'utf8'));
      expect(document.status).toBe('needs_review');

      /**
       * Correcting `total` to the STRING "1200" made the arithmetic check's
       * `typeof v === 'number'` guard fail, which switched off BOTH the check
       * and the "could not be checked" warning — so the document came back
       * clean and became an approvable proposal.
       */
      await expect(
        call(IpcChannel.DocumentCorrect, {
          documentId: document.id,
          fieldKey: 'total',
          value: 'twelve hundred',
          reason: 'Trying to launder the arithmetic.',
        }),
      ).rejects.toThrow(/cannot be read as one/i);

      expect(sub.store.get(document.id)!.status).toBe('needs_review');
    });

    it('a correction to an ambiguous date is refused', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await expect(
        call(IpcChannel.DocumentCorrect, {
          documentId: document.id,
          fieldKey: 'invoiceDate',
          value: '12/08/2026',
          reason: 'Ambiguous on purpose.',
        }),
      ).rejects.toThrow(/ambiguous/i);
    });

    it('a reclassify keeps a correction the reviewer already made', async () => {
      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await call(IpcChannel.DocumentCorrect, {
        documentId: document.id,
        fieldKey: 'invoiceNumber',
        value: 'INV-CORRECTED',
        reason: 'The printed number is wrong.',
      });
      const after = (await call(IpcChannel.DocumentReclassify, {
        documentId: document.id,
        kind: 'invoice',
        reason: 'Confirming the type.',
      })) as DocumentDetail;

      // Replacing `fields` wholesale silently un-fixed a value a person had
      // explicitly fixed, leaving it visible only in the history.
      expect(after.document.fields.find((f) => f.key === 'invoiceNumber')?.value).toBe('INV-CORRECTED');
      expect(after.document.fields.find((f) => f.key === 'invoiceNumber')?.corrected).toBe(true);
    });

    it('a reader who cannot open the target module sees no link, not just no candidate', async () => {
      const crm = stores.get('crm-customers')!;
      // The stored title differs from the text on the document on purpose:
      // "Borealis Trading" is in the file and the reader may see it, while
      // "Pvt Ltd" exists only in the CRM record they cannot open.
      const customer = crm.create({
        title: 'Borealis Trading Pvt Ltd',
        fields: { name: 'Borealis Trading Pvt Ltd' },
        actor: ACTOR,
        now: T0,
      });
      await crm.flush();

      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await call(IpcChannel.DocumentLink, {
        documentId: document.id,
        moduleId: 'crm-customers',
        recordId: customer.id,
        relationship: 'Invoice for this customer',
        basis: 'Bill To matches.',
      });

      granted.delete('crm:read');
      const view = await detail(document.id);
      /**
       * `candidates` were gated and `links` were not, so a confirmed link
       * handed back `recordTitle` — the customer's name — to an actor with
       * `data:read` and nothing else. A confirmed link is not less sensitive
       * than a proposed one.
       */
      expect(view.document.links).toHaveLength(0);
      const listed = (await call(IpcChannel.DocumentList, {})) as DocumentSummary[];
      expect(listed[0]?.linkCount).toBe(0);
      // …and the stored name cannot be confirmed through the search box
      // either. Searching the text that IS on the document still works — the
      // reader is allowed to read the document.
      const probe = (await call(IpcChannel.DocumentList, { search: 'Pvt Ltd' })) as DocumentSummary[];
      expect(probe).toHaveLength(0);
      const legitimate = (await call(IpcChannel.DocumentList, { search: 'Borealis' })) as DocumentSummary[];
      expect(legitimate).toHaveLength(1);
    });

    it('the cap never evicts a document a business record still cites', async () => {
      const crm = stores.get('crm-customers')!;
      const customer = crm.create({
        title: 'Borealis Trading',
        fields: { name: 'Borealis Trading' },
        actor: ACTOR,
        now: T0,
      });
      await crm.flush();

      const { document } = await upload('invoice.txt', Buffer.from(INVOICE_TEXT, 'utf8'));
      await call(IpcChannel.DocumentLink, {
        documentId: document.id,
        moduleId: 'crm-customers',
        recordId: customer.id,
        relationship: 'Invoice for this customer',
        basis: 'Bill To matches.',
      });

      /**
       * `documents:delete` refuses to remove a linked document. Eviction went
       * around that guard entirely: the oldest record fell off the end, taking
       * the link with it and orphaning its bytes forever.
       */
      const { MAX_DOCUMENTS_FOR_TEST } = await import('./documentStore');
      for (let i = 0; i < MAX_DOCUMENTS_FOR_TEST + 5; i += 1) {
        await upload(`filler-${i}.txt`, Buffer.from(`filler ${i}`, 'utf8'));
      }

      expect(sub.store.get(document.id), 'the linked document was evicted').not.toBeNull();
      expect(sub.store.get(document.id)!.links).toHaveLength(1);
    });

    it('removing a document removes its bytes, unless another record shares them', async () => {
      const { document } = await upload('a.txt', Buffer.from('shared content', 'utf8'));
      expect(await sub.store.bytes(document.id)).not.toBeNull();

      const removed = (await call(IpcChannel.DocumentDelete, { documentId: document.id })) as {
        removed: boolean;
      };
      expect(removed.removed).toBe(true);
      expect(sub.store.get(document.id)).toBeNull();
      // The blob is gone with it — otherwise `documents/` grows by every file
      // ever uploaded and nothing ever points at them again.
      const orphans = await fs.readdir(join(dir, 'documents')).catch(() => []);
      expect(orphans).toHaveLength(0);
    });
  });
});
