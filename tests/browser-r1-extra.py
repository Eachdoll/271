from playwright.sync_api import sync_playwright
import json,os
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(viewport={'width':390,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:4174',wait_until='networkidle')
 result=page.evaluate('''async()=>{
 const {seedState}=await import('/engine.js');const world=await import('/image-generation/world.js');const ui=await import('/image-generation/settings-ui.js');
 const state=seedState();world.migrateWorldState(state);world.getActiveWorld(state).providerConfig=Object.fromEntries(['google','openai','bfl'].map(engine=>[engine,{transport:'proxy',proxyEndpoint:'https://fixture.invalid'}]));
 const fetchOriginal=window.fetch,signals=[];window.fetch=(url,options)=>String(url).includes('fixture.invalid')?new Promise((resolve,reject)=>{signals.push(options.signal);options.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true});}):fetchOriginal(url,options);
 document.querySelector('#app').innerHTML=ui.renderImageSettings(state);
 ui.configureImageUI({getState:()=>state,isParent:()=>true,protectedAction:fn=>fn(),toast:()=>{},save:()=>true,showModal:()=>{},closeModal:()=>{},render:()=>{}});
 const comparison=ui.compareEngines();
 try{await new Promise((resolve,reject)=>{const limit=Date.now()+7000;const timer=setInterval(()=>{if(signals.length===3){clearInterval(timer);resolve();}else if(Date.now()>limit){clearInterval(timer);reject(Error('comparison signals '+signals.length));}},20);});ui.cleanupImageUI();await comparison;return {requests:signals.length,aborted:signals.every(signal=>signal.aborted)};}
 finally{ui.cleanupImageUI();window.fetch=fetchOriginal;}
}''');assert result=={'requests':3,'aborted':True},result
 google=page.evaluate('''async()=>{
 const {prepareGoogleReferences}=await import('/image-generation/providers.js');const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1536;canvas.getContext('2d').fillRect(0,0,2048,1536);const original=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const before=original.size;const [prepared]=await prepareGoogleReferences([original]);const bitmap=await createImageBitmap(prepared);const result={mime:prepared.type,width:bitmap.width,height:bitmap.height,originalUnchanged:original.size===before,sameCachedBlob:(await prepareGoogleReferences([original]))[0]===prepared};bitmap.close();return result;
 }''');assert google=={'mime':'image/webp','width':1024,'height':768,'originalUnchanged':True,'sameCachedBlob':True},google
 recovery=b.new_context(viewport={'width':390,'height':900});rp=recovery.new_page();rp.on('pageerror',lambda e:errors.append(str(e)));rp.goto('http://127.0.0.1:4174',wait_until='networkidle');rp.locator('[data-action=nav][data-view=settings]').first.click();rp.locator('#pin').fill('1234');rp.locator('#pin-confirm').fill('1234');rp.locator('#pin-form button[type=submit]').click();rp.locator('#settings-form').wait_for();count=rp.evaluate("JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books.length");rp.evaluate("localStorage.setItem('donghwa-workshop-credential-v1:pin-lock-v2','corrupt fixture')");rp.reload(wait_until='networkidle');rp.locator('[data-action=nav][data-view=settings]').first.click();rp.locator('#pin').fill('0000');rp.locator('#pin-form button[type=submit]').click();rp.wait_for_function("document.getElementById('pin-error').textContent.includes('맞지')");assert rp.locator('#vault-reset').count()==0;rp.locator('#pin').fill('1234');rp.locator('#pin-form button[type=submit]').click();rp.locator('#vault-reset').wait_for();rp.locator('#vault-reset').click();rp.locator('#settings-form').wait_for();assert rp.evaluate("JSON.parse(localStorage.getItem('donghwa-workshop-v1')).books.length")==count;recovery.close()
 assert not errors,errors
 print(json.dumps({'A-10':result,'A-8':google,'A-14':'PIN verification and UI recovery passed','pageErrors':errors}));b.close()
