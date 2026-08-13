/**
 * Phase 6 — Universal Enterprise Data Plane: ZIP writer.
 *
 * The counterpart to `zipReader.ts`, and the reason the Data Plane can write a
 * genuine `.xlsx` without a native dependency: an OOXML package IS a ZIP, and
 * `node:zlib` already ships the only hard part (deflate).
 *
 * Deliberately narrow — store or deflate, no ZIP64, no encryption, no
 * directories. That is exactly what an OOXML package needs and nothing more, so
 * there is no format surface here that we do not fully control.
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

/** CRC-32 (IEEE), the checksum every ZIP entry header carries. */
export function crc32(buf: Buffer): number {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (table[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  content: string | Buffer;
}

/**
 * Build a ZIP archive (deflate) from named parts.
 *
 * Order is preserved, because an OOXML consumer is entitled to expect
 * `[Content_Types].xml` first.
 */
export function buildZip(parts: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBuf = Buffer.from(part.name, 'utf8');
    const raw = typeof part.content === 'string' ? Buffer.from(part.content, 'utf8') : part.content;
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
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
