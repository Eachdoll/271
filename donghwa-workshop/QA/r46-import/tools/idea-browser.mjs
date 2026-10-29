import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/',output='/workspace/artifacts/r46/idea-local.json']=process.argv.slice(2);
const test=fs.readFileSync('/workspace/sites/donghwa-workshop/tests/idea-deck-r46.test.mjs','utf8');
const fixtures=test.slice(test.indexOf('const roomInput ='),test.indexOf("\ntest('R46 the room:"));
const report={base,paidRequests:[],pageErrors:[],runs:[],realModelCouncilVerified:false};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'localhost,127.0.0.1'}}:{})});
const check=(x,m)=>{if(!x)throw Error(m);};
try{
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'ko-KR',serviceWorkers:'block'}),p=await ctx.newPage(),run={width,draws:[]};
  p.on('pageerror',e=>report.pageErrors.push(e.message));
  await p.route('**/api/cloud/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'}));
  await p.route(/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/,r=>{report.paidRequests.push(r.request().url());return r.abort();});
  await p.goto(base,{waitUntil:'networkidle'});
  const click=async s=>{await p.locator(s).first().click();await p.waitForTimeout(200);};
  await click('[data-action="nav"][data-view="settings"]');await p.fill('#pin','1234');await p.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');await click('[data-action="nav"][data-view="create"]');
  let previous=await p.inputValue('#topic');
  for(let i=0;i<4;i++){
   await click('[data-simple-action="idea"]');const draw={topic:await p.inputValue('#topic'),note:await p.locator('#simple-idea-status').innerText()};
   check(draw.topic&&draw.topic!==previous,'Idea did not replace the topic');
   check(['아이디어 ·','발상','인물 짜임','장치','끝'].every(x=>draw.note.includes(x)),'Four cards not shown');run.draws.push(draw);previous=draw.topic;
  }
  run.buttons=await p.locator('.simple-create button:visible').count();check(run.buttons<=12,'Step 1 button cap');
  await click('[data-simple-action="topic"]');run.chipCleared=!(await p.locator('#simple-idea-status').innerText()).trim();check(run.chipCleared,'Topic chip did not clear the card note');
  await click('[data-simple-action="next"]');await p.locator('#simple-allow-new').uncheck();await click('[data-simple-action="next"]');await click('[data-simple-action="start-demo"]');await p.waitForSelector('.simple-create[data-simple-step="4"]',{timeout:90000});await click('[data-simple-action="goto-step"][data-step="3"]');
  run.demoNoIdeaLine=!(await p.locator('.simple-create').innerText()).includes('아이디어 ·');check(run.demoNoIdeaLine,'Demo step 3 should not show an idea line');
  const fixture=await p.evaluate(`(async()=>{
   const {getLevelSpec}=await import('./reading-levels.js'),{normalizeStoryInput}=await import('./story-generation/pipeline.js'),{runStoryCouncil}=await import('./story-generation/council.js'),{renderCouncilReviewForm}=await import('./story-generation/council-room.js');
   ${fixtures}
   const engine=room(),result=await runStoryCouncil(roomInput(),{engine},{engineFor:async()=>engine}),requests=engine.calls.filter(c=>String(c.user).includes('[피치 1개 쓰기]')).map(c=>String(c.user));
   return{html:renderCouncilReviewForm({...result.record,recommended:2}),data:{mockRequests:engine.calls.length,devices:result.record.pitches.map(p=>p.device),materials:result.record.materials,deviceLines:requests.map(u=>/\\[이번 후보의 장치\\] ([^\\n]+)/u.exec(u)?.[1]),turnLines:requests.map(u=>/\\[이번 후보의 반전\\] ([^\\n]+)/u.exec(u)?.[1]),curveLines:requests.map(u=>/\\[이번 후보의 곡선 모양\\] ([^\\n]+)/u.exec(u)?.[1]),koreanOnlyRules:requests.every(u=>u.includes('[말] 제목·한 줄 줄거리와 모든 글은 한국어로만')),growthLeavesSolutionOpen:String(engine.calls[0].user).includes('여기서 정하지 않는다')}};
  })()`);
  run.council=fixture.data;check(['devices','deviceLines','turnLines','curveLines'].every(k=>new Set(run.council[k]).size===3),'Mock requests do not differ');check(run.council.koreanOnlyRules&&run.council.growthLeavesSolutionOpen,'Room rules not applied');
  await p.setContent('<base href="'+base+'"><link rel="stylesheet" href="'+base+'style.css"><div class="modal-overlay"><section class="modal"><div class="modal-body">'+fixture.html+'</div></section></div>',{waitUntil:'networkidle'});
  run.council.deviceTags=await p.locator('.pitch-device').allTextContents();run.council.materialLines=await p.locator('.pitch-materials').allTextContents();
  check(run.council.deviceTags.length===3&&run.council.materialLines.length===3,'Candidate tags missing');
  check(run.council.materialLines.some(t=>t.includes('등장인물 3명 · 유하·해니·동동'))&&run.council.materialLines.some(t=>t.includes('등장인물 2명 · 유하·동동'))&&run.council.materialLines.every(t=>t.includes('장소 1곳 · 편지방')),'App name-based counts differ');
  report.runs.push(run);await ctx.close();
 }
 check(!report.pageErrors.length&&!report.paidRequests.length,'Browser safety check');report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
