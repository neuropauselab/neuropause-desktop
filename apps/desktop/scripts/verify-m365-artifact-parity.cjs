#!/usr/bin/env node
/**
 * SEAM-B.20 / GATE-R.14 — M365 ARTIFACT AUTHORITY PARITY.
 *
 * Answers one question about a BUILT artifact, not about source:
 *
 *   Does this executable's embedded Microsoft 365 OAuth authority surface behave exactly like the
 *   governed source profile — narrow when the contacts profile is selected, historically unchanged
 *   otherwise, and incapable of merging the two?
 *
 * WHY THIS EXISTS (and is not a duplicate): the repository's two artifact verifiers answer different
 * questions — `verify-e2e-strip.sh` proves e2e seams are absent from a release build (and REBUILDS
 * `out/` to do it, which is unusable while an armed build must be preserved), and
 * `verify-release-artifacts.cjs` proves the packaged files match the update feed's hashes. Neither
 * inspects authority. This one does, and it never builds anything.
 *
 * WHY A GREP IS NOT ENOUGH: SEAM-B.19 measured an artifact that contained ZERO occurrences of the
 * profile identifiers and still carried the old flat scope surface — absence of a string was the
 * finding, but presence of a string would not have been a proof. So this verifier EXTRACTS the emitted
 * declarations and FUNCTIONS from the artifact and EXECUTES them in an isolated VM sandbox with no
 * network, no filesystem, no electron and no ambient globals: the answer comes from running the
 * artifact's own compiled logic, not from reading its text.
 *
 * Usage:  node scripts/verify-m365-artifact-parity.cjs <path-to-built-main-bundle>
 * Exit 0 = PASS (every predicate held). Exit 1 = FAIL (with the failing predicate named).
 * Read-only: opens the artifact, writes nothing, contacts nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

/** The historical surface measured from source at HEAD b349394 — the regression baseline. */
const HISTORICAL_FULL = [
  'openid', 'profile', 'email', 'offline_access', 'User.Read',
  'User.Read.All', 'Group.Read.All', 'Directory.Read.All',
  'Mail.Read', 'Calendars.Read', 'Files.Read', 'Contacts.Read', 'Team.ReadBasic.All',
  'Mail.ReadWrite', 'Mail.Send', 'Calendars.ReadWrite', 'Files.ReadWrite.All',
  'Contacts.ReadWrite', 'Chat.ReadWrite', 'ChannelMessage.Send', 'Channel.Create',
  'ChannelMember.Read.All',
];
const EXPECTED_CONTACTS = [
  'openid', 'profile', 'email', 'offline_access', 'User.Read', 'Contacts.Read', 'Contacts.ReadWrite',
];
/** Everything the contacts profile must never carry — derived, not remembered. */
const FORBIDDEN = HISTORICAL_FULL.filter((s) => !EXPECTED_CONTACTS.includes(s));

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};
const sorted = (xs) => [...xs].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

const artifact = process.argv[2];
if (!artifact) {
  console.error('usage: node scripts/verify-m365-artifact-parity.cjs <built-main-bundle.js>');
  process.exit(1);
}

/* ── P1/P2 — the artifact exists and gets an immutable identity ─────────────────────────────── */
if (!fs.existsSync(artifact)) {
  record('P1 ARTIFACT_EXISTS', false, artifact);
  process.exit(1);
}
const bytes = fs.readFileSync(artifact);
const src = bytes.toString('utf8');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
record('P1 ARTIFACT_EXISTS', true, path.resolve(artifact));
record('P2 ARTIFACT_IDENTITY', true, `sha256=${sha256} size=${bytes.length} mtime=${fs.statSync(artifact).mtime.toISOString()}`);

/* ── P3 — the compiled profile implementation is present ───────────────────────────────────── */
const markers = ['NEUROPAUSE_M365_SCOPE_PROFILE', 'm365ScopesForProfile', 'M365_SCOPE_SETS'];
const missingMarkers = markers.filter((m) => !src.includes(m));
record(
  'P3 PROFILE_IMPLEMENTATION_PRESENT',
  missingMarkers.length === 0,
  missingMarkers.length === 0 ? markers.join(', ') : `absent: ${missingMarkers.join(', ')}`,
);
if (missingMarkers.length > 0) {
  console.error('\nThe artifact does not contain the narrow-profile implementation — it predates it.');
  process.exit(1);
}

/* ── Extract the emitted authority logic and RUN it (layers 4-5) ────────────────────────────── */
function extract(name, kind) {
  // Emitted declarations are top-level `const NAME = [...]` / `function NAME(...) {...}`.
  const re =
    kind === 'array'
      ? new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`)
      : new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`);
  const m = re.exec(src);
  if (!m) throw new Error(`could not extract ${name} from the artifact`);
  return kind === 'array' ? `const ${name} = ${m[1]};` : m[0];
}

let sandbox;
try {
  const pieces = [
    extract('M365_PROTOCOL_SCOPES', 'array'),
    extract('M365_DIRECTORY_SCOPES', 'array'),
    extract('M365_MAIL_SCOPES', 'array'),
    extract('M365_CALENDAR_SCOPES', 'array'),
    extract('M365_FILES_SCOPES', 'array'),
    extract('M365_CONTACTS_SCOPES', 'array'),
    extract('M365_TEAMS_SCOPES', 'array'),
    extract('m365ScopesForProfile', 'fn'),
    extract('resolveM365ScopeProfile', 'fn'),
  ];
  // No require, no process, no fetch, no fs: the sandbox can only compute.
  sandbox = vm.createContext(Object.create(null));
  vm.runInContext(
    `${pieces.join('\n')}
     const __out = {
       contacts: m365ScopesForProfile('contacts'),
       full: m365ScopesForProfile('full'),
       resolveUnset: resolveM365ScopeProfile(undefined),
       resolveUnknown: resolveM365ScopeProfile('nonsense'),
       resolveContacts: resolveM365ScopeProfile('contacts'),
       sets: {
         protocol: M365_PROTOCOL_SCOPES, directory: M365_DIRECTORY_SCOPES, mail: M365_MAIL_SCOPES,
         calendar: M365_CALENDAR_SCOPES, files: M365_FILES_SCOPES, contacts: M365_CONTACTS_SCOPES,
         teams: M365_TEAMS_SCOPES,
       },
     };
     __out;`,
    sandbox,
  );
  sandbox = vm.runInContext('__out', sandbox);
} catch (err) {
  record('P3b EXTRACT_AND_EXECUTE', false, String(err && err.message));
  process.exit(1);
}
record('P3b EXTRACT_AND_EXECUTE', true, 'compiled profile logic executed in an isolated VM (no net/fs/electron)');

/* ── P4 — contacts profile is EXACTLY the 7-scope set ──────────────────────────────────────── */
record(
  'P4 CONTACTS_PROFILE_EXACT',
  same(sandbox.contacts, EXPECTED_CONTACTS) && sandbox.contacts.length === 7,
  `${sandbox.contacts.length} scopes: ${sandbox.contacts.join(' ')}`,
);

/* ── P5 — no forbidden authority under the contacts profile ────────────────────────────────── */
const leaked = FORBIDDEN.filter((s) => sandbox.contacts.includes(s));
record('P5 FORBIDDEN_ABSENT', leaked.length === 0, leaked.length === 0 ? `${FORBIDDEN.length} forbidden scopes, none present` : `LEAKED: ${leaked.join(', ')}`);

/* ── P6 — capability boundary: contacts merges with nothing ────────────────────────────────── */
const overlaps = ['mail', 'files', 'calendar', 'directory', 'teams']
  .map((f) => ({ f, o: sandbox.sets[f].filter((s) => sandbox.contacts.includes(s)) }))
  .filter((x) => x.o.length > 0);
record('P6 PROFILE_BOUNDARY', overlaps.length === 0, overlaps.length === 0 ? 'contacts ∩ {mail,files,calendar,directory,teams} = ∅' : JSON.stringify(overlaps));

/* ── P8 — the full profile is still exactly the historical surface ─────────────────────────── */
record(
  'P8 FULL_PROFILE_REGRESSION',
  same(sandbox.full, HISTORICAL_FULL) && sandbox.full.length === 22,
  `${sandbox.full.length} scopes, set-equal to the historical 22: ${same(sandbox.full, HISTORICAL_FULL)}`,
);

/* ── Fail-safe resolution: unset/unknown must stay `full` (B.18's deliberate choice) ────────── */
record(
  'P8b RESOLUTION_FAIL_SAFE',
  sandbox.resolveUnset === 'full' && sandbox.resolveUnknown === 'full' && sandbox.resolveContacts === 'contacts',
  `unset=${sandbox.resolveUnset} unknown=${sandbox.resolveUnknown} contacts=${sandbox.resolveContacts}`,
);

/* ── P7 — the consent card describes exactly the requested authority ───────────────────────── */
const descMatch = /const M365_SCOPE_DESCRIPTIONS = Object.freeze\(([\s\S]*?)\n\}\);/.exec(src);
if (!descMatch) {
  record('P7 UI_AUTHORITY_PARITY', false, 'could not locate the emitted description map');
} else {
  const described = [...descMatch[1].matchAll(/(?:^|\s)"?([A-Za-z][A-Za-z0-9._]*)"?\s*:\s*\{\s*label:/g)].map((m) => m[1]);
  const missingDesc = sandbox.contacts.filter((s) => !described.includes(s));
  const overDesc = described.filter((s) => !sandbox.full.includes(s));
  record(
    'P7 UI_AUTHORITY_PARITY',
    missingDesc.length === 0 && overDesc.length === 0,
    `described=${described.length}; contacts-profile scopes undescribed=${missingDesc.length}; described-but-never-requested=${overDesc.length}`,
  );
}

/* ── P9 — no secret material in the artifact's auth configuration ──────────────────────────── */
const secretHits = [/client_secret\s*[:=]\s*["'][^"']+["']/, /BEGIN [A-Z ]*PRIVATE KEY/, /refresh_token\s*[:=]\s*["'][A-Za-z0-9._-]{20,}["']/]
  .filter((re) => re.test(src));
record('P9 NO_SECRET_MATERIAL', secretHits.length === 0, secretHits.length === 0 ? 'no embedded secret pattern' : `${secretHits.length} pattern(s) matched`);

/* ── P10 — redirect configuration unchanged ────────────────────────────────────────────────── */
const redirectOk = src.includes('loopbackPort: 42817') && src.includes('/callback');
record('P10 REDIRECT_PRESERVED', redirectOk, 'loopbackPort 42817 + /callback present');

/* ── P11 — delegated only: no .default, no *.ReadWrite.All contacts variant ────────────────── */
const delegatedOk =
  !sandbox.full.some((s) => s.endsWith('.default')) &&
  !sandbox.full.includes('Contacts.ReadWrite.All') &&
  src.includes('clientSecretEnv: null');
record('P11 DELEGATED_ONLY', delegatedOk, 'no .default in any profile; entra clientSecretEnv null (public client)');

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ARTIFACT PARITY: PASS' : 'ARTIFACT PARITY: FAIL'} — ${results.length - failed.length}/${results.length} predicates held`);
process.exit(failed.length === 0 ? 0 : 1);
