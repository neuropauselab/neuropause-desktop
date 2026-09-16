// NP-R34.2-B.32 verify-signing: fail-closed signature/notarization verification of built artifacts.
// Usage: verify-signing.cjs <artifact-dir> --platform windows|macos   (env: EXPECTED_WIN_SIGNER_CN, EXPECTED_MAC_TEAM_ID optional but recommended)
// windows: every *.exe must pass `osslsigncode verify` (Authenticode chain) — runs on Linux runners. macos: every *.dmg/*.zip must pass
// codesign --verify --deep --strict, spctl (Gatekeeper) and `stapler validate` (notarization ticket) — MUST run on a macOS runner.
// Missing tool, wrong platform, zero artifacts, or any failed check => exit 1. Writes signing-receipt.json. Never mutates artifacts.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),os=require('os');
const dir=process.argv[2]; const pi=process.argv.indexOf('--platform'); const platform=pi>0?process.argv[pi+1]:'';
const receipt={platform,dir,checks:[],result:'DENY'}; const out=()=>{ fs.writeFileSync('signing-receipt.json',JSON.stringify(receipt,null,2)); console.log(JSON.stringify(receipt,null,2)); process.exit(receipt.result==='PASS'?0:1); };
const deny=(code,detail)=>{ receipt.checks.push({code,detail,ok:false}); receipt.result='DENY'; out(); };
const run=(cmd,args)=>{ const r=spawnSync(cmd,args,{encoding:'utf8'}); return {status:r.status,error:r.error?String(r.error):null,text:(r.stdout||'')+(r.stderr||'')}; };
if(!dir||!fs.existsSync(dir)||!fs.statSync(dir).isDirectory()) deny('DIR_ABSENT',String(dir));
if(!['windows','macos'].includes(platform)) deny('PLATFORM_UNSPECIFIED','--platform windows|macos required');
const files=fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile());
if(platform==='windows'){
  const exes=files.filter(f=>/\.exe$/i.test(f)); if(!exes.length) deny('NO_ARTIFACTS','no *.exe in '+dir);
  const probe=run('osslsigncode',['--version']); if(probe.error||probe.status===null) deny('TOOL_MISSING','osslsigncode not available: '+(probe.error||''));
  for(const f of exes){ const p=path.join(dir,f); const r=run('osslsigncode',['verify','-in',p]);
    const ok = r.status===0 && /Signature verification: ok/i.test(r.text) && !/Failed/i.test(r.text);
    const cnOk = process.env.EXPECTED_WIN_SIGNER_CN ? r.text.includes(process.env.EXPECTED_WIN_SIGNER_CN) : true;
    receipt.checks.push({code:'AUTHENTICODE',file:f,ok:ok&&cnOk,signerMatched:cnOk,detail:r.text.split('\n').filter(l=>/Subject|Signature verification|Number of signers|Failed/i.test(l)).join(' | ').slice(0,600)});
    if(!process.env.EXPECTED_WIN_SIGNER_CN) receipt.checks.push({code:'SIGNER_CN_NOT_PINNED',file:f,ok:true,detail:'EXPECTED_WIN_SIGNER_CN unset — identity not pinned (set it in the production-release environment)'});
  }
} else {
  if(os.platform()!=='darwin') deny('WRONG_RUNNER','macOS signature/notarization verification requires a macOS runner (codesign/spctl/stapler); got '+os.platform());
  const macs=files.filter(f=>/\.(dmg|zip)$/i.test(f)); if(!macs.length) deny('NO_ARTIFACTS','no *.dmg/*.zip in '+dir);
  for(const t of ['codesign','spctl','xcrun']){ const pr=run(t,['--help']); if(pr.error) deny('TOOL_MISSING',t); }
  for(const f of macs){ const p=path.join(dir,f); let target=p, tmp=null;
    if(/\.zip$/i.test(f)){ tmp=fs.mkdtempSync(path.join(os.tmpdir(),'npsign-')); const u=run('ditto',['-x','-k',p,tmp]); if(u.status!==0){ receipt.checks.push({code:'UNZIP',file:f,ok:false,detail:u.text.slice(0,300)}); continue; }
      const app=fs.readdirSync(tmp).find(x=>/\.app$/.test(x)); if(!app){ receipt.checks.push({code:'NO_APP_IN_ZIP',file:f,ok:false}); continue; } target=path.join(tmp,app); }
    const cs=run('codesign',['--verify','--deep','--strict','--verbose=2',target]); const csOk=cs.status===0;
    const dv=run('codesign',['-dv','--verbose=4',target]); const team=(dv.text.match(/TeamIdentifier=([A-Z0-9]+)/)||[])[1]||null;
    const teamOk=process.env.EXPECTED_MAC_TEAM_ID?team===process.env.EXPECTED_MAC_TEAM_ID:true;
    const sp=run('spctl',['-a','-t',/\.dmg$/i.test(f)?'open':'exec','--context','context:primary-signature','-v',target]); const spOk=sp.status===0&&/accepted/.test(sp.text);
    const st=run('xcrun',['stapler','validate',target]); const stOk=st.status===0&&/The validate action worked/i.test(st.text);
    receipt.checks.push({code:'CODESIGN',file:f,ok:csOk,detail:cs.text.trim().slice(0,300)},{code:'TEAM_ID',file:f,ok:teamOk,team,pinned:!!process.env.EXPECTED_MAC_TEAM_ID},{code:'GATEKEEPER',file:f,ok:spOk,detail:sp.text.trim().slice(0,300)},{code:'NOTARIZATION_STAPLE',file:f,ok:stOk,detail:st.text.trim().slice(0,300)});
    if(tmp) fs.rmSync(tmp,{recursive:true,force:true}); }
}
receipt.result = receipt.checks.length && receipt.checks.every(c=>c.ok) ? 'PASS' : 'DENY'; out();
