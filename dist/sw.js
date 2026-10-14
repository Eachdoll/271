const CACHE='donghwa-shell-v4';
const FILES=['./','./index.html','./style.css','./app.js','./engine.js','./output.js','./manifest.webmanifest','./assets/favicon.svg','./assets/hero.png','./image-generation/index.js','./image-generation/providers.js','./image-generation/styles.js','./image-generation/world.js','./image-generation/vault.js','./image-generation/assets.js','./image-generation/pipeline.js','./image-generation/settings-ui.js','./management.js','./photo-materials.js','./companions.js','./reading-levels.js','./reading-checker.js','./reading-ui.js','./levels.json','./reading-vocab.js','./vocab/dolch_preprimer.txt','./vocab/dolch_primer.txt','./vocab/dolch_first.txt','./vocab/fry_1000.txt','./vocab/cvc_short_vowel.txt','./vocab/dale_chall.txt','./vocab/spache.txt','./style-studio.js','./wardrobe.js','./wardrobe-translation.js','./audio-playback.js','./image-generation/models.js','./image-generation/story-renderer.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('donghwa-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const allowed=FILES.map(path=>new URL(path,self.registration.scope).pathname);
  if(!allowed.includes(url.pathname))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&!response.redirected&&response.type!=='opaque'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||Response.error())));
});
