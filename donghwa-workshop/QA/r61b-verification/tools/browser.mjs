import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4981/',out='/workspace/artifacts/r61b/local.json',fixturePath=process.env.DONGHWA_R61B_FIXTURE||'/workspace/artifacts/r61b/extended/missing-english-fixture.json']=process.argv.slice(2);
const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
const report={base,runs:[],pageErrors:[],paidRequests:[]};let active;
try{
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'ko-KR',serviceWorkers:'block'}),p=await ctx.newPage();active=p;
  p.on('pageerror',e=>report.pageErrors.push(e.message));
  await p.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.paidRequests.push(r.request().url());return r.abort();});
  await p.route('**/api/cloud/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'}));
  await p.goto(base,{waitUntil:'networkidle'});
  const click=async sel=>{report.lastAction=sel;await p.locator(sel).first().click();await p.waitForTimeout(150);if(await p.locator('#pin-form').isVisible().catch(()=>false)&&!await p.locator('#pin-confirm').count()){await p.fill('#pin','1234');await p.locator('#pin-form button[type="submit"]').click();await p.waitForTimeout(150);}};
  await click('[data-action="nav"][data-view="settings"]');await p.fill('#pin','1234');await p.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');
  const id=await p.evaluate(async f=>{
   const {createFullAutoJob}=await import('./full-auto.js');
   const before=JSON.parse(localStorage.getItem('donghwa-workshop-v1')),s=f.state;
   for(const[k,v]of Object.entries(before.settings))if(/^pin/i.test(k))s.settings[k]=v;
   const w={characterIds:['yuha','mom'],backgroundIds:['home','forest'],topic:'숲에서 친구를 만나요',pageCount:16,koreanLevel:'K2',englishLevel:'E2',language:'bilingual',value:'none',ending:'home',simpleFlow:true};
   const job=createFullAutoJob(s,w,{allowNew:false,planMode:'selection',stopBefore:'text'});
   const b=f.book;b.fullAutoRunId=job.id;job.book=b;job.status='text-review';job.input=b.storyInput;job.outline=b.outline;job.pagination=b.pagination;
   s.books.push(b);localStorage.setItem('donghwa-workshop-v1',JSON.stringify(s));return job.id;
  },fixture);
  await p.reload({waitUntil:'networkidle'});await click('[data-action="nav"][data-view="create"]');await click(`[data-simple-action="resume"][data-id="${id}"]`);
  await p.waitForSelector('.simple-create[data-simple-step="4"]');
  for(let i=0;i<fixture.index;i++)await click('[data-simple-action="page-next"]');
  const row={width,review:{en:await p.inputValue('#page-en'),ko:await p.inputValue('#page-ko'),missingNotice:await p.locator('.simple-page-text').innerText(),overflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}};
  assert.equal(row.review.en,'');assert.equal(row.review.ko,fixture.book.pages[fixture.index].ko);assert.match(row.review.missingNotice,/영어 없음/);assert.equal(row.review.overflow,false);
  await click('[data-action="nav"][data-view="library"]');if(await p.getByRole('button',{name:'나가기',exact:true}).isVisible().catch(()=>false)){await p.getByRole('button',{name:'나가기',exact:true}).click();await p.waitForTimeout(200);}await click(`[data-action="open-book"][data-id="${fixture.book.id}"]`);await click(`[data-action="read-book"][data-id="${fixture.book.id}"]`);
  for(let i=0;i<fixture.index;i++)await click('[data-action="reader-next"]');
  row.reader={en:await p.locator('.modal.reader .en').innerText(),ko:await p.locator('.modal.reader .ko').innerText()};assert.equal(row.reader.en,'');assert.equal(row.reader.ko,fixture.book.pages[fixture.index].ko);
  row.print=await p.evaluate(async f=>{const {getPrintHTML}=await import('./output.js');const html=getPrintHTML(f.book,{language:'en',layout:'single'},f.state.characters);const doc=new DOMParser().parseFromString(html,'text/html');return{containsMissingKorean:doc.querySelector('main').textContent.includes(f.book.pages[f.index].ko),english: [...doc.querySelectorAll('main p.en')].map(p=>p.textContent),hasKnownEnglish:html.includes(f.book.pages[0].en)};},fixture);
  assert.equal(row.print.containsMissingKorean,false);assert.equal(row.print.hasKnownEnglish,true);assert(row.print.english.includes(''),'English print retains an empty English block');
  row.cache=await p.evaluate(async()=>(await(await fetch('./sw.js')).text()).match(/donghwa-shell-v\d+/)?.[0]);assert.equal(row.cache,'donghwa-shell-v132');
  report.runs.push(row);await ctx.close();
 }
 assert.equal(report.pageErrors.length,0);assert.equal(report.paidRequests.length,0);report.passed=true;
}catch(e){report.passed=false;report.error=e.stack;report.visible=await active?.locator('body').innerText().catch(()=>null);process.exitCode=1;}finally{await browser.close();fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,runs:report.runs.length,error:report.error,pageErrors:report.pageErrors,paidRequests:report.paidRequests}));}
