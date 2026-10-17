import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageEngine, generateImage } from '../dist/image-generation/providers.js';
import { renderImageRequest } from '../dist/image-generation/story-renderer.js';
import { getEngineModel, estimateBookCost } from '../dist/image-generation/models.js';
import { createImageProxyHandler } from '../image-proxy/server.mjs';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const pixels = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const png = `data:image/png;base64,${pixels}`;
const blob = new Blob([Uint8Array.from(atob(pixels), x => x.charCodeAt(0))], { type: 'image/png' });
const req = { scenePrompt: 'The child walks into the garden.', stylePrompt: 'soft watercolor paper', negativePrompt: 'flat vectors', referenceImages: [{ blob, role: 'style_sheet', label: 'warm watercolor' }, { blob, role: 'character_front', label: 'Yuha face' }], seed: 42, size: { width: 1536, height: 1024 }, quality: 'draft' };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('StoryRenderer orders references and composes visual style, scene, roles and no-text instructions', () => {
  const r = renderImageRequest(req, { maxReferenceImages: 16, supportsNegative: false });
  assert.deepEqual(r.referenceImages.map(ref => ref.role), ['character_front', 'style_sheet']);
  assert.match(r.composedPrompt, /^soft watercolor paper/);
  assert.match(r.composedPrompt, /Image 1 is Yuha face/);
  assert.match(r.composedPrompt, /Image 2 is warm watercolor/);
  assert.match(r.composedPrompt, /No text.*no logos/i);
  assert.match(r.composedPrompt, /Avoid: flat vectors/);
  assert.doesNotMatch(renderImageRequest(req, { supportsNegative: true }).composedPrompt, /Avoid:/);
});

test('Only optional background tails can be trimmed, required identity and style images are retained', () => {
  const withBackground = { ...req, referenceImages: [...req.referenceImages, { blob, role: 'background', label: 'garden' }] };
  const r = renderImageRequest(withBackground, { maxReferenceImages: 2 });
  assert.equal(r.droppedReferenceCount, 1);
  assert.equal(r.referenceImages.length, 2);
  assert.throws(() => renderImageRequest(req, { maxReferenceImages: 1 }), error => error.code === 'reference_limit');
});

test('Google draft uses officially documented Lite image model, always at 1K', async () => {
  const engine = createImageEngine({ engine: 'google', config: { apiKey: 'fixture-secret', fetch: async (url, options) => {
    assert.match(url, /gemini-3\.1-flash-lite-image:generateContent$/);
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.imageConfig.imageSize, '1K');
    assert.equal(body.contents[0].parts.length, 3);
    return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: pixels } }] } }] });
  } } });
  assert.equal(engine.capabilities().maxReferenceImages, 14);
  const result = await engine.generate(req);
  assert.ok(result.imageBlob instanceof Blob);
  assert.equal(result.seed, 42);
  assert.equal(result.metadata.seedSupported, false);
  assert.equal(result.model, 'gemini-3.1-flash-lite-image');
  assert.equal(result.costUsd, undefined);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/);
});

test('Final Google pro selection and OpenAI draft/final route to documented model and qualities', async () => {
  assert.equal(getEngineModel('google', 'final', { googlePro: true }), 'gemini-3-pro-image');
  assert.equal(getEngineModel('fal', 'draft'), 'bytedance/seedream/v5/lite');
  assert.equal(getEngineModel('fal', 'final'), 'bytedance/seedream/v5/pro');
  for (const [quality, expected] of [['draft', 'low'], ['final', 'high']]) {
    const r = await generateImage({ ...req, quality }, { engine: 'openai', config: { apiKey: 'fixture', fetch: async (_url, options) => { assert.equal(options.body.get('quality'), expected); return json({ data: [{ b64_json: pixels }] }); } } });
    assert.equal(r.meta.effectiveQuality, expected);
  }
});

test('Cost estimate is distinct from actual provider-reported USD', async () => {
  const estimate = estimateBookCost({ engine: 'google', quality: 'final', pageCount: 12, size: '1024x1024' });
  assert.equal(estimate.imageCount, 13);
  assert.equal(estimate.costUsd, 0.871);
  assert.equal(estimate.estimated, true);
  const r = await generateImage({ ...req, referenceImages: [], quality: 'final' }, { engine: 'openai', config: { apiKey: 'fixture', fetch: async () => json({ data: [{ b64_json: pixels }], cost_usd: 0.213 }) } });
  assert.equal(r.meta.costUsd, 0.213);
  assert.equal(r.meta.costSource, 'provider-response');
  assert.equal(r.meta.costUsdEstimated, 0.17);
});

test('Proxy mode sends pixels and roles with no browser key or authentication headers', async () => {
  const r = await generateImage(req, { engine: 'google', config: { transport: 'proxy', proxyEndpoint: 'http://localhost:8787', apiKey: 'never-send-this', fetch: async (url, options) => {
    assert.equal(url, 'http://localhost:8787/api/image/google');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['x-goog-api-key'], undefined);
    assert.doesNotMatch(options.body, /never-send-this|apiKey/);
    assert.equal(JSON.parse(options.body).referenceImages[0].role, 'character_front');
    return json({ imageUrl: png, seed: null, model: 'gemini-3.1-flash-lite-image', meta: {} });
  } } });
  assert.equal(r.meta.transport, 'proxy');
});

async function callProxy(handler, payload, origin = 'https://app.example.test', path = '/api/image/google') {
  const request = Readable.from([Buffer.from(JSON.stringify(payload))]);
  request.url = path; request.method = 'POST'; request.headers = { 'content-type': 'application/json', origin };
  const response = new EventEmitter();
  response.destroyed = false; response.writableEnded = false;
  response.writeHead = (status, headers) => { response.status = status; response.headers = headers; };
  response.end = value => { response.body = JSON.parse(value); response.writableEnded = true; };
  await handler(request, response);
  return response;
}

test('Local proxy accepts environment keys only, blocks other origins and redacts upstream failures', async () => {
  const handler = createImageProxyHandler({ env: { GOOGLE_IMAGE_API_KEY: 'server-secret', IMAGE_PROXY_ALLOWED_ORIGINS: 'https://app.example.test' }, generate: async (_req, { config }) => { assert.equal(config.apiKey, 'server-secret'); throw new Error('server-secret https://secret.example/'); } });
  const payload = { ...req, referenceImages: [{ dataUrl: png, role: 'style_sheet', label: 'style' }] };
  const failed = await callProxy(handler, payload);
  assert.equal(failed.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /server-secret|secret.example/);
  assert.equal((await callProxy(handler, { ...payload, apiKey: 'client-secret' })).status, 400);
  assert.equal((await callProxy(handler, payload, 'https://other.example.test')).status, 403);
});

test('Wardrobe translation proxy accepts only descriptions and uses the server key', async () => {
  let calls=0;
  const handler=createImageProxyHandler({env:{GOOGLE_IMAGE_API_KEY:'server-secret',IMAGE_PROXY_ALLOWED_ORIGINS:'https://app.example.test'},translate:async(description,options)=>{
    calls++;assert.equal(description,'연보라색 리넨 코트');assert.equal(options.config.apiKey,'server-secret');assert.equal(options.approved,true);assert.ok(options.signal instanceof AbortSignal);
    return {englishDescription:'a lavender linen coat',model:'gemini-3.1-flash-lite-image'};
  }});
  const route='/api/translate/wardrobe/google',payload={description:'연보라색 리넨 코트'};
  const result=await callProxy(handler,payload,undefined,route);
  assert.equal(result.status,200);assert.equal(result.body.englishDescription,'a lavender linen coat');assert.doesNotMatch(JSON.stringify(result.body),/server-secret/);
  assert.equal((await callProxy(handler,{...payload,apiKey:'client-secret'},undefined,route)).status,400);
  assert.equal((await callProxy(handler,{...payload,endpoint:'https://other.example'},undefined,route)).status,400);
  assert.equal((await callProxy(handler,payload,'https://other.example.test',route)).status,403);assert.equal(calls,1);
  const missing=createImageProxyHandler({env:{IMAGE_PROXY_ALLOWED_ORIGINS:'https://app.example.test'},translate:async()=>{throw new Error('must not run');}});
  assert.equal((await callProxy(missing,payload,undefined,route)).status,503);
});

test('A-7 BFL reports the exact sorted eight references that were sent',async()=>{
 const refs=Array.from({length:10},(_,index)=>({blob,role:index===8?'character_front':index===9?'style_sheet':'background',required:false,label:String(index)}));
 let submitted;
 const result=await generateImage({...req,referenceImages:refs},{engine:'bfl',config:{apiKey:'fixture',fetch:async(url,options)=>{
  if(url.includes('get_result'))return json({status:'Ready',result:{sample:png}});
  submitted=JSON.parse(options.body);return json({id:'fixture',polling_url:'https://api.bfl.ai/v1/get_result?id=fixture'});
 }}});
 assert.equal(Object.keys(submitted).filter(k=>/^input_image/.test(k)).length,8);
 assert.deepEqual(result.keptReferences.map(r=>r.label),['8','9','0','1','2','3','4','5']);
 assert.deepEqual(result.meta.referenceMetadata.map(r=>r.label),result.keptReferences.map(r=>r.label));
});
test('A-8 Google rejects oversized inline references before its API fetch',async()=>{
 let calls=0;const oversized=new Blob([new Uint8Array(15*1024*1024)],{type:'image/png'});
 await assert.rejects(generateImage({...req,referenceImages:[{blob:oversized,role:'style_sheet'}]},{engine:'google',config:{apiKey:'fixture',fetch:async()=>{calls++;throw Error('must not fetch');}}}),error=>error.code==='reference_limit_bytes');assert.equal(calls,0);
});
test('A-12 reference downloads and expired output URLs do not report key authentication errors',async()=>{
 await assert.rejects(generateImage({...req,referenceImages:[{imageUrl:'https://images.example/sheet.png',role:'style_sheet'}]},{engine:'google',config:{apiKey:'fixture',fetch:async()=>new Response('',{status:403})}}),error=>error.code==='reference_download_failed' && /시트/.test(error.message));
 await assert.rejects(generateImage({...req,referenceImages:[]},{engine:'openai',config:{apiKey:'fixture',fetch:async url=>String(url).includes('api.openai.com')?json({data:[{url:'https://images.example/expired.png'}]}):new Response('',{status:403})}}),error=>error.code==='result_download_expired' && /만료/.test(error.message));
});
test('A-15 the proxy refuses missing Origin without a matching server token and limits depth',async()=>{
 let calls=0;const handler=createImageProxyHandler({env:{IMAGE_PROXY_TOKEN:'fixture-token'},generate:async()=>{calls++;return {imageUrl:png,seed:1,meta:{}};}});
 assert.equal((await callProxy(handler,{...req,referenceImages:[]},null)).status,403);
 let nested={};for(let index=0;index<34;index++)nested={next:nested};
 const allowed=createImageProxyHandler({env:{IMAGE_PROXY_ALLOWED_ORIGINS:'https://app.example.test'}});
 assert.equal((await callProxy(allowed,{nested})).status,413);assert.equal(calls,0);
});
