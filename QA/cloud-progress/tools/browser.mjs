import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/',output='/workspace/artifacts/cloud-progress/local.json']=process.argv.slice(2);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
const report={base,synthetic:true,pageErrors:[],providerRequests:[],writes:[],runs:[]};const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};const check=(v,m)=>{if(!v)throw Error(m);};
try{
 const prep=await browser.newContext({serviceWorkers:'block'});await prep.route('**/api/cloud/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{}'}));const p=await prep.newPage();await p.goto(base,{waitUntil:'networkidle'});
 const fixture=await p.evaluate(async()=>{const{seedState}=await import('./engine.js');const local=seedState(),remote=seedState();remote.books[0].title='클라우드 재현 책';const id='image-qa-cloud-progress-123456';const c=document.createElement('canvas');c.width=96;c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#488';ctx.fillRect(0,0,96,64);const data=c.toDataURL('image/png'),bytes=Uint8Array.from(atob(data.split(',')[1]),x=>x.charCodeAt(0));const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');remote.books[0].pages[0].imageAssetId=id;remote.books[0].pages[0].imageUrl='asset:'+id;return{local,remote,bytes:Array.from(bytes),asset:{id,kind:'image',mimeType:'image/png',size:bytes.length,sha256}};});await prep.close();
 for(const scenario of ['automatic','choice']){
  const ctx=await browser.newContext({viewport:{width:scenario==='automatic'?1280:390,height:900},serviceWorkers:'block'}),page=await ctx.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));await ctx.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.providerRequests.push(true);return r.abort();});
  const local=structuredClone(fixture.local);if(scenario==='choice')local.books[0].title='이 기기에서 쓴 책';await ctx.addInitScript(s=>localStorage.setItem('donghwa-workshop-v1',JSON.stringify(s)),local);
  const mediaGate=gate(),mediaEntered=gate(),libraryGate=gate(),libraryEntered=gate();let holdLibrary=false,libraryGets=0;
  await ctx.route('**/api/cloud/**',async route=>{const req=route.request(),url=new URL(req.url());if(req.method()!=='GET'){report.writes.push({scenario,method:req.method()});await route.abort();return;}const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname.endsWith('/session'))return json({authenticated:true,user:{id:'qa-cloud-owner',displayName:'테스트 가족'}});
   if(url.pathname.endsWith('/library')&&url.searchParams.has('meta'))return json({exists:true,revision:1,updatedAt:'2026-11-03T00:00:00Z',summary:{bookCount:fixture.remote.books.length,characterCount:fixture.remote.characters.length,backgroundCount:fixture.remote.backgrounds.length}});
   if(url.pathname.endsWith('/library')){libraryGets++;if(holdLibrary){libraryEntered.resolve();await libraryGate.promise;}return json({exists:true,revision:1,state:fixture.remote,manifest:[fixture.asset],updatedAt:'2026-11-03T00:00:00Z'});}
   if(url.pathname.includes('/media/')){mediaEntered.resolve();await mediaGate.promise;return route.fulfill({status:200,contentType:'image/png',body:Buffer.from(fixture.bytes)});}return route.fulfill({status:404,body:'{}'});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-action="cloud-open"]');
  const row={scenario};
  if(scenario==='automatic'){
   await mediaEntered.promise;await page.locator('[data-action="cloud-open"]').first().click();row.inFlight=await page.locator('#cloud-panel-status').innerText();row.disabledWhileBusy=await page.locator('[data-action="cloud-pull"]').isDisabled();mediaGate.resolve();await page.waitForFunction(()=>document.querySelector('#cloud-panel-status')?.textContent.includes('클라우드 저장됨'),null,{timeout:30000});row.finished=await page.locator('#cloud-panel-status').innerText();row.enabledAfterFinish=await page.locator('[data-action="cloud-pull"]').isEnabled();row.restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books[0].title==='클라우드 재현 책');row.progressShown=row.inFlight.includes('클라우드 자료 불러오는 중')&&row.inFlight.includes('0/1');
  }else{
   await page.waitForFunction(()=>document.querySelector('.status-chip')?.getAttribute('aria-label')?.includes('클라우드에 자료 연결하기'),null,{timeout:15000});holdLibrary=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await libraryEntered.promise;await page.locator('[data-action="cloud-open"]').first().click();row.disabledWhileBusy=await page.locator('[data-action="cloud-pull"]').isDisabled();libraryGate.resolve();await page.waitForFunction(()=>document.querySelector('#cloud-panel-status')?.textContent.includes('클라우드에 자료 연결하기'),null,{timeout:15000});row.enabledAfterFinish=await page.locator('[data-action="cloud-pull"]').isEnabled();row.localUntouched=await page.evaluate(()=>JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books[0].title==='이 기기에서 쓴 책');row.libraryGets=libraryGets;mediaGate.resolve();
  }
  report.runs.push(row);await ctx.close();
 }
 report.passed=report.runs.every(r=>r.disabledWhileBusy&&r.enabledAfterFinish&&(r.scenario==='automatic'?r.progressShown&&r.restored:r.localUntouched))&&!report.pageErrors.length&&!report.providerRequests.length&&!report.writes.length;
 if(!report.passed)process.exitCode=1;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
