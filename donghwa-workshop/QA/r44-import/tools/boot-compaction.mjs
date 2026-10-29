import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/',output='/workspace/artifacts/r44/boot-local.json']=process.argv.slice(2);
const report={base,synthetic:true,pageErrors:[],paidRequests:[],cloudRequests:[],realFamilySaveVerified:false};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
const check=(x,m)=>{if(!x)throw Error(m);};
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR',serviceWorkers:'block'}),p=await ctx.newPage();
 p.on('pageerror',e=>report.pageErrors.push(e.message));
 await p.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.paidRequests.push(r.request().url());return r.abort();});
 await p.route('**/api/cloud/**',r=>{report.cloudRequests.push({method:r.request().method(),path:new URL(r.request().url()).pathname});return r.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'});});
 await p.goto(base,{waitUntil:'networkidle'});
 report.before=await p.evaluate(async()=>{
  const{seedState}=await import('./engine.js'),{migrateWorldState}=await import('./image-generation/world.js'),{migrateReadingSettings}=await import('./reading-ui.js'),{createFullAutoJob}=await import('./full-auto.js');
  const s=seedState();migrateWorldState(s);migrateReadingSettings(s.settings);
  const row={input:1234,output:567,requests:2,costUsd:0.1234,costUsdEstimated:0.1234,model:'synthetic-model',engineId:'openai',stage:'prose',writerCheckpoint:{response:'synthetic-response '.repeat(14000)},richnessReport:{response:'synthetic-report '.repeat(6000)}};
  for(const b of s.books)b.textUsage={calls:[structuredClone(row)]};
  s.storyDrafts||={};s.storyDrafts['r44-meta-only']={id:'r44-meta-only',stage:'final',usage:{calls:[structuredClone(row)]},paginationMeta:{coherence:{passed:true},approvedProse:{ko:'synthetic-prose '.repeat(7000)},qualityCheckpoint:{response:'synthetic-response '.repeat(9000)}}};
  const j=createFullAutoJob(s,{characterIds:['yuha'],backgroundIds:['home'],topic:'창가에서 빗방울 듣기',pageCount:12,koreanLevel:'K1',englishLevel:'E0',language:'bilingual',simpleFlow:true},{allowNew:false,stopBefore:'text',planMode:'selection',councilReview:false});
  j.status='paused';j.usage={calls:[structuredClone(row)]};j.writerCheckpoint={version:1,completed:{resume:'keep-this-response'}};s.fullAutoJobs||={};s.fullAutoJobs[j.id]=j;
  s.books[0].imageUsage={prompt:'synthetic picture request retained',seed:123};
  const raw=JSON.stringify(s);localStorage.setItem('donghwa-workshop-v1',raw);
  return{bytes:new TextEncoder().encode(raw).length,bookId:s.books[0].id,bookCount:s.books.length,jobId:j.id,prose:JSON.stringify(s.books.map(b=>b.pages)),imageUsage:s.books[0].imageUsage,rows:s.books.length+2};
 });
 await p.reload({waitUntil:'networkidle'});
 report.after=await p.evaluate(({jobId})=>{
  const raw=localStorage.getItem('donghwa-workshop-v1'),s=JSON.parse(raw),rows=[...s.books.map(b=>b.textUsage.calls[0]),s.storyDrafts['r44-meta-only'].usage.calls[0],s.fullAutoJobs[jobId].usage.calls[0]];
  return{bytes:new TextEncoder().encode(raw).length,bookCount:s.books.length,rows:rows.length,usageCheckpointCount:rows.filter(r=>Object.keys(r).some(k=>k.endsWith('Checkpoint'))).length,totals:rows.reduce((a,r)=>({input:a.input+r.input,output:a.output+r.output,requests:a.requests+r.requests,costUsd:a.costUsd+r.costUsd}),{input:0,output:0,requests:0,costUsd:0}),allModelNamesKept:rows.every(r=>r.model==='synthetic-model'),resume:s.fullAutoJobs[jobId].writerCheckpoint,meta:s.storyDrafts['r44-meta-only'].paginationMeta,imageUsage:s.books[0].imageUsage,prose:JSON.stringify(s.books.map(b=>b.pages))};
 },{jobId:report.before.jobId});
 check(report.after.bytes<report.before.bytes*0.7,'Boot did not shrink stored library');
 check(!report.after.usageCheckpointCount&&report.after.rows===report.before.rows,'Usage copies not compacted');
 check(report.after.totals.requests===report.before.rows*2&&report.after.totals.input===report.before.rows*1234&&report.after.totals.output===report.before.rows*567&&Math.abs(report.after.totals.costUsd-report.before.rows*0.1234)<1e-9,'Usage totals changed');
 check(report.after.allModelNamesKept&&report.after.resume?.completed?.resume==='keep-this-response','Model or resume data changed');
 check(report.after.prose===report.before.prose&&JSON.stringify(report.after.imageUsage)===JSON.stringify(report.before.imageUsage),'Book or picture data changed');
 check(JSON.stringify(report.after.meta)===JSON.stringify({coherence:{passed:true}}),'Stage copies not removed');
 const firstRaw=await p.evaluate(()=>localStorage.getItem('donghwa-workshop-v1'));
 await p.reload({waitUntil:'networkidle'});report.idempotent=await p.evaluate(raw=>localStorage.getItem('donghwa-workshop-v1')===raw,firstRaw);check(report.idempotent,'Second boot changed compacted storage');
 const click=async selector=>{await p.locator(selector).first().click();await p.waitForTimeout(200);};
 await click('[data-action="nav"][data-view="settings"]');
 if(await p.locator('#pin-confirm').count()){await p.fill('#pin','1234');await p.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');}
 else if(await p.locator('#pin-form').isVisible().catch(()=>false)){await p.fill('#pin','1234');await click('#pin-form button[type="submit"]');}
 await click('[data-action="nav"][data-view="library"]');await click('[data-action="open-book"][data-id="'+report.before.bookId+'"]');await click('[data-action="read-book"][data-id="'+report.before.bookId+'"]');
 report.readerOpened=await p.locator('.reader').count()>0;check(report.readerOpened,'Compacted book reader did not open');
 report.cache=await p.evaluate(async()=>(await(await fetch('./sw.js')).text()).match(/donghwa-shell-v\d+/)?.[0]);
 report.savedPercent=Math.round((1-report.after.bytes/report.before.bytes)*1000)/10;
 delete report.before.prose;delete report.after.prose;
 check(report.cache==='donghwa-shell-v94'&&!report.pageErrors.length&&!report.paidRequests.length&&report.cloudRequests.every(r=>r.method==='GET'),'Safety/cache check');report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
