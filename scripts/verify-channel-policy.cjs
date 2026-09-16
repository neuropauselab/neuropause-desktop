#!/usr/bin/env node
// §31: derive whether latest==beta is legal under the CONFIGURED policy (from electron-builder channel + a policy file).
// Usage: verify-channel-policy.cjs <policy.json>. RC-phase policy may legally alias latest->beta; non-RC must diverge.
const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
// p: {channel:'beta'|'latest', phase:'rc'|'stable', latestEqualsBeta:true|false}
let legal;
if(p.phase==='rc') legal = true;            // documented RC policy: stable follows beta track
else legal = (p.latestEqualsBeta===false);  // stable phase: channels must diverge
console.log(JSON.stringify({phase:p.phase,latestEqualsBeta:p.latestEqualsBeta,legal,result:legal?'PASS':'DENY'})); process.exit(legal?0:1);
