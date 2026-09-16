#!/usr/bin/env node
// NP-R34.2-B.30 INDEPENDENT differential checker (structurally different from the primary): computes the FORWARD
// reachable set from the gate (jobs that transitively depend on gate) and DENYs any consequential job NOT in it, or
// with a non-success if:, or neutralized failure. Different traversal + different code path from gate-consumption-ast.cjs.
const fs=require('fs'); const yaml=require(process.env.JS_YAML_PATH||'js-yaml');
const gi=process.argv.indexOf('--gate'); const GATE=gi>=0?process.argv[gi+1]:'candidate-admission';
const raw=fs.readFileSync(process.argv[2],'utf8');
// v2 (B.32) — independent RAW-TEXT checks (different code path from the AST analyzer on purpose):
// (a) dialect: any anchor/alias/merge/multi-doc/%YAML => UNKNOWN; (b) gate block grammar via indentation slicing of the raw text.
if(/(^|[\s\[{,])<<\s*:|^\s*%YAML|(:|^\s*-|[\[{,])\s*[&*][A-Za-z_][\w-]*(\s|$|[,\]}])/m.test(raw) || raw.split(/\r?\n/).filter(l=>/^---\s*$/.test(l)).length>1){ console.log(JSON.stringify({result:'UNKNOWN',code:'DIALECT'})); process.exit(2); }
let d; try{ d=yaml.load(raw); }catch(e){ console.log(JSON.stringify({result:'UNKNOWN'})); process.exit(2); }
if(!d||!d.jobs){ console.log(JSON.stringify({result:'UNKNOWN'})); process.exit(2); }
const arr=v=>v==null?[]:Array.isArray(v)?v:[v];
const J=d.jobs; if(!J[GATE]){ console.log(JSON.stringify({result:'UNKNOWN',code:'GATE_ABSENT'})); process.exit(2); }
// raw-text gate block: from the line `  <GATE>:` (2-space indent) to the next 2-space-indented key
const L=raw.split(/\r?\n/); const gs=L.findIndex(l=>new RegExp('^  '+GATE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*:').test(l));
const gateBad=[]; const unf=[];
// v3: trigger surface
if(!(d.on&&typeof d.on==='object'&&Object.keys(d.on).length===1&&d.on.push&&Object.keys(d.on.push).length===1&&Array.isArray(d.on.push.tags))) gateBad.push('TRIGGER_SURFACE'); if(gs<0) gateBad.push('GATE_BLOCK_NOT_FOUND'); else {
  let ge=L.findIndex((l,i)=>i>gs&&/^  [A-Za-z_][\w-]*\s*:/.test(l)); if(ge<0) ge=L.length; const B=L.slice(gs,ge).join('\n');
  // v3.1: line-grammar checks use the parsed run text of the predicate step (raw block lines may be folded by a YAML emitter); modifier checks stay raw
  for(const x of (J[GATE].steps||[])){ if(x&&typeof x.run==='string'&&!/candidate-admission\.cjs/.test(x.run)&&/\bcd\b|mkdir|\bln\b|\bcp\b|\bmv\b|scripts\//.test(x.run)) gateBad.push('SIBLING_FS_TAMPER'); }
  const RUNS=(J[GATE].steps||[]).filter(x=>x&&typeof x.run==='string'&&/candidate-admission\.cjs/.test(x.run)).map(x=>x.run); const R=RUNS.join('\n');
  if(!/candidate-admission\.cjs/.test(B)) gateBad.push('PREDICATE_ABSENT');
  if(/working-directory\s*:/.test(B) || (d.defaults&&d.defaults.run&&d.defaults.run['working-directory']!==undefined)) gateBad.push('WORKING_DIRECTORY_REDIRECT'); // v3.3
  if(!/^\s*set -euo pipefail\s*$/m.test(R)) gateBad.push('NO_STRICT_MODE');
  if(/^\s*(shell|strategy|continue-on-error|if)\s*:/m.test(B.split(/\n/).filter(l=>!/^\s*#/.test(l)).join('\n').replace(/^  [\w-]+:.*$/m,''))) gateBad.push('STEP_OR_JOB_MODIFIER');
  // per-line: assignment lines (`[export] NAME=...`) may contain shell logic in their value but may never touch hijack names;
  // every other non-comment line must be free of exit-masking constructs.
  for(const l0 of R.split(/\n/)){ const l=l0.trim(); if(!l||l.startsWith('#')) continue;
    const asg=/^(?:export\s+)?([A-Za-z_]\w*)=/.exec(l);
    if(asg){ if(/^(PATH|NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|LD_PRELOAD|DYLD_\w*|RUNNER_\w*)$/.test(asg[1])) gateBad.push('HIJACK_ASSIGN:'+asg[1]); continue; }
    if(/\bexit\b|\bset\s+\+|\btrap\b|\beval\b|\bsource\b|\bexec\b|\|\||\|\s*tee|PATH=|NODE_OPTIONS|GITHUB_ENV|GITHUB_PATH|LD_PRELOAD|DYLD_/.test(l)) gateBad.push('MASKING_OR_HIJACK:'+l.slice(0,30)); }
  if(RUNS.length!==1) gateBad.push('PREDICATE_STEPS_'+RUNS.length);
  // v3.2: sibling steps in the gate job must not tamper with the runner environment (PATH/NODE_OPTIONS/GITHUB_ENV/GITHUB_PATH/set +e/trap/exit)
  for(const x of (J[GATE].steps||[])){ if(!x||typeof x.run!=='string'||/candidate-admission\.cjs/.test(x.run)) continue; if(/PATH=|NODE_OPTIONS|GITHUB_ENV|GITHUB_PATH|LD_PRELOAD|DYLD_|\bset\s+\+|\btrap\b|\bexit\b/.test(x.run)) gateBad.push('SIBLING_TAMPER'); }
  const pl=R.split(/\n/).filter(l=>/candidate-admission\.cjs/.test(l)&&!/^\s*#/.test(l)); if(pl.length!==1) gateBad.push('PREDICATE_COUNT_'+pl.length); else if(!/^\s*node scripts\/candidate-admission\.cjs(\s+[\w.\/-]+)?\s*$/.test(pl[0])) gateBad.push('PREDICATE_NOT_BARE');
}
// forward reachability: R = {gate} ∪ jobs whose needs ⊆ (reachable) ... i.e. depends (directly/transitively) on gate
const dependsOnGate={}; function dep(id){ if(id in dependsOnGate) return dependsOnGate[id]; dependsOnGate[id]=false; const n=arr(J[id]?.needs).map(String); dependsOnGate[id]=n.includes(GATE)||n.some(x=>J[x]&&dep(x)); return dependsOnGate[id]; }
Object.keys(J).forEach(dep);
const topSecret=JSON.stringify(d.env||{}).includes('secrets.');
function cons(id){ const j=J[id]; const s=(j.steps||[]).map(x=>(x.run||'')+' '+(x.uses||'')).join(' ');
  const cred = topSecret || JSON.stringify([j.env||{},j.container||{},j.services||{}]).match(/secrets|github\.token|GITHUB_TOKEN/i) || (j.steps||[]).some(x=>JSON.stringify(x.env||x['with']||{}).includes('secrets.')) || j.secrets==='inherit';
  return cred || typeof j.uses==='string' || /electron-builder|package:(win|mac)|upload-artifact|aws s3|r2\.cloudflarestorage|wrangler|gh release|scp |codesign|notarytool|signtool|stage|promote|publish|deploy|mirror|ship|sign|build/i.test(id+' '+s); }
function ifBad(expr){ if(!expr||typeof expr!=='string') return false; const e=expr.toLowerCase(); if(/always\(|cancelled\(|failure\(/.test(e)) return true;
  const c=e.replace(/\$\{\{|\}\}/g,'').replace(/success\(\)/g,'S').replace(/needs\.[a-z0-9_-]+\.result=='success'/g,'S').replace(/[\s()]/g,'').replace(/&&/g,''); return !(c.length&&[...c].every(ch=>ch==='S')); }
// v3 (B.32): chain-wide if: check — any transitive need (except the gate) with a non-success-only if launders a DENY
function chainIfBad(id,seen=new Set()){ if(seen.has(id))return false; seen.add(id); for(const n of arr(J[id]?.needs).map(String)){ if(n===GATE) continue; const j=J[n]; if(!j) return true; if(ifBad(j.if)) return true; if((j.steps||[]).some(st=>st&&ifBad(st.if))) return true; if(chainIfBad(n,seen)) return true; } return false; }
function chainCoeBad(id,seen=new Set()){ if(seen.has(id))return false; seen.add(id); const j=J[id]; if(!j)return false;
  if(j['continue-on-error']!==undefined&&j['continue-on-error']!==false) return true;
  if((j.steps||[]).some(st=>st['continue-on-error']!==undefined&&st['continue-on-error']!==false)) return true;
  return arr(j.needs).map(String).some(n=>chainCoeBad(n,seen)); }
const bad=[];
for(const id of Object.keys(J)){ if(id===GATE) continue; if(!cons(id)) continue;
  const j=J[id]; if(!dependsOnGate[id]) bad.push(id+':NO_GATE_PATH');
  if(chainIfBad(id)) bad.push(id+':CHAIN_IF_LAUNDER');
  // v3.2: any credential-bearing or publish-verb job must be bound to the protected environment by name
  { const s2=(j.steps||[]).map(x=>(x.run||'')+' '+(x.uses||'')).join(' '); const cred=JSON.stringify([j.env||{},j.container||{},j.services||{},...(j.steps||[]).map(x=>[x.env||{},x['with']||{},x.run||''])]).match(/secrets|github\.token|GITHUB_TOKEN/i); const pub=/aws s3|r2\.cloudflarestorage|wrangler|gh release|scp |rsync |purge_cache|docker push|kubectl (apply|set|rollout|delete)|helm (push|upgrade|install)/i.test(s2);
    if(cred||pub){ const en=j.environment==null?null:(typeof j.environment==='object'?j.environment.name:String(j.environment)); if(en!=='production-release') bad.push(id+':WRITER_ENV_'+(en||'NONE')); } }
  if((j.steps||[]).some(st=>st&&typeof st.uses==='string'&&/^(\.\/|docker:\/\/)/.test(st.uses))) unf.push(id);
  else if(ifBad(j.if)) bad.push(id+':UNSAFE_IF');
  else if(j['continue-on-error']!==undefined&&j['continue-on-error']!==false) bad.push(id+':COE');
  else if(chainCoeBad(id)) bad.push(id+':CHAIN_COE');
  else if(typeof j.uses==='string') bad.push(id+':REUSABLE_UNFOLLOWED');
}
const res=bad.length?'DENY':'PASS';
for(const b of gateBad) bad.push('GATE:'+b); const res2=bad.length?'DENY':(unf.length?'UNKNOWN':'PASS'); console.log(JSON.stringify({result:res2,bad,unfollowable:unf})); process.exit(res2==='PASS'?0:(res2==='UNKNOWN'?2:1));
