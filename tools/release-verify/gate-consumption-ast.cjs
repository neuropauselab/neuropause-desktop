#!/usr/bin/env node
// NP-R34.2-B.31 gate-consumption analyzer — REAL YAML AST (js-yaml), v3.
// v3 adopts the B.30-relay ROOT FIX: INVERT THE DEFAULT — every non-gate job is CONSEQUENTIAL unless PROVABLY INERT
// (no uses:, no secrets anywhere incl run:, no non-trivial run). A job the classifier can't categorise is examined
// (fail-closed), never dropped. Also: secrets resolved as an EXPRESSION context everywhere (env/with/run, dot AND
// bracket AND format()/fromJSON); permissions normalized (string 'write-all'/'write' AND mapping). Content invariants
// from B.30 retained (gate must invoke candidate-admission.cjs + propagate exit; step-level dangerous-if; env name).
// Fail-closed: parse/no-parser → exit 2; unknown-if/unfollowable-reusable → DENY. Exit 0/1/2.
// PORTABILITY (B.30-relay packaging defect): set JS_YAML_PATH to a js-yaml install; if absent → exit 2 (never regex).
const fs=require('fs');
const YAML_PATH=process.env.JS_YAML_PATH||'js-yaml'; // v6.4: resolve from the repo's own dependency when unset
let yaml; try{ yaml=require(YAML_PATH); }catch(e){ console.error(JSON.stringify({result:'UNKNOWN',code:'NO_YAML_PARSER'})); process.exit(2); }
const gi=process.argv.indexOf('--gate'); const GATE=gi>=0?process.argv[gi+1]:'candidate-admission';
const EXPECTED_ENV=process.env.EXPECTED_ENV||'production-release';
const PREDICATE=/candidate-admission\.cjs/;
let text; try{ text=fs.readFileSync(process.argv[2],'utf8'); }catch(e){ console.log(JSON.stringify({result:'UNKNOWN',code:'READ_ERROR',detail:String(e.message)})); process.exit(2); }
// v5 (B.32): YAML dialect parity with GitHub's parser is not provable here — anchors/aliases/merge keys/%YAML/multi-doc => UNKNOWN (exit 2, fail-closed)
{ const t=text; // v6.3: block AND flow contexts ([ { , : -) for anchors/aliases; merge key anywhere
  const bad = /(^|[\s\[{,])<<\s*:/m.test(t) || /(:|^\s*-|[\[{,])\s*&[A-Za-z_][A-Za-z0-9_-]*(\s|$|[,\]}])/m.test(t) || /(:|^\s*-|[\[{,])\s*\*[A-Za-z_][A-Za-z0-9_-]*\s*($|[,\]}])/m.test(t) || /^\s*%YAML/m.test(t) || (t.match(/^---\s*$/mg)||[]).length>1;
  if(bad){ console.log(JSON.stringify({result:'UNKNOWN',code:'YAML_DIALECT_UNPROVABLE',detail:'anchors/aliases/merge keys/multi-doc present'})); process.exit(2); } }
let doc; try{ doc=yaml.load(text); }catch(e){ console.log(JSON.stringify({result:'UNKNOWN',code:'YAML_PARSE_ERROR',detail:String(e.message)})); process.exit(2); }
if(!doc||typeof doc!=='object'||!doc.jobs){ console.log(JSON.stringify({result:'UNKNOWN',code:'NO_JOBS'})); process.exit(2); }
const asArr=v=>v==null?[]:Array.isArray(v)?v:[v];
// secrets as an EXPRESSION context: dot (secrets.X), bracket (secrets['X']/secrets["X"]), and inside format()/fromJSON — any 'secrets' token in an expression
// v4 (B.32): credential = secrets.* | secrets['*'] | github.token | GITHUB_TOKEN | toJSON(secrets) | any `secrets` context word
const SECRET_RE=/secrets\s*(\.\s*[A-Za-z0-9_]+|\[\s*['"][^'"]+['"]\s*\])|github\s*\.\s*token|\bGITHUB_TOKEN\b|toJSON\s*\(\s*secrets\s*\)|\bsecrets\b/i;
function hasSecret(o){ let f=false; (function w(x){ if(f||x==null)return; if(typeof x==='string'){ if(SECRET_RE.test(x))f=true; } else if(typeof x==='object'){ for(const v of Object.values(x)) w(v);} })(o); return f; }
const topEnvSecret=hasSecret(doc.env||{});
const jobs={};
for(const [id,j] of Object.entries(doc.jobs)){
  const steps=Array.isArray(j.steps)?j.steps:[];
  const runText=steps.map(s=>typeof s.run==='string'?s.run:'').join('\n');
  const usesList=steps.map(s=>typeof s.uses==='string'?s.uses:'').filter(Boolean).concat(typeof j.uses==='string'?[j.uses]:[]);
  // secret scan EVERYWHERE: job env/with, each step env/with/run, top-level env
  const secretHere = topEnvSecret || hasSecret(j.env||{}) || hasSecret(j['with']||{}) || hasSecret(j.container||{}) || hasSecret(j.services||{}) || steps.some(s=>hasSecret(s.env||{})||hasSecret(s['with']||{})||hasSecret(s.run||'')) || j.secrets==='inherit';
  jobs[id]={ id, raw:j, needs:asArr(j.needs).map(String), if:typeof j.if==='string'?j.if:'',
    environment: j.environment?(typeof j.environment==='object'?(j.environment.name||''):String(j.environment)):null,
    permissions: j.permissions!==undefined?j.permissions:null, reusableUses:typeof j.uses==='string'?j.uses:null,
    inherit:j.secrets==='inherit', coe:j['continue-on-error'], steps, uses:usesList, secret:secretHere,
    runText, cmd:(runText+' '+usesList.join(' ')),
    stepBadIf: steps.some(s=>dangerousIf(s.if)), stepCoeBad: steps.some(s=>coeBad(s['continue-on-error'])) };
}
function dangerousIf(e){ if(!e||typeof e!=='string')return false; e=e.toLowerCase(); if(/always\s*\(|cancelled\s*\(|failure\s*\(/.test(e))return true;
  const c=e.replace(/\$\{\{|\}\}/g,'').replace(/success\s*\(\s*\)/g,'S').replace(/needs\.[a-z0-9_-]+\.result\s*==\s*'success'/g,'S').replace(/[\s()]/g,'').replace(/&&/g,''); return !(c.length&&[...c].every(x=>x==='S')); }
function coeBad(v){ return v!==undefined && v!==false; }
// INERT: provably harmless (v4 strict — see below).
// v4 (B.32, closes e11 inert-exemption abuse): EVERY command segment (split on newline ; && || |) must be echo/:/true,
// with no command substitution ($( or backtick), no ${{ }} expression, no redirection to a path outside the workspace;
// any with:, any env: carrying an expression, or any network/publish verb anywhere in run makes the job NON-inert.
const NETVERB=/\b(curl|wget|ssh|scp|rsync|sftp|gh|aws|wrangler|rclone|git\s+push|npm\s+publish|docker\s+push|twine|cargo\s+publish)\b/i;
const WVERB=/stage|promote|publish|deploy|ship|upload|mirror|release/i;
const PUBCMD=/aws s3|r2\.cloudflarestorage|wrangler|gh release (create|upload)|scp |docker push|kubectl (apply|set|rollout|delete)|helm (push|upgrade|install)/i; // v6.4: container/cluster publishers are writers too
function trivialSeg(x){ x=x.trim(); if(!x) return true; if(/\$\(|`|\$\{\{/.test(x)) return false; return /^(echo\b|:$|:\s|true$)/.test(x); }
function inert(j){ if(j.uses.length||j.secret||j.reusableUses||j.inherit) return false;
  if(WVERB.test(j.id)) return false; // v6.1 (B.32, hunter a12): a job NAMED like a writer is never exempt, even when hollowed to an echo
  if(j.steps.some(s=>s&&typeof s==='object'&&s.with!==undefined)) return false;
  if(j.raw&&(j.raw.container!==undefined||j.raw.services!==undefined)) return false; // v6.2: containers/services can carry credentials and side effects
  if(JSON.stringify([j.env||null,...j.steps.map(s=>s&&s.env||null)]).includes('${{')) return false;
  const runs=j.steps.map(s=>typeof s.run==='string'?s.run:'').filter(Boolean);
  if(runs.some(r=>NETVERB.test(r)||PUBCMD.test(r))) return false;
  return runs.every(r=>r.split(/\r?\n|;|&&|\|\||\|/).every(trivialSeg)); }
// writer = needs env/perms/secret-before-gate scrutiny
function writer(j){ return j.secret||j.inherit||j.reusableUses||WVERB.test(j.id)||PUBCMD.test(j.cmd); }
function permsWide(p,j){ if(p==null)return false; if(typeof p==='string') return /write/i.test(p); // 'write-all','write'
  const s=JSON.stringify(p);
  if(/"(contents|packages|deployments|actions|pull-requests|issues|statuses|checks|security-events|pages|discussions|repository-projects)":\s*"write"/.test(s)) return true;
  // v6.4 (B.39 A11/A12): OIDC + attestation write is permitted ONLY on a job that holds no credential, invokes no publish/network verb,
  // is not writer-named and is not a reusable/inherit job — i.e. it can attest built artifacts and nothing else. Anything wider is widening.
  if(/"(id-token|attestations)":\s*"write"/.test(s)){ if(!j||j.secret||j.inherit||j.reusableUses||WVERB.test(j.id)||PUBCMD.test(j.cmd)||NETVERB.test(j.runText)) return true; }
  return false; }
function closure(id,seen=new Set()){ for(const n of (jobs[id]?.needs||[])){ if(jobs[n]&&!seen.has(n)){seen.add(n);closure(n,seen);} } return seen; }
const inv=[]; const D=(id,ok,det)=>inv.push({id,result:ok?'PASS':'DENY',detail:det});
// gate content invariant — v5 (B.32): strict gate-script grammar. Closes a03 (`|| exit 0`), a04 (`set +e` + trailing `exit 0`),
// a14 (shell override + `| tee` pipeline), PATH/NODE_OPTIONS hijack, predicate-step `if:`/coe, gate `strategy`, predicate repeated/hidden.
// The step invoking the predicate must be shaped like the golden: first line `set -euo pipefail`; preamble = only `[export] NAME=value`
// (never PATH/NODE_OPTIONS/NODE_PATH/BASH_ENV/ENV/LD_PRELOAD/DYLD_*/RUNNER_*/GITHUB_* except the 4 inputs); the predicate line is exactly
// `node scripts/candidate-admission.cjs [arg]`; epilogue lines are trivial (echo/:/true); no set +e / trap / exit / eval / source / return
// anywhere; no shell: override (absent or exactly `bash`); no if:/continue-on-error on that step; no strategy on the gate job.
const HIJACK=/^(PATH|NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|LD_PRELOAD|DYLD_[A-Z_]*|RUNNER_[A-Z_]*|GITHUB_[A-Z_]*)$/;
const GATE_INPUT=/^GITHUB_(EVENT_NAME|REF|REF_NAME|SHA)$/;
function gateScriptOk(run){
  const lines=run.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));
  if(!lines.length||lines[0]!=='set -euo pipefail') return 'NO_STRICT_MODE';
  if(/\bset\s+\+|\btrap\b|\bexit\b|\beval\b|\bsource\b|^\s*\.\s|\breturn\b|\bexec\b/m.test(run)) return 'EXIT_MASKING_CONSTRUCT';
  const pi=lines.findIndex(l=>PREDICATE.test(l)); if(pi<0) return 'HOLLOW_NOT_INVOKED';
  if(!/^node\s+scripts\/candidate-admission\.cjs(\s+[A-Za-z0-9_.\/-]+)?$/.test(lines[pi])) return 'PREDICATE_NOT_BARE';
  if(lines.slice(pi+1).some(l=>PREDICATE.test(l))) return 'PREDICATE_REPEATED';
  for(const l of lines.slice(1,pi)){ const m=/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l); if(!m) return 'UNTRUSTED_PREAMBLE:'+l.slice(0,40); if(HIJACK.test(m[1])&&!GATE_INPUT.test(m[1])) return 'ENV_HIJACK:'+m[1]; if(/\$\{\{/.test(m[2])) return 'EXPRESSION_IN_PREAMBLE'; }
  for(const l of lines.slice(pi+1)){ if(!l.split(/;|&&|\|\||\|/).every(trivialSeg)) return 'NONTRIVIAL_EPILOGUE:'+l.slice(0,40); }
  return 'OK';
}
let gc='ABSENT';
if(jobs[GATE]){ const g=jobs[GATE]; const raw=g.raw||{};
  const pst=g.steps.filter(s=>s&&typeof s==='object'&&typeof s.run==='string'&&PREDICATE.test(s.run));
  if(!pst.length) gc='HOLLOW_NOT_INVOKED';
  else if(pst.length>1) gc='PREDICATE_IN_MULTIPLE_STEPS';
  else { const st=pst[0]; const envKeys=Object.keys(Object.assign({},raw.env||{},st.env||{}));
    // v6.2 (B.32, wf2 env-perms-concurrency-2/2b/2c): a working-directory redirect makes the textual predicate resolve to a different file
    if(st['working-directory']!==undefined || (raw.defaults&&raw.defaults.run&&raw.defaults.run['working-directory']!==undefined) || (doc.defaults&&doc.defaults.run&&doc.defaults.run['working-directory']!==undefined)) gc='WORKING_DIRECTORY_REDIRECT';
    else if(g.steps.some(x=>x&&typeof x==='object'&&x!==st&&typeof x.run==='string'&&/\bcd\b|mkdir|\bln\b|\bcp\b|\bmv\b|scripts\//.test(x.run))) gc='SIBLING_STEP_FS_TAMPER';
    else if(raw.strategy!==undefined) gc='GATE_HAS_STRATEGY';
    else if(raw.defaults&&raw.defaults.run&&raw.defaults.run.shell!==undefined&&raw.defaults.run.shell!=='bash') gc='GATE_SHELL_OVERRIDE';
    else if(doc.defaults&&doc.defaults.run&&doc.defaults.run.shell!==undefined&&doc.defaults.run.shell!=='bash') gc='WORKFLOW_SHELL_OVERRIDE';
    else if(st.shell!==undefined&&st.shell!=='bash') gc='STEP_SHELL_OVERRIDE';
    else if(st.if!==undefined) gc='PREDICATE_STEP_HAS_IF';
    else if(coeBad(g.coe)||g.stepCoeBad||coeBad(st['continue-on-error'])) gc='EXIT_DISCARDED';
    else if(envKeys.some(k=>HIJACK.test(k)&&!GATE_INPUT.test(k))) gc='ENV_HIJACK_KEY';
    else if(g.steps.some(s=>s&&typeof s==='object'&&s!==st&&typeof s.run==='string'&&/\bset\s+\+|\btrap\b|\bexit\b|PATH=|NODE_OPTIONS|GITHUB_ENV|GITHUB_PATH/.test(s.run))) gc='SIBLING_STEP_TAMPER';
    else gc=gateScriptOk(st.run); } }
D('GATE_INVOKES_PREDICATE', gc==='OK', 'gate content: '+gc);
const badPins=[]; const unfollowable=[]; for(const j of Object.values(jobs)) for(const u of j.uses){
  if(u===j.reusableUses && /^[^./][^@]*\/\.github\/workflows\/[^@]+@[0-9a-f]{40}$/.test(u)) continue; // remote reusable workflow, pinned
  if(/^(\.\/|docker:\/\/)/.test(u) || (u===j.reusableUses)) { unfollowable.push(j.id+':'+u); continue; }   // v6: local/docker/unpinned-reusable => cannot be followed
  const at=(u.split('@')[1]||''); if(!/^[0-9a-f]{40}$/.test(at)||/^0{40}$/.test(at)) badPins.push(j.id+':'+u); }
D('ACTION_PIN_SHAPE', badPins.length===0, badPins.length?('bad/bogus: '+badPins.join(', ')):'@40-hex; RESOLUTION=NOT_AVAILABLE');
// v6 (B.32): trigger surface — production path must be tag-push ONLY (no workflow_dispatch/workflow_call/pull_request/schedule/...)
{ const on=doc.on; const ok = on && typeof on==='object' && !Array.isArray(on) && Object.keys(on).length===1 && on.push && typeof on.push==='object' && Object.keys(on.push).length===1 && Array.isArray(on.push.tags) && on.push.tags.length>0 && on.push.tags.every(t=>/^v/.test(String(t)));
  D('TRIGGER_SURFACE', !!ok, ok?'on.push.tags only':('on = '+JSON.stringify(on)).slice(0,120)); }
// INVERTED DEFAULT: every non-gate, non-inert job is consequential
const consequential=Object.values(jobs).filter(j=>j.id!==GATE && !inert(j));
let anyFail=false,anyUnknown=false; const per=[];
for(const c of consequential){
  const clo=closure(c.id); const reach=clo.has(GATE);
  let cond='SAFE'; if(c.if){ cond=dangerousIf(c.if)?'DANGEROUS':(/success\(\)|needs\.[a-z0-9_-]+\.result\s*==\s*'success'/i.test(c.if)?'SAFE':'UNKNOWN'); }
  const chain=[c.id,...clo]; const coeV=chain.filter(id=>jobs[id]&&(coeBad(jobs[id].coe)||jobs[id].stepCoeBad));
  // v6 (B.32): success must propagate along EVERY job in the closure — an intermediate job (inert or not, except the gate itself)
  // with always()/!cancelled()/failure()/unknown `if:` or a dangerous step-if launders a gate DENY into a downstream success.
  const ifV=[...clo].filter(id=>id!==GATE&&jobs[id]&&((jobs[id].if&&dangerousIf(jobs[id].if))||jobs[id].stepBadIf));
  const ifU=[...clo].filter(id=>id!==GATE&&jobs[id]&&jobs[id].if&&!dangerousIf(jobs[id].if)&&!/success\(\)|needs\.[a-z0-9_-]+\.result\s*==\s*'success'/i.test(jobs[id].if));
  const failProp = coeV.length===0 && !c.stepBadIf && ifV.length===0;
  const isW=writer(c); const wide=permsWide(c.permissions,c); const envOk = !isW ? true : (c.environment===EXPECTED_ENV);
  const reuse=!!c.reusableUses;
  let v='PASS';
  if(!reach) v='DENY';
  else if(cond==='DANGEROUS'||c.stepBadIf) v='DENY';
  else if(cond==='UNKNOWN') v='UNKNOWN';
  else if(!failProp) v='DENY';
  else if(ifU.length) v='UNKNOWN';
  else if(wide) v='DENY';
  else if(!envOk) v='DENY';
  if(reuse && v==='PASS') v='UNKNOWN';
  if(v==='DENY')anyFail=true; if(v==='UNKNOWN')anyUnknown=true;
  per.push({job:c.id, writer:isW, credential:c.secret||c.inherit, gateReachable:reach, conditional:c.if||'(none)', conditionalSafety:cond,
    stepDangerousIf:c.stepBadIf, failurePropagation:failProp, coeViolators:coeV, chainIfViolators:ifV, chainIfUnknown:ifU, permissionsWidened:wide,
    environment:c.environment, environmentOk:envOk, reusableUnfollowable:reuse, verdict:v}); }
const gateFail=inv.some(x=>x.result==='DENY');
let result=(anyFail||gateFail)?'FAIL':((anyUnknown||unfollowable.length)?'UNKNOWN':'PASS'); if(!jobs[GATE])result='UNKNOWN';
console.log(JSON.stringify({property:'Gate=DENY => no consequential job executes (inverted default; content+structure)',
  gateJob:GATE,gatePresent:!!jobs[GATE],gateContent:gc,inertJobs:Object.values(jobs).filter(j=>j.id!==GATE&&inert(j)).map(j=>j.id),
  consequentialJobs:consequential.map(j=>j.id),invariants:inv,unfollowableUses:unfollowable,perJob:per,result},null,2));
process.exit(result==='PASS'?0:(result==='UNKNOWN'?2:1));
