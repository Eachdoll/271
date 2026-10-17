from playwright.sync_api import sync_playwright
import json,os
out=os.environ.get('R3_QA_OUTPUT','/workspace/artifacts/r3-qa/after');os.makedirs(out,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 results=[]
 for width in [1280,390]:
  context=browser.new_context(viewport={'width':width,'height':900},service_workers='block');page=context.new_page();page.set_default_timeout(15000);errors=[];paid=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('https://fonts.**/*',lambda route:route.abort())
  for host in ['api.openai.com','generativelanguage.googleapis.com','api.anthropic.com','api.bfl.ai','fal.run']:page.route('https://'+host+'/**',lambda route:(paid.append(route.request.url),route.abort()))
  def action(name):page.locator('[data-story-action='+name+']').first.click()
  def nav(name):page.locator('[data-action=nav][data-view='+name+']').first.click()
  def screenshot(name):page.screenshot(path=f'{out}/{name}-{width}.png',full_page=name not in ['reader','pages'])
  try:
   page.goto('http://127.0.0.1:4174',wait_until='networkidle');screenshot('library')
   assert page.locator('.storage-panel').count()==1
   if width==390:assert page.locator('.book-card').first.bounding_box()['height']<=300
   nav('settings');page.locator('#pin').fill('1234');page.locator('#pin-confirm').fill('1234');page.locator('#pin-form button[type=submit]').click();page.locator('#settings-form').wait_for()
   assert not page.locator('.cloud-status-card').count()
   page.locator('#dailyLimit').select_option('5');assert page.locator('.settings-dirty-dot:visible').count()==1
   page.locator('[data-action=settings-tab][data-tab=text]').click();page.locator('#tg-engine').wait_for();assert not page.locator('#settings-form').count()
   page.locator('[data-action=settings-tab][data-tab=home]').click();assert page.locator('#dailyLimit').input_value()=='5'
   page.locator('[data-action=save-settings-tab]').click();page.wait_for_function("JSON.parse(localStorage.getItem('donghwa-workshop-v1')).settings.dailyLimit===5")
   page.locator('[data-action=settings-tab][data-tab=text]').click();page.locator('.settings-jump a').first.click();assert page.url.endswith('#settings=text');page.locator('#tg-engine').select_option('google');page.locator('[data-quality-role-model=prose]').evaluate('(e)=>{e.closest("details").open=true}');page.locator('[data-quality-role-model=prose]').fill('fixture-model');page.locator('[data-action=settings-tab][data-tab=home]').click();page.locator('[data-action=settings-tab][data-tab=text]').click();assert page.locator('#tg-engine').input_value()=='google';assert page.locator('[data-text-provider=google]').count()==1;assert page.locator('[data-quality-role-model=prose]').input_value()=='fixture-model';page.locator('[data-quality-role-model=prose]').evaluate('(e)=>{e.closest("details").open=true}');page.locator('[data-quality-role-model=prose]').fill('');page.locator('[data-action=save-settings-tab]').click();page.wait_for_function("!document.querySelector('[data-action=save-settings-tab]').disabled")
   page.locator('[data-action=settings-tab][data-tab=image]').click();page.locator('[data-action=save-settings-tab]').click();page.wait_for_function("!document.querySelector('[data-action=save-settings-tab]').disabled")
   screenshot('settings')
   nav('materials');assert not page.locator('.cloud-status-card').count();assert page.locator('.storage-panel').count()==0;screenshot('materials')
   nav('create');page.locator('[data-action=wizard-next]').click();page.locator('#topic').fill('유하와 초록이가 숲에서 노래하는 바람을 찾는 이야기');page.locator('[data-action=wizard-next]').click();page.locator('#value').select_option('custom');page.locator('#valueCustom').fill('서로의 말을 끝까지 듣기');page.locator('[data-action=wizard-next]').click()
   assert page.locator('.steps .step').count()==4;assert page.locator('[data-full-auto-action=start]').count()==1
   page.locator('[data-action=open-story-text-settings]').click();page.locator('#text-engine-settings').wait_for();assert page.locator('[data-action=settings-tab][data-tab=text]').get_attribute('aria-selected')=='true';page.locator('[data-action=return-story-settings]').click()
   page.locator('[data-action=wizard-back]').click();assert page.locator('#valueCustom').input_value()=='서로의 말을 끝까지 듣기';page.locator('[data-action=wizard-back]').click();assert '노래하는 바람' in page.locator('#topic').input_value();page.locator('[data-action=wizard-next]').click();page.locator('[data-action=wizard-next]').click();screenshot('wizard')
   page.locator('[data-action=wizard-next]').click();action('start-api');page.locator('#toast .toast-action').wait_for();page.locator('#toast .toast-action').click();page.locator('[data-text-field=apiKey]').first.wait_for();assert page.locator('[data-text-field=apiKey]').first.evaluate('(e)=>document.activeElement===e');page.locator('[data-action=return-story-settings]').click();page.locator('.story-tools summary').first.click();action('start-demo');page.locator('[data-beat-field=summary]').first.wait_for(state='attached');action('approve-outline');page.locator('[data-story-action=generate-prose]').wait_for();action('generate-prose');page.locator('.story-prose-paragraph').first.wait_for();action('approve-prose');page.locator('#story-page-count').wait_for(state='attached');assert page.locator('[data-story-page]').count()==12
   assert page.locator('.modal-actions #story-accept-failures').count()==1
   assert page.locator('.story-sticky-header .story-steps').count()==1
   page.locator('#story-accept-failures').check();screenshot('pages');action('approve-pages');page.locator('#page-ko').wait_for();assert page.locator('.checks-panel').count()==1
   page.locator('[data-action=check-tab][data-tab=events]').click();page.locator('[data-action=edit-page][data-page="1"]').first.click();assert page.locator('#page-ko').evaluate('(e)=>document.activeElement===e')
   page.locator('[data-action=check-tab][data-tab=reading]').click();assert '[object Object]' not in page.locator('.checks-panel').inner_text();screenshot('checks');screenshot('editor');page.locator('#cache-audio-approval').uncheck();page.locator('[data-action=approve-book]').click();page.locator('.detail-info').wait_for();screenshot('detail')
   state=json.loads(page.evaluate("localStorage.getItem('donghwa-workshop-v1')"));book=state['books'][0];assert len(book['pages'])==12;draft=state['storyDrafts'][book['storyDraftId']];assert draft['stage']=='final' and 'pictureBook' not in draft
   page.locator('[data-action=revise-book-copy]').click();page.locator('#page-ko').wait_for();page.locator('#page-ko').fill('유하가 새로 고친 길을 걸어요.');page.locator('[data-action=regenerate-text]').click();page.locator('[data-story-page]').first.wait_for(state='attached');assert page.locator('[data-story-page]').count()==12;assert '새로 고친 길' in page.locator('[data-page-field=textKo]').first.input_value();screenshot('revision');action('close')
   nav('settings');page.locator('#discard-confirm').click();page.locator('[data-action=settings-tab][data-tab=image]').click();assert not page.locator('.settings-dirty-dot:visible').count()
   page.locator('#ig-compare-prompt').fill('비교 프롬프트 입력만으로 저장을 막지 않아요.');assert not page.locator('.settings-dirty-dot:visible').count()
   forbidden=page.locator('#style-forbidden-form textarea');forbidden.evaluate('(e)=>{e.closest("details").open=true}');forbidden.fill('폭력, 공포');assert not page.locator('.settings-dirty-dot:visible').count();page.locator('#style-forbidden-form button[type=submit]').click();assert not page.locator('.settings-dirty-dot:visible').count()
   page.locator('[data-world-variation=create]').first.click();page.locator('#wv-name').fill('리뷰 검증 World');page.locator('#world-variation-form button[type=submit]').click();page.locator('#ig-world-name').wait_for();assert page.locator('#ig-world-name').input_value()=='리뷰 검증 World';assert not page.locator('.settings-dirty-dot:visible').count()
   page.locator('#ig-world-name').fill('리뷰 검증 World · 수정');assert page.locator('.settings-dirty-dot:visible').count()==1;page.locator('#ig-world-form button[type=submit]').click();page.wait_for_function("!document.querySelector('.settings-dirty-dot:not([hidden])')");assert page.locator('#ig-world-name').input_value().endswith('수정');screenshot('settings-own-save');page.locator('[data-action=settings-tab][data-tab=home]').click();page.locator('#sr-lexile').fill('350');assert not page.locator('.settings-dirty-dot:visible').count();page.locator('[data-reading-action=apply-sr]').click();assert page.locator('.settings-dirty-dot:visible').count()==1;page.locator('[data-action=settings-tab][data-tab=text]').click();page.locator('[data-action=settings-tab][data-tab=home]').click();assert page.locator('#sr-lexile').input_value()=='350';assert page.locator('#default-englishLevel').input_value()=='E2';page.locator('[data-action=save-settings-tab]').click();page.wait_for_function("JSON.parse(localStorage.getItem('donghwa-workshop-v1')).settings.srLexile===350")
   nav('library');page.locator('[data-action=toggle-mode]').click()
   # Deterministic browser speech stub: exercises the real reader event path without sound or external requests.
   page.evaluate("()=>{window.__speechCalls=0;window.speechSynthesis.speak=()=>{window.__speechCalls++}}")
   page.locator('.book-cover-button').first.click();page.locator('.reader').wait_for();assert '재생 버튼을 누르면' in page.locator('#reader-status').inner_text();assert page.evaluate('window.__speechCalls')==0;screenshot('child-silent');page.keyboard.press('Escape')
   page.locator('.book-name[data-action=read-book]').first.click();page.locator('.reader').wait_for();page.wait_for_function("window.__speechCalls>0");assert '읽고 있어요' in page.locator('#reader-status').inner_text();screenshot('child-playing');page.keyboard.press('Escape')
   assert not errors,errors;assert not paid,paid
   results.append({'width':width,'revision':'pages mode restored with edited text','checks':'Korean descriptions','settings':'own saves do not mark dirty; World form clears dirty','child':'cover silent, explicit read plays','pageErrors':errors,'paidRequests':len(paid)})
  except Exception:
   print('ERRORS',errors);print('BODY',page.locator('body').inner_text()[-1800:]);screenshot('failure');raise
  finally:context.close()
 # Protected-data cards are renderer-tested: actual protected navigation must continue to open recovery.
 context=browser.new_context(viewport={'width':390,'height':900},service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/app.js',lambda route:route.fulfill(response=route.fetch(),body=route.fetch().text()+"\nexport function qaRenderProtected(name){view=name;render();}\n"))
 page.route('**/api/cloud/session',lambda route:route.fulfill(json={'authenticated':True,'user':{'id':'review-fixture','displayName':'검증 계정'}}))
 page.route('**/api/cloud/library?meta=1',lambda route:route.fulfill(json={'exists':False,'revision':0,'summary':{'bookCount':0,'characterCount':0,'backgroundCount':0}}))
 page.add_init_script("localStorage.setItem('donghwa-workshop-v1','unreadable review fixture')")
 page.goto('http://127.0.0.1:4174',wait_until='networkidle')
 for target in ['materials','settings']:
  page.evaluate("async name=>(await import('/app.js')).qaRenderProtected(name)",target);assert page.locator('.device-storage-notice.storage-error').count()==1;assert page.locator('.status-chip').inner_text()=='기존 데이터 보호 중';page.screenshot(path=f'{out}/storage-blocked-{target}-390.png',full_page=True)
 assert page.evaluate("localStorage.getItem('donghwa-workshop-v1')")=='unreadable review fixture';assert not errors,errors;context.close()
 results.append({'storageBlocked':'visible on authenticated materials/settings; original preserved','pageErrors':errors});browser.close();print(json.dumps(results,ensure_ascii=False))
