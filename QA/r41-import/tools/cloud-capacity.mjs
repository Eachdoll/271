import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/', output='/workspace/artifacts/r41/cloud-local.json']=process.argv.slice(2);
const report={base,paidRequests:[],cloudRequests:[],pageErrors:[],synthetic:true,realFamilySaveVerified:false};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
try {
 const context=await browser.newContext({serviceWorkers:'block'}), page=await context.newPage();
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.paidRequests.push(r.request().url());return r.abort();});
 await page.route('**/api/cloud/**',r=>{report.cloudRequests.push({method:r.request().method(),path:new URL(r.request().url()).pathname});return r.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'});});
 await page.goto(base,{waitUntil:'networkidle'});
 report.capacity=await page.evaluate(async()=>{
  const {createLibraryBackup,clearDirectBlobCache}=await import('./output.js');
  const {restoreImageAsset,deleteImageAsset}=await import('./image-generation/assets.js');
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  canvas.getContext('2d').fillRect(0,0,1,1);
  const png=await new Promise(r=>canvas.toBlob(r,'image/png'));
  const blob=new Blob([png,new Uint8Array(32*1024*1024-png.size)],{type:'image/png'});
  const ids=Array.from({length:5},(_,i)=>'image-r41-synthetic-'+i), urls=[];
  const state={books:[],characters:[],backgrounds:[],worlds:[],settings:{}};
  const result={assetCount:5,bytesPerAsset:blob.size,totalBytes:5*blob.size,over150MiB:5*blob.size>150*1024*1024};
  try {
   for(const id of ids)await restoreImageAsset(id,blob);
   state.characters=ids.map((id,i)=>({id:'test-'+i,name:'합성'+i,sheet:{imageAssetId:id,imageUrl:'asset:'+id}}));
   const before=JSON.stringify(state), cloud=await createLibraryBackup(state,{mode:'blobs'});
   result.cloudPackaged=cloud.assets.size===5&&[...cloud.assets.values()].every(b=>b instanceof Blob);
   result.cloudBytes=[...cloud.assets.values()].reduce((s,b)=>s+b.size,0);
   result.cloudHasNoBase64Text=cloud.text===undefined;
   try {await createLibraryBackup(state);result.fileBackupError=null;}catch(e){result.fileBackupError=e.message;}
   result.fileCapPreserved=/150MB/.test(result.fileBackupError||'');
   result.stateUnchanged=JSON.stringify(state)===before;
   const direct={books:[],characters:ids.map((_,i)=>{const url=URL.createObjectURL(blob);urls.push(url);return{id:'direct-'+i,name:'합성'+i,sheet:{imageUrl:url}};}),backgrounds:[],worlds:[],settings:{}};
   const d=await createLibraryBackup(direct,{mode:'blobs'});
   result.directCloudPackaged=d.assets.size===5;
   result.directCloudBytes=[...d.assets.values()].reduce((s,b)=>s+b.size,0);
  } finally {for(const id of ids)await deleteImageAsset(id);for(const u of urls)URL.revokeObjectURL(u);clearDirectBlobCache();}
  return result;
 });
 report.passed=report.capacity.over150MiB&&report.capacity.cloudPackaged&&report.capacity.fileCapPreserved&&report.capacity.stateUnchanged&&report.capacity.directCloudPackaged&&!report.pageErrors.length&&!report.paidRequests.length&&report.cloudRequests.every(r=>r.method==='GET');
 if(!report.passed)throw Error('Capacity assertions failed');
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
