import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {seedState} from '/workspace/sites/donghwa-workshop/dist/engine.js';
const [base='http://127.0.0.1:4961',output='/workspace/artifacts/r45/large-pull.json']=process.argv.slice(2);
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Only the isolated loopback Worker is allowed');
const report={target:'isolated rebuilt Worker and fresh Chromium',synthetic:true,parentAccountTouched:false,realParentPullVerified:false,paidRequests:[],pageErrors:[],mediaDownloads:0};
const owner='r45-local-'+crypto.randomUUID(),ids=Array.from({length:7},(_,i)=>'image-r45-large-'+String(i+1).padStart(10,'0'));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
let page;
try{
 const fixture=await browser.newPage();await fixture.goto(base);
 const png=Buffer.from(await fixture.evaluate(()=>{const c=document.createElement('canvas');c.width=1536;c.height=1024;const x=c.getContext('2d');x.fillStyle='#52788a';x.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];}),'base64');await fixture.close();
 const bytes=Buffer.alloc(32*1024*1024);png.copy(bytes);const manifest=[];
 for(const [i,id] of ids.entries()){
  bytes[bytes.length-1]=i;
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const r=await fetch(base+'/api/cloud/media/'+id,{method:'PUT',headers:{'oai-authenticated-user-id':owner,'X-Cloud-Account-ID':owner,Origin:base,'Content-Type':'image/png','X-Content-SHA256':sha256},body:bytes});
  if(r.status!==201)throw Error('Synthetic media upload failed: '+r.status+' '+await r.text());
  manifest.push({id,kind:'image',mimeType:'image/png',size:bytes.length,sha256});
 }
 const state=seedState(),sample=state.books[0];
 state.books=[{id:'r45-large-book',title:'R45 합성 큰 책장',characterIds:['yuha'],language:'bilingual',approved:true,pages:ids.map((id,i)=>({...structuredClone(sample.pages[0]),ko:'유하가 그림을 봐요.',en:'Yuha looks at the picture.',imageAssetId:id,imageUrl:'asset:'+id}))}];
 state.settings={readingKoLevel:'K2',readingEnLevel:'E2'};state.worlds=[];state.storyDrafts={};state.fullAutoJobs={};state.daily={};
 const saved=await fetch(base+'/api/cloud/library',{method:'PUT',headers:{'oai-authenticated-user-id':owner,'X-Cloud-Account-ID':owner,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,state,manifest})});
 if(saved.status!==200)throw Error('Synthetic library setup failed: '+saved.status+' '+await saved.text());
 report.imageCount=ids.length;report.bytesPerImage=bytes.length;report.totalImageBytes=manifest.reduce((n,m)=>n+m.size,0);report.estimatedBase64Characters=ids.length*Math.ceil(bytes.length/3)*4;
 const local=seedState();local.books[0].title='R45 이전 기기 자료 보관 확인';
 const ctx=await browser.newContext({viewport:{width:1280,height:900},locale:'ko-KR',serviceWorkers:'block'});await ctx.addInitScript(s=>{if(!localStorage.getItem('r45-test-initialized')){localStorage.setItem('donghwa-workshop-v1',JSON.stringify(s));localStorage.setItem('r45-test-initialized','true');}},local);
 page=await ctx.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.paidRequests.push(r.request().url());return r.abort();});
 await page.route('**/api/cloud/**',r=>{if(new URL(r.request().url()).origin!==base)throw Error('Unexpected cloud origin');return r.continue({headers:{...r.request().headers(),'oai-authenticated-user-id':owner}});});
 page.on('response',r=>{if(r.url().includes('/api/cloud/media/')&&r.request().method()==='GET'&&r.status()===200)report.mediaDownloads++;});
 await page.goto(base,{waitUntil:'networkidle'});
 const click=async s=>{await page.locator(s).first().click();await page.waitForTimeout(250);};
 await click('[data-action="nav"][data-view="settings"]');await page.fill('#pin','1234');await page.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');await click('[data-action="nav"][data-view="library"]');
 await click('[data-action="cloud-open"]');await page.waitForSelector('[data-action="cloud-pull"]',{timeout:20000});await click('[data-action="cloud-pull"]');
 const begin=Date.now();await click('#cloud-action-confirm');
 await page.waitForFunction(()=>{try{return JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books?.[0]?.id==='r45-large-book';}catch{return false;}},{},{timeout:240000,polling:500});
 report.pullMilliseconds=Date.now()-begin;
 report.restored=await page.evaluate(async ids=>{const s=JSON.parse(localStorage.getItem('donghwa-workshop-v1')),{getAsset}=await import('./image-generation/assets.js'),{latestRecoveryPoint,decodeStoredLibrary}=await import('./library-storage.js'),r=await latestRecoveryPoint();const backup=r?JSON.parse(decodeStoredLibrary(r.text)):null;const sizes=[];for(const id of ids)sizes.push((await getAsset(id))?.size||0);return{bookCount:s.books.length,pageCount:s.books[0].pages.length,assetBytes:sizes.reduce((a,b)=>a+b,0),assetCount:sizes.filter(Boolean).length,recoveryReason:r?.reason,recoveryTitle:backup?.books?.[0]?.title,storageHasInlineImages:localStorage.getItem('donghwa-workshop-v1').includes('data:image/')};},ids);
 if(report.restored.assetBytes!==report.totalImageBytes||report.restored.recoveryReason!=='before-cloud-pull'||report.restored.recoveryTitle!==local.books[0].title)throw Error('Assets or recovery copy mismatch');
 await click('[data-action="open-book"][data-id="r45-large-book"]');await click('[data-action="read-book"][data-id="r45-large-book"]');
 await page.waitForFunction(()=>[...document.querySelectorAll('.reader-picture img')].some(e=>e.complete&&e.naturalWidth===1536),{},{timeout:20000});report.readerImageVisible=true;
 await page.reload({waitUntil:'networkidle'});report.persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books[0].id==='r45-large-book');
 if(!report.persisted||report.pageErrors.length||report.paidRequests.length||report.mediaDownloads!==7)throw Error('Persistence/browser safety check');
 report.passed=true;
}catch(e){report.passed=false;report.error=e.message;report.debug=await page?.locator('body').innerText().catch(()=>null);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
