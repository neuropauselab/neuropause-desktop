// Minimal reader for the PostgreSQL custom-format dump (PGDMP) header + TOC.
// Written because this container's pg_restore is 16 and refuses "unsupported
// version (1.16)". Reads only structure — no server needed.
const fs = require('fs');

function open(path) {
  const b = fs.readFileSync(path);
  if (b.slice(0, 5).toString() !== 'PGDMP') throw new Error('not a PGDMP archive');
  let p = 5;
  const vmaj = b[p++], vmin = b[p++], vrev = b[p++];
  const intSize = b[p++];
  const offSize = b[p++];
  const format = b[p++];
  const st = { b, p, intSize, offSize };
  const version = vmaj * 256 + vmin;
  let compression = null;
  if (version >= 0x010f) compression = b[st.p++];          // 1.15+: algorithm byte
  const t = { sec: ri(st), min: ri(st), hour: ri(st), mday: ri(st), mon: ri(st), year: ri(st), isdst: ri(st) };
  const dbname = rs(st);
  const remoteVersion = rs(st);
  const dumpVersion = rs(st);
  return { st, vmaj, vmin, vrev, format, compression, t, dbname, remoteVersion, dumpVersion };
}
function ri(st) {                       // ReadInt: sign byte + intSize LE bytes
  const sign = st.b[st.p++];
  let v = 0;
  for (let i = 0; i < st.intSize; i++) v += st.b[st.p++] * Math.pow(256, i);
  return sign ? -v : v;
}
function rs(st) {                       // ReadStr: len, then bytes (-1 = null)
  const n = ri(st);
  if (n < 0) return null;
  const s = st.b.slice(st.p, st.p + n).toString('utf8');
  st.p += n;
  return s;
}

const file = process.argv[2];
const a = open(file);
const st = a.st;
const count = ri(st);
const entries = [];
for (let i = 0; i < count; i++) {
  const e = {};
  e.dumpId = ri(st);
  e.hadDumper = ri(st);               // 1 => this entry has a data block
  e.tableoid = rs(st);
  e.oid = rs(st);
  e.tag = rs(st);
  e.desc = rs(st);
  e.section = ri(st);
  e.defn = rs(st);
  e.dropStmt = rs(st);
  e.copyStmt = rs(st);
  e.namespace = rs(st);
  e.tablespace = rs(st);
  e.tableam = rs(st);
  if (a.vmaj * 256 + a.vmin >= 0x0110) e.relkind = ri(st);   // 1.16+
  e.owner = rs(st);
  e.withOids = rs(st);
  const deps = [];
  for (;;) { const d = rs(st); if (d === null) break; deps.push(d); }
  e.deps = deps;
  // offset: flag byte + offSize bytes
  st.p += 1 + st.offSize;
  entries.push(e);
}

const stamp = `${a.t.year + 1900}-${String(a.t.mon + 1).padStart(2, '0')}-${String(a.t.mday).padStart(2, '0')} ` +
  `${String(a.t.hour).padStart(2, '0')}:${String(a.t.min).padStart(2, '0')}:${String(a.t.sec).padStart(2, '0')}`;

if (process.argv[3] === '--json') {
  const data = entries.filter((e) => e.desc === 'TABLE DATA').map((e) => e.tag).sort();
  console.log(JSON.stringify({ file: require('path').basename(file), dbname: a.dbname, stamp, tableData: data }));
} else {
  console.log(`file            ${require('path').basename(file)}`);
  console.log(`archive version ${a.vmaj}.${a.vmin}-${a.vrev}   format=${a.format} compression=${a.compression}`);
  console.log(`database        ${a.dbname}`);
  console.log(`server / pg_dump ${a.remoteVersion} / ${a.dumpVersion}`);
  console.log(`dump taken      ${stamp} (local to the dumping container, UTC)`);
  console.log(`TOC entries     ${count}`);
  const byDesc = {};
  for (const e of entries) byDesc[e.desc] = (byDesc[e.desc] || 0) + 1;
  console.log('by kind        ', Object.entries(byDesc).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join(' '));
  const data = entries.filter((e) => e.desc === 'TABLE DATA');
  console.log(`\nTABLE DATA entries (${data.length}) — every table whose rows are IN this archive:`);
  console.log(data.map((e) => '  ' + e.tag).sort().join('\n'));
}
