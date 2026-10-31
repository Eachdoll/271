import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/',output='/workspace/artifacts/r49/fit-local.json']=process.argv.slice(2);
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
  const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');for(let y=0;y<900;y+=20)for(let z=0;z<1600;z+=20){x.fillStyle=(z/20+y/20)%2?'#181818':'#fffcf0';x.fillRect(z,y,20,20);}const busy=c.toDataURL('image/png');x.fillStyle='#52788a';x.fillRect(0,0,600,900);const png=c.toDataURL('image/png');
  const input=normalizeStoryInput({...fixture.storyInput,promptDiet:{version:1},promptPolicy:{version:1},storyChange:{version:1},storyDrama:{version:1},textPocket:{version:1},bookFormat:{version:1,id:'pictureLed'},layoutPolicy:openingsLayoutPolicy(),pageCount:16,specs:freezeReadingLevels({koreanLevel:'K2',englishLevel:'E2'},{},{layout:'openings'}).specs});
  const outline=demoOutline(input);outline.beats.forEach(b=>b.picturePlan={version:1,carrier:'both',pocket:'left',picture:'a child beside a rug'});
  const ko='유하가 문 앞에 섰어요.';
  const en='“Will it come out if I wait?” The bundle bobbed, and Yuha bobbed too.';
  const prose=demoProse(outline,input),pagination=demoPagination(outline,prose,input);pagination.pages=outline.beats.flatMap((b,i)=>(i<2?['left','right']:['spread']).map(side=>({...pagination.pages[0],entryId:'b'+b.index+'-'+side,openingIndex:i+1,openingNo:i+1,side,beatIndex:b.index,kind:side==='spread'?'spread':'page',textKo:ko,textEn:i%3===2?en+en+en:en}))).map((e,i)=>({...e,pageNo:i+1}));
  const book={...structuredClone(fixture),id:'r49-synthetic-book',title:'R48 합성 글 자리',approved:true,language:'bilingual',storyInput:input,outline,prose,pagination,pages:toLegacyPages(pagination).map(p=>({...p,imageUrl:p.beatIndex%2?png:busy,imageMeta:{prompt:"COMPOSITION FIRST … TEXT FIELD: leave the left 35% of the picture's height as one flat field."}})),cover:{imageUrl:png}};
  const status=layoutStatus(book);if(status.layout!=='openings')throw Error('Invalid synthetic opening structure: '+status.errors.join(';'));const before=JSON.stringify(book),out={book,flat:png,busy,html:{}};
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
  const summary={bookFont:r.bookFont,printReady:r.printReady,pockets:r.rows.length,split:r.rows.filter(x=>x.mode==='split').length,on:r.rows.filter(x=>x.mode==='on').length,below:r.rows.filter(x=>x.mode==='below').length,cut:cut.length,pass:cut.length===0&&r.rows.length>0};
  const edges=await q.evaluate(()=>[...document.querySelectorAll('.pocket-frame')].map(f=>{const img=f.querySelector('img'),c=document.createElement('canvas');c.width=96;c.height=54;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,96,54);const px=ctx.getImageData(0,0,1,54).data;let sum=0,sq=0;for(let i=0;i<px.length;i+=4){const v=(px[i]+px[i+1]+px[i+2])/765;sum+=v;sq+=v*v;}const sd=Math.sqrt(Math.max(0,sq/54-(sum/54)**2));return{flat:sd<.06,busy:sd>=.06,on:(f.closest('[data-pocket-host]')||f).classList.contains('pocket-on')};}));summary.busyOn=edges.filter(e=>e.busy&&e.on).length;summary.flatOn=edges.filter(e=>e.flat&&e.on).length;report.prints[kind]={summary,rows:r.rows,warning:await q.locator('#print-pocket-warning').textContent()};check(summary.busyOn===0&&summary.flatOn>0,'Patterned art must stay below, flat edge must take some text: '+kind);
  check(summary.pass,'Synthetic print clipping: '+kind);await q.close();
 }
 // The generated book is inserted only into a fresh browser's local shelf.
 report.readers=[];
 for(const width of [390,1280]){
  const q=await ctx.newPage();await q.setViewportSize({width,height:900});await q.goto(base,{waitUntil:'networkidle'});await q.evaluate(async book=>{const{seedState}=await import('./engine.js');const s=seedState();s.books.unshift(book);localStorage.setItem('donghwa-workshop-v1',JSON.stringify(s));},data.book);await q.reload({waitUntil:'networkidle'});
  const click=async s=>{await q.locator(s).first().click();await q.waitForTimeout(200);};await click('[data-action="nav"][data-view="settings"]');await q.fill('#pin','1234');await q.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');await click('[data-action="nav"][data-view="library"]');await click('[data-action="open-book"][data-id="r49-synthetic-book"]');await click('[data-action="read-book"][data-id="r49-synthetic-book"]');for(let i=0;i<4;i++)await click('[data-action="reader-next"]');await q.waitForTimeout(300);
  const r=await q.evaluate(()=>{const host=document.querySelector('.reader-page[data-pocket-host]'),f=host?.querySelector('.pocket-frame'),panel=f?.querySelector('.text-pocket'),mode=host?.classList.contains('pocket-split')?'split':host?.classList.contains('pocket-on')?'on':'below';const visible=[...host.querySelectorAll('.text-pocket-inner>.ko,.text-pocket-inner>.en,[data-pocket-words]>.ko,[data-pocket-words]>.en')].filter(e=>e.getBoundingClientRect().height>0).map(e=>{const r=e.getBoundingClientRect(),box=e.parentElement.getBoundingClientRect();return{lang:e.classList.contains('ko')?'ko':'en',ratio:r.height?Math.max(0,Math.min(r.bottom,box.bottom)-Math.max(r.top,box.top))/r.height:0};});return{mode,share:f?.style.getPropertyValue('--pocket-share'),visible,overflow:f?.classList.contains('pocket-overflow'),panelBackground:panel&&getComputedStyle(panel).backgroundColor};});
  report.readers.push({width,...r});check(r.visible.some(v=>v.lang==='ko')&&r.visible.some(v=>v.lang==='en')&&r.visible.every(v=>v.ratio>=.99)&&!r.overflow,'Reader text clipped or missing language');await q.close();
 }
 check(report.unchanged&&report.legacyHasNoPocket&&!report.pageErrors.length&&!report.paidRequests.length,'Safety or source mutation');report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
