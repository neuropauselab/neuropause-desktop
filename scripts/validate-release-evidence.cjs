#!/usr/bin/env node
// NP-R34.2-B.29 validate-release-evidence v2: empty/absent gates -> DENY; PASS-without-evidence -> DENY.
const fs=require("fs"); const OK=new Set(["PASS","PARTIAL","FAIL","DENY","BLOCKED","UNKNOWN","ABSENT","NOT_APPLICABLE","NOT_REACHED","FALSE","DENIED"]);
const p=process.argv[2]; if(!p||!fs.existsSync(p)){ console.log(JSON.stringify({result:"DENY",code:"RECEIPT_ABSENT"})); process.exit(1); }
let r; try{ r=JSON.parse(fs.readFileSync(p,"utf8")); }catch{ console.log(JSON.stringify({result:"DENY",code:"MALFORMED"})); process.exit(1); }
const gates=r.gates; if(!gates || typeof gates!=="object" || Object.keys(gates).length===0){ console.log(JSON.stringify({result:"DENY",code:"NO_GATES"})); process.exit(1); }
const viol=[];
for(const [k,v] of Object.entries(gates)){ if(!v||!OK.has(v.status)) viol.push("BAD_STATUS:"+k); if(v&&v.status==="PASS"&&!v.evidence) viol.push("PASS_WITHOUT_EVIDENCE:"+k); }
if(viol.length){ console.log(JSON.stringify({result:"DENY",violations:viol})); process.exit(1); }
console.log(JSON.stringify({result:"VALID",gates:Object.keys(gates).length})); process.exit(0);
