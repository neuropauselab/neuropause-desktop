#!/usr/bin/env node
// §10/§11: consumes a machine-readable env contract; NEVER queries/mutates repo settings. Distinguishes
// CONFIGURED_AND_VERIFIED / CONFIGURATION_UNKNOWN / CONFIGURED_BUT_UNPROTECTED. Never UNKNOWN->PASS.
const fs=require('fs');
const p=process.argv[2];
if(!p||!fs.existsSync(p)){ console.log(JSON.stringify({result:'CONFIGURATION_UNKNOWN',reason:'ENV_CONTRACT_ABSENT'})); process.exit(1); }
let c; try{ c=JSON.parse(fs.readFileSync(p,'utf8')); }catch{ console.log(JSON.stringify({result:'CONFIGURATION_UNKNOWN',reason:'MALFORMED'})); process.exit(1); }
const need={name:'production-release',requiredReviewers:true,preventSelfReview:true,deploymentTagPattern:'v*',secretsRequired:true};
// A workflow referencing an env is NOT evidence; require an explicit externally-captured verified flag.
if(c.verifiedByAdmin!==true){ console.log(JSON.stringify({result:'CONFIGURATION_UNKNOWN',reason:'NO_EXTERNAL_EVIDENCE (verifiedByAdmin!=true)'})); process.exit(1); }
const bad=Object.entries(need).filter(([k,v])=>c[k]!==v);
if(bad.length){ console.log(JSON.stringify({result:'CONFIGURED_BUT_UNPROTECTED',reason:'missing '+bad.map(x=>x[0]).join(',')})); process.exit(1); }
console.log(JSON.stringify({result:'CONFIGURED_AND_VERIFIED'})); process.exit(0);
