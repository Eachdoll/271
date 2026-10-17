from playwright.sync_api import sync_playwright
import json,os
out=os.environ.get('R1_QA_OUTPUT','/tmp/donghwa-r1-qa');os.makedirs(out,exist_ok=True)
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
   screenshot('editor');page.locator('#cache-audio-approval').uncheck();page.locator('[data-action=approve-book]').click();page.locator('.detail-info').wait_for();screenshot('detail')
   state=json.loads(page.evaluate("localStorage.getItem('donghwa-workshop-v1')"));book=state['books'][0];assert len(book['pages'])==12;draft=state['storyDrafts'][book['storyDraftId']];assert draft['stage']=='final' and 'pictureBook' not in draft
   page.locator('[data-action=read-book]').click();assert page.locator('.reader').bounding_box()['height']>=890 if width==390 else True;page.locator('.reader-play-options summary').click();page.locator('[data-action=reader-font][data-size="2"]').click();assert page.locator('.reader-font-2').count()==1;screenshot('reader');page.keyboard.press('ArrowRight');assert '2 / 12' in page.locator('.reader-top').inner_text();page.keyboard.press('Escape')
   nav('library');page.locator('#search-books').fill('초록');page.locator('[data-action=favorite]').first.click();assert page.locator('#search-books').input_value()=='초록';page.locator('[data-action=tab][data-tab=favorites]').click();assert page.locator('#search-books').input_value()=='초록'
   page.locator('[data-action=toggle-mode]').click();assert page.locator('body.child-mode').count()==1;assert page.locator('#search-books').count()==0;assert page.locator('#sort').count()==0
   small=page.locator('button:visible,a:visible,select:visible').evaluate_all('(els)=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width<43.9||r.height<43.9}).map(e=>({text:e.textContent,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))');assert not small,small
   screenshot('child');page.locator('[data-action=open-book]').first.click();page.locator('.reader').wait_for();assert page.locator('.reader-font-2').count()==1;page.keyboard.press('Escape')
   page.reload(wait_until='networkidle');assert page.locator('.device-storage-warning').count()==0;assert page.locator('.book-name').filter(has_text=book['title']).count()==1;page.locator('[data-action=open-book]').first.click();page.locator('[data-action=read-book]').click();page.locator('.reader-font-2').wait_for();page.keyboard.press('Escape')
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'), 'overflow'
   assert not errors,errors;assert not paid,paid
   results.append({'width':width,'status':'passed','pageErrors':errors,'paidRequests':len(paid)})
  except Exception:
   print('ERRORS',errors);print('BODY',page.locator('body').inner_text()[-1800:]);screenshot('failure');raise
  finally:context.close()
 browser.close();print(json.dumps(results,ensure_ascii=False))
