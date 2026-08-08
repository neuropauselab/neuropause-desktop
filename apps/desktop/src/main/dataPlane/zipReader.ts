/**
 * Phase 6 — Universal Enterprise Data Plane: minimal ZIP reader.
 *
 * XLSX and DOCX are ZIP containers of XML parts. Rather than add a parsing
 * dependency to the desktop main process — which has never shipped a native
 * module and builds a macOS universal binary — this reads the archive with
 * nothing but `node:zlib`, which ships with Node.
 *
 * Deliberately narrow: central-directory scan, stored (method 0) and deflate
 * (method 8) entries only. Anything else — ZIP64, encryption, an exotic
 * compression method — is REJECTED with a named error rather than silently
 * mis-parsed. A wrong answer is worse than an honest refusal.
 *
 * Untrusted input: every offset is bounds-checked against the buffer, entry
 * count and per-entry inflated size are capped, and the total inflated budget
 * is enforced across the archive (zip-bomb protection).
 */
import { inflateRawSync } from 'node:zlib';

/** Hard caps. An enterprise spreadsheet is large; a zip bomb is absurd. */
export const ZIP_MAX_ENTRIES = 2_048;
/** Per-entry inflated ceiling (128 MiB). */
export const ZIP_MAX_ENTRY_BYTES = 128 * 1024 * 1024;
/** Whole-archive inflated ceiling (256 MiB). */
export const ZIP_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const EOCD_MIN_SIZE = 22;
/** The EOCD comment field is 16-bit, so the record starts within 64 KiB + 22 of the end. */
const EOCD_MAX_SCAN = 0xffff + EOCD_MIN_SIZE;

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  /** Normalized forward-slash path inside the archive. */
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function u16(buf: Buffer, at: number): number {
  if (at + 2 > buf.length) throw new ZipError('Truncated archive: unexpected end while reading.');
  return buf.readUInt16LE(at);
}

function u32(buf: Buffer, at: number): number {
  if (at + 4 > buf.length) throw new ZipError('Truncated archive: unexpected end while reading.');
  return buf.readUInt32LE(at);
}

/** Locate the End Of Central Directory record by scanning backwards for its signature. */
function findEocd(buf: Buffer): number {
  if (buf.length < EOCD_MIN_SIZE) throw new ZipError('Not a ZIP archive: file is too small.');
  const floor = Math.max(0, buf.length - EOCD_MAX_SCAN);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new ZipError('Not a ZIP archive: no end-of-central-directory record found.');
}

/**
 * Read the central directory. Returns entry metadata only — nothing is
 * decompressed until `readEntry` is called for a specific part.
 */
export function listZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const entryCount = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);

  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported by this reader.');
  }
  if (entryCount > ZIP_MAX_ENTRIES) {
    throw new ZipError(`Archive has ${entryCount} entries, above the ${ZIP_MAX_ENTRIES} limit.`);
  }
  if (cdOffset + cdSize > buf.length) {
    throw new ZipError('Corrupt archive: central directory extends past end of file.');
  }

  const entries: ZipEntry[] = [];
  let at = cdOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (u32(buf, at) !== SIG_CENTRAL) {
      throw new ZipError(`Corrupt archive: bad central-directory signature at entry ${i + 1}.`);
    }
    const flags = u16(buf, at + 8);
    // Bit 0 = encrypted. We never guess at encrypted content.
    if ((flags & 0x0001) !== 0) throw new ZipError('Encrypted archives are not supported.');

    const compressionMethod = u16(buf, at + 10);
    const compressedSize = u32(buf, at + 20);
    const uncompressedSize = u32(buf, at + 24);
    const nameLen = u16(buf, at + 28);
    const extraLen = u16(buf, at + 30);
    const commentLen = u16(buf, at + 32);
    const localHeaderOffset = u32(buf, at + 42);

    const nameStart = at + 46;
    if (nameStart + nameLen > buf.length) throw new ZipError('Corrupt archive: entry name overruns file.');
    const name = buf.toString('utf8', nameStart, nameStart + nameLen).replace(/\\/g, '/');

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    at = nameStart + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Inflate one entry. `zlib` is required lazily so that merely importing this
 * module costs nothing in processes that never open an archive.
 */
export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.uncompressedSize > ZIP_MAX_ENTRY_BYTES) {
    throw new ZipError(`Archive part "${entry.name}" exceeds the ${ZIP_MAX_ENTRY_BYTES}-byte limit.`);
  }
  const lho = entry.localHeaderOffset;
  if (u32(buf, lho) !== SIG_LOCAL) {
    throw new ZipError(`Corrupt archive: bad local header for "${entry.name}".`);
  }
  const nameLen = u16(buf, lho + 26);
  const extraLen = u16(buf, lho + 28);
  const dataStart = lho + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) {
    throw new ZipError(`Corrupt archive: data for "${entry.name}" overruns file.`);
  }
  const raw = buf.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) return Buffer.from(raw);
  if (entry.compressionMethod !== 8) {
    throw new ZipError(`Unsupported compression method ${entry.compressionMethod} for "${entry.name}".`);
  }

  return inflateRawSync(raw, { maxOutputLength: ZIP_MAX_ENTRY_BYTES });
}

/**
 * Open an archive and return a lookup over its parts, enforcing the whole-archive
 * inflated budget as parts are read.
 */
export interface ZipArchive {
  entries: ZipEntry[];
  has: (name: string) => boolean;
  /** Read a part as UTF-8 text. Returns null when the part is absent. */
  text: (name: string) => string | null;
  /** Every entry name matching a predicate, in central-directory order. */
  find: (pred: (name: string) => boolean) => string[];
}

export function openZip(buf: Buffer): ZipArchive {
  const entries = listZipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let spent = 0;

  const text = (name: string): string | null => {
    const entry = byName.get(name);
    if (!entry) return null;
    spent += entry.uncompressedSize;
    if (spent > ZIP_MAX_TOTAL_BYTES) {
      throw new ZipError(`Archive expands past the ${ZIP_MAX_TOTAL_BYTES}-byte total limit.`);
    }
    return readZipEntry(buf, entry).toString('utf8');
  };

  return {
    entries,
    has: (name) => byName.has(name),
    text,
    find: (pred) => entries.map((e) => e.name).filter(pred),
  };
}

/** Cheap magic-byte check: every ZIP (and so every XLSX/DOCX) starts with "PK". */
export function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}
