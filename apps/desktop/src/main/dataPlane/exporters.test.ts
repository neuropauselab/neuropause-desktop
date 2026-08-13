/**
 * Phase 6 — export tests.
 *
 * The central assertion is a ROUND TRIP: every format this product writes is
 * read back by the product's own parser and must yield the same values. An
 * export the importer cannot read is a defect, and this is where it surfaces —
 * not on a customer's machine.
 */
import { describe, expect, it } from 'vitest';
import { parseFile } from './parsers';
import { openZip } from './zipReader';
import {
  buildExport,
  safeSheetName,
  toCsv,
  toJson,
  toXlsx,
  type ExportTable,
} from './exporters';

const TABLE: ExportTable = {
  name: 'Customers',
  columns: [
    { key: 'name', label: 'Customer Name' },
    { key: 'email', label: 'Email' },
    { key: 'credit', label: 'Credit Limit' },
    { key: 'active', label: 'Active' },
    { key: 'notes', label: 'Notes' },
  ],
  rows: [
    { name: 'Acme Pvt. Ltd.', email: 'ops@acme.example', credit: 250000, active: true, notes: null },
    { name: 'Ørsted A/S', email: 'hei@orsted.example', credit: 1200.5, active: false, notes: 'Prefers "net 30"' },
    { name: 'Comma, Inc.', email: 'x@comma.example', credit: 0, active: true, notes: 'Line one\nline two' },
  ],
};

const TEXT = (v: unknown): string => String(v ?? '');

describe('CSV export', () => {
  it('writes a header row from the labels, not the field keys', () => {
    const csv = toCsv(TABLE).toString('utf8');
    expect(csv.split('\r\n')[0]).toBe('\uFEFFCustomer Name,Email,Credit Limit,Active,Notes');
  });

  it('leads with a UTF-8 BOM so Excel does not mangle non-ASCII names', () => {
    const bytes = toCsv(TABLE);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('quotes exactly the values RFC-4180 requires and doubles inner quotes', () => {
    const csv = toCsv(TABLE).toString('utf8');
    expect(csv).toContain('"Comma, Inc."');
    expect(csv).toContain('"Prefers ""net 30"""');
    expect(csv).toContain('"Line one\nline two"');
  });

  it('writes an empty cell for null — never the word "null"', () => {
    const csv = toCsv(TABLE).toString('utf8');
    expect(csv).not.toContain('null');
    expect(csv.split('\r\n')[1]?.endsWith(',')).toBe(true);
  });

  it('round-trips through our own parser with the same values', () => {
    const doc = parseFile('customers.csv', toCsv(TABLE));
    const table = doc.tables[0];
    expect(table).toBeDefined();
    expect(table?.headers).toEqual(['Customer Name', 'Email', 'Credit Limit', 'Active', 'Notes']);
    expect(table?.rows).toHaveLength(3);
    expect(TEXT(table?.rows[0]?.[0])).toBe('Acme Pvt. Ltd.');
    expect(TEXT(table?.rows[1]?.[0])).toBe('Ørsted A/S');
    expect(TEXT(table?.rows[2]?.[0])).toBe('Comma, Inc.');
    expect(TEXT(table?.rows[2]?.[4])).toBe('Line one\nline two');
  });
});

describe('JSON export', () => {
  it('keys by the stable field key, because JSON is the machine-facing format', () => {
    const parsed = JSON.parse(toJson(TABLE).toString('utf8')) as Record<string, unknown>[];
    expect(Object.keys(parsed[0] ?? {})).toEqual(['name', 'email', 'credit', 'active', 'notes']);
  });

  it('preserves types rather than stringifying everything', () => {
    const parsed = JSON.parse(toJson(TABLE).toString('utf8')) as Record<string, unknown>[];
    expect(parsed[0]?.credit).toBe(250000);
    expect(parsed[0]?.active).toBe(true);
    expect(parsed[0]?.notes).toBeNull();
  });

  it('round-trips through our own parser', () => {
    const doc = parseFile('customers.json', toJson(TABLE));
    const table = doc.tables[0];
    expect(table?.rows).toHaveLength(3);
    expect(table?.headers).toContain('name');
  });
});

describe('XLSX export', () => {
  it('is a real OOXML package, not a zip of loose XML', () => {
    const zip = openZip(toXlsx(TABLE));
    const names = zip.entries.map((e) => e.name);
    // Every one of these is required for Excel to open the file without
    // offering to "repair" it — which a user reads as data corruption.
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('_rels/.rels');
    expect(names).toContain('xl/workbook.xml');
    expect(names).toContain('xl/_rels/workbook.xml.rels');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(names).toContain('xl/styles.xml');
    expect(names).toContain('xl/sharedStrings.xml');
  });

  it('declares an Override content type for every non-default part', () => {
    const types = openZip(toXlsx(TABLE)).text('[Content_Types].xml') ?? '';
    for (const part of ['/xl/workbook.xml', '/xl/worksheets/sheet1.xml', '/xl/styles.xml', '/xl/sharedStrings.xml']) {
      expect(types).toContain(`PartName="${part}"`);
    }
    expect(types).toContain('Extension="rels"');
  });

  it('points the workbook at the worksheet through a fully-qualified relationship', () => {
    const rels = openZip(toXlsx(TABLE)).text('xl/_rels/workbook.xml.rels') ?? '';
    expect(rels).toContain('http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet');
    expect(rels).toContain('Target="worksheets/sheet1.xml"');
  });

  it('declares fonts, fills and borders so the styles part is valid', () => {
    const styles = openZip(toXlsx(TABLE)).text('xl/styles.xml') ?? '';
    expect(styles).toContain('<fonts');
    expect(styles).toContain('<fills');
    expect(styles).toContain('<borders');
    expect(styles).toContain('<cellStyleXfs');
    expect(styles).toContain('<cellXfs');
  });

  it('round-trips through our own parser with the same values and types', () => {
    const doc = parseFile('customers.xlsx', toXlsx(TABLE));
    const table = doc.tables[0];
    expect(table?.name).toBe('Customers');
    expect(table?.headers).toEqual(['Customer Name', 'Email', 'Credit Limit', 'Active', 'Notes']);
    expect(table?.rows).toHaveLength(3);
    expect(TEXT(table?.rows[0]?.[0])).toBe('Acme Pvt. Ltd.');
    expect(table?.rows[0]?.[2]).toBe(250000);
    expect(TEXT(table?.rows[1]?.[0])).toBe('Ørsted A/S');
    expect(table?.rows[1]?.[2]).toBe(1200.5);
  });

  it('escapes markup in values instead of producing broken XML', () => {
    const doc = parseFile(
      'x.xlsx',
      toXlsx({
        name: 'Odd',
        columns: [
          { key: 'a', label: 'A & B' },
          { key: 'b', label: 'Note' },
        ],
        rows: [
          { a: '<script>alert("x")</script> & more', b: 'one' },
          { a: 'plain', b: 'two' },
        ],
      }),
    );
    expect(TEXT(doc.tables[0]?.headers[0])).toBe('A & B');
    expect(TEXT(doc.tables[0]?.rows[0]?.[0])).toBe('<script>alert("x")</script> & more');
  });

  it('drops control characters XML cannot represent rather than writing an unreadable file', () => {
    const doc = parseFile(
      'x.xlsx',
      toXlsx({
        name: 'Odd',
        columns: [
          { key: 'a', label: 'Value' },
          { key: 'b', label: 'Note' },
        ],
        rows: [
          { a: 'bad\u0000value\u0007here', b: 'one' },
          { a: 'clean', b: 'two' },
        ],
      }),
    );
    expect(TEXT(doc.tables[0]?.rows[0]?.[0])).toBe('badvaluehere');
  });

  it('survives a large export without truncating rows', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ a: `Name ${i}`, b: i }));
    const doc = parseFile(
      'big.xlsx',
      toXlsx({
        name: 'Big',
        columns: [
          { key: 'a', label: 'Name' },
          { key: 'b', label: 'Value' },
        ],
        rows,
      }),
    );
    expect(doc.tables[0]?.rows).toHaveLength(2000);
    expect(doc.tables[0]?.rows[1999]?.[1]).toBe(1999);
  });

  it('handles a table wider than 26 columns (the AA boundary)', () => {
    const columns = Array.from({ length: 30 }, (_, i) => ({ key: `c${i}`, label: `Col ${i}` }));
    const row: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) row[`c${i}`] = `v${i}`;
    const doc = parseFile('wide.xlsx', toXlsx({ name: 'Wide', columns, rows: [row] }));
    expect(doc.tables[0]?.headers).toHaveLength(30);
    expect(TEXT(doc.tables[0]?.rows[0]?.[29])).toBe('v29');
  });
});

describe('safeSheetName', () => {
  it('removes the characters Excel forbids in a sheet name', () => {
    expect(safeSheetName('Sales/Q1: [2026]?')).toBe('Sales Q1   2026');
  });

  it('truncates at 31 characters, Excel’s hard limit', () => {
    expect(safeSheetName('x'.repeat(60))).toHaveLength(31);
  });

  it('falls back rather than producing an unopenable empty name', () => {
    expect(safeSheetName('  ')).toBe('Sheet1');
    expect(safeSheetName('///')).toBe('Sheet1');
  });
});

describe('buildExport', () => {
  it('names the file after the data and the day it was taken', () => {
    const artifact = buildExport(TABLE, 'csv', '2026-08-08T10:00:00.000Z');
    expect(artifact.filename).toBe('customers-2026-08-08.csv');
    expect(artifact.records).toBe(3);
    expect(artifact.format).toBe('csv');
  });

  it('produces a filesystem-safe name from an awkward module title', () => {
    const artifact = buildExport({ ...TABLE, name: 'AR / AP Aging (₹)' }, 'json', '2026-08-08T10:00:00.000Z');
    expect(artifact.filename).toBe('ar-ap-aging-2026-08-08.json');
  });

  it('exports an empty table as a header-only file rather than failing', () => {
    const artifact = buildExport({ ...TABLE, rows: [] }, 'csv', '2026-08-08T10:00:00.000Z');
    expect(artifact.records).toBe(0);
    expect(artifact.content.toString('utf8')).toContain('Customer Name');
  });
});
