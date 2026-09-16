#!/usr/bin/env node
// NP-R34.2-B.29 verify-feed v3: parse files[] as blocks; require url+sha512 per entry; verify size when present.
// Usage: verify-feed.cjs <feed.yml> <artifact-dir> <expected-version>. Exit 1 on any mismatch/missing.
const fs=require("fs"),path=require("path"),crypto=require("crypto");
function die(m){console.error("::error::verify-feed: "+m);process.exit(1);}
function parseFeed(y){
  const lines=y.split(/\r?\n/); const out=[]; let cur=null, inFiles=false;
  for(const ln of lines){
    if(/^files:\s*$/.test(ln)){inFiles=true;continue;}
    if(inFiles){
      const u=ln.match(/^\s*-\s*url:\s*(.+?)\s*$/);
      if(u){ if(cur) out.push(cur); cur={url:u[1].replace(/['"]/g,''),sha512:null,size:null}; continue; }
      if(/^\S/.test(ln)){ if(cur){out.push(cur);cur=null;} inFiles=false; continue; }  // dedent → end files
      if(cur){ const s=ln.match(/^\s*sha512:\s*(.+?)\s*$/); if(s) cur.sha512=s[1].replace(/['"]/g,'');
               const z=ln.match(/^\s*size:\s*(\d+)\s*$/); if(z) cur.size=z[1]; }
    }
  }
  if(cur) out.push(cur);
  return out;
}
const [feedPath,artDir,expVer]=process.argv.slice(2);
if(!feedPath||!artDir||!expVer) die("usage: verify-feed <feed.yml> <artifact-dir> <expected-version>");
const y=fs.readFileSync(feedPath,"utf8");
const ver=(y.match(/^version:\s*(.+)$/m)||[])[1]?.trim();
if(ver!==expVer) die("feed.version "+ver+" != expected "+expVer);
const entries=parseFeed(y);
if(!entries.length) die("feed lists no files[] entries");
for(const e of entries){
  if(!e.url) die("files[] entry missing url");
  if(!e.sha512) die("files[] entry "+e.url+" MISSING sha512");
  const f=path.join(artDir,e.url);
  if(!fs.existsSync(f)) die("advertised payload absent: "+e.url);
  const buf=fs.readFileSync(f);
  if(crypto.createHash("sha512").update(buf).digest("base64")!==e.sha512) die("payload "+e.url+" sha512 mismatch");
  if(e.size!=null && String(buf.length)!==e.size) die("payload "+e.url+" size "+buf.length+" != declared "+e.size);
}
console.log("feed OK: v"+ver+" — "+entries.length+" payload(s) verified (url+sha512"+(entries.every(e=>e.size!=null)?"+size":"")+")");
