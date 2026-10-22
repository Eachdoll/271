import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
import {authorEco} from './eco-author.mjs';
const [base='http://127.0.0.1:4960/',output='/workspace/artifacts/r32/eco-local.json']=process.argv.slice(2),dir=path.dirname(output),tag=path.basename(output,'.json');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
const report={base,author:'Codex-written JSON; no paid API or demo story generation',pageErrors:[],paidRequests:[],cloudWritesBlocked:0,steps:[]};
let page;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR',serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']});page=await context.newPage();
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,route=>{report.paidRequests.push(route.request().url());return route.abort();});
 await page.route('**/api/cloud/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))report.cloudWritesBlocked++;return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'unauthorized'})});});
 const click=async s=>{await page.locator(s).first().click();await page.waitForTimeout(200);};
 const action=a=>click(`[data-simple-action="${a}"]`);
 const shot=async name=>{const file=`${tag}-${name}.png`;await page.screenshot({path:path.join(dir,file),fullPage:true});report.steps.push({step:name,screenshot:file});};
 const currentJob=()=>page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('donghwa-workshop-v1')).fullAutoJobs||{}).find(j=>j.eco));
 await page.goto(base,{waitUntil:'networkidle'});
 await click('[data-action="nav"][data-view="settings"]');await page.fill('#pin','1234');await page.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');
 await click('[data-action="nav"][data-view="create"]');await action('format');
 await page.selectOption('#koreanLevel','K2');await page.selectOption('#englishLevel','E2');await page.selectOption('#pageCount','12');await page.selectOption('#language','bilingual');
 await page.fill('#topic','유하가 숲과 정원에서 빨간 공을 찾아요');await action('next');
 for(const el of await page.locator('[data-simple-action="friend"]').all()){const id=await el.getAttribute('data-id'),on=await el.getAttribute('aria-pressed')==='true';if(on&&id!=='yuha')await el.click();}
 for(const el of await page.locator('[data-simple-action="place"]').all()){const id=await el.getAttribute('data-id'),on=await el.getAttribute('aria-pressed')==='true',want=['home','forest','garden'].includes(id);if(on!==want)await el.click();}
 await page.locator('#simple-allow-new').uncheck();await action('next');await action('start-eco');await page.waitForSelector('#eco-prompt');
 let job=await currentJob();if(!job)throw Error('Eco job not created');report.jobId=job.id;report.initialUsageCalls=job.usage?.calls?.length||0;
 const outlinePrompt=await page.inputValue('#eco-prompt');fs.writeFileSync(path.join(dir,`${tag}-outline-prompt.txt`),outlinePrompt);await action('eco-copy');report.outlineClipboardMatches=await page.evaluate(()=>navigator.clipboard.readText()).then(t=>t===outlinePrompt).catch(()=>false);
 await page.fill('#eco-reply','안 돼요');await action('eco-accept');report.invalidOutlineReasons=await page.locator('.simple-eco-errors').innerText();if(!report.invalidOutlineReasons.includes('JSON'))throw Error('Missing non-JSON rejection reason');await shot('01-invalid-outline');
 const answers=authorEco(job.input);fs.writeFileSync(path.join(dir,`${tag}-outline-answer.json`),JSON.stringify(answers.outline,null,2));fs.writeFileSync(path.join(dir,`${tag}-pages-answer.json`),JSON.stringify(answers.pages,null,2));
 await page.fill('#eco-reply',JSON.stringify(answers.outline));await action('eco-accept');job=await currentJob();if(job.eco.step!=='pages')throw Error('Outline refused: '+JSON.stringify(job.eco.errors));
 const pagesPrompt=await page.inputValue('#eco-prompt');fs.writeFileSync(path.join(dir,`${tag}-pages-prompt.txt`),pagesPrompt);await action('eco-copy');report.pagesClipboardMatches=await page.evaluate(()=>navigator.clipboard.readText()).then(t=>t===pagesPrompt).catch(()=>false);await shot('02-pages-prompt');
 await page.fill('#eco-reply',JSON.stringify({cover:answers.pages.cover,pages:[]}));await action('eco-accept');report.invalidPagesReasons=await page.locator('.simple-eco-errors').innerText();await shot('03-invalid-pages');
 const bad=structuredClone(answers.pages);bad.pages[0].textEn='Yuha carries his little red ball with both of his hands while he slowly walks through the forest and looks around at every small thing along the winding path.';
 await page.fill('#eco-reply',JSON.stringify(bad));await action('eco-accept');job=await currentJob();if(job.eco.step!=='fix')throw Error('Expected level fix step: '+JSON.stringify(job.eco.errors));report.levelFindings=await page.locator('.simple-eco-findings').innerText();report.fixPrompt=await page.inputValue('#eco-prompt');fs.writeFileSync(path.join(dir,`${tag}-fix-prompt.txt`),report.fixPrompt);await shot('04-level-fix');
 const fix={pages:[{pageNo:1,textKo:answers.pages.pages[0].textKo,textEn:answers.pages.pages[0].textEn}]};await page.fill('#eco-reply',JSON.stringify(fix));await action('eco-accept');await page.waitForSelector('.simple-create[data-simple-step="4"]');job=await currentJob();report.preSaveUsageCalls=job.usage?.calls?.length||0;report.bookCheck=job.storyCheck;report.entries=job.book.pages.length;report.printedPages=job.book.pages.reduce((n,p)=>n+(p.kind==='spread'?2:1),0);if(report.printedPages!==12)throw Error('Not twelve printed pages');await shot('05-review');
 report.picturePrompts=[];
 for(let i=0;i<report.entries;i++){
  await action('eco-prompt');const prompt=await page.inputValue('#eco-dialog-text');report.picturePrompts.push({entry:i+1,prompt});if(!prompt.includes('No text, letters'))throw Error('Missing picture instruction');await click('#eco-dialog-close');
  const chooser=page.waitForEvent('filechooser');await action('eco-upload');await (await chooser).setFiles(new URL('./test-upload.png',import.meta.url).pathname);
  await page.waitForFunction(index=>{const s=JSON.parse(localStorage.getItem('donghwa-workshop-v1'));const j=Object.values(s.fullAutoJobs||{}).find(x=>x.eco);return j?.book?.pages?.[index]?.imageMeta?.engine==='upload';},i);
  if(i<report.entries-1)await action('page-next');
 }
 await shot('06-all-uploaded');await action('to-finish');await page.waitForSelector('.simple-create[data-simple-step="5"]');await action('eco-prompt');report.coverPrompt=await page.inputValue('#eco-dialog-text');await click('#eco-dialog-close');await shot('07-no-cover');await action('save-book');await page.getByRole('button',{name:'1쪽 그림을 표지로 쓰고 저장',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books?.some(b=>b.eco&&b.approved===true),{timeout:30000});
 report.saved=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('donghwa-workshop-v1'));const b=s.books.find(b=>b.eco&&b.approved);return {id:b.id,title:b.title,eco:b.eco,approved:b.approved,pages:b.pages.map(p=>({imageAssetId:p.imageAssetId,engine:p.imageMeta?.engine,quality:p.imageMeta?.quality})),cover:b.cover,textCosts:b.textCosts,bookTextUsageCalls:b.textUsage?.calls?.length||0,storyDraftUsageCalls:Object.values(s.storyDrafts||{}).flatMap(d=>d.usage?.calls||[]).length,usageCallRows:Object.values(s.fullAutoJobs||{}).flatMap(j=>j.usage?.calls||[]).length,remainingEcoJobs:Object.values(s.fullAutoJobs||{}).filter(j=>j.eco).length};});
 if(report.preSaveUsageCalls||report.saved.bookTextUsageCalls||report.saved.storyDraftUsageCalls||report.saved.usageCallRows||report.paidRequests.length||report.pageErrors.length)throw Error('Unexpected paid usage or page error');
 report.saved.coverCopiedAsSeparateAsset=report.saved.cover.imageAssetId!==report.saved.pages[0].imageAssetId;
 if(!report.saved.coverCopiedAsSeparateAsset||report.saved.pages.some(p=>p.engine!=='upload'||p.quality!=='final'))throw Error('Upload/cover save failed');
 await click('[data-action="nav"][data-view="library"]');report.shelfHasBook=(await page.locator('body').innerText()).includes(report.saved.title);await shot('08-library');await page.reload({waitUntil:'networkidle'});report.persistedAfterReload=await page.evaluate(()=>JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books.some(b=>b.eco&&b.approved));
 report.cache=await page.evaluate(async()=>{const r=await fetch(new URL('sw.js',location.href));return(await r.text()).match(/donghwa-shell-v\d+/u)?.[0];});report.passed=report.shelfHasBook&&report.persistedAfterReload&&report.cache==='donghwa-shell-v78';
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;if(page)await page.screenshot({path:path.join(dir,`${tag}-error.png`),fullPage:true}).catch(()=>{});}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,error:report.error,entries:report.entries,printedPages:report.printedPages,invalidOutlineReasons:report.invalidOutlineReasons,invalidPagesReasons:report.invalidPagesReasons,usageCallRows:report.saved?.usageCallRows,cache:report.cache,paidRequests:report.paidRequests,pageErrors:report.pageErrors}));}
