#!/usr/bin/env node
// NP-R34.2-B.29 verify-public v3: public-HTTPS; parse files[] as blocks; require+verify url+sha512(+size) each.
// Usage: verify-public.cjs <feed-url> <expected-version>. Exit 1 on any mismatch. GATES final success.
const https=require("https"),crypto=require("crypto");
function die(m){console.error("::error::verify-public: "+m);process.exit(1);}
function get(u){return new Promise((res,rej)=>{https.get(u,r=>{if(r.statusCode!==200)return rej(new Error("HTTP "+r.statusCode+" "+u));const c=[];r.on("data",d=>c.push(d));r.on("end",()=>res(Buffer.concat(c)));}).on("error",rej);});}
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
(async()=>{
  const [feedUrl,expVer]=process.argv.slice(2);
  if(!feedUrl||!expVer) die("usage: verify-public <feed-url> <expected-version>");
  const base=feedUrl.replace(/\/[^/]*$/,"/");
  let y; try{ y=(await get(feedUrl)).toString("utf8"); }catch(e){ die("feed fetch: "+e.message); }
  const ver=(y.match(/^version:\s*(.+)$/m)||[])[1]?.trim();
  if(ver!==expVer) die("public feed.version "+ver+" != expected "+expVer);
  const entries=parseFeed(y);
  if(!entries.length) die("public feed lists no files[] entries");
  for(const e of entries){
    if(!e.url||!e.sha512) die("public feed entry missing url/sha512");
    let buf; try{ buf=await get(base+e.url); }catch(x){ die("payload fetch "+e.url+": "+x.message); }
    if(crypto.createHash("sha512").update(buf).digest("base64")!==e.sha512) die("public payload "+e.url+" sha512 mismatch");
    if(e.size!=null && String(buf.length)!==e.size) die("public payload "+e.url+" size "+buf.length+" != declared "+e.size);
  }
  console.log("PUBLIC OK: "+base+" v"+ver+" — "+entries.length+" payload(s) verified");
})();
