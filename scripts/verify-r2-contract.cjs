#!/usr/bin/env node
// §39: validate a DECLARATIVE R2 credential contract. NEVER exercises a credential. Missing field → UNKNOWN, not PASS.
const fs=require('fs'); const p=process.argv[2];
const need=['bucket','allowedPrefixes','allowedOperations','TTL','owner','environment','rotationPolicy','revocationPath'];
if(!p||!fs.existsSync(p)){ console.log(JSON.stringify({result:'UNKNOWN',reason:'CONTRACT_ABSENT'})); process.exit(1); }
let c; try{ c=JSON.parse(fs.readFileSync(p,'utf8')); }catch{ console.log(JSON.stringify({result:'UNKNOWN',reason:'MALFORMED'})); process.exit(1); }
const miss=need.filter(k=>c[k]===undefined||c[k]===null||c[k]==='');
if(miss.length){ console.log(JSON.stringify({result:'UNKNOWN',reason:'MISSING:'+miss.join(',')})); process.exit(1); }
console.log(JSON.stringify({result:'CONTRACT_DECLARED',note:'declared only; credential NOT exercised'})); process.exit(0);
