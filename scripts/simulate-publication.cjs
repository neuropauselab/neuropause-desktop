#!/usr/bin/env node
// §63/§65/§66: LOCAL publication simulator (no R2). Models immutable releases/<tag>/ staging → verify → pointer promote
// → public verify → rollback, entirely in a temp dir. Proves failure states never reach PUBLIC_RELEASE_VERIFIED.
// Usage: simulate-publication.cjs <scenario>  scenarios: good|missing-artifact|wrong-digest|partial-promote|rollback|rollback-target-missing
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const scenario=process.argv[2]||'good';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pubsim-'));
const state={phase:'UNADMITTED'};
function h(b){return crypto.createHash('sha512').update(b).digest('base64');}
function fail(code){ console.log(JSON.stringify({scenario,final:state.phase,result:'NO_PUBLICATION',code})); process.exit(0); }
// stage immutable release
const rel=path.join(root,'releases','v1.0.0-rc.30'); fs.mkdirSync(rel,{recursive:true});
const exe=Buffer.from('INSTALLER'); if(scenario!=='missing-artifact') fs.writeFileSync(path.join(rel,'NeuroPause-Setup.exe'),exe);
const feedSha = scenario==='wrong-digest' ? 'WRONGDIGEST==' : h(exe);
fs.writeFileSync(path.join(rel,'beta.yml'),`version: 1.0.0-rc.30\nfiles:\n  - url: NeuroPause-Setup.exe\n    sha512: ${feedSha}\n    size: ${exe.length}\n`);
state.phase='STAGED';
// staged verification
const exePath=path.join(rel,'NeuroPause-Setup.exe');
if(!fs.existsSync(exePath)) fail('STAGED_ARTIFACT_MISSING');
if(h(fs.readFileSync(exePath))!==feedSha) fail('STAGED_DIGEST_MISMATCH');
state.phase='VERIFIED';
// promote pointer (channel)
const ch=path.join(root,'channels'); fs.mkdirSync(ch,{recursive:true});
if(scenario==='partial-promote'){ fs.writeFileSync(path.join(ch,'beta.yml'),fs.readFileSync(path.join(rel,'beta.yml'))); /* payload NOT promoted */ }
else { fs.copyFileSync(path.join(rel,'beta.yml'),path.join(ch,'beta.yml')); fs.copyFileSync(exePath,path.join(ch,'NeuroPause-Setup.exe')); }
state.phase='PROMOTED';
// public verify (payload must exist + match)
const pp=path.join(ch,'NeuroPause-Setup.exe');
if(!fs.existsSync(pp)) fail('PUBLIC_PAYLOAD_MISSING');
if(h(fs.readFileSync(pp))!==feedSha) fail('PUBLIC_DIGEST_MISMATCH');
state.phase='PUBLIC_VERIFIED';
// rollback scenarios
if(scenario==='rollback'||scenario==='rollback-target-missing'){
  const prev=path.join(root,'releases','v1.0.0-rc.29');
  if(scenario==='rollback'){ fs.mkdirSync(prev,{recursive:true}); const p29=Buffer.from('INSTALLER-29'); fs.writeFileSync(path.join(prev,'NeuroPause-Setup.exe'),p29); fs.writeFileSync(path.join(prev,'beta.yml'),`version: 1.0.0-rc.29\nfiles:\n  - url: NeuroPause-Setup.exe\n    sha512: ${h(p29)}\n    size: ${p29.length}\n`);
    fs.copyFileSync(path.join(prev,'beta.yml'),path.join(ch,'beta.yml')); fs.copyFileSync(path.join(prev,'NeuroPause-Setup.exe'),path.join(ch,'NeuroPause-Setup.exe'));
    const rf=fs.readFileSync(path.join(ch,'beta.yml'),'utf8'); const ok=/version: 1.0.0-rc.29/.test(rf)&&h(fs.readFileSync(path.join(ch,'NeuroPause-Setup.exe')))===h(p29);
    console.log(JSON.stringify({scenario,result:ok?'ROLLBACK_VERIFIED':'ROLLBACK_NOT_VERIFIED'})); process.exit(0);
  } else { console.log(JSON.stringify({scenario,result:'ROLLBACK_NOT_VERIFIED',code:'ROLLBACK_TARGET_MISSING'})); process.exit(0); }
}
console.log(JSON.stringify({scenario,final:state.phase,result:'PUBLIC_RELEASE_VERIFIED'})); process.exit(0);
