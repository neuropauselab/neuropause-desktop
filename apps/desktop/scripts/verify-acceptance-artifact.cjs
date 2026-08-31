#!/usr/bin/env node
/**
 * verify-acceptance-artifact — bind an acceptance artifact to the feature set
 * the acceptance procedure assumes it has.
 *
 * WHY THIS EXISTS (Gate 20, round 61)
 * -----------------------------------
 * The Gate-20 Windows acceptance ran rc.20 (`efe8196`, 2026-08-15) in an
 * offline VM. Items B3/B5/B6/B9 could not be driven, and the matrix recorded
 * the cause as "gated behind signing in, which needs the cloud auth backend".
 * That was true of THAT BINARY and false of the product: local-first mode
 * (S17, `89f3c45`, 2026-08-18) removed the sign-in wall three days after rc.20
 * was cut, so on current source those four items are reachable with no backend
 * at all. Measured in the shipped rc.20 `app.asar`: `device.invalid` 0,
 * `Working locally` 0, `LocalModeBanner` 0, while `Sign in to your AI
 * operating layer` 1 — the wall is present, the offline entry path is not.
 *
 * Nothing detected that. The artifact was 390 commits stale and no check bound
 * it to the procedure that consumed it, so a whole Windows session was spent
 * discovering a limitation of the binary rather than of the product.
 *
 * This verifier answers one question before a machine session is spent:
 *   DOES THIS ARTIFACT ACTUALLY CONTAIN THE FEATURES THE PROCEDURE DRIVES?
 *
 * It is deliberately NOT a build step and NEVER builds anything: it reads an
 * already-produced artifact. Contrast the two existing verifiers —
 * `verify-release-artifacts.cjs` checks installer/feed hash consistency but is
 * blind to CONTENT; `verify-e2e-strip.sh` answers a different question and
 * REBUILDS `out/`, which is unusable when a specific artifact must be
 * preserved. This one never builds and inspects content.
 *
 * INSTRUMENT DISCIPLINE
 * ---------------------
 * Markers are STRING LITERALS (UI copy, channel names, log lines), never bare
 * identifiers: minifiers rename identifiers but preserve string literals, so an
 * identifier that is absent may only have been renamed. Every run self-tests
 * with a control needle that must be absent and a control that must be present;
 * if either control misbehaves the run reports INSTRUMENT_FAILURE rather than a
 * verdict about the artifact. A zero from an unverified instrument is evidence
 * about the instrument.
 *
 * Usage:
 *   node scripts/verify-acceptance-artifact.cjs --resources <dir>
 *   node scripts/verify-acceptance-artifact.cjs --asar <app.asar> [--build-info <file>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The acceptance-critical feature manifest.
 *
 * Each entry names an acceptance item, the STRING LITERAL that proves the
 * feature shipped, and why that item depends on it. `acceptanceItems` refer to
 * section B of certification/WINDOWS-ACCEPTANCE-ROUND32.md.
 *
 * Every marker here is pinned against current source by
 * `src/main/acceptanceArtifactParity.test.ts`, so the manifest cannot rot into
 * asserting the absence of something that no longer exists by that name.
 */
const FEATURE_MANIFEST = [
  {
    id: 'local-first-entry',
    marker: 'Working locally',
    source: 'apps/desktop/src/renderer/src/localFirst/story.ts',
    acceptanceItems: ['B1', 'B3', 'B5', 'B6', 'B9'],
    why:
      'S17 local-first mode. Without it the app presents a sign-in wall, and every ' +
      'signed-in acceptance item is unreachable on a machine with no auth backend.',
  },
  {
    id: 'local-principal-namespace',
    marker: 'device.invalid',
    source: 'apps/desktop/src/renderer/src/App.tsx',
    acceptanceItems: ['B3'],
    why:
      'The device-local principal tenant namespace (D-12). B3 (active tenant context) ' +
      'resolves through it when there is no cloud account.',
  },
  {
    id: 'data-plane-history',
    marker: 'dp:history',
    source: 'packages/shared/src/ipc/channels.ts',
    acceptanceItems: ['B4', 'B5'],
    why: 'The Data page history channel B4 asserts registers and B5 drives.',
  },
  {
    id: 'data-plane-import',
    marker: 'dp:import',
    source: 'packages/shared/src/ipc/channels.ts',
    acceptanceItems: ['B5'],
    why: 'Import flow channel.',
  },
  {
    id: 'data-plane-export',
    marker: 'dp:export',
    source: 'packages/shared/src/ipc/channels.ts',
    acceptanceItems: ['B5'],
    why: 'Export flow channel.',
  },
  {
    id: 'assistant-conversations',
    marker: 'assistant:conversations',
    source: 'packages/shared/src/ipc/channels.ts',
    acceptanceItems: ['B6'],
    why: 'Assistant view read channel; also the round-39 boot-race surface.',
  },
  {
    id: 'provisioned-owner-protection',
    marker: 'protectedOwnerIdForTarget',
    source: 'apps/desktop/src/main/enterprise/org/orgStore.ts',
    acceptanceItems: ['B9', 'B11'],
    why: 'Round-40 owner-row hardening that B9/B11 spot-check.',
  },
  {
    id: 'shutdown-flush-barrier',
    marker: 'Shutdown flush complete',
    source: 'apps/desktop/src/main/index.ts',
    acceptanceItems: ['B7'],
    why: 'Round-37 graceful shutdown barrier; B7 restart persistence depends on it.',
  },
  {
    id: 'tenant-recovery-announce',
    marker: 'announceTenantRecovery',
    source: 'apps/desktop/src/main/tenancy/tenantRecoveryHub.ts',
    acceptanceItems: ['B10'],
    why: 'Round-39 recovery-triggered AI reconfigure; B10 local AI routing depends on it.',
  },
];

/** A needle that must never appear in any real artifact. */
const CONTROL_ABSENT = '__NEUROPAUSE_ACCEPTANCE_CONTROL_MUST_NOT_EXIST__';
/** A needle that must appear in any real Electron app bundle. */
const CONTROL_PRESENT = 'electron';

/** Exact substring occurrence count. Never a regex — no escaping surprises. */
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * Pure verification core. Injectable so it is testable without a real artifact
 * — the durability gap recorded against `verify-m365-artifact-parity.cjs`,
 * which is a straight CLI and therefore uncovered by the suite.
 *
 * @param {{ asarText: string, buildInfo: object|null, manifest?: Array }} input
 */
function verifyAcceptanceArtifact(input) {
  const { asarText, buildInfo } = input;
  const manifest = input.manifest || FEATURE_MANIFEST;
  const checks = [];

  // --- instrument self-test, before any verdict about the artifact ----------
  const absentControl = countOccurrences(asarText, CONTROL_ABSENT);
  const presentControl = countOccurrences(asarText, CONTROL_PRESENT);
  if (absentControl !== 0 || presentControl === 0) {
    return {
      ok: false,
      instrument: 'INSTRUMENT_FAILURE',
      detail:
        `control-absent=${absentControl} (expected 0), ` +
        `control-present=${presentControl} (expected >0) — ` +
        'the search instrument is not trustworthy on this input; no verdict issued',
      checks: [],
      missing: [],
      unreachableItems: [],
      buildInfo: buildInfo || null,
    };
  }

  // --- provenance ----------------------------------------------------------
  if (buildInfo) {
    checks.push({
      label: 'build-info present',
      ok: true,
      detail: `version=${buildInfo.version} commit=${buildInfo.commit} dirty=${buildInfo.dirty}`,
    });
    if (buildInfo.dirty === true) {
      checks.push({
        label: 'build provenance clean',
        ok: false,
        detail: 'build-info reports dirty=true — artifact was built from a modified tree',
      });
    }
  } else {
    checks.push({ label: 'build-info present', ok: false, detail: 'build-info.json not found' });
  }

  // --- feature parity ------------------------------------------------------
  const missing = [];
  for (const feature of manifest) {
    const count = countOccurrences(asarText, feature.marker);
    const ok = count > 0;
    if (!ok) missing.push(feature);
    checks.push({
      label: `feature: ${feature.id}`,
      ok,
      detail: ok
        ? `marker ${JSON.stringify(feature.marker)} ×${count}`
        : `marker ${JSON.stringify(feature.marker)} ABSENT — acceptance items ` +
          `${feature.acceptanceItems.join('/')} are NOT drivable on this artifact. ${feature.why}`,
    });
  }

  const unreachableItems = [
    ...new Set(missing.flatMap((f) => f.acceptanceItems)),
  ].sort();

  return {
    ok: checks.every((c) => c.ok),
    instrument: 'OK',
    detail: null,
    checks,
    missing,
    unreachableItems,
    buildInfo: buildInfo || null,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { resources: null, asar: null, buildInfo: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--resources') args.resources = argv[++i];
    else if (argv[i] === '--asar') args.asar = argv[++i];
    else if (argv[i] === '--build-info') args.buildInfo = argv[++i];
  }
  return args;
}

function readArtifact(args) {
  let asarPath = args.asar;
  let buildInfoPath = args.buildInfo;
  if (args.resources) {
    asarPath = asarPath || path.join(args.resources, 'app.asar');
    buildInfoPath = buildInfoPath || path.join(args.resources, 'build-info.json');
  }
  if (!asarPath) throw new Error('specify --resources <dir> or --asar <file>');
  if (!fs.existsSync(asarPath)) throw new Error(`asar not found: ${asarPath}`);

  // latin1 keeps every byte addressable as a character — the asar is a mixed
  // binary/text container and utf8 decoding would corrupt offsets.
  const asarText = fs.readFileSync(asarPath).toString('latin1');

  let buildInfo = null;
  if (buildInfoPath && fs.existsSync(buildInfoPath)) {
    try {
      buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    } catch {
      buildInfo = null;
    }
  }
  return { asarText, buildInfo, asarPath };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let artifact;
  try {
    artifact = readArtifact(args);
  } catch (err) {
    console.error(`acceptance-artifact: ${err.message}`);
    process.exit(2);
  }

  const result = verifyAcceptanceArtifact(artifact);

  console.log(`Acceptance artifact: ${artifact.asarPath}`);
  if (result.instrument !== 'OK') {
    console.error(`INSTRUMENT_FAILURE — ${result.detail}`);
    process.exit(3);
  }
  for (const c of result.checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  if (result.unreachableItems.length > 0) {
    console.log('');
    console.log(
      'ACCEPTANCE ITEMS NOT DRIVABLE ON THIS ARTIFACT: ' +
        result.unreachableItems.join(', ')
    );
    console.log(
      'Do not spend a machine session on these items with this build — they will ' +
        'fail for want of the feature, not for want of the platform.'
    );
  }
  console.log('');
  console.log(result.ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  verifyAcceptanceArtifact,
  countOccurrences,
  FEATURE_MANIFEST,
  CONTROL_ABSENT,
  CONTROL_PRESENT,
};
