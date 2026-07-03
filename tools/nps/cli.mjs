#!/usr/bin/env node
/**
 * nps — the NeuroPause Developer SDK CLI.
 *
 * Commands:
 *   nps init <dir>                    scaffold a new plugin
 *   nps validate <dir>                validate a plugin manifest
 *   nps pack <dir> [-o file.npkg]     package a plugin (tar.gz) + sha256
 *   nps keygen [-o name]              generate an Ed25519 signing key pair
 *   nps sign <file> -k <key.pem>      sign a package digest (Ed25519)
 *   nps dev <dir>                     validate + print hot-reload run steps
 *
 * Dependency-free: Node built-ins only. The signing scheme matches the runtime
 * verifier (Ed25519 over the package's SHA-256 digest).
 */
import { promises as fs, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { createHash, generateKeyPairSync, sign as edSign, createPublicKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const MANIFEST = 'neuropause.plugin.json';
const PERMISSIONS = [
  'network', 'filesystem_read', 'filesystem_write', 'clipboard', 'notifications',
  'camera', 'microphone', 'local_models', 'automation', 'background', 'shell_execution',
];
const KINDS = ['background', 'automation', 'ai_agent', 'mcp_server', 'ui'];

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function fail(msg) {
  console.error(c.red('✗ ' + msg));
  process.exit(1);
}
function ok(msg) {
  console.log(c.green('✓ ' + msg));
}

function flag(args, name, short) {
  const i = args.findIndex((a) => a === name || a === short);
  return i >= 0 ? args[i + 1] : undefined;
}

function validateManifestObject(m) {
  const errs = [];
  if (typeof m !== 'object' || !m) return ['manifest must be a JSON object'];
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(m.id || '')) errs.push('id: lowercase, >=3 chars, [a-z0-9._-]');
  if (!m.name) errs.push('name: required');
  if (!/^\d+\.\d+\.\d+([-+].*)?$/.test(m.version || '')) errs.push('version: must be semver (x.y.z)');
  if (!m.engine || typeof m.engine.neuropause !== 'string') errs.push('engine.neuropause: required range');
  if (!KINDS.includes(m.kind)) errs.push(`kind: one of ${KINDS.join(', ')}`);
  if (m.kind && m.kind !== 'ui' && !m.main) errs.push('main: required for code plugins');
  for (const p of m.permissions || []) if (!PERMISSIONS.includes(p)) errs.push(`permissions: unknown "${p}"`);
  for (const c2 of m.contributions || []) {
    if (!['sidebar', 'toolbar', 'panel', 'widget'].includes(c2.surface)) errs.push(`contribution surface invalid: ${c2.surface}`);
  }
  return errs;
}

async function readManifest(dir) {
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) fail(`No ${MANIFEST} in ${dir}`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    fail(`Invalid JSON in ${MANIFEST}: ${e.message}`);
  }
}

function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    fs.readFile(path).then((buf) => res(h.update(buf).digest('hex'))).catch(rej);
  });
}

/* ── commands ── */

async function cmdInit(dir) {
  if (!dir) fail('usage: nps init <dir>');
  const target = resolve(dir);
  await fs.mkdir(target, { recursive: true });
  const id = basename(target).toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  const manifest = {
    id,
    name: basename(target),
    version: '0.1.0',
    description: 'A NeuroPause plugin.',
    author: '',
    engine: { neuropause: '>=0.1.0 <1.0.0' },
    kind: 'automation',
    main: 'index.cjs',
    contributions: [],
    permissions: ['notifications', 'background'],
  };
  await fs.writeFile(join(target, MANIFEST), JSON.stringify(manifest, null, 2));
  const entry = `'use strict';
/** ${manifest.name} — a NeuroPause plugin. */
module.exports = {
  async activate(host) {
    host.log('${manifest.name} activated');
    await host.storage.set('startedAt', new Date().toISOString());
    // host.notify requires the "notifications" permission:
    await host.notify('${manifest.name}', 'Plugin is running').catch((e) => host.log('notify denied: ' + e.message));
  },
  async deactivate() {
    // clean up timers, listeners, etc.
  },
};
`;
  await fs.writeFile(join(target, 'index.cjs'), entry);
  ok(`Scaffolded plugin in ${dir}`);
  console.log(c.dim(`  ${MANIFEST}\n  index.cjs`));
}

async function cmdValidate(dir) {
  if (!dir) fail('usage: nps validate <dir>');
  const m = await readManifest(dir);
  const errs = validateManifestObject(m);
  if (errs.length) {
    console.error(c.red('✗ Manifest invalid:'));
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }
  if (m.kind !== 'ui' && !existsSync(join(dir, m.main))) fail(`main entry not found: ${m.main}`);
  ok(`Manifest valid: ${m.id}@${m.version} (${m.kind})`);
}

async function cmdPack(args) {
  const dir = args[0];
  if (!dir) fail('usage: nps pack <dir> [-o out.npkg]');
  const m = await readManifest(dir);
  const errs = validateManifestObject(m);
  if (errs.length) fail('Fix manifest before packing: ' + errs.join('; '));
  const out = resolve(flag(args, '--out', '-o') || `${m.id}-${m.version}.npkg`);
  // Use the OS tar to build a real, dependency-free gzip archive.
  const r = spawnSync('tar', ['-czf', out, '-C', resolve(dir), '.'], { stdio: 'inherit' });
  if (r.status !== 0) fail('tar failed (is tar installed?)');
  const sha = await sha256File(out);
  await fs.writeFile(`${out}.sha256`, `${sha}  ${basename(out)}\n`);
  ok(`Packed ${basename(out)}`);
  console.log(c.dim(`  sha256: ${sha}`));
}

async function cmdKeygen(args) {
  const name = flag(args, '--out', '-o') || 'neuropause-signing';
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const keyId = createHash('sha256').update(der).digest('hex').slice(0, 16);
  await fs.writeFile(`${name}.public.pem`, pubPem);
  await fs.writeFile(`${name}.private.pem`, privPem, { mode: 0o600 });
  ok('Generated Ed25519 key pair');
  console.log(c.dim(`  ${name}.public.pem  (share / register as trusted)`));
  console.log(c.dim(`  ${name}.private.pem (keep secret)`));
  console.log(`  key id: ${c.bold(keyId)}`);
}

async function cmdSign(args) {
  const file = args[0];
  const keyPath = flag(args, '--key', '-k');
  if (!file || !keyPath) fail('usage: nps sign <file> -k <private.pem> [-o file.sig]');
  if (!existsSync(file)) fail(`file not found: ${file}`);
  if (!existsSync(keyPath)) fail(`key not found: ${keyPath}`);
  const digestHex = await sha256File(file);
  const privPem = await fs.readFile(keyPath, 'utf8');
  // Sign the digest bytes — identical to what the runtime verifier checks.
  const signature = edSign(null, Buffer.from(digestHex, 'hex'), privPem).toString('base64');
  const out = flag(args, '--out', '-o') || `${file}.sig`;
  await fs.writeFile(out, signature);
  // Derive the key id from the matching public key for convenience.
  const pub = createPublicKey(privPem);
  const der = pub.export({ type: 'spki', format: 'der' });
  const keyId = createHash('sha256').update(der).digest('hex').slice(0, 16);
  ok(`Signed ${basename(file)}`);
  console.log(c.dim(`  digest:    ${digestHex}`));
  console.log(c.dim(`  signature: ${out}`));
  console.log(`  key id:    ${c.bold(keyId)}`);
}

async function cmdDev(dir) {
  if (!dir) fail('usage: nps dev <dir>');
  await cmdValidate(dir);
  const parent = dirname(resolve(dir));
  console.log('\n' + c.bold('Dev mode — hot reload via the plugin loader:'));
  console.log('  1. Point the app at your plugins folder:');
  console.log(c.dim(`       export NEUROPAUSE_PLUGINS_DIR="${parent}"`));
  console.log('  2. Start NeuroPause:');
  console.log(c.dim('       npm run dev'));
  console.log('  3. Enable the plugin from the app; edits in this folder hot-reload it.');
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init': return cmdInit(args[0]);
    case 'validate': return cmdValidate(args[0]);
    case 'pack': return cmdPack(args);
    case 'keygen': return cmdKeygen(args);
    case 'sign': return cmdSign(args);
    case 'dev': return cmdDev(args[0]);
    default:
      console.log(c.bold('nps — NeuroPause Developer SDK'));
      console.log('  nps init <dir>                 scaffold a new plugin');
      console.log('  nps validate <dir>             validate a plugin manifest');
      console.log('  nps pack <dir> [-o file.npkg]  package a plugin (tar.gz) + sha256');
      console.log('  nps keygen [-o name]           generate an Ed25519 key pair');
      console.log('  nps sign <file> -k <key.pem>   sign a package digest');
      console.log('  nps dev <dir>                  validate + print hot-reload steps');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => fail(e.message));
