import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/',output='/workspace/artifacts/r47/fit-local.json']=process.argv.slice(2);
const fixture=JSON.parse(fs.readFileSync('/workspace/sites/donghwa-workshop/tests/fixtures/legacy-page-book-r12.json','utf8'));
const runner=fs.readFileSync('/workspace/sites/donghwa-workshop/scripts/r47-pocket-fit.mjs','utf8');
const measure=/const report = await page\.evaluate\(([\s\S]*?)\);\n  const cut/.exec(runner)?.[1];
if(!measure)throw Error('R47 measurement function not found');
const report={base,synthetic:true,originalBookFilesAvailable:false,originalBookVerification:'unverified',pageErrors:[],paidRequests:[],prints:{}};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
const check=(x,m)=>{if(!x)throw Error(m);};
try{
 const ctx=await browser.newContext({viewport:{width:1400,height:1000},serviceWorkers:'block'});ctx.on('page',p=>p.on('pageerror',e=>report.pageErrors.push(e.message)));
 await ctx.route('**/api/cloud/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'}));
 await ctx.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.paidRequests.push(r.request().url());return r.abort();});
 const p=await ctx.newPage();await p.goto(base,{waitUntil:'networkidle'});
 const data=await p.evaluate(async fixture=>{
  const {normalizeStoryInput,toLegacyPages}=await import('./story-generation/pipeline.js'),{freezeReadingLevels}=await import('./reading-levels.js'),{openingsLayoutPolicy,layoutStatus}=await import('./book-layout.js'),{demoOutline,demoProse,demoPagination}=await import('./story-generation/demo.js'),{getPrintHTML,feedbackBookHTML}=await import('./output.js');
  const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');x.fillStyle='#52788a';x.fillRect(0,0,1600,270);x.fillStyle='#e2c77d';x.fillRect(0,270,1600,630);const png=c.toDataURL('image/png');
  const input=normalizeStoryInput({...fixture.storyInput,promptDiet:{version:1},promptPolicy:{version:1},storyChange:{version:1},storyDrama:{version:1},textPocket:{version:1},bookFormat:{version:1,id:'pictureLed'},layoutPolicy:openingsLayoutPolicy(),pageCount:16,specs:freezeReadingLevels({koreanLevel:'K2',englishLevel:'E2'},{},{layout:'openings'}).specs});
  const outline=demoOutline(input);outline.beats.forEach(b=>b.picturePlan={version:1,carrier:'both',pocket:'top',picture:'a child beside a rug'});
  const ko='“기다리면 혼자 나올까?” 유하가 작게 중얼거려요. 꾸러미가 들썩이면 유하도 따라 들썩들썩해요. 기다려도 그대로라서 유하의 입이 조금 나와요.';
  const en='“Will it come out if I wait?” The bundle bobbed, and Yuha bobbed too.';
  const prose=demoProse(outline,input),pagination=demoPagination(outline,prose,input);pagination.pages=outline.beats.map((b,i)=>({...pagination.pages[0],entryId:'b'+b.index+'-spread',pageNo:i+1,openingIndex:i+1,openingNo:i+1,side:'spread',beatIndex:b.index,kind:'spread',textKo:i%3===2?ko+ko:ko,textEn:i%3===2?en+en:en}));
  const book={...structuredClone(fixture),id:'r47-synthetic-book',title:'R47 합성 글 자리',approved:true,language:'bilingual',storyInput:input,outline,prose,pagination,pages:toLegacyPages(pagination).map(p=>({...p,imageUrl:png,imageMeta:{prompt:"COMPOSITION FIRST … TEXT FIELD: leave the top 30% of the picture's height as one flat field."}})),cover:{imageUrl:png}};
  const status=layoutStatus(book);if(status.layout!=='openings')throw Error('Invalid synthetic opening structure: '+status.errors.join(';'));const before=JSON.stringify(book),out={book,html:{}};
  for(const language of ['bilingual','ko']){
   const b={...structuredClone(book),language};out.html[language]=getPrintHTML(b,{layout:'single',language},[]);out.html[language+'Feedback']=(await feedbackBookHTML(b,{layout:'single',language},[])).html;
  }
  const old=structuredClone(book);delete old.storyInput.textPocket;out.legacyHasNoPocket=!getPrintHTML(old,{layout:'single'},[]).includes('text-pocket');out.unchanged=JSON.stringify(book)===before;return out;
 },fixture);
 report.unchanged=data.unchanged;report.legacyHasNoPocket=data.legacyHasNoPocket;
 for(const [kind,html] of Object.entries(data.html)){
  const q=await ctx.newPage();await q.setContent(html,{waitUntil:'networkidle'});await q.waitForFunction(()=>document.documentElement.dataset.printReady,{},{timeout:30000});await q.waitForTimeout(500);
  const r=await q.evaluate('('+measure+')()');
  const cut=r.rows.filter(t=>(t.ko!==null&&t.ko<.99)||(t.en!==null&&t.en<.99)||t.belowOverflow||t.fieldOverflow);
  const summary={bookFont:r.bookFont,printReady:r.printReady,pockets:r.rows.length,split:r.rows.filter(x=>x.mode==='split').length,spill:r.rows.filter(x=>x.mode==='spill').length,cut:cut.length,pass:cut.length===0&&r.rows.length>0};
  report.prints[kind]={summary,rows:r.rows};
  check(summary.pass,'Synthetic print clipping: '+kind);await q.close();
 }
 // The generated book is inserted only into a fresh browser's local shelf.
 report.readers=[];
 for(const width of [390,1280]){
  const q=await ctx.newPage();await q.setViewportSize({width,height:900});await q.goto(base,{waitUntil:'networkidle'});await q.evaluate(async book=>{const{seedState}=await import('./engine.js');const s=seedState();s.books.unshift(book);localStorage.setItem('donghwa-workshop-v1',JSON.stringify(s));},data.book);await q.reload({waitUntil:'networkidle'});
  const click=async s=>{await q.locator(s).first().click();await q.waitForTimeout(200);};await click('[data-action="nav"][data-view="settings"]');await q.fill('#pin','1234');await q.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');await click('[data-action="nav"][data-view="library"]');await click('[data-action="open-book"][data-id="r47-synthetic-book"]');await click('[data-action="read-book"][data-id="r47-synthetic-book"]');for(let i=0;i<4;i++)await click('[data-action="reader-next"]');await q.waitForTimeout(300);
  const r=await q.evaluate(()=>{const f=document.querySelector('.reader-picture .pocket-frame'),p=f?.querySelector('.text-pocket'),inner=p?.querySelector('.text-pocket-inner'),box=inner?.getBoundingClientRect();return{share:f?.style.getPropertyValue('--pocket-share'),font:p&&getComputedStyle(p).fontSize,overflow:f?.classList.contains('pocket-overflow'),order:[...inner?.children||[]].map(e=>e.classList.contains('ko')?'ko':e.classList.contains('en')?'en':e.lang),visible:[...inner?.children||[]].map(e=>{const r=e.getBoundingClientRect();return{lang:e.classList.contains('ko')?'ko':e.classList.contains('en')?'en':e.lang,ratio:r.height?Math.max(0,Math.min(r.bottom,box.bottom)-Math.max(r.top,box.top))/r.height:0};})};});
  report.readers.push({width,...r});check(r.order[0]==='ko'&&r.visible.some(v=>v.lang==='ko')&&r.visible.some(v=>v.lang==='en')&&r.visible.every(v=>v.ratio>=.99)&&!r.overflow,'Reader text clipped or missing language');await q.close();
 }
 check(report.unchanged&&report.legacyHasNoPocket&&!report.pageErrors.length&&!report.paidRequests.length,'Safety or source mutation');report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
