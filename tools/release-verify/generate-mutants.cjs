const fs=require('fs'),path=require('path'),cp=require('child_process');
const YP=process.env.JS_YAML_PATH||'/Users/saurabhpatel/Desktop/np-global-pilot-007b/node_modules/js-yaml';
const yaml=require(YP);
const ED=process.argv[2]; const good=path.join(ED,'fixtures/workflow-gate/good.yml'); const MD=path.join(ED,'mutants');
const base=yaml.load(fs.readFileSync(good,'utf8'));
const clone=()=>JSON.parse(JSON.stringify(base));
// each mutation returns a mutated doc; expected security result = 'DENY' (all are bypass attempts)
const MUT={
 M01_remove_needs:d=>{delete d.jobs['stage-publication'].needs;return d;},
 M02_needs_unrelated:d=>{d.jobs['stage-publication'].needs=['build-windows'];delete d.jobs['build-windows'].needs;return d;}, // sever build from gate too
 M04_if_always:d=>{d.jobs['promote-publication'].if='${{ always() }}';return d;},
 M05_if_not_cancelled:d=>{d.jobs['stage-publication'].if='${{ !cancelled() }}';return d;},
 M06_if_failure_or_success:d=>{d.jobs['promote-publication'].if='${{ failure() || success() }}';return d;},
 M07_if_permissive:d=>{d.jobs['stage-publication'].if="${{ github.actor != '' }}";return d;},
 M08_job_coe_true:d=>{d.jobs['candidate-admission']['continue-on-error']=true;return d;},
 M09_job_coe_expr:d=>{d.jobs['candidate-admission']['continue-on-error']='${{ github.actor != \'\' }}';return d;},
 M10_credential_before_gate:d=>{d.jobs['early-cred']={ 'runs-on':'ubuntu-latest', env:{AWS_SECRET_ACCESS_KEY:'${{ secrets.R2_FEED_SECRET }}'}, steps:[{run:'echo x'}] };return d;},
 M11_credential_no_gate:d=>{d.jobs['leak']={ 'runs-on':'ubuntu-latest', needs:['build-windows'], env:{TOKEN:'${{ secrets.R2_FEED_SECRET }}'}, steps:[{run:'echo x'}] }; delete d.jobs['build-windows'].needs; return d;},
 M12_publish_no_gate:d=>{d.jobs['ship']={ 'runs-on':'ubuntu-latest', steps:[{run:'aws s3 cp dist s3://neuropause-site/'}] };return d;},
 M13_sign_no_gate:d=>{d.jobs['resign']={ 'runs-on':'macos-latest', steps:[{run:'codesign --sign X app'}] };return d;},
 M14_build_no_gate:d=>{d.jobs['rebuild']={ 'runs-on':'ubuntu-latest', steps:[{run:'npm run package:win'}] };return d;},
 M15_decoy_needs_in_run:d=>{delete d.jobs['stage-publication'].needs; d.jobs['stage-publication'].steps=[{run:'echo "needs: candidate-admission"'}];return d;},
 M16_fake_if_in_run:d=>{delete d.jobs['promote-publication'].needs; d.jobs['promote-publication'].steps=[{run:'if: ${{ needs.candidate-admission.result }}'}];return d;},
 M17_flow_mapping_job:d=>{d.jobs['flowpub']={ 'runs-on':'ubuntu-latest', steps:[{run:'aws s3 cp x s3://b/'}] };return d;}, // dumped may be block; still ungated publish
 M21_secrets_inherit:d=>{d.jobs['reuse']={ uses:'./.github/workflows/pub.yml', secrets:'inherit' };return d;},
 M22_top_env_secret:d=>{d.env={R2_LEAK:'${{ secrets.R2_FEED_SECRET }}'}; d.jobs['mirror']={ 'runs-on':'ubuntu-latest', steps:[{run:'echo ${R2_LEAK}'}] };return d;},
 M23_job_env_secret_no_gate:d=>{d.jobs['grab']={ 'runs-on':'ubuntu-latest', env:{K:'${{ secrets.R2_INSTALLER_SECRET }}'}, steps:[{run:'echo x'}] };return d;},
 M24_step_env_secret_no_gate:d=>{d.jobs['grab2']={ 'runs-on':'ubuntu-latest', steps:[{env:{K:'${{ secrets.R2_FEED_SECRET }}'}, run:'echo x'}] };return d;},
 M25_remove_environment:d=>{delete d.jobs['stage-publication'].environment; delete d.jobs['promote-publication'].environment; return d;}, // env is admin-verified separately; not a gate-consumption DENY by itself
 M29_second_publish:d=>{d.jobs['publish2']={ 'runs-on':'ubuntu-latest', steps:[{run:'wrangler r2 object put b/x'}] };return d;},
 M30_second_sign:d=>{d.jobs['sign2']={ 'runs-on':'macos-latest', steps:[{run:'notarytool submit'}] };return d;},
 M31_second_credential:d=>{d.jobs['cred2']={ 'runs-on':'ubuntu-latest', env:{X:'${{ secrets.R2_ACCOUNT_ID }}'}, steps:[{run:'echo x'}] };return d;},
 M34_workflow_call:d=>{d.jobs['called']={ uses:'./.github/workflows/reusable.yml' };return d;},
 M43_step_coe:d=>{d.jobs['candidate-admission'].steps=(d.jobs['candidate-admission'].steps||[]).map((s,i)=>i===1?({...s,'continue-on-error':true}):s);return d;},
};
const results=[];
for(const [id,fn] of Object.entries(MUT)){
  const doc=fn(clone());
  const p=path.join(MD,id+'.yml'); fs.writeFileSync(p, yaml.dump(doc));
  const r1=cp.spawnSync('node',[path.join(ED,'scripts/gate-consumption-ast.cjs'),p],{encoding:'utf8',env:process.env});
  const r2=cp.spawnSync('node',[path.join(ED,'scripts/gate-consumption-ast2.cjs'),p],{encoding:'utf8',env:process.env});
  const v1 = r1.status===0?'PASS':r1.status===2?'UNKNOWN':'DENY';
  const v2 = r2.status===0?'PASS':r2.status===2?'UNKNOWN':'DENY';
  // M25 (remove environment) is NOT a gate-consumption bypass by itself → expected PASS on gate-consumption (env is a separate admin gate)
  const expected = id==='M25_remove_environment' ? 'PASS' : 'DENY';
  const detected = (v1!=='PASS'); // any non-PASS = analyzer refused
  const escape = (expected==='DENY' && v1==='PASS');
  results.push({id,primary:v1,independent:v2,expected,detected,escape,differ:v1!==v2});
}
fs.writeFileSync(path.join(ED,'15_MUTATION_RESULTS.json'), JSON.stringify({total:results.length,
  escapes:results.filter(r=>r.escape).length, results},null,2));
const esc=results.filter(r=>r.escape);
console.log('mutants:',results.length,'| escapes:',esc.length,'| differ(primary vs independent):',results.filter(r=>r.differ).length);
for(const r of results) console.log('  '+r.id.padEnd(30),'primary='+r.primary,'indep='+r.independent, r.escape?'*** ESCAPE ***':(r.differ?'(differ)':''));
