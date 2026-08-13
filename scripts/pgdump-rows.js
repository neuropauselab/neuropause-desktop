// Counts actual rows per table inside a PGDMP custom-format archive by
// decompressing its data blocks. No PostgreSQL server involved.
//
// Needed because "TABLE DATA" appearing in the TOC proves nothing — pg_dump
// emits a data section for empty tables too. The row count is the fact.
const fs = require('fs');
const zlib = require('zlib');

const path = process.argv[2];
const b = fs.readFileSync(path);
if (b.slice(0, 5).toString() !== 'PGDMP') throw new Error('not PGDMP');
const st = { b, p: 5 };
const vmaj = b[st.p++], vmin = b[st.p++]; st.p++; // vrev
st.intSize = b[st.p++];
st.offSize = b[st.p++];
const format = b[st.p++];
const version = vmaj * 256 + vmin;
let compression = 0;
if (version >= 0x010f) compression = b[st.p++];

const ri = () => { const s = b[st.p++]; let v = 0; for (let i = 0; i < st.intSize; i++) v += b[st.p++] * Math.pow(256, i); return s ? -v : v; };
const rs = () => { const n = ri(); if (n < 0) return null; const s = b.slice(st.p, st.p + n).toString('utf8'); st.p += n; return s; };

for (let i = 0; i < 7; i++) ri();      // timestamp fields
rs(); rs(); rs();                       // dbname, remoteVersion, dumpVersion

const count = ri();
const tagById = new Map();
for (let i = 0; i < count; i++) {
  const dumpId = ri(); const hadDumper = ri();
  rs(); rs();                           // tableoid, oid
  const tag = rs(); const desc = rs();
  ri();                                 // section
  rs(); rs(); rs(); rs(); rs(); rs();   // defn, drop, copy, namespace, tablespace, tableam
  if (version >= 0x0110) ri();          // relkind
  rs(); rs();                           // owner, withOids
  for (;;) { if (rs() === null) break; }
  st.p += 1 + st.offSize;
  if (desc === 'TABLE DATA') tagById.set(dumpId, tag);
}

// Data blocks follow the TOC: blockType(1) dumpId(int) then compressed chunks.
const rows = new Map();
while (st.p < b.length) {
  const blockType = b[st.p++];
  if (blockType !== 1 && blockType !== 3) break;   // 1 = BLK_DATA, 3 = BLK_BLOBS
  const dumpId = ri();
  const chunks = [];
  for (;;) {
    const n = ri();
    if (n <= 0) break;
    chunks.push(b.slice(st.p, st.p + n));
    st.p += n;
  }
  const raw = Buffer.concat(chunks);
  let text = '';
  try {
    text = compression === 0 ? raw.toString('utf8') : zlib.inflateSync(raw).toString('utf8');
  } catch {
    try { text = zlib.gunzipSync(raw).toString('utf8'); } catch { text = ''; }
  }
  const tag = tagById.get(dumpId) ?? `dumpId:${dumpId}`;
  // COPY data: one row per line, terminated by a lone "\." line.
  const n = text.split('\n').filter((l) => l.length > 0 && l !== '\\.').length;
  rows.set(tag, (rows.get(tag) || 0) + n);
}

const entries = [...rows.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]));
const total = entries.reduce((s, [, n]) => s + n, 0);
if (process.argv[3] === '--json') {
  console.log(JSON.stringify({ file: require('path').basename(path), total, rows: Object.fromEntries(entries) }));
} else {
  console.log(`${require('path').basename(path)} — ${total} rows across ${entries.length} tables\n`);
  for (const [t, n] of entries) if (n > 0) console.log(`  ${String(n).padStart(6)}  ${t}`);
  const empty = entries.filter(([, n]) => n === 0).map(([t]) => t);
  console.log(`\n  empty (${empty.length}): ${empty.join(', ')}`);
}
