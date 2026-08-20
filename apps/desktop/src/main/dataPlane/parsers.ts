/**
 * Phase 6 — Universal Enterprise Data Plane: format parsers.
 *
 * Zero runtime dependencies. XLSX and DOCX are read through the local ZIP
 * reader + XML scanner; CSV/TSV is a real RFC-4180 parser (quoted fields,
 * embedded delimiters and newlines, doubled quotes); JSON and XML are handled
 * structurally.
 *
 * Formats we cannot honestly parse — PDF, images (OCR), legacy .xls — are
 * reported as `unsupported` with a named reason. They are never guessed at and
 * never silently produce an empty result that reads like success.
 */
import { openZip, looksLikeZip, ZipError } from './zipReader';
import { eachElement, decodeXml, textOf, stripTags } from './xmlScanner';
import { extractTallyVouchers, foldBankStatementTable } from './aggregations';

export type CellValue = string | number | boolean | null;

export type SourceFormat =
  | 'xlsx'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'xml'
  | 'docx'
  | 'txt'
  | 'pdf'
  | 'image'
  | 'unknown';

/** Formats this build can actually read. Anything else is declared, not attempted. */
export const SUPPORTED_FORMATS: readonly SourceFormat[] = ['xlsx', 'csv', 'tsv', 'json', 'xml', 'docx', 'txt'];

/** Row ceiling per table. Beyond this we stop and flag `truncated` rather than exhaust memory. */
export const MAX_ROWS_PER_TABLE = 200_000;

export interface ParsedTable {
  /** Sheet name, JSON pointer, or a synthesized name. */
  name: string;
  headers: string[];
  /** Data rows only — the header row is excluded. */
  rows: CellValue[][];
  /** Zero-based index of the header row in the SOURCE, for provenance. Null when synthesized. */
  headerRowIndex: number | null;
  /** Source row index of `rows[0]`, so provenance can name the true spreadsheet row. */
  firstDataRowIndex: number;
  truncated: boolean;
}

export interface ParsedDocument {
  format: SourceFormat;
  kind: 'tabular' | 'text' | 'unsupported';
  tables: ParsedTable[];
  text: string | null;
  warnings: string[];
  /** Present only when kind === 'unsupported'. */
  unsupportedReason?: string;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

const EXT_FORMAT: Record<string, SourceFormat> = {
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
  json: 'json',
  xml: 'xml',
  docx: 'docx',
  txt: 'txt',
  md: 'txt',
  log: 'txt',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  tif: 'image',
  tiff: 'image',
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Decide the format from the filename and the magic bytes. Magic bytes win over
 * the extension for container formats — a mislabeled `.xlsx` that is really a
 * CSV should not be handed to the ZIP reader.
 */
export function detectFormat(filename: string, buf: Buffer): SourceFormat {
  const byExt = EXT_FORMAT[extensionOf(filename)] ?? 'unknown';

  if (looksLikeZip(buf)) {
    // OOXML containers. Distinguish by the parts they carry.
    try {
      const zip = openZip(buf);
      if (zip.find((n) => n.startsWith('xl/')).length > 0) return 'xlsx';
      if (zip.has('word/document.xml')) return 'docx';
    } catch {
      // Not a readable archive — fall through to the extension.
    }
    return byExt === 'xlsx' || byExt === 'docx' ? byExt : 'unknown';
  }

  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image';
  // Legacy .xls (OLE compound file) — detected so we can refuse it by name.
  if (buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0) return 'unknown';

  return byExt;
}

// ---------------------------------------------------------------------------
// Delimited text (CSV / TSV) — RFC 4180
// ---------------------------------------------------------------------------

/** Split delimited text into raw rows, honouring quotes, doubled quotes and embedded newlines. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  // Strip a UTF-8 BOM — Excel writes one and it corrupts the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      sawAny = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      sawAny = true;
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAny = false;
      continue;
    }
    field += ch;
    sawAny = true;
  }
  if (field !== '' || sawAny || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Infer the delimiter by which candidate yields the most consistent column count. */
export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const rows = parseDelimited(sample, d).slice(0, 20).filter((r) => r.length > 0);
    if (rows.length === 0) continue;
    const widths = rows.map((r) => r.length);
    const max = Math.max(...widths);
    if (max < 2) continue;
    const consistent = widths.filter((w) => w === max).length / widths.length;
    const score = max * consistent;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Header detection + table assembly
// ---------------------------------------------------------------------------

function isBlankRow(row: readonly CellValue[]): boolean {
  return row.every((c) => c === null || c === '' || (typeof c === 'string' && c.trim() === ''));
}

/**
 * Pick the header row: the first non-blank row whose cells are predominantly
 * short, distinct, non-numeric labels and which is followed by data. Returns
 * null when no row looks like a header (the caller then synthesizes names).
 */
export function detectHeaderRow(rows: readonly (readonly CellValue[])[]): number | null {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;
    const cells = row.filter((c) => c !== null && String(c).trim() !== '');
    if (cells.length < 2) continue;
    const textual = cells.filter((c) => typeof c === 'string' && !isNumericText(String(c)));
    const distinct = new Set(cells.map((c) => String(c).trim().toLowerCase())).size;
    const short = cells.filter((c) => String(c).trim().length <= 60).length;
    // Duplicate column names are common in real exports (two "Amount" columns);
    // `uniqueHeaders` disambiguates them, so requiring *total* distinctness here
    // would discard a genuine header row and silently import it as data.
    const looksHeader =
      textual.length >= Math.ceil(cells.length * 0.6) &&
      distinct >= Math.max(2, Math.ceil(cells.length * 0.6)) &&
      short === cells.length;
    if (!looksHeader) continue;
    // Must be followed by at least one non-blank row to be a header rather than a title.
    for (let j = i + 1; j < rows.length; j += 1) {
      const next = rows[j];
      if (next && !isBlankRow(next)) return i;
    }
    return null;
  }
  return null;
}

function isNumericText(s: string): boolean {
  const t = s.trim();
  if (t === '') return false;
  return /^[-+]?[\d,]*\.?\d+(?:[eE][-+]?\d+)?$/.test(t);
}

function uniqueHeaders(raw: readonly CellValue[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((cell, idx) => {
    let base = cell === null ? '' : String(cell).trim();
    if (base === '') base = `column_${idx + 1}`;
    const prior = seen.get(base.toLowerCase());
    if (prior === undefined) {
      seen.set(base.toLowerCase(), 1);
      return base;
    }
    seen.set(base.toLowerCase(), prior + 1);
    return `${base}_${prior + 1}`;
  });
}

/** Turn a raw grid into a table with headers, dropping fully-blank rows. */
export function toTable(name: string, grid: readonly (readonly CellValue[])[]): ParsedTable {
  const headerIdx = detectHeaderRow(grid);
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);

  const headerCells: CellValue[] =
    headerIdx === null
      ? Array.from({ length: width }, (_, i) => `column_${i + 1}`)
      : [...(grid[headerIdx] ?? [])];
  while (headerCells.length < width) headerCells.push(null);
  const headers = uniqueHeaders(headerCells);

  const firstData = headerIdx === null ? 0 : headerIdx + 1;
  const rows: CellValue[][] = [];
  let truncated = false;
  for (let i = firstData; i < grid.length; i += 1) {
    const src = grid[i];
    if (!src || isBlankRow(src)) continue;
    if (rows.length >= MAX_ROWS_PER_TABLE) {
      truncated = true;
      break;
    }
    const row: CellValue[] = [];
    for (let c = 0; c < headers.length; c += 1) row.push(src[c] ?? null);
    rows.push(row);
  }

  return { name, headers, rows, headerRowIndex: headerIdx, firstDataRowIndex: firstData, truncated };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** Built-in numeric formats that denote a date/time (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** Convert an Excel serial date to an ISO string. Handles the 1900 leap-year artifact. */
export function excelSerialToIso(serial: number): string {
  const ms = EXCEL_EPOCH_UTC + Math.round(serial * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const hasTime = Math.abs(serial - Math.floor(serial)) > 1e-9;
  return hasTime ? d.toISOString() : d.toISOString().slice(0, 10);
}

/** Column reference ("A", "AB") → zero-based index. */
export function columnRefToIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

interface XlsxStyles {
  /** cellXfs index → true when the format is a date. */
  dateXf: boolean[];
}

function parseStyles(xml: string | null): XlsxStyles {
  if (!xml) return { dateXf: [] };
  const customDate = new Set<number>();
  eachElement(xml, 'numFmt', (el) => {
    const id = Number(el.attrs.numFmtId);
    const code = el.attrs.formatCode ?? '';
    // A format is a date format if it carries date tokens outside literal quotes.
    const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    if (Number.isFinite(id) && /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare)) customDate.add(id);
  });

  const dateXf: boolean[] = [];
  // Only the cellXfs block maps style index → numFmtId.
  const cellXfsStart = xml.indexOf('<cellXfs');
  if (cellXfsStart !== -1) {
    const end = xml.indexOf('</cellXfs>', cellXfsStart);
    const block = xml.slice(cellXfsStart, end === -1 ? undefined : end);
    eachElement(block, 'xf', (el) => {
      const id = Number(el.attrs.numFmtId ?? '0');
      dateXf.push(BUILTIN_DATE_FORMATS.has(id) || customDate.has(id));
    });
  }
  return { dateXf };
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  eachElement(xml, 'si', (el) => {
    // `<si>` is either a single `<t>` or a set of rich-text `<r><t>` runs.
    out.push(textOf(el.inner, 't'));
  });
  return out;
}

interface SheetRef {
  name: string;
  path: string;
}

function resolveSheets(zip: ReturnType<typeof openZip>): SheetRef[] {
  const workbook = zip.text('xl/workbook.xml');
  if (!workbook) return [];
  const rels = zip.text('xl/_rels/workbook.xml.rels') ?? '';
  const relTarget = new Map<string, string>();
  eachElement(rels, 'Relationship', (el) => {
    const id = el.attrs.Id;
    const target = el.attrs.Target;
    if (id && target) relTarget.set(id, target);
  });

  const sheets: SheetRef[] = [];
  eachElement(workbook, 'sheet', (el) => {
    const name = el.attrs.name ?? `Sheet${sheets.length + 1}`;
    const rid = el.attrs['r:id'] ?? el.attrs.id ?? '';
    let target = relTarget.get(rid) ?? '';
    if (target === '') target = `worksheets/sheet${sheets.length + 1}.xml`;
    const path = target.startsWith('/')
      ? target.slice(1)
      : target.startsWith('xl/')
        ? target
        : `xl/${target}`;
    sheets.push({ name, path });
  });
  return sheets;
}

function parseSheet(xml: string, shared: readonly string[], styles: XlsxStyles): CellValue[][] {
  const grid: CellValue[][] = [];
  eachElement(xml, 'row', (rowEl) => {
    const declared = Number(rowEl.attrs.r ?? '0');
    const rowIndex = Number.isFinite(declared) && declared > 0 ? declared - 1 : grid.length;
    const cells: CellValue[] = [];
    eachElement(rowEl.inner, 'c', (cellEl) => {
      const ref = cellEl.attrs.r ?? '';
      const col = ref === '' ? cells.length : columnRefToIndex(ref);
      const type = cellEl.attrs.t ?? 'n';
      let value: CellValue = null;

      if (type === 'inlineStr') {
        value = textOf(cellEl.inner, 't');
      } else {
        const rawV = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellEl.inner);
        const raw = rawV ? decodeXml(rawV[1] ?? '') : '';
        if (raw === '') {
          value = null;
        } else if (type === 's') {
          const idx = Number(raw);
          value = Number.isFinite(idx) ? (shared[idx] ?? '') : '';
        } else if (type === 'b') {
          value = raw === '1';
        } else if (type === 'e') {
          value = null; // A spreadsheet error cell carries no importable value.
        } else if (type === 'str') {
          value = raw;
        } else {
          const num = Number(raw);
          if (Number.isFinite(num)) {
            const styleIdx = Number(cellEl.attrs.s ?? '-1');
            const isDate = styleIdx >= 0 && styles.dateXf[styleIdx] === true;
            value = isDate ? excelSerialToIso(num) : num;
          } else {
            value = raw;
          }
        }
      }
      if (col >= 0) {
        while (cells.length < col) cells.push(null);
        cells[col] = value;
      }
    });
    while (grid.length < rowIndex) grid.push([]);
    grid[rowIndex] = cells;
  });
  return grid;
}

function parseXlsx(buf: Buffer): ParsedDocument {
  const warnings: string[] = [];
  const zip = openZip(buf);
  const shared = parseSharedStrings(zip.text('xl/sharedStrings.xml'));
  const styles = parseStyles(zip.text('xl/styles.xml'));
  const sheets = resolveSheets(zip);

  if (sheets.length === 0) warnings.push('Workbook declares no worksheets.');

  const tables: ParsedTable[] = [];
  for (const sheet of sheets) {
    const xml = zip.text(sheet.path);
    if (xml === null) {
      warnings.push(`Worksheet "${sheet.name}" is referenced but missing from the archive.`);
      continue;
    }
    const grid = parseSheet(xml, shared, styles);
    const table = toTable(sheet.name, grid);
    if (table.rows.length === 0 && table.headers.length === 0) continue;
    if (table.truncated) warnings.push(`Sheet "${sheet.name}" exceeded ${MAX_ROWS_PER_TABLE} rows and was truncated.`);
    tables.push(table);
  }
  return { format: 'xlsx', kind: 'tabular', tables, text: null, warnings };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

function parseDocx(buf: Buffer): ParsedDocument {
  const zip = openZip(buf);
  const xml = zip.text('word/document.xml');
  if (xml === null) throw new ParseError('DOCX archive has no word/document.xml part.');

  const paragraphs: string[] = [];
  eachElement(xml, 'w:p', (el) => {
    const text = textOf(el.inner, 'w:t').trim();
    if (text !== '') paragraphs.push(text);
  });
  const text = paragraphs.length > 0 ? paragraphs.join('\n') : stripTags(xml).trim();

  // Word tables carry real tabular data; extract them so they can be routed too.
  const tables: ParsedTable[] = [];
  let tableNo = 0;
  eachElement(xml, 'w:tbl', (tbl) => {
    tableNo += 1;
    const grid: CellValue[][] = [];
    eachElement(tbl.inner, 'w:tr', (tr) => {
      const cells: CellValue[] = [];
      eachElement(tr.inner, 'w:tc', (tc) => {
        cells.push(textOf(tc.inner, 'w:t').trim());
      });
      if (cells.length > 0) grid.push(cells);
    });
    if (grid.length > 1) tables.push(toTable(`Table ${tableNo}`, grid));
  });

  return {
    format: 'docx',
    kind: tables.length > 0 ? 'tabular' : 'text',
    tables,
    text,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// JSON / XML / TXT
// ---------------------------------------------------------------------------

function flattenJsonValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

/** Collect every array-of-objects in the document; each becomes a table. */
function collectJsonTables(node: unknown, path: string, out: ParsedTable[], depth = 0): void {
  if (depth > 6 || out.length >= 50) return;
  if (Array.isArray(node)) {
    const objects = node.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r));
    if (objects.length > 0 && objects.length === node.length) {
      const headers: string[] = [];
      for (const obj of objects.slice(0, 500)) {
        for (const k of Object.keys(obj)) if (!headers.includes(k)) headers.push(k);
      }
      const rows = objects.slice(0, MAX_ROWS_PER_TABLE).map((obj) => headers.map((h) => flattenJsonValue(obj[h])));
      out.push({
        name: path === '' ? 'data' : path,
        headers,
        rows,
        headerRowIndex: null,
        firstDataRowIndex: 0,
        truncated: objects.length > MAX_ROWS_PER_TABLE,
      });
      return;
    }
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      collectJsonTables(value, path === '' ? key : `${path}.${key}`, out, depth + 1);
    }
  }
}

function parseJson(text: string): ParsedDocument {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new ParseError(`Invalid JSON: ${(err as Error).message}`);
  }
  const tables: ParsedTable[] = [];
  collectJsonTables(doc, '', tables);
  return {
    format: 'json',
    kind: tables.length > 0 ? 'tabular' : 'text',
    tables,
    text: tables.length > 0 ? null : text.slice(0, 200_000),
    warnings: tables.length === 0 ? ['No array-of-objects found; treated as text.'] : [],
  };
}

function parseXmlDoc(text: string): ParsedDocument {
  // NP-011: Tally exports (ENVELOPE→TALLYMESSAGE→VOUCHER) are voucher-shaped,
  // not record-shaped — the generic repeated-element heuristic would mangle
  // them. The dedicated extractor emits one row per voucher with its ledger
  // lines pre-folded into the shared GlJournalLine JSON shape.
  const tally = extractTallyVouchers(text);
  if (tally) return { format: 'xml', kind: 'tabular', tables: [tally], text: null, warnings: [] };

  // Find the most frequent repeated element and treat it as the record shape.
  const counts = new Map<string, number>();
  const re = /<([A-Za-z_][-A-Za-z0-9_.]*)(\s[^>]*)?>/g;
  let m = re.exec(text);
  while (m !== null) {
    const name = m[1];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    m = re.exec(text);
  }
  let best = '';
  let bestCount = 1;
  for (const [name, n] of counts) {
    if (n > bestCount) {
      best = name;
      bestCount = n;
    }
  }
  if (best === '' || bestCount < 2) {
    return { format: 'xml', kind: 'text', tables: [], text: stripTags(text).slice(0, 200_000), warnings: ['No repeated element found; treated as text.'] };
  }

  const records: Record<string, CellValue>[] = [];
  eachElement(text, best, (el) => {
    if (records.length >= MAX_ROWS_PER_TABLE) return;
    const rec: Record<string, CellValue> = {};
    for (const [k, v] of Object.entries(el.attrs)) rec[k] = v;
    const child = /<([A-Za-z_][-A-Za-z0-9_.]*)(\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let c = child.exec(el.inner);
    while (c !== null) {
      const key = c[1];
      const raw = c[3] ?? '';
      if (key && !/[<>]/.test(raw)) rec[key] = decodeXml(raw).trim();
      c = child.exec(el.inner);
    }
    if (Object.keys(rec).length > 0) records.push(rec);
  });

  if (records.length === 0) {
    return { format: 'xml', kind: 'text', tables: [], text: stripTags(text).slice(0, 200_000), warnings: [] };
  }
  const headers: string[] = [];
  for (const r of records) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  return {
    format: 'xml',
    kind: 'tabular',
    tables: [
      {
        name: best,
        headers,
        rows: records.map((r) => headers.map((h) => r[h] ?? null)),
        headerRowIndex: null,
        firstDataRowIndex: 0,
        truncated: false,
      },
    ],
    text: null,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const UNSUPPORTED_REASON: Partial<Record<SourceFormat, string>> = {
  pdf: 'PDF text extraction is not implemented in this build (no PDF engine is bundled).',
  image: 'OCR is not configured — image text extraction is unavailable (EXTERNAL DEPENDENCY).',
  unknown: 'Unrecognized or unsupported file format.',
};

/**
 * Parse a file into tables and/or text. Never throws for an unsupported format —
 * it returns `kind: 'unsupported'` with a reason, so callers surface an honest
 * state instead of an empty success.
 */
export function parseFile(filename: string, buf: Buffer): ParsedDocument {
  const doc = parseFileRaw(filename, buf);
  if (doc.kind !== 'tabular') return doc;
  // NP-011: aggregation-shaped sources. A bank-transaction table folds into ONE
  // statement row (lines pre-serialized in the shared BankStatementLine shape);
  // anything that does not match the conservative signature passes through.
  const tables = doc.tables.map((t) => foldBankStatementTable(t, filename) ?? t);
  return tables === doc.tables ? doc : { ...doc, tables };
}

function parseFileRaw(filename: string, buf: Buffer): ParsedDocument {
  const format = detectFormat(filename, buf);

  if (!SUPPORTED_FORMATS.includes(format)) {
    return {
      format,
      kind: 'unsupported',
      tables: [],
      text: null,
      warnings: [],
      unsupportedReason: UNSUPPORTED_REASON[format] ?? 'Unsupported file format.',
    };
  }

  try {
    if (format === 'xlsx') return parseXlsx(buf);
    if (format === 'docx') return parseDocx(buf);

    const text = buf.toString('utf8');
    if (format === 'json') return parseJson(text);
    if (format === 'xml') return parseXmlDoc(text);
    if (format === 'csv' || format === 'tsv') {
      const delimiter = format === 'tsv' ? '\t' : sniffDelimiter(text);
      const grid = parseDelimited(text, delimiter).map((r) => r.map<CellValue>((c) => (c === '' ? null : c)));
      const table = toTable('data', grid);
      return {
        format,
        kind: 'tabular',
        tables: table.headers.length > 0 ? [table] : [],
        text: null,
        warnings: table.truncated ? [`Input exceeded ${MAX_ROWS_PER_TABLE} rows and was truncated.`] : [],
      };
    }
    return { format: 'txt', kind: 'text', tables: [], text: text.slice(0, 200_000), warnings: [] };
  } catch (err) {
    if (err instanceof ZipError || err instanceof ParseError) {
      return {
        format,
        kind: 'unsupported',
        tables: [],
        text: null,
        warnings: [],
        unsupportedReason: err.message,
      };
    }
    throw err;
  }
}
