from playwright.sync_api import sync_playwright
import json,os
out=os.environ.get('R6_QA_OUTPUT','/workspace/artifacts/r6-qa');os.makedirs(out,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage']);results=[]
 for width in [1280,390]:
  context=browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=context.new_page();errors=[];paid=[];examples=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.on('request',lambda request:examples.append(request.url) if '/examples/approved-books.json' in request.url else None)
  page.route('https://fonts.**/*',lambda route:route.abort())
  for host in ['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','api.bfl.ai','fal.run']:
   page.route('https://'+host+'/**',lambda route:(paid.append(route.request.url),route.abort()))
  page.goto('http://127.0.0.1:4174',wait_until='networkidle');assert not examples
  page.locator('[data-action=nav][data-view=settings]').first.click();page.locator('#pin').fill('1234');page.locator('#pin-confirm').fill('1234');page.locator('#pin-form button[type=submit]').click();page.locator('#settings-form').wait_for()
  page.locator('[data-action=settings-tab][data-tab=text]').click();flag=page.locator('[data-quality-flag=useDistilledExamples]');assert not flag.is_checked();assert not examples
  assert '자동 판정만 통과' in flag.locator('..').inner_text();flag.check();page.locator('[data-action=save-settings-tab]').click();page.wait_for_function("JSON.parse(localStorage.getItem('donghwa-workshop-v1')).settings.storyQuality.useDistilledExamples===true");assert not examples
  loaded=page.evaluate('''async()=>{const {loadStoryQualityData}=await import('/story-generation/quality-adapter.js');const state=JSON.parse(localStorage.getItem('donghwa-workshop-v1'));const data=await loadStoryQualityData(fetch,{includeDistilled:state.settings.storyQuality.useDistilledExamples});return {gold:data.goldBooks.length,distilled:data.distilledBooks.length,frozen:Object.isFrozen(data.distilledBooks[0].outline)};}''');assert loaded=={'gold':24,'distilled':161,'frozen':True},loaded;assert len(examples)==1
  page.screenshot(path=f'{out}/distilled-option-{width}.png',full_page=True)
  page.reload(wait_until='networkidle');assert len(examples)==1;page.locator('[data-action=nav][data-view=settings]').first.click();page.locator('#pin').fill('1234');page.locator('#pin-form button[type=submit]').click();page.locator('[data-quality-flag=useDistilledExamples]').wait_for();assert page.locator('[data-quality-flag=useDistilledExamples]').is_checked()
  fallback=page.evaluate('''async()=>{const {loadStoryQualityData}=await import('/story-generation/quality-adapter.js?fallback-test');const data=await loadStoryQualityData((url,options)=>String(url).includes('/examples/')?Promise.resolve(new Response('',{status:503})):fetch(url,options),{includeDistilled:true});return {gold:data.goldBooks.length,distilled:data.distilledBooks.length};}''');assert fallback=={'gold':24,'distilled':0},fallback
  assert not errors,errors;assert not paid,paid;results.append({'width':width,'default':'OFF','optionalRequests':len(examples),'loaded':loaded,'failureFallback':fallback,'savedOption':'survives reload','pageErrors':errors,'paidRequests':len(paid)});context.close()
 browser.close();print(json.dumps(results,ensure_ascii=False))
