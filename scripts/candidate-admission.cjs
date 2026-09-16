#!/usr/bin/env node
// NP-R34.2-B.28 candidate-admission: fail-closed source/candidate/version binding (Domain A/B/§23).
// Monorepo extension: the tag must equal the ROOT package.json version AND the apps/desktop version — one release
// identity for every workspace. The signed release authority (np-authority/1, Model E) is admitted by the separate,
// environment-bound `authority-admission` job (scripts/authority-admission.cjs), which every build depends on.
// Inputs via env: GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_REF_NAME, GITHUB_SHA,
//   RELEASE_CANDIDATE_TAG, RELEASE_CANDIDATE_SHA (repo vars), GIT_DIRTY ('true'/'false'),
//   PKG_VERSION (root package.json), DESKTOP_VERSION (apps/desktop/package.json). Writes candidate.json. Exit 1 on any violation.
const fs = require('fs');
function die(msg){ console.error('::error::candidate-admission: '+msg); process.exit(1); }
const e = process.env;
const need = ['GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_REF_NAME','GITHUB_SHA','PKG_VERSION','DESKTOP_VERSION','GIT_DIRTY'];
for (const k of need) if (!e[k]) die('missing env '+k);
if (e.GIT_DIRTY !== 'false') die('dirty or unknown source tree (GIT_DIRTY must be the literal "false"; caller normalizes git status --porcelain)');
if (!e.RELEASE_CANDIDATE_TAG || !e.RELEASE_CANDIDATE_SHA) die('launch candidate NOT designated (RELEASE_CANDIDATE_TAG/SHA unset) — HUMAN_DECISION_REQUIRED');
if (e.GITHUB_EVENT_NAME !== 'push') die('production publication requires event==push, got '+e.GITHUB_EVENT_NAME);
if (!/^refs\/tags\/v/.test(e.GITHUB_REF)) die('production publication requires a v* tag ref, got '+e.GITHUB_REF);
if (e.GITHUB_REF_NAME !== e.RELEASE_CANDIDATE_TAG) die('tag '+e.GITHUB_REF_NAME+' != designated '+e.RELEASE_CANDIDATE_TAG);
if (e.GITHUB_SHA !== e.RELEASE_CANDIDATE_SHA) die('commit '+e.GITHUB_SHA+' != designated '+e.RELEASE_CANDIDATE_SHA);
if (e.GITHUB_REF_NAME.replace(/^v/,'') !== e.PKG_VERSION) die('tag '+e.GITHUB_REF_NAME+' != monorepo version '+e.PKG_VERSION);
if (e.DESKTOP_VERSION !== e.PKG_VERSION) die('apps/desktop version '+e.DESKTOP_VERSION+' != monorepo version '+e.PKG_VERSION+' (one release identity for all workspaces)');
const out = { repository: e.GITHUB_REPOSITORY||null, candidate_sha: e.GITHUB_SHA, candidate_tag: e.GITHUB_REF_NAME,
  candidate_version: e.PKG_VERSION, desktop_version: e.DESKTOP_VERSION, event: e.GITHUB_EVENT_NAME, ref: e.GITHUB_REF, dirty: false };
fs.writeFileSync(process.argv[2]||'candidate.json', JSON.stringify(out,null,2));
console.log('candidate admitted: '+out.candidate_tag+' @ '+out.candidate_sha+' (v'+out.candidate_version+')');
