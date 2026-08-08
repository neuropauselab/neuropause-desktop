/**
 * Phase 6 — Universal Enterprise Data Plane: TEST-ONLY fixture builders.
 *
 * Builds genuine ZIP/XLSX bytes in memory so the parser tests exercise the real
 * format — shared strings, deflate compression, date styles — without committing
 * a binary fixture to the repository.
 *
 * Nothing in the production main process imports this module.
 */
import { deflateRawSync } from 'node:zlib';

let CRC_TABLE: Int32Array | null = null;

function crcTable(): Int32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  CRC_TABLE = table;
  return table;
}

export function crc32(buf: Buffer): number {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (table[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  name: string;
  content: string;
}

/** Build a real ZIP archive (deflate) from a set of named text parts. */
export function buildZip(parts: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBuf = Buffer.from(part.name, 'utf8');
    const raw = Buffer.from(part.content, 'utf8');
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** A cell value in a fixture sheet. `{ date }` emits a real Excel serial + date style. */
export type FixtureCell = string | number | boolean | null | { date: string };

export interface FixtureSheet {
  name: string;
  rows: FixtureCell[][];
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function isoToSerial(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - EXCEL_EPOCH_UTC) / 86_400_000);
}

function colName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a real .xlsx workbook: shared strings for text, style index 1 bound to a
 * date number format, deflate-compressed parts.
 */
export function buildXlsx(sheets: readonly FixtureSheet[]): Buffer {
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

  const sheetXml = sheets.map((sheet) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${colName(c)}${r + 1}`;
            if (cell === null) return '';
            if (typeof cell === 'object') {
              return `<c r="${ref}" s="1"><v>${isoToSerial(cell.date)}</v></c>`;
            }
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
            if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
            return `<c r="${ref}" t="s"><v>${intern(cell)}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });

  const parts: ZipInput[] = [
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    },
    {
      // numFmtId 164 is a custom date format; cellXfs index 1 uses it.
      name: 'xl/styles.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
    },
  ];

  sheets.forEach((_s, i) => {
    parts.push({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml[i] ?? '' });
  });

  parts.push({
    name: 'xl/sharedStrings.xml',
    content: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
      .map((s) => `<si><t>${esc(s)}</t></si>`)
      .join('')}</sst>`,
  });

  return buildZip(parts);
}

/** Build a real .docx with paragraphs. */
export function buildDocx(paragraphs: readonly string[]): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`).join('');
  return buildZip([
    {
      name: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    },
  ]);
}
