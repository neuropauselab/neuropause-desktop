/**
 * Release-artifact + update-feed integrity verifier.
 *
 * Run after `electron-builder` packages a platform, BEFORE the artifacts are
 * published, to fail fast when the build output is incomplete or the
 * auto-update feed does not match the shipped binaries. It catches the
 * distribution defects unit tests cannot:
 *   - a missing installer (.dmg/.exe) or update payload (.zip),
 *   - a missing channel feed file (latest-mac.yml / beta-mac.yml / …), which
 *     would leave auto-update with nothing to read,
 *   - a feed whose recorded sha512/size does not match the file on disk (a
 *     truncated or swapped upload — electron-updater rejects it at runtime).
 *
 * Reads ONLY the local `dist/` output — no certificates, no secrets, no
 * network — so it runs identically in CI and locally after `npm run package`.
 *
 * CLI: node scripts/verify-release-artifacts.cjs [--platform mac|win] [--dist <dir>]
 * The pure functions are exported for unit testing; the CLI runs only when
 * executed directly.
 */
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

function unquote(value) {
  return value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

/**
 * Parse the subset of an electron-updater feed file we depend on (flat,
 * machine-generated YAML). Returns { version, path, sha512, files:[{url,sha512,size}] }.
 */
function parseUpdateFeed(text) {
  const feed = { version: null, path: null, sha512: null, files: [] };
  let inFiles = false;
  let current = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    if (indent === 0) {
      inFiles = false;
      current = null;
      let m;
      if ((m = /^version:\s*(.+)$/.exec(line))) feed.version = unquote(m[1]);
      else if ((m = /^path:\s*(.+)$/.exec(line))) feed.path = decodeURIComponent(unquote(m[1]));
      else if ((m = /^sha512:\s*(.+)$/.exec(line))) feed.sha512 = unquote(m[1]);
      else if (/^files:\s*$/.test(line)) inFiles = true;
      continue;
    }
    if (!inFiles) continue;
    let m;
    if ((m = /^-\s*url:\s*(.+)$/.exec(line))) {
      current = { url: decodeURIComponent(unquote(m[1])), sha512: null, size: null };
      feed.files.push(current);
    } else if (current && (m = /^url:\s*(.+)$/.exec(line))) {
      current.url = decodeURIComponent(unquote(m[1]));
    } else if (current && (m = /^sha512:\s*(.+)$/.exec(line))) {
      current.sha512 = unquote(m[1]);
    } else if (current && (m = /^size:\s*(.+)$/.exec(line))) {
      current.size = Number(unquote(m[1]));
    }
  }
  return feed;
}

/** electron-updater records file digests as base64-encoded sha512. */
function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

const PLATFORM_RULES = {
  mac: {
    installer: { label: '.dmg installer', test: (f) => f.endsWith('.dmg') },
    payload: { label: '-mac.zip update payload', test: (f) => f.endsWith('-mac.zip') },
    feed: { label: 'macOS update feed (*-mac.yml)', test: (f) => f.endsWith('-mac.yml') },
  },
  win: {
    installer: { label: 'NSIS .exe installer', test: (f) => f.toLowerCase().endsWith('.exe') },
    payload: { label: '.zip update payload', test: (f) => f.endsWith('.zip') && !f.endsWith('-mac.zip') },
    feed: { label: 'Windows update feed (latest.yml / beta.yml / …)', test: (f) => f.endsWith('.yml') && !f.endsWith('-mac.yml') },
  },
};

/**
 * Verify a packaged `dist` directory for one platform. Returns
 * { ok, checks: [{ label, ok, detail }] }. IO is injectable for tests.
 */
function verifyReleaseArtifacts(distDir, platform, io = {}) {
  const exists = io.exists ?? existsSync;
  const readDir = io.readDir ?? readdirSync;
  const readFile = io.readFile ?? ((p) => readFileSync(p));
  const hash = io.hash ?? ((buf) => sha512Base64(buf));

  const rules = PLATFORM_RULES[platform];
  const checks = [];
  const pass = (label, detail) => checks.push({ label, ok: true, detail: detail ?? null });
  const fail = (label, detail) => checks.push({ label, ok: false, detail });

  if (!rules) return { ok: false, checks: [{ label: 'platform', ok: false, detail: `unknown platform "${platform}" (expected mac|win)` }] };
  if (!exists(distDir)) return { ok: false, checks: [{ label: 'dist directory', ok: false, detail: `not found: ${distDir}` }] };

  const files = readDir(distDir);

  // 1. Required artifact classes present.
  for (const key of ['installer', 'payload', 'feed']) {
    const rule = rules[key];
    if (files.some((f) => rule.test(f))) pass(`present: ${rule.label}`);
    else fail(`present: ${rule.label}`, 'no matching file in dist');
  }

  // 2. Feed integrity: every referenced file exists and its sha512 matches disk.
  const feedName = files.find((f) => rules.feed.test(f));
  if (feedName) {
    let feed;
    try {
      feed = parseUpdateFeed(readFile(join(distDir, feedName)).toString());
    } catch (err) {
      feed = null;
      fail(`feed parseable: ${feedName}`, err && err.message ? err.message : String(err));
    }
    if (feed) {
      pass(`feed parsed: ${feedName} (v${feed.version ?? '?'}, ${feed.files.length} file(s))`);

      /**
       * GATE 27 (round 61) — VERSION PARITY, the check this verifier lacked.
       *
       * Everything else here compares the feed against the binaries BESIDE IT in
       * the same dist/, so a build made under a stale version stamp is perfectly
       * self-consistent and passed 6/6 — which is precisely how the `da36851`
       * class ("two binaries, one version") kept getting through. Comparing the
       * feed to the version the MANIFESTS declare is the one question that
       * catches it here; `releaseDiscipline.test.ts` catches the tag half.
       *
       * `expectedVersion` is injectable so the pure function stays testable; it
       * defaults to the desktop manifest beside this script.
       */
      const expectedVersion =
        io.expectedVersion ??
        (() => {
          try {
            return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
          } catch {
            return null;
          }
        })();
      if (expectedVersion == null) {
        // Cannot measure — say so rather than passing silently.
        fail('feed version parity', 'could not read the declared version from package.json');
      } else if (feed.version !== expectedVersion) {
        fail(
          'feed version parity',
          `feed declares v${feed.version ?? '?'} but the manifests declare v${expectedVersion} — ` +
            'this artifact set is stamped with a version it was not built under',
        );
      } else {
        pass(`feed version parity: v${expectedVersion} matches the manifests`);
      }
      // files[] entries and the top-level update `path` are checked
      // independently — electron-updater downloads the top-level path/sha512,
      // so a disagreement between it and files[] must not be masked.
      const checkFile = (entry, origin) => {
        const target = join(distDir, entry.url);
        if (!exists(target)) {
          fail(`${origin}→file: ${entry.url}`, 'referenced by feed but missing from dist');
          return;
        }
        const bytes = readFile(target);
        if (entry.sha512) {
          const actual = hash(bytes);
          if (actual === entry.sha512) pass(`sha512 ok [${origin}]: ${entry.url}`);
          else fail(`sha512 ok [${origin}]: ${entry.url}`, `feed ${entry.sha512.slice(0, 12)}… ≠ actual ${actual.slice(0, 12)}…`);
        }
        if (entry.size != null && bytes.length !== entry.size) {
          fail(`size ok [${origin}]: ${entry.url}`, `feed ${entry.size} ≠ actual ${bytes.length}`);
        }
      };
      if (feed.files.length === 0 && !feed.path) fail(`feed references files: ${feedName}`, 'feed lists no files');
      for (const entry of feed.files) checkFile(entry, 'files');
      if (feed.path) checkFile({ url: feed.path, sha512: feed.sha512, size: null }, 'path');
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}

function parseArgs(argv) {
  const opts = { platform: process.platform === 'win32' ? 'win' : 'mac', dist: 'dist' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--platform' && argv[i + 1]) opts.platform = argv[++i];
    else if (argv[i] === '--dist' && argv[i + 1]) opts.dist = argv[++i];
  }
  return opts;
}

function main() {
  const { platform, dist } = parseArgs(process.argv.slice(2));
  const result = verifyReleaseArtifacts(dist, platform);
  console.log(`[verify-release] platform=${platform} dist=${dist}`);
  for (const c of result.checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.ok ? '' : ` — ${c.detail}`}`);
  if (result.ok) {
    console.log('[verify-release] OK — artifacts present and feed matches binaries.');
    process.exit(0);
  }
  console.error('[verify-release] FAILED — see the FAIL lines above.');
  process.exit(1);
}

module.exports = { parseUpdateFeed, sha512Base64, verifyReleaseArtifacts, PLATFORM_RULES };

if (require.main === module) main();
