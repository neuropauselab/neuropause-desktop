#!/usr/bin/env node
/**
 * Founder handoff manifest — P13C.
 *
 * Reads a packaged installer plus the build-info baked into the same build and
 * emits `release-manifest.json` + a `.sha256` sidecar beside the artifact.
 *
 * WHY A SCRIPT AND NOT A TYPED-OUT JSON FILE
 *
 * Every field here is READ from something, never asserted by whoever is doing
 * the handoff. The checksum is computed from the bytes being shipped; the
 * commit, branch and dirty flag come from the build-info that electron-builder
 * embedded in that same build; signing status is determined by parsing the
 * artifact's own PE certificate table. A manifest a human fills in is a
 * manifest that eventually disagrees with the file it describes — which is the
 * exact defect (three different things claiming version 1.0.0-rc.15) that the
 * provenance work on 12 August was written to end.
 *
 * Usage:
 *   node scripts/make-release-manifest.cjs \
 *     --artifact release/windows/NeuroPause-Founder-Test-Setup.exe \
 *     --build-info apps/desktop/resources/build-info.json \
 *     [--out release/windows/release-manifest.json]
 *
 * Contains no secrets: it reads a binary and a JSON file, and touches no
 * credential, keychain or network.
 */
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync, statSync } = require('node:fs');
const { join, basename, dirname } = require('node:path');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Is this PE file Authenticode-signed?
 *
 * The Certificate Table is data directory entry 4 in the PE optional header. A
 * size of zero means no signature is attached. Reported as a fact read from the
 * artifact rather than as a claim about how it was built — `electron-builder`
 * logs "signing with signtool.exe" even on hosts where signtool cannot exist,
 * so its output is not evidence and this is.
 *
 * Returns true / false, or null when the file is not a PE image at all.
 */
function authenticodeSigned(filePath) {
  const buf = readFileSync(filePath);
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null; // 'MZ'
  const peOff = buf.readUInt32LE(0x3c);
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return null; // 'PE\0\0'
  const magic = buf.readUInt16LE(peOff + 24);
  const ddOff = peOff + 24 + (magic === 0x20b ? 112 : 96);
  if (ddOff + 40 > buf.length) return null;
  return buf.readUInt32LE(ddOff + 36) !== 0; // entry 4: [va, size] -> size
}

function peArch(filePath) {
  const buf = readFileSync(filePath);
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null;
  const peOff = buf.readUInt32LE(0x3c);
  const machine = buf.readUInt16LE(peOff + 4);
  return { 0x8664: 'x64', 0x014c: 'x86', 0xaa64: 'arm64' }[machine] ?? `0x${machine.toString(16)}`;
}

const artifact = arg('artifact');
if (!artifact || !existsSync(artifact)) {
  console.error('Usage: make-release-manifest.cjs --artifact <installer> [--build-info <path>] [--out <path>]');
  console.error(artifact ? `Artifact not found: ${artifact}` : 'Missing --artifact');
  process.exit(1);
}

/**
 * THE TRAP THIS GUARD EXISTS FOR.
 *
 * The default path is the build-info of whatever was last built IN THIS
 * CHECKOUT. When the artifact came from somewhere else — a CI runner, another
 * machine — that file describes a different build, and the manifest would
 * confidently record the wrong commit for the bytes it is checksumming. That is
 * the same class of defect as a build claiming a commit whose tree it did not
 * contain, arriving one layer further out.
 *
 * The build-info that belongs to a CI artifact ships inside its own `-win.zip`
 * at `resources/build-info.json`. Extract it and pass `--build-info`.
 */
const buildInfoExplicit = process.argv.includes('--build-info');
const buildInfoPath = arg('build-info', join('apps', 'desktop', 'resources', 'build-info.json'));
if (!buildInfoExplicit) {
  console.warn(
    `[manifest] NOTE: using the local ${buildInfoPath}. If this artifact was built elsewhere ` +
      '(CI runner, another machine), that file describes a DIFFERENT build — extract ' +
      "resources/build-info.json from the artifact's own -win.zip and pass --build-info.",
  );
}
if (!existsSync(buildInfoPath)) {
  console.error(`build-info.json not found at ${buildInfoPath} — refusing to emit a manifest with invented provenance.`);
  process.exit(1);
}

const info = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
const bytes = readFileSync(artifact);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const signed = authenticodeSigned(artifact);

/**
 * The NSIS installer stub is a 32-bit PE by design, whatever the payload's
 * architecture — so the stub's machine word is reported as `installerArch` and
 * is deliberately NOT presented as the application's architecture. Calling a
 * 32-bit stub an x86 build would be a false statement about an x64 product.
 */
const manifest = {
  product: 'NeuroPause OS',
  channel: info.channel ?? null,
  version: info.version ?? null,
  build: `${info.version ?? 'unknown'}+${info.commit ?? 'unknown'}`,
  gitCommit: info.commit ?? null,
  branch: info.branch ?? null,
  dirty: info.dirty ?? null,
  buildTime: info.buildTime ?? null,
  platform: 'win32',
  architecture: 'x64',
  installerArch: peArch(artifact),
  electronVersion: null, // filled below when the desktop manifest is readable
  /**
   * The Node the BUILD pins, read from `.nvmrc` — the same file the release
   * workflows hand to `setup-node`. `process.version` would have recorded
   * whichever Node ran THIS script, on whichever machine assembled the handoff:
   * a different fact wearing the same field name.
   */
  nodeVersion: null,
  artifact: basename(artifact),
  artifactBytes: statSync(artifact).size,
  artifactSha256: sha256,
  signingStatus: signed === null ? 'UNKNOWN' : signed ? 'SIGNED' : 'NOT CONFIGURED',
  notarizationStatus: 'NOT APPLICABLE (Windows)',
  certificationStatus: 'PROGRAM 13C — NOT CERTIFIED',
  testSummary: null, // set with --tests '<json>' when a gate run backs this build
};

try {
  const pkg = JSON.parse(readFileSync(join('apps', 'desktop', 'package.json'), 'utf8'));
  manifest.electronVersion = (pkg.devDependencies || {}).electron ?? (pkg.dependencies || {}).electron ?? null;
} catch {
  /* left null rather than guessed */
}
try {
  manifest.nodeVersion = readFileSync('.nvmrc', 'utf8').trim() || null;
} catch {
  /* left null rather than guessed */
}

const tests = arg('tests');
if (tests) {
  try {
    manifest.testSummary = JSON.parse(tests);
  } catch {
    console.error('--tests was not valid JSON; leaving testSummary null rather than recording a guess.');
  }
}

const out = arg('out', join(dirname(artifact), 'release-manifest.json'));
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(`${artifact}.sha256`, `${sha256}  ${basename(artifact)}\n`);

console.log(`[manifest] ${out}`);
console.log(`[manifest] ${artifact}.sha256`);
console.log(`[manifest] sha256   ${sha256}`);
console.log(`[manifest] commit   ${manifest.gitCommit}  branch ${manifest.branch}  dirty ${manifest.dirty}`);
console.log(`[manifest] signing  ${manifest.signingStatus}`);
if (manifest.dirty === true) {
  console.warn('[manifest] WARNING: this artifact was built over a DIRTY working tree.');
}
if (manifest.signingStatus === 'NOT CONFIGURED') {
  console.warn('[manifest] WARNING: the installer is UNSIGNED. Windows SmartScreen will warn the user.');
}
