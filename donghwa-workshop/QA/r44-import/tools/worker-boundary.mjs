import fs from 'node:fs';
const [base='http://127.0.0.1:4961',output='/workspace/artifacts/r44/worker-boundary.json']=process.argv.slice(2);
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('This harness only permits an isolated local worker');
const account='r44-local-synthetic-'+crypto.randomUUID();
const report={target:'isolated rebuilt worker on loopback',productionServerBoundaryVerified:false,parentAccountTouched:false,paidCalls:0};
try{
 const call=async(method,state,expectedRevision=0)=>{
  const r=await fetch(base+'/api/cloud/library',{method,headers:{'oai-authenticated-user-id':account,'X-Cloud-Account-ID':account,...(method==='PUT'?{'Content-Type':'application/json',Origin:base}:{})},...(method==='PUT'?{body:JSON.stringify({state,expectedRevision,manifest:[]})}:{})});
  return{status:r.status,body:await r.json()};
 };
 const state={books:[],characters:[],backgrounds:[],worlds:[],settings:{},notes:'x'.repeat(10*1024*1024)};
 report.underBytes=new TextEncoder().encode(JSON.stringify(state)).byteLength;
 const a=await call('PUT',state);report.under={status:a.status,errorCode:a.body.error?.code,revision:a.body.revision};
 if(a.status!==200)throw Error('10MiB library was not accepted');
 const read=await call('GET');report.roundtrip={status:read.status,notesBytes:read.body.state?.notes?.length,revision:read.body.revision};
 if(read.status!==200||read.body.state?.notes?.length!==10*1024*1024)throw Error('10MiB roundtrip failed');
 state.notes='x'.repeat(17*1024*1024);report.overBytes=new TextEncoder().encode(JSON.stringify(state)).byteLength;
 const b=await call('PUT',state,1);report.over={status:b.status,errorCode:b.body.error?.code,message:b.body.error?.message};
 if(b.status!==413||b.body.error?.code!=='state_too_large'||!b.body.error?.message?.includes('16MB'))throw Error('17MiB library was not rejected at 16MiB limit');
 const preserved=await call('GET');report.previousPreserved=preserved.body.revision===1&&preserved.body.state?.notes?.length===10*1024*1024;
 if(!report.previousPreserved)throw Error('Rejected write replaced the previous snapshot');
 report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
