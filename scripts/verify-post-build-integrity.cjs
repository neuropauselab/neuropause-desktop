#!/usr/bin/env node
// §23/§24: compare pre/post build tracked-file state against an explicit generator allowlist. Any unexpected
// add/delete/modify/rename → DENY. Usage: verify-post-build-integrity.cjs <pre.json> <post.json> <allowlist.json>
const fs=require('fs');
const [pre,post,allow]=process.argv.slice(2).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const A=new Set(allow.allowedGeneratedPaths||[]);
const P=new Map(pre.map(x=>[x.path,x.sha256])), Q=new Map(post.map(x=>[x.path,x.sha256]));
const viol=[];
for(const [k,v] of Q){ if(!P.has(k)){ if(!A.has(k)) viol.push('ADD '+k); } else if(P.get(k)!==v){ if(!A.has(k)) viol.push('MODIFY '+k); } }
for(const k of P.keys()){ if(!Q.has(k)) viol.push('DELETE '+k); }
if(viol.length){ console.log(JSON.stringify({result:'DENY',code:'UNEXPECTED_TREE_MUTATION',violations:viol})); process.exit(1); }
console.log(JSON.stringify({result:'PASS'})); process.exit(0);
