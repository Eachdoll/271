from playwright.sync_api import sync_playwright
import json,os
out=os.environ.get('EVAL_QA_OUTPUT','/workspace/artifacts/eval-qa');os.makedirs(out,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 results=[]
 for width in [1280,390]:
  context=browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=context.new_page();errors=[];paid=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('https://fonts.**/*',lambda route:route.abort())
  for host in ['api.anthropic.com','api.openai.com','generativelanguage.googleapis.com']:
   page.route('https://'+host+'/**',lambda route:(paid.append(route.request.url),route.abort()))
  page.goto('http://127.0.0.1:4174',wait_until='networkidle')
  page.locator('[data-action=nav][data-view=settings]').first.click();page.locator('#pin').fill('1234');page.locator('#pin-confirm').fill('1234');page.locator('#pin-form button[type=submit]').click();page.locator('#settings-form').wait_for()
  page.locator('[data-action=settings-tab][data-tab=text]').click();page.locator('#tg-engine').select_option('anthropic');page.locator('[data-action=save-settings-tab]').click();page.wait_for_function("JSON.parse(localStorage.getItem('donghwa-workshop-v1')).settings.textGeneration.engine==='anthropic'")
  outline=page.locator('[data-quality-role-model=outline]');outline.evaluate('(e)=>{e.closest("details").open=true}');assert outline.get_attribute('placeholder')=='claude-sonnet-5-5';assert page.locator('#story-quality-settings').inner_text().find('전문·쪽 나누기는 별도 검증')>=0
  assert page.locator('#quality-models-outline option[value="claude-haiku-5-5"]').count()==1
  page.screenshot(path=f'{out}/anthropic-default-{width}.png',full_page=True)
  outline.fill('claude-opus-5-5');page.locator('[data-action=save-settings-tab]').click();page.wait_for_function("JSON.parse(localStorage.getItem('donghwa-workshop-v1')).settings.storyQuality?.engines?.outline?.model==='claude-opus-5-5'")
  page.reload(wait_until='networkidle');page.locator('[data-action=nav][data-view=settings]').first.click();page.locator('#pin').fill('1234');page.locator('#pin-form button[type=submit]').click();page.locator('[data-quality-role-model=outline]').wait_for(state='attached');outline=page.locator('[data-quality-role-model=outline]');assert outline.input_value()=='claude-opus-5-5';assert outline.get_attribute('placeholder')=='claude-opus-5-5'
  assert not errors,errors;assert not paid,paid;results.append({'width':width,'default':'Sonnet 5.5','explicit Opus':'persists after reload','Haiku 5.5':'available','pageErrors':errors,'paidRequests':len(paid)});context.close()
 browser.close();print(json.dumps(results,ensure_ascii=False))
