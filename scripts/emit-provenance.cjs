#!/usr/bin/env node
// NP-R34.2-B.28 emit-provenance (Domain N/§18): immutable provenance object, written BEFORE mutable pointer flip.
// All values machine-derived from env / computed hashes; nothing invented. Usage: emit-provenance.cjs <artifact-dir> > provenance.json
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const e=process.env, dir=process.argv[2]||'dist';
const arts=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()):[];
const files=arts.map(f=>{const b=fs.readFileSync(path.join(dir,f));return{name:f,size:b.length,
  sha256:crypto.createHash('sha256').update(b).digest('hex'),sha512:crypto.createHash('sha512').update(b).digest('base64')};});
process.stdout.write(JSON.stringify({repository:e.GITHUB_REPOSITORY||null,source_sha:e.GITHUB_SHA||null,
  source_ref:e.GITHUB_REF||null,tag:e.GITHUB_REF_NAME||null,package_version:e.PKG_VERSION||null,
  workflow_run_id:e.GITHUB_RUN_ID||null,workflow_run_attempt:e.GITHUB_RUN_ATTEMPT||null,
  triggering_actor:e.GITHUB_ACTOR||null,approving_actor:e.APPROVING_ACTOR||null,artifacts:files},null,2));
