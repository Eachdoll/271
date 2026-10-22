import fs from 'node:fs';
import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright/index.mjs';
const [base='http://127.0.0.1:4960/', output='/workspace/artifacts/r31c/free-local.json']=process.argv.slice(2);
const paidPattern=/api\.openai\.com|api\.anthropic\.com|generativelanguage|fal\.run|bfl\.ai/;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(base.startsWith('https:')&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
const report={base,runs:[]};
try{
 for(const [level,count,width] of [['K1',12,1280],['K2',16,390]]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'ko-KR',serviceWorkers:'block'});
  const page=await context.newPage();const run={level,count,width,pageErrors:[],paidRequests:[],cloudWritesBlocked:0};report.runs.push(run);
  page.on('pageerror',e=>run.pageErrors.push(e.message));
  await page.route(paidPattern,route=>{run.paidRequests.push(route.request().url());return route.abort();});
  await page.route('**/api/cloud/**',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method()))run.cloudWritesBlocked++;return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'unauthorized'})});});
  await page.goto(base,{waitUntil:'networkidle'});
  const click=async selector=>{await page.locator(selector).first().click();await page.waitForTimeout(250);};
  await click('[data-action="nav"][data-view="settings"]');
  await page.fill('#pin','1234');await page.fill('#pin-confirm','1234');await click('#pin-form button[type="submit"]');
  await click('[data-action="nav"][data-view="create"]');await click('[data-simple-action="format"]');
  await page.selectOption('#koreanLevel',level);await page.selectOption('#englishLevel','E0');await page.selectOption('#pageCount',String(count));
  await page.fill('#topic','4살 유하가 스쿨버스를 타고 해니를 만나 장난치며 유치원에 가는 이야기');
  await click('[data-simple-action="next"]');await click('[data-simple-action="next"]');
  await page.locator('.simple-costs').evaluate(el=>{for(let node=el;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});
  run.format=await page.locator('.simple-create').innerText();run.costLines=await page.locator('.simple-costs').innerText();
  const expected=level==='K1'?'$0.65':'$1.77';
  run.priceMatches=run.costLines.includes(expected);if(!run.priceMatches)throw Error(`${level}: unexpected text price`);
  if(level==='K1'){
   await click('[data-simple-action="start-demo"]');await page.waitForSelector('.simple-create[data-simple-step="4"]',{timeout:90000});
   run.demoStep4=true;await click('[data-simple-action="edit-text"]');await click('[data-simple-action="cancel-text"]');await click('[data-simple-action="to-finish"]');
   run.demoStep5=await page.locator('.simple-create[data-simple-step="5"]').isVisible();
  }
  run.cache=await page.evaluate(async()=>{const response=await fetch(new URL('sw.js',location.href));return (await response.text()).match(/donghwa-shell-v\d+/u)?.[0];});
  run.overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  await page.screenshot({path:output.replace(/\.json$/,`-${level}.png`),fullPage:true});
  if(run.pageErrors.length||run.paidRequests.length||run.overflow>1)throw Error(`${level}: browser errors, paid request or overflow`);
  await context.close();
 }
 report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}finally{await browser.close();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,error:report.error,runs:report.runs.map(({format,...run})=>run)}));}
