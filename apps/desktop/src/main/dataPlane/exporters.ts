/**
 * Phase 6 — Universal Enterprise Data Plane: export.
 *
 * The inverse of ingestion: take real records out of an enterprise module in a
 * format a person can open. Pure functions over plain rows — no Electron, no
 * filesystem — so the whole surface is testable, and the same bytes that reach
 * disk are the bytes the tests assert on.
 *
 * The strong correctness property here is the ROUND TRIP: everything this file
 * writes is read back by our own `parseFile`, so an export that this product
 * could not itself re-import is a test failure rather than a support ticket.
 */
import type { EnterpriseFieldValue } from '@neuropause/shared';
import { buildZip, type ZipEntry } from './zipWriter';

export type ExportFormat = 'csv' | 'xlsx' | 'json';

export interface ExportColumn {
  key: string;
  label: string;
}

export type ExportCell = EnterpriseFieldValue;

export interface ExportTable {
  /** Sheet name for xlsx; ignored by csv and json. */
  name: string;
  columns: readonly ExportColumn[];
  rows: readonly Record<string, ExportCell>[];
}

/** Characters XML 1.0 cannot represent at all — dropped rather than smuggled. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function xmlText(value: string): string {
  return value
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function xmlAttr(value: string): string {
  return xmlText(value).replace(/"/g, '&quot;');
}

/** Render a cell for a text-based format. `null` becomes empty, never "null". */
function asText(value: ExportCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * RFC-4180 with CRLF line endings and a UTF-8 BOM.
 *
 * The BOM is not decoration: without it Excel on both macOS and Windows opens a
 * UTF-8 CSV as the local codepage, and every non-ASCII name in the file is
 * mangled on arrival. Our own parser strips it on the way back in.
 */
export function toCsv(table: ExportTable): Buffer {
  const escape = (raw: string): string =>
    /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;

  const lines: string[] = [table.columns.map((c) => escape(c.label)).join(',')];
  for (const row of table.rows) {
    lines.push(table.columns.map((c) => escape(asText(row[c.key] ?? null))).join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * An array of objects keyed by FIELD KEY, not by label.
 *
 * JSON is the machine-facing format, so it carries the stable identifier a
 * script can rely on; CSV and XLSX carry the human label.
 */
export function toJson(table: ExportTable): Buffer {
  const out = table.rows.map((row) => {
    const record: Record<string, ExportCell> = {};
    for (const col of table.columns) record[col.key] = row[col.key] ?? null;
    return record;
  });
  return Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_TYPE = `${NS_REL_DOC}/officeDocument`;
const REL_SHEET = `${NS_REL_DOC}/worksheet`;
const REL_STYLES = `${NS_REL_DOC}/styles`;
const REL_STRINGS = `${NS_REL_DOC}/sharedStrings`;

/** Excel's sheet-name rules. A name Excel rejects makes the whole file unopenable. */
export function safeSheetName(name: string, fallback = 'Sheet1'): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned.length === 0 ? fallback : cleaned;
}

function columnRef(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * A single-sheet workbook Excel opens without a repair prompt.
 *
 * Excel is strict in ways a ZIP-of-XML does not suggest: it wants the package
 * relationships part, an Override content type for every non-default part, and
 * a styles part that actually declares fonts, fills and borders. A "minimal"
 * workbook that omits any of those opens with a repair dialog, which reads to a
 * user as data corruption. So this writes the whole package.
 */
export function toXlsx(table: ExportTable): Buffer {
  const sheetName = safeSheetName(table.name);

  // Shared strings: every text value interned once, which is both the format's
  // convention and a large size win on real exports with repeated categories.
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const intern = (s: string): number => {
    const existing = sharedIndex.get(s);
    if (existing !== undefined) return existing;
    const idx = shared.length;
    shared.push(s);
    sharedIndex.set(s, idx);
    return idx;
  };

  const cellXml = (ref: string, value: ExportCell, headerRow: boolean): string => {
    const style = headerRow ? ' s="1"' : '';
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}"${style}><v>${value}</v></c>`;
    }
    if (typeof value === 'boolean') {
      return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
    }
    const text = asText(value);
    if (text.length === 0) return '';
    return `<c r="${ref}"${style} t="s"><v>${intern(text)}</v></c>`;
  };

  const rowsXml: string[] = [];
  rowsXml.push(
    `<row r="1">${table.columns
      .map((c, i) => cellXml(`${columnRef(i)}1`, c.label, true))
      .join('')}</row>`,
  );
  table.rows.forEach((row, r) => {
    const cells = table.columns
      .map((c, i) => cellXml(`${columnRef(i)}${r + 2}`, row[c.key] ?? null, false))
      .join('');
    rowsXml.push(`<row r="${r + 2}">${cells}</row>`);
  });

  const lastCol = columnRef(Math.max(table.columns.length - 1, 0));
  const dimension = `A1:${lastCol}${table.rows.length + 1}`;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    `</worksheet>`;

  const sharedXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="${NS_MAIN}" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t xml:space="preserve">${xmlText(s)}</t></si>`).join('') +
    `</sst>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const parts: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL_TYPE}" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}">` +
        `<sheets><sheet name="${xmlAttr(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
        `</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${NS_PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL_SHEET}" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL_STYLES}" Target="styles.xml"/>` +
        `<Relationship Id="rId3" Type="${REL_STRINGS}" Target="sharedStrings.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/sharedStrings.xml', content: sharedXml },
  ];

  return buildZip(parts);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ExportArtifact {
  content: Buffer;
  /** Suggested filename including extension. */
  filename: string;
  format: ExportFormat;
  records: number;
}

/** Filesystem-safe, lowercase, no spaces — a filename a person can retype. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  );
}

export function buildExport(table: ExportTable, format: ExportFormat, dateIso: string): ExportArtifact {
  const day = dateIso.slice(0, 10);
  const filename = `${slug(table.name)}-${day}.${format}`;
  const content = format === 'csv' ? toCsv(table) : format === 'json' ? toJson(table) : toXlsx(table);
  return { content, filename, format, records: table.rows.length };
}
