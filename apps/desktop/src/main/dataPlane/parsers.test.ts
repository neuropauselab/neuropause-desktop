/**
 * Phase 6 — Universal Data Plane: parser locks.
 *
 * Exercises the REAL formats (genuine ZIP/deflate/shared-strings/date-style
 * bytes built by testFixtures), the RFC-4180 edge cases that break naive CSV
 * splitters, and — most importantly — that unreadable and unsupported input
 * fails honestly instead of returning an empty success.
 */
import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  excelSerialToIso,
  columnRefToIndex,
  parseDelimited,
  parseFile,
  sniffDelimiter,
  toTable,
  detectHeaderRow,
  MAX_ROWS_PER_TABLE,
} from './parsers';
import { listZipEntries, openZip, ZipError, looksLikeZip } from './zipReader';
import { buildDocx, buildXlsx, buildZip } from './testFixtures';
import { decodeXml, eachElement, parseAttrs } from './xmlScanner';

describe('zipReader', () => {
  it('round-trips a real deflate archive', () => {
    const zip = buildZip([
      { name: 'a.txt', content: 'hello world' },
      { name: 'nested/b.xml', content: '<root>ok</root>' },
    ]);
    expect(looksLikeZip(zip)).toBe(true);
    const entries = listZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'nested/b.xml']);
    const archive = openZip(zip);
    expect(archive.text('a.txt')).toBe('hello world');
    expect(archive.text('nested/b.xml')).toBe('<root>ok</root>');
    expect(archive.text('missing.txt')).toBeNull();
  });

  it('refuses a file that is not an archive', () => {
    expect(() => listZipEntries(Buffer.from('definitely not a zip'))).toThrow(ZipError);
  });

  it('refuses a truncated archive rather than returning partial entries', () => {
    const zip = buildZip([{ name: 'a.txt', content: 'x'.repeat(200) }]);
    expect(() => listZipEntries(zip.subarray(0, zip.length - 10))).toThrow(ZipError);
  });
});

describe('xmlScanner', () => {
  it('decodes the five entities and numeric references', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &#65; &#x42;')).toBe('a & b <c> A B');
  });

  it('parses attributes in both quote styles', () => {
    expect(parseAttrs(' r="A1" t=\'s\' s="2"')).toEqual({ r: 'A1', t: 's', s: '2' });
  });

  it('iterates elements including self-closing ones', () => {
    const seen: string[] = [];
    eachElement('<c r="A1"><v>1</v></c><c r="B1"/><c r="C1"><v>3</v></c>', 'c', (el) => {
      seen.push(`${el.attrs.r ?? '?'}:${el.inner}`);
    });
    expect(seen).toEqual(['A1:<v>1</v>', 'B1:', 'C1:<v>3</v>']);
  });
});

describe('XLSX', () => {
  const workbook = buildXlsx([
    {
      name: 'Customers',
      rows: [
        ['Customer Name', 'Email', 'Credit Limit', 'Created On'],
        ['ABC Industries Pvt Ltd', 'ops@abc.example', 250000, { date: '2025-04-01' }],
        ['Northwind Trading', 'hi@northwind.example', 100000, { date: '2025-05-12' }],
      ],
    },
    {
      name: 'Notes',
      rows: [['Internal migration notes'], ['Exported from the legacy system']],
    },
  ]);

  it('detects the format from magic bytes, not just the extension', () => {
    expect(detectFormat('anything.bin', workbook)).toBe('xlsx');
  });

  it('reads every sheet, resolving shared strings', () => {
    const doc = parseFile('company.xlsx', workbook);
    expect(doc.kind).toBe('tabular');
    expect(doc.tables.map((t) => t.name)).toEqual(['Customers', 'Notes']);
    const customers = doc.tables[0];
    expect(customers?.headers).toEqual(['Customer Name', 'Email', 'Credit Limit', 'Created On']);
    expect(customers?.rows).toHaveLength(2);
    expect(customers?.rows[0]?.[0]).toBe('ABC Industries Pvt Ltd');
  });

  it('converts date-styled serials to ISO dates and keeps numbers numeric', () => {
    const doc = parseFile('company.xlsx', workbook);
    const row = doc.tables[0]?.rows[0];
    expect(row?.[2]).toBe(250000); // number stays a number
    expect(row?.[3]).toBe('2025-04-01'); // serial + date style → ISO
  });

  it('synthesizes column names when a sheet has no header row', () => {
    const doc = parseFile('company.xlsx', workbook);
    const notes = doc.tables[1];
    expect(notes?.headerRowIndex).toBeNull();
    expect(notes?.headers).toEqual(['column_1']);
    expect(notes?.rows).toHaveLength(2);
  });

  it('maps Excel serials and column refs correctly', () => {
    expect(excelSerialToIso(45748)).toBe('2025-04-01');
    expect(columnRefToIndex('A')).toBe(0);
    expect(columnRefToIndex('Z')).toBe(25);
    expect(columnRefToIndex('AA')).toBe(26);
    expect(columnRefToIndex('AB12')).toBe(27);
  });
});

describe('delimited text', () => {
  it('handles quotes, embedded delimiters and embedded newlines', () => {
    const csv = 'name,note\n"Acme, Inc.","line one\nline two"\n"He said ""hi""",plain\n';
    const rows = parseDelimited(csv, ',');
    expect(rows[1]).toEqual(['Acme, Inc.', 'line one\nline two']);
    expect(rows[2]).toEqual(['He said "hi"', 'plain']);
  });

  it('strips a UTF-8 BOM so the first header is not corrupted', () => {
    const rows = parseDelimited('﻿id,name\n1,x\n', ',');
    expect(rows[0]).toEqual(['id', 'name']);
  });

  it('sniffs the delimiter', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n')).toBe(',');
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
    expect(sniffDelimiter('a;b;c\n1;2;3\n')).toBe(';');
  });

  it('parses a CSV file end to end', () => {
    const doc = parseFile('customers.csv', Buffer.from('Customer Name,Email\nAcme,ops@acme.example\n', 'utf8'));
    expect(doc.format).toBe('csv');
    expect(doc.tables[0]?.headers).toEqual(['Customer Name', 'Email']);
    expect(doc.tables[0]?.rows[0]).toEqual(['Acme', 'ops@acme.example']);
  });
});

describe('header detection', () => {
  it('finds the header even when preceded by title rows', () => {
    const grid = [['Quarterly export'], [], ['Invoice No', 'Amount'], ['INV-1', 100]];
    expect(detectHeaderRow(grid)).toBe(2);
  });

  it('refuses to treat a trailing label row as a header', () => {
    expect(detectHeaderRow([['Invoice No', 'Amount']])).toBeNull();
  });

  it('disambiguates duplicate header names', () => {
    const table = toTable('t', [
      ['Name', 'Name', 'Total'],
      ['a', 'b', 1],
    ]);
    expect(table.headers).toEqual(['Name', 'Name_2', 'Total']);
  });
});

describe('JSON and XML', () => {
  it('turns an array of objects into a table', () => {
    const doc = parseFile(
      'customers.json',
      Buffer.from(JSON.stringify({ customers: [{ name: 'Acme', email: 'a@b.example' }] }), 'utf8'),
    );
    expect(doc.tables[0]?.name).toBe('customers');
    expect(doc.tables[0]?.headers).toEqual(['name', 'email']);
  });

  it('reports invalid JSON honestly rather than returning empty success', () => {
    const doc = parseFile('bad.json', Buffer.from('{ not json', 'utf8'));
    expect(doc.kind).toBe('unsupported');
    expect(doc.unsupportedReason).toMatch(/Invalid JSON/);
  });

  it('extracts repeated XML elements as records', () => {
    const xml = '<rows><row id="1"><name>A</name></row><row id="2"><name>B</name></row></rows>';
    const doc = parseFile('data.xml', Buffer.from(xml, 'utf8'));
    expect(doc.tables[0]?.rows).toHaveLength(2);
    expect(doc.tables[0]?.headers).toContain('name');
  });
});

describe('DOCX', () => {
  it('extracts paragraph text', () => {
    const doc = parseFile('note.docx', buildDocx(['Contract summary', 'Party: Acme']));
    expect(doc.format).toBe('docx');
    expect(doc.kind).toBe('text');
    expect(doc.text).toContain('Contract summary');
    expect(doc.text).toContain('Party: Acme');
  });
});

describe('unsupported and malformed input fails honestly', () => {
  it('names PDF as unimplemented rather than returning nothing', () => {
    const doc = parseFile('report.pdf', Buffer.from('%PDF-1.7\nbinary', 'utf8'));
    expect(doc.kind).toBe('unsupported');
    expect(doc.unsupportedReason).toMatch(/PDF/i);
    expect(doc.tables).toHaveLength(0);
  });

  it('names OCR as an external dependency for images', () => {
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1')]);
    const doc = parseFile('scan.png', png);
    expect(doc.kind).toBe('unsupported');
    expect(doc.unsupportedReason).toMatch(/OCR/i);
  });

  it('reports a corrupt xlsx instead of throwing', () => {
    const corrupt = Buffer.concat([Buffer.from('PK'), Buffer.from('garbage'.repeat(20))]);
    const doc = parseFile('broken.xlsx', corrupt);
    expect(doc.kind).toBe('unsupported');
    expect(doc.tables).toHaveLength(0);
    expect(doc.unsupportedReason).toBeTruthy();
  });

  it('handles an empty file without crashing', () => {
    const doc = parseFile('empty.csv', Buffer.alloc(0));
    expect(doc.tables.length === 0 || doc.tables[0]?.rows.length === 0).toBe(true);
  });
});

describe('scale', () => {
  it('parses a 20k-row CSV and keeps values intact', () => {
    const lines = ['SKU,Product Name,Unit Price'];
    for (let i = 0; i < 20_000; i += 1) lines.push(`SKU-${i},Widget ${i},${i * 2}`);
    const doc = parseFile('big.csv', Buffer.from(lines.join('\n'), 'utf8'));
    const table = doc.tables[0];
    expect(table?.rows).toHaveLength(20_000);
    expect(table?.truncated).toBe(false);
    expect(table?.rows[19_999]?.[0]).toBe('SKU-19999');
  });

  it('has a row ceiling so a runaway file cannot exhaust memory', () => {
    expect(MAX_ROWS_PER_TABLE).toBeLessThanOrEqual(1_000_000);
  });
});
