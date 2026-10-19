// R13 엔진 세부 선택: 공급자 → 모델 for text and pictures. Fake fetch only.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, updateWorldGenerationSettings, captureBookGenerationSnapshot, markCharacterSheetConfirmed} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {
  listTextModelOptions, textModelOptionLabel, listTextModels, validateModelId, isModelId, getTextModel,
  getTextModelInfo, estimateTextCost, estimateStoryTextCost, resolveStoryStageSettings, resolveQualityStageSettings,
  normalizeModelRegistry, STORY_STAGE_MODELS,
} from '../dist/text-generation/models.js';
import {fetchProviderModels, parseModelList, modelListRequest, supportsModelList} from '../dist/text-generation/model-list.js';
import {createTextEngine} from '../dist/text-generation/providers.js';
import {
  getTextGenerationSettings, renderTextEngineQuick, renderTextSettings, simpleTextModelValue,
  simpleTextModelOptions, applySimpleTextModel, SIMPLE_TEXT_MODEL_NOTE,
} from '../dist/text-generation/settings-ui.js';
import {
  getEngineModel, estimateImageCost, estimateBookCost, listImageModelOptions, frozenImageConfig, ENGINE_MODELS,
  chosenImageModel, imageModelSnapshot,
} from '../dist/image-generation/models.js';
import {generateImage} from '../dist/image-generation/providers.js';
import {renderImageEngineQuick, renderImageSettings, applyImageModelChoice, currentImageModel} from '../dist/image-generation/settings-ui.js';
import {createFullAutoJob, runFullAuto, estimateFullAutoCost, fullAutoPayload} from '../dist/full-auto.js';
import {estimateSimpleCosts} from '../dist/story-generation/page-tools.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {createImageProxyHandler} from '../image-proxy/server.mjs';
import {legacyEngineSnapshot, legacyAppSnapshot} from './fixtures/r13-legacy-engine.mjs';

const json = (data, init = {}) => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}, ...init});
const PIXELS = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const PNG = `data:image/png;base64,${PIXELS}`;
function setup() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '유하와 달토끼의 별 찾기', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'};
  return {state, wizard};
}
/** Visible step buttons, excluding material cards and step-bar links (R9-B2 rule 3, R11). */
const stepButtons = html => [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]).filter(tag => !/simple-card/.test(tag) && !/data-simple-nav=/.test(tag));
const tag = (html, id) => html.match(new RegExp(`<select id="${id}"[^>]*>`))?.[0] || '';
function ctxFor(state, wizard, draft = null) {
  let w = wizard, d = draft, page = 0;
  return {
    getState: () => state, getWizard: () => w, setWizard: v => { w = v; }, getDraft: () => d, setDraft: v => { d = v; },
    getEditPage: () => page, setEditPage: v => { page = v; }, isSimpleView: () => true, isSimpleMode: () => true,
    materialPortrait: c => `<svg aria-label="${c.name}"></svg>`, cover: () => '', illustration: () => '<img alt="">',
  };
}

/* ---------- 1. option lists ---------- */
test('R13 options: the curated catalog with price and tier first, then fetched, then typed; nothing invented', () => {
  const sol = listTextModels('openai').find(row => row.id === 'gpt-6.1-sol');
  assert.equal(textModelOptionLabel(sol), 'GPT-6.1 Sol · 고급 · 입력 $2 / 출력 $10 per 1M');
  const plain = listTextModelOptions('openai');
  assert.deepEqual(plain.map(row => row.id), ['gpt-4.1-mini', 'gpt-6.1-sol', 'gpt-6-astra']);
  assert.ok(plain.every(row => row.group === 'catalog'));
  assert.doesNotMatch(JSON.stringify(plain), /5\.6|gpt-5/, 'GPT 5.6 Sol is not in the catalog and is never invented');
  assert.deepEqual(listTextModelOptions('anthropic').map(row => row.id), ['claude-haiku-4-5-20251001', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
  assert.deepEqual(listTextModelOptions('google').map(row => row.id), ['gemini-2.5-flash', 'gemini-4-argon']);
  const config = {fetchedModels: {fetchedAt: '2026-10-19T00:00:00.000Z', models: [{id: 'gpt-6.1-sol'}, {id: 'gpt-5.5-mini', label: 'GPT-5.5 mini'}, {id: 'bad id'}]}, customModels: ['gpt-5.5-mini', 'my-tuned:v2', '__custom']};
  const rows = listTextModelOptions('openai', config);
  assert.deepEqual(rows.map(row => [row.id, row.group]), [['gpt-4.1-mini', 'catalog'], ['gpt-6.1-sol', 'catalog'], ['gpt-6-astra', 'catalog'], ['gpt-5.5-mini', 'fetched'], ['my-tuned:v2', 'custom']]);
  assert.match(rows[3].label, /GPT-5\.5 mini \(gpt-5\.5-mini\) · 목록에 없는 모델 · 요금은 공급자에서 확인/);
  assert.match(rows[4].label, /직접 입력 · 목록에 없는 모델/);
  // Pictures: catalog with the price line, fetched/typed after it, a fixed model for ComfyUI and the sample.
  const images = listImageModelOptions('google', {fetchedModels: {fetchedAt: 'x', models: [{id: 'gemini-3-pro-image'}, {id: 'gemini-9-image'}]}, customModels: ['my-image']});
  assert.deepEqual(images.map(row => row.id), ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-3.1-flash-lite-image', 'gemini-9-image', 'my-image']);
  assert.match(images[1].label, /Gemini 3 Pro Image · 상위 · 2K까지 \$0\.134/);
  assert.match(images[3].label, /목록에 없는 모델 · 요금은 공급자에서 확인/);
  assert.deepEqual(listImageModelOptions('fal').map(row => row.id), [ENGINE_MODELS.fal.final, ENGINE_MODELS.fal.draft]);
  assert.deepEqual(listImageModelOptions('sample', {customModels: ['x']}).map(row => row.id), ['original-svg-template-v1']);
});

/* ---------- 2. list fetch, parsing, filtering, errors, proxy ---------- */
test('R13 list fetch: OpenAI keeps chat models newest first; images keep image models; the key goes in a header only', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({url, options});
    return json({data: [
      {id: 'gpt-4.1-mini', created: 10}, {id: 'gpt-6.1-sol', created: 30}, {id: 'text-embedding-3-large', created: 50},
      {id: 'whisper-1', created: 5}, {id: 'dall-e-3', created: 6}, {id: 'gpt-image-2', created: 40}, {id: 'gpt-4o-realtime-preview', created: 41},
      {id: 'o4-mini', created: 20}, {id: 'gpt-3.5-turbo-instruct', created: 1}, {id: 'tts-1', created: 2}, {id: 'omni-moderation-latest', created: 3},
    ]});
  };
  const list = await fetchProviderModels({kind: 'text', engine: 'openai', config: {apiKey: 'sk-test-secret', fetch}, now: () => new Date('2026-10-19T01:02:03Z')});
  assert.deepEqual(list.models.map(row => row.id), ['gpt-6.1-sol', 'o4-mini', 'gpt-4.1-mini']);
  assert.equal(list.fetchedAt, '2026-10-19T01:02:03.000Z');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test-secret');
  assert.equal(calls[0].options.body, undefined, 'a list call has no body: no tokens, no cost');
  assert.doesNotMatch(JSON.stringify(list), /sk-test-secret/);
  const images = await fetchProviderModels({kind: 'image', engine: 'openai', config: {apiKey: 'sk-test-secret', fetch}});
  assert.deepEqual(images.models.map(row => row.id), ['gpt-image-2']);
});

test('R13 list fetch: Anthropic uses the browser-access headers; Google filters generateContent models', async () => {
  let seen;
  const anthropic = await fetchProviderModels({kind: 'text', engine: 'anthropic', config: {apiKey: 'ant-key', fetch: async (url, options) => {
    seen = {url, headers: options.headers};
    return json({data: [
      {type: 'model', id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z'},
      {type: 'model', id: 'claude-fable-5-1', display_name: 'Claude Fable 5.1', created_at: '2026-09-01T00:00:00Z'},
      {type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-06-01T00:00:00Z'},
    ], has_more: false});
  }}});
  assert.deepEqual(anthropic.models.map(row => row.id), ['claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001']);
  assert.equal(anthropic.models[0].label, 'Claude Fable 5.1');
  assert.equal(seen.url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.deepEqual(seen.headers, {'x-api-key': 'ant-key', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'});
  const googleData = {models: [
    {name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens']},
    {name: 'models/gemini-4-argon', displayName: 'Gemini 4 Argon', supportedGenerationMethods: ['generateContent']},
    {name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent']},
    {name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent']},
    {name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent']},
    {name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict']},
    {name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent']},
  ]};
  let googleSeen;
  const google = await fetchProviderModels({kind: 'text', engine: 'google', config: {apiKey: 'g-key', fetch: async (url, options) => { googleSeen = {url, headers: options.headers}; return json(googleData); }}});
  assert.deepEqual(google.models.map(row => row.id), ['gemini-4-argon', 'gemini-2.5-flash']);
  assert.equal(googleSeen.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
  assert.deepEqual(googleSeen.headers, {'x-goog-api-key': 'g-key'});
  assert.doesNotMatch(googleSeen.url, /g-key/, 'the key is never put in the URL');
  assert.deepEqual(parseModelList('image', 'google', googleData).map(row => row.id), ['gemini-3.1-flash-image']);
  // Local servers: no key, no dates, embeddings left out.
  const local = await fetchProviderModels({kind: 'text', engine: 'local', config: {baseUrl: 'http://127.0.0.1:1234/v1', fetch: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:1234/v1/models');
    assert.deepEqual(options.headers, {});
    return json({data: [{id: 'qwen3:8b'}, {id: 'nomic-embed-text'}]});
  }}});
  assert.deepEqual(local.models.map(row => row.id), ['qwen3:8b']);
});

test('R13 list fetch: errors are Korean, carry no key, and nothing is asked without a key or a list API', async () => {
  let calls = 0;
  const fail = status => async () => { calls++; return new Response('upstream sk-secret-body', {status}); };
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'sk-secret', fetch: fail(401)}}), error => /키를 확인해 주세요/.test(error.message) && error.status === 401 && !/sk-secret/.test(error.message));
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'sk-secret', fetch: fail(429)}}), /요청 한도/);
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'sk-secret', fetch: fail(404)}}), /주소나 프록시/);
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'sk-secret', fetch: fail(500)}}), /모델 목록을 주지 않았어요/);
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'sk-secret', fetch: async () => { throw new TypeError('Failed to fetch sk-secret'); }}}), error => /불러오지 못했어요/.test(error.message) && !/sk-secret/.test(error.message));
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'sk-secret', fetch: async () => new Response('not json', {status: 200})}}), /응답을 읽지 못했어요/);
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'sk-secret', fetch: async () => json({data: [{id: 'whisper-1'}]})}}), /글 모델을 찾지 못했어요/);
  const before = calls;
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {fetch: fail(200)}}), /키를 저장해 주세요/);
  for (const engine of ['bfl', 'fal', 'local', 'sample']) {
    assert.equal(supportsModelList('image', engine), false);
    await assert.rejects(fetchProviderModels({kind: 'image', engine, config: {apiKey: 'k', fetch: fail(200)}}), /목록을 제공하지 않아요/);
  }
  await assert.rejects(fetchProviderModels({engine: 'openai', config: {apiKey: 'k', baseUrl: 'https://user:pw@api.example.test/v1', fetch: fail(200)}}), /인증 정보/);
  assert.equal(calls, before, 'no request without a key, a list API or a clean address');
});

test('R13 list fetch through the proxy: no browser key, the server answers with its own list', async () => {
  let seen;
  const list = await fetchProviderModels({kind: 'text', engine: 'anthropic', config: {apiKey: 'browser-key-unused', proxyEndpoint: 'https://proxy.example.test', transport: 'proxy', fetch: async (url, options) => {
    seen = {url, options};
    return json({fetchedAt: '2026-10-19T00:00:00.000Z', models: [{id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5'}, {id: 'bad id'}, 'claude-x-9']});
  }}});
  assert.equal(seen.url, 'https://proxy.example.test/api/models/text/anthropic');
  assert.deepEqual(seen.options.headers, {});
  assert.doesNotMatch(JSON.stringify(seen), /browser-key-unused/);
  assert.deepEqual(list.models, [{id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5'}, {id: 'claude-x-9'}]);
  assert.deepEqual(modelListRequest('image', 'google', {transport: 'proxy', proxyEndpoint: 'https://p.example.test/'}), {url: 'https://p.example.test/api/models/image/google', headers: {}, proxy: true});
});

test('R13 proxy server: GET model lists with server keys, origin rules kept; a typed text model is registered', async () => {
  const listed = [], texts = [], images = [];
  const handler = createImageProxyHandler({
    env: {IMAGE_PROXY_ALLOWED_ORIGINS: 'https://story.example', OPENAI_API_KEY: 'server-openai', GOOGLE_IMAGE_API_KEY: 'server-google'},
    listModels: async args => { listed.push(args); return {fetchedAt: '2026-10-19T00:00:00.000Z', models: [{id: 'gpt-5.5-mini'}]}; },
    textEngineFactory: context => ({async complete() { texts.push(context); return {text: '{}', json: {}, usage: {input: 1, output: 1}}; }}),
    generate: async (request, context) => { images.push(context); return {imageUrl: PNG, seed: 1, meta: {model: context.config.model || 'default'}}; },
  });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = {Origin: 'https://story.example'};
  try {
    const ok = await fetch(`${base}/api/models/text/openai`, {headers: origin});
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).models, [{id: 'gpt-5.5-mini'}]);
    assert.equal(ok.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    assert.equal(listed[0].config.apiKey, 'server-openai');
    assert.equal(listed[0].kind, 'text');
    assert.equal((await fetch(`${base}/api/models/text/openai`, {headers: {Origin: 'https://evil.example'}})).status, 403);
    assert.equal((await fetch(`${base}/api/models/text/openai`)).status, 403, 'no origin and no server token');
    assert.equal((await fetch(`${base}/api/models/image/bfl`, {headers: origin})).status, 404);
    assert.equal((await fetch(`${base}/api/models/text/anthropic`, {headers: origin})).status, 503, 'no server key, nothing asked');
    assert.equal(listed.length, 1);
    const post = body => fetch(`${base}/api/text/openai`, {method: 'POST', headers: {...origin, 'Content-Type': 'application/json'}, body: JSON.stringify({system: 's', user: 'u', maxTokens: 100, ...body})});
    assert.equal((await post({model: 'gpt-5.5-mini'})).status, 200);
    assert.deepEqual(texts.at(-1).config.customModels, ['gpt-5.5-mini']);
    assert.equal((await post({model: 'gpt-6-astra'})).status, 200);
    assert.equal(texts.at(-1).config.customModels, undefined, 'catalog models are sent as before');
    const image = await fetch(`${base}/api/image/google`, {method: 'POST', headers: {...origin, 'Content-Type': 'application/json'}, body: JSON.stringify({scenePrompt: 'a', referenceImages: [], seed: 1, size: {width: 1024, height: 1024}, quality: 'final', model: 'gemini-3-pro-image'})});
    assert.equal(image.status, 200);
    assert.equal(images.at(-1).config.model, 'gemini-3-pro-image');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

/* ---------- 3. custom IDs ---------- */
test('R13 typed model IDs follow /^[A-Za-z0-9._:\\/-]{1,120}$/ and never collide with picker options', () => {
  for (const id of ['gpt-5.5-mini', 'models/gemini-x', 'qwen3:8b', 'fal-ai/flux/dev', 'a', 'A'.repeat(120), ' claude-x-9 '])
    assert.equal(validateModelId(id), id.trim());
  for (const id of ['', ' ', 'a b', 'https://x.example/?q=1', 'x'.repeat(121), '<script>', 'model;rm', '__custom', '__fetch', '__stages', null, undefined])
    assert.throws(() => validateModelId(id), /모델 ID는 영문·숫자와/);
  assert.equal(isModelId('gpt-5.5'), true);
  assert.equal(isModelId(12), false);
  assert.deepEqual(normalizeModelRegistry({customModels: ['ok-1', 'bad id', 'ok-1', '__x']}), {customModels: ['ok-1']});
  assert.deepEqual(normalizeModelRegistry({}), {}, 'settings saved before R13 gain no field');
});

/* ---------- 4. request shape for models outside the catalog ---------- */
test('R13 a model outside the catalog gets no temperature, reasoning, effort, thinking or schema fields; the stage budget is its limit', async () => {
  const request = {system: 'S', user: 'U', jsonSchema: {type: 'object'}, temperature: 0.7, maxTokens: 4000};
  const capture = reply => {
    const seen = [];
    return {seen, fetch: async (url, options) => { seen.push({url, body: JSON.parse(options.body), headers: options.headers}); return json(reply); }};
  };
  const openai = capture({choices: [{message: {content: '{"ok":true}'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1}});
  const result = await createTextEngine({engine: 'openai', config: {apiKey: 'sk-test', model: 'gpt-5.5-mini', customModels: ['gpt-5.5-mini'], fetch: openai.fetch}}).complete(request);
  assert.deepEqual(Object.keys(openai.seen[0].body).sort(), ['max_completion_tokens', 'messages', 'model']);
  assert.equal(openai.seen[0].body.model, 'gpt-5.5-mini');
  assert.equal(openai.seen[0].body.max_completion_tokens, 4000);
  assert.match(openai.seen[0].body.messages[0].content, /Return only JSON matching this schema/);
  assert.deepEqual(result.json, {ok: true});
  assert.equal(result.meta.requestedModel, 'gpt-5.5-mini');
  assert.equal(result.meta.pricingUnknown, true);
  assert.equal(result.meta.costUsdEstimated, 0);
  const anthropic = capture({content: [{type: 'text', text: '{"ok":true}'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}});
  await createTextEngine({engine: 'anthropic', config: {apiKey: 'k', model: 'claude-x-9', fetchedModels: {fetchedAt: 'x', models: [{id: 'claude-x-9'}]}, fetch: anthropic.fetch}}).complete(request);
  assert.deepEqual(Object.keys(anthropic.seen[0].body).sort(), ['max_tokens', 'messages', 'model', 'system']);
  assert.equal(anthropic.seen[0].body.max_tokens, 4000);
  assert.equal(anthropic.seen[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
  const google = capture({candidates: [{content: {parts: [{text: '{"ok":true}'}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1}});
  await createTextEngine({engine: 'google', config: {apiKey: 'k', model: 'gemini-9-pro', customModels: ['gemini-9-pro'], fetch: google.fetch}}).complete(request);
  assert.match(google.seen[0].url, /\/models\/gemini-9-pro:generateContent$/);
  assert.deepEqual(google.seen[0].body.generationConfig, {maxOutputTokens: 4000});
  const proxy = capture({text: '{"ok":true}', usage: {input: 1, output: 1}});
  await createTextEngine({engine: 'openai', config: {proxyEndpoint: 'https://proxy.example.test', transport: 'proxy', model: 'gpt-5.5-mini', customModels: ['gpt-5.5-mini'], fetch: proxy.fetch}}).complete(request);
  assert.deepEqual(Object.keys(proxy.seen[0].body).sort(), ['jsonSchema', 'maxTokens', 'model', 'system', 'user']);
  // Catalog models keep today's shape (also pinned byte for byte below).
  const catalog = capture({choices: [{message: {content: '{"ok":true}'}}], usage: {}});
  await createTextEngine({engine: 'openai', config: {apiKey: 'sk-test', model: 'gpt-6.1-sol', fetch: catalog.fetch}}).complete(request);
  assert.equal(catalog.seen[0].body.reasoning_effort, 'low');
  assert.equal(catalog.seen[0].body.response_format.type, 'json_schema');
  // An unknown ID nobody fetched or typed still falls back to the default, as before R13.
  assert.equal(getTextModel('openai', {model: 'gpt-5.6-sol'}), 'gpt-4.1-mini');
  assert.equal(getTextModelInfo('openai', 'gpt-5.6-sol').id, 'gpt-4.1-mini');
});

/* ---------- 5. estimates ---------- */
test('R13 estimates: an unknown model has no price, totals say 일부 요금 미확인, helpers keep their economy price', () => {
  const cost = estimateTextCost({engine: 'openai', config: {model: 'gpt-5.5-mini', customModels: ['gpt-5.5-mini']}, input: 1e6, output: 1e6});
  assert.equal(cost.costUsd, 0);
  assert.equal(cost.pricingUnknown, true);
  assert.equal(cost.inputRate, null);
  assert.match(cost.note, /요금 정보 없음/);
  assert.equal(estimateTextCost({engine: 'openai', model: 'gpt-6.1-sol', input: 1e6, output: 1e6}).pricingUnknown, undefined);
  const source = {engine: 'openai'};
  applySimpleTextModel(source, 'openai', 'gpt-5.5-mini');
  const settings = getTextGenerationSettings({settings: {textGeneration: source}});
  const estimate = estimateStoryTextCost({settings: {...settings, storyQuality: {enabled: true}}, pageCount: 12, at: '2026-10-19'});
  assert.equal(estimate.pricingUnknown, true);
  assert.ok(estimate.unknownPricingStages.includes('prose') && estimate.unknownPricingStages.includes('outline'));
  assert.ok(!estimate.unknownPricingStages.includes('simplification') && !estimate.unknownPricingStages.includes('childSimulator'), 'economy helpers keep their defaults and prices');
  assert.ok(estimate.costUsd > 0, 'the known helper prices still add up');
  const known = estimateStoryTextCost({settings: {...getTextGenerationSettings({settings: {textGeneration: {engine: 'openai'}}}), storyQuality: {enabled: true}}, pageCount: 12, at: '2026-10-19'});
  assert.equal(known.pricingUnknown, undefined);
  // Pictures: known models are priced per model, unknown ones are not priced.
  assert.equal(estimateImageCost({engine: 'google', config: {model: 'gemini-3-pro-image'}, size: '1536x1024'}).costUsd, 0.134);
  assert.equal(estimateImageCost({engine: 'fal', config: {model: ENGINE_MODELS.fal.draft}}).costUsd, 0.035);
  const unknown = estimateBookCost({engine: 'openai', config: {model: 'gpt-image-9'}, pageCount: 12});
  assert.equal(unknown.pricingUnknown, true);
  assert.equal(unknown.costUsd, 0);
  assert.match(unknown.note, /요금 정보 없음/);
});

test('R13 ③ and FULL AUTO estimates name the unpriced parts instead of a made-up number', () => {
  const {state, wizard} = setup();
  applySimpleTextModel(state.settings.textGeneration ||= {engine: 'openai'}, 'openai', 'gpt-5.5-mini');
  updateWorldGenerationSettings(state, {imageEngine: 'openai'});
  applyImageModelChoice(getActiveWorld(state), 'openai', 'gpt-image-9');
  const cost = estimateFullAutoCost(state, wizard);
  assert.equal(cost.textPricingUnknown, true);
  assert.equal(cost.imagePricingUnknown, true);
  assert.equal(cost.imageUnitUsd, 0);
  const simple = estimateSimpleCosts(state, wizard);
  assert.equal(simple.textPricingUnknown, true);
  assert.equal(simple.pageTextPricingUnknown, true);
  assert.equal(simple.imagePricingUnknown, true);
  const html = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3})));
  assert.match(html, /<span>글 만들기<\/span><strong>약 \$[\d.]+ · 일부 요금 미확인<\/strong>/);
  assert.match(html, /<span>그림 12쪽 \+ 표지<\/span><strong>요금 정보 없음<\/strong>/);
});

test('R13 unpriced pictures are still paid: book estimates count the sheets and every simple picture confirm asks', () => {
  const {state} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'openai'});
  applyImageModelChoice(getActiveWorld(state), 'openai', 'gpt-image-9');
  const book = {id: 'book-r13', characterIds: ['yuha'], backgroundIds: [], pages: [{pageNo: 1}, {pageNo: 2}], pagination: {pages: []}, textGenerationSettings: getTextGenerationSettings(state)};
  const costs = estimateSimpleCosts(state, book);
  assert.equal(costs.imagePricingUnknown, true);
  assert.equal(costs.imageUnitUsd, 0);
  assert.equal(costs.sheetsNeeded, 1, 'the sheet still to buy is counted, not priced at $0');
  assert.equal(costs.imagesNeeded, 3);
  // The simple screen never treats an unpriced model as free (no '$0' confirm skipped).
  const source = readFileSync(new URL('../dist/simple-create.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!confirmed && \(total > 0 \|\| estimate\.imagePricingUnknown\)\)/);
  assert.match(source, /paid = unit > 0 \|\| sheets > 0 \|\| unpriced/);
  assert.match(source, /\(sheets > 0 \|\| costs\.sheetsNeeded > 0\) &&/);
  // A known model keeps the legacy estimate shape (no new fields).
  applyImageModelChoice(getActiveWorld(state), 'openai', 'gpt-image-2');
  const known = estimateSimpleCosts(state, book);
  assert.equal('sheetsNeeded' in known || 'imagePricingUnknown' in known, false);
});

/* ---------- 6. simple ③ and the settings pages ---------- */
test('R13 ③: 글 엔진 + 모델 and 그림 엔진 + 모델 selects, the one-line note, and still at most 12 counted buttons', () => {
  const {state, wizard} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  const w = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3});
  let html = renderSimpleCreate(ctxFor(state, w));
  assert.match(html, /<select id="simple-text-engine" >/);
  assert.match(html, /<option value="openai" selected>GPT · OpenAI/);
  assert.match(html, /<option value="anthropic" >Claude · Anthropic/);
  assert.match(html, /<option value="google" >Gemini · Google/);
  assert.match(tag(html, 'simple-text-model'), /data-engine="openai" data-current=""/);
  assert.match(html, /<option value="" selected>기본 추천 · GPT-6\.1 Sol \+ GPT-6 Astra \(단계별 자동\)<\/option>/);
  assert.match(html, /GPT-6\.1 Sol · 고급 · 입력 \$2 \/ 출력 \$10 per 1M/);
  assert.match(html, /<option value="__custom">직접 입력…<\/option>/);
  assert.match(html, /<option value="__fetch">모델 목록 불러오기 · 무료…<\/option>/);
  assert.ok(html.includes(SIMPLE_TEXT_MODEL_NOTE));
  assert.match(SIMPLE_TEXT_MODEL_NOTE, /보조 호출은 기본 경제형 모델/);
  assert.match(tag(html, 'simple-image-model'), /data-engine="google" data-current="gemini-3\.1-flash-image"/);
  assert.match(html, /Gemini 3 Pro Image · 상위/);
  assert.ok(stepButtons(html).length <= 12, `③: ${stepButtons(html).length}`);
  // A chosen model shows as the selection; ComfyUI and the free sample have no image model select.
  applySimpleTextModel(state.settings.textGeneration ||= {engine: 'openai'}, 'openai', 'gpt-6.1-sol');
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-3-pro-image');
  html = renderSimpleCreate(ctxFor(state, w));
  assert.match(tag(html, 'simple-text-model'), /data-current="gpt-6\.1-sol"/);
  assert.match(html, /<option value="gpt-6\.1-sol" selected>/);
  assert.match(html, /<option value="gemini-3-pro-image" selected>/);
  updateWorldGenerationSettings(state, {imageEngine: 'sample'});
  html = renderSimpleCreate(ctxFor(state, w));
  assert.doesNotMatch(html, /id="simple-image-model"/);
  assert.ok(stepButtons(html).length <= 12);
});

test('R13 ③ is locked once a job exists and shows the models frozen in the job', () => {
  const {state, wizard} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  applySimpleTextModel(state.settings.textGeneration ||= {engine: 'openai'}, 'openai', 'gpt-5.5-mini');
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-3-pro-image');
  const job = createFullAutoJob(state, {...wizard, simpleFlow: true}, {stopBefore: 'text'});
  job.status = 'paused';
  // The parent changes the settings afterwards: the job keeps its copy.
  applySimpleTextModel(state.settings.textGeneration, 'openai', 'gpt-6-astra');
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-3.1-flash-lite-image');
  const html = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id})));
  assert.match(tag(html, 'simple-text-model'), /disabled/);
  assert.match(tag(html, 'simple-image-model'), /disabled/);
  assert.match(html, /<option value="gpt-5\.5-mini" selected>/);
  assert.match(html, /<option value="gemini-3-pro-image" selected>/);
  assert.doesNotMatch(html, /value="__fetch"|id="simple-text-model-custom"/);
  assert.ok(stepButtons(html).length <= 12);
});

test('R13 simple settings: 공급자 + one 모델 select for text and pictures, list and typed IDs inside the selects', () => {
  const {state} = setup();
  const text = renderTextEngineQuick(state);
  assert.match(text, /글 엔진 · 공급자/);
  assert.match(text, /<select id="tg-model" data-text-field="model" data-current="">/);
  assert.doesNotMatch(text, /data-text-field="medium"|data-text-field="upper"/);
  assert.match(text, /value="__fetch"/);
  assert.match(text, /id="tg-custom-model" data-text-field="customModel"[^>]*hidden/);
  assert.doesNotMatch(text, /data-text-setting="fetch-models"/, 'the 12-button page uses the select option');
  updateWorldGenerationSettings(state, {imageEngine: 'openai'});
  const image = renderImageEngineQuick(state);
  assert.match(image, /<select id="ig-model" data-ig-model-engine="openai" data-current="gpt-image-2">/);
  assert.match(image, /value="__fetch"/);
  assert.doesNotMatch(image, /data-ig-action="fetch-models"/);
  assert.match(image, /미리보기도 이 모델로 그려요/);
  updateWorldGenerationSettings(state, {imageEngine: 'bfl'});
  assert.doesNotMatch(renderImageEngineQuick(state), /value="__fetch"/, 'BFL has no list API');
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  assert.match(renderImageEngineQuick(state), /미리보기는 Gemini 3\.1 Flash Lite Image 그대로예요/);
  assert.doesNotMatch(renderImageEngineQuick(state), /ig-google-pro/, 'the model select replaced the Pro checkbox');
});

test('R13 pro settings: medium/upper list catalog + fetched + typed with a list button; World image settings get a model select', () => {
  const {state} = setup();
  state.settings.textGeneration = {engine: 'openai', providers: {openai: {fetchedModels: {fetchedAt: '2026-10-19T00:00:00.000Z', models: [{id: 'gpt-5.5-mini'}]}, customModels: ['my-tuned:v2'], stageModels: {medium: 'gpt-5.5-mini', upper: 'gpt-6-astra'}}}};
  const html = renderTextSettings(state);
  assert.match(html, /data-text-field="medium"/);
  assert.match(html, /data-text-field="upper"/);
  assert.match(html, /<optgroup label="추천 목록 · 요금 확인 2026-10-15">/);
  assert.match(html, /<optgroup label="불러온 목록 · 2026-10-19">/);
  assert.match(html, /<optgroup label="직접 입력한 모델">/);
  assert.match(html, /<option value="gpt-5\.5-mini" selected>gpt-5\.5-mini · 목록에 없는 모델/);
  assert.match(html, /data-text-setting="fetch-models"/);
  assert.match(html, /목록에 없는 모델 · 요금 정보 없음/);
  assert.match(html, /일부 요금 미확인/);
  assert.equal(getTextGenerationSettings(state).providers.openai.stageModels.medium, 'gpt-5.5-mini');
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  const image = renderImageSettings(state);
  assert.match(image, /<select id="ig-model" data-ig-model-engine="google"/);
  assert.match(image, /data-ig-action="fetch-models"/);
  updateWorldGenerationSettings(state, {imageEngine: 'sample'});
  assert.doesNotMatch(renderImageSettings(state), /id="ig-model"/);
});

/* ---------- 7. stages, freezing ---------- */
test('R13 the simple choice drives the medium and upper stages; economy helpers keep their defaults', () => {
  const source = {engine: 'anthropic'};
  assert.equal(simpleTextModelValue('anthropic', {}), '');
  applySimpleTextModel(source, 'anthropic', 'claude-x-9');
  assert.deepEqual(source.providers.anthropic, {customModels: ['claude-x-9'], stageModels: {medium: 'claude-x-9', upper: 'claude-x-9'}});
  const settings = getTextGenerationSettings({settings: {textGeneration: source}});
  for (const stage of ['outline', 'plotContract', 'sceneBriefs', 'prose', 'pagination', 'coherence', 'coherenceRepair'])
    assert.equal(resolveStoryStageSettings(settings, stage).config.model, 'claude-x-9', stage);
  for (const role of ['outline', 'prose', 'coach'])
    assert.equal(resolveQualityStageSettings(settings, role, {enabled: true}).config.model, 'claude-x-9', role);
  assert.equal(resolveQualityStageSettings(settings, 'cheap', {enabled: true}).config.model, 'claude-haiku-4-5-20251001');
  // In pro mode a helper can still be picked, including a registered model.
  assert.equal(resolveQualityStageSettings(settings, 'cheap', {enabled: true, engines: {cheap: {engine: 'anthropic', model: 'claude-x-9'}}}).config.model, 'claude-x-9');
  assert.equal(simpleTextModelValue('anthropic', settings.providers.anthropic), 'claude-x-9');
  // '' goes back to the stage defaults; a pro medium/upper pair shows as such and is left alone.
  applySimpleTextModel(source, 'anthropic', '');
  assert.deepEqual(source.providers.anthropic.stageModels, {...STORY_STAGE_MODELS.anthropic});
  const pair = {stageModels: {medium: 'claude-haiku-5-5', upper: 'claude-fable-5-1'}};
  assert.equal(simpleTextModelValue('anthropic', pair), '__stages');
  assert.match(simpleTextModelOptions('anthropic', pair), /<option value="__stages" selected>프로 모드 단계별 설정 · Claude Haiku 5\.5 \+ Claude Fable 5\.1/);
  assert.equal(applySimpleTextModel({providers: {anthropic: structuredClone(pair)}}, 'anthropic', '__stages'), false);
  assert.throws(() => applySimpleTextModel({}, 'openai', 'bad id'), /모델 ID/);
  // Local: the model name itself.
  const local = {engine: 'local'};
  applySimpleTextModel(local, 'local', 'qwen3:8b');
  assert.equal(local.providers.local.model, 'qwen3:8b');
  assert.equal(resolveStoryStageSettings(getTextGenerationSettings({settings: {textGeneration: local}}), 'prose').config.model, 'qwen3:8b');
});

test('R13 a FULL AUTO job freezes the text model; later settings never change it', () => {
  const {state, wizard} = setup();
  state.settings.textGeneration = {engine: 'openai'};
  applySimpleTextModel(state.settings.textGeneration, 'openai', 'gpt-5.5-mini');
  const job = createFullAutoJob(state, wizard);
  applySimpleTextModel(state.settings.textGeneration, 'openai', 'gpt-6-astra');
  state.settings.textGeneration.providers.openai.customModels = [];
  assert.deepEqual(job.textSettings.providers.openai.stageModels, {medium: 'gpt-5.5-mini', upper: 'gpt-5.5-mini'});
  assert.deepEqual(job.textSettings.providers.openai.customModels, ['gpt-5.5-mini']);
  assert.equal(resolveStoryStageSettings(job.textSettings, 'prose').config.model, 'gpt-5.5-mini');
  assert.equal(resolveQualityStageSettings(job.textSettings, 'cheap', {enabled: true}).config.model, 'gpt-4.1-mini');
  const payload = fullAutoPayload(job);
  assert.equal(payload.textModelId, 'gpt-5.5-mini');
  // The frozen copy survives serialization (a reload of the saved job).
  const reloaded = JSON.parse(JSON.stringify(job.textSettings));
  assert.equal(getTextModel('openai', resolveStoryStageSettings(reloaded, 'outline').config), 'gpt-5.5-mini');
});

test('R13 pictures: getEngineModel honours the choice for finals, drafts keep the draft model unless the provider has one model', () => {
  assert.equal(getEngineModel('google', 'final', {model: 'gemini-3-pro-image'}), 'gemini-3-pro-image');
  assert.equal(getEngineModel('google', 'draft', {model: 'gemini-3-pro-image'}), ENGINE_MODELS.google.draft);
  assert.equal(getEngineModel('google', 'final', {googlePro: true, model: 'gemini-3.1-flash-image'}), 'gemini-3.1-flash-image', 'a picked model wins over the legacy Pro switch');
  assert.equal(getEngineModel('google', 'final', {googlePro: true}), 'gemini-3-pro-image');
  assert.equal(getEngineModel('fal', 'draft', {model: 'fal-ai/flux/dev'}), ENGINE_MODELS.fal.draft);
  assert.equal(getEngineModel('fal', 'final', {model: 'fal-ai/flux/dev'}), 'fal-ai/flux/dev');
  assert.equal(getEngineModel('openai', 'draft', {model: 'gpt-image-9'}), 'gpt-image-9');
  assert.equal(getEngineModel('bfl', 'draft', {model: 'flux-2-flex'}), 'flux-2-flex');
  assert.equal(getEngineModel('local', 'final', {model: 'x'}), 'ComfyUI workflow');
  assert.equal(getEngineModel('sample', 'final', {model: 'x'}), 'original-svg-template-v1');
  assert.equal(getEngineModel('openai', 'final', {model: 'bad id'}), 'gpt-image-2');
  assert.equal(chosenImageModel('google', {model: '__custom'}), null);
  const world = {imageEngine: 'google', providerConfig: {google: {proxyEndpoint: 'https://p.example.test'}}};
  assert.equal(currentImageModel(world, 'google'), 'gemini-3.1-flash-image');
  assert.equal(applyImageModelChoice(world, 'google', 'gemini-3.1-flash-image'), false, 'no write when nothing changes');
  assert.deepEqual(world.providerConfig.google, {proxyEndpoint: 'https://p.example.test'});
  assert.equal(applyImageModelChoice(world, 'google', 'gemini-9-image'), true);
  assert.deepEqual(world.providerConfig.google, {proxyEndpoint: 'https://p.example.test', model: 'gemini-9-image', customModels: ['gemini-9-image']});
  assert.equal(applyImageModelChoice(world, 'google', 'gemini-3-pro-image'), true);
  assert.equal(world.providerConfig.google.model, 'gemini-3-pro-image');
  assert.deepEqual(world.providerConfig.google.customModels, ['gemini-9-image'], 'a catalog pick is not added to typed models');
  assert.throws(() => applyImageModelChoice(world, 'google', 'a b'), /모델 ID/);
  assert.equal(applyImageModelChoice(world, 'sample', 'x'), false);
});

test('R13 picture requests: a typed fal path has no suffix, a typed Gemini model gets no size switch, the proxy gets the model only when chosen', async () => {
  const preset = {id: 'style', name: '종이', stylePrompt: 'soft', negativePrompt: 'sharp', palette: ['#F2C178'], styleRefImages: []};
  const request = {prompt: 'A small rabbit opens a book.', stylePreset: preset, referenceImages: [], seed: 7, size: '1536x1024', quality: 'final'};
  const urls = [];
  let step = 0;
  await generateImage(request, {engine: 'fal', config: {apiKey: 'k', model: 'fal-ai/flux/dev', pollIntervalMs: 100, fetch: async url => {
    urls.push(url); step++;
    if (step === 1) return json({request_id: 'r', status_url: 'https://queue.fal.run/x/status', response_url: 'https://queue.fal.run/x'});
    if (step === 2) return json({status: 'COMPLETED'});
    if (step === 3) return json({images: [{url: 'https://images.example.test/a.png'}]});
    return new Response(new Blob([Uint8Array.from(atob(PIXELS), c => c.charCodeAt(0))], {type: 'image/png'}));
  }}});
  assert.equal(urls[0], 'https://queue.fal.run/fal-ai/flux/dev');
  let body;
  const result = await generateImage(request, {engine: 'google', config: {apiKey: 'k', model: 'gemini-9-image', fetch: async (url, options) => {
    body = {url, data: JSON.parse(options.body)};
    return json({candidates: [{content: {parts: [{inlineData: {mimeType: 'image/png', data: PIXELS}}]}}]});
  }}});
  assert.match(body.url, /\/models\/gemini-9-image:generateContent$/);
  assert.deepEqual(body.data.generationConfig.imageConfig, {aspectRatio: '3:2'});
  assert.equal(result.meta.costEstimate.pricingUnknown, true);
  const proxyBodies = [];
  for (const config of [{}, {model: 'gemini-3-pro-image'}])
    await generateImage(request, {engine: 'google', config: {...config, proxyEndpoint: 'https://proxy.example.test', transport: 'proxy', fetch: async (url, options) => { proxyBodies.push(JSON.parse(options.body)); return json({imageUrl: PNG, model: 'm'}); }}});
  assert.equal('model' in proxyBodies[0], false, 'no chosen model: the proxy body is as before');
  assert.equal(proxyBodies[1].model, 'gemini-3-pro-image');
});

test('R13 the book snapshot freezes the picture model; a World change never reaches an existing book', () => {
  const {state} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  const world = getActiveWorld(state);
  markCharacterSheetConfirmed(state, 'yuha', {imageUrl: PNG, seed: null, meta: {requestedSeed: 10}});
  applyImageModelChoice(world, 'google', 'gemini-3-pro-image');
  const book = {characterIds: ['yuha']};
  captureBookGenerationSnapshot(state, book);
  assert.deepEqual(book.generationSnapshot.imageModelConfig, {googlePro: false, modelVariant: 'default', model: 'gemini-3-pro-image'});
  applyImageModelChoice(world, 'google', 'gemini-3.1-flash-lite-image');
  assert.equal(getEngineModel('google', 'final', frozenImageConfig(world.providerConfig.google, book.generationSnapshot)), 'gemini-3-pro-image');
  // A book frozen with the default never picks up a model chosen later.
  const older = {generationSnapshot: {imageEngine: 'google', imageModelConfig: {googlePro: false, modelVariant: 'default'}}};
  assert.equal(getEngineModel('google', 'final', frozenImageConfig(world.providerConfig.google, older.generationSnapshot)), 'gemini-3.1-flash-image');
  assert.equal(world.revision, book.generationSnapshot.worldRevision, 'a model choice does not invalidate confirmed sheets');
  assert.deepEqual(imageModelSnapshot({imageEngine: 'sample', providerConfig: {sample: {model: 'x'}}}), {googlePro: false, modelVariant: 'default'});
});

test('R13 a FULL AUTO job freezes the picture model for its sheets, backgrounds and book snapshot', async () => {
  const {state, wizard} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  const world = getActiveWorld(state);
  applyImageModelChoice(world, 'google', 'gemini-3-pro-image');
  const job = createFullAutoJob(state, wizard);
  assert.deepEqual(job.imageModelConfig, {googlePro: false, modelVariant: 'default', model: 'gemini-3-pro-image'});
  applyImageModelChoice(world, 'google', 'gemini-3.1-flash-lite-image');
  const seen = {sheets: [], backgrounds: []};
  const result = (data, stage) => ({data, usage: {input: 1, output: 1}, meta: {stage, requests: 1}});
  const ops = {
    preflight: async () => {},
    plan: async () => result({reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['home'], newBackgrounds: [{name: '달빛 언덕', nameEn: 'Moon Hill', type: 'space', description: '달의 낮은 언덕', layout: '둥근 돌 세 개와 낮은 길, 건물 없음'}, {name: '별빛 정원', nameEn: 'Star Garden', type: 'garden', description: '별빛 아래 작은 정원', layout: '작은 둥근 화단과 곧은 흙길, 문과 건물 없음'}], reason: '두 장소를 더해요.'}, 'materials'),
    characterSheet: async (s, character, options) => { seen.sheets.push(options.frozenImageModel); return {imageAssetId: 'image-sheet-0001', imageUrl: PNG, seed: 1, meta: {quality: 'final', requestedSeed: 1}}; },
    backgroundSheet: async (s, background, options) => { seen.backgrounds.push(options.frozenImageModel); return {imageAssetId: 'image-bg-' + background.id, imageUrl: PNG, seed: 1, meta: {quality: 'final'}}; },
    outline: async input => result(demoOutline(input), 'outline'),
    briefs: async (o, i) => result(demoSceneBriefs(o, i), 'sceneBriefs'),
    prose: async (o, i) => result(demoProse(o, i), 'prose'),
    enrichment: async p => result(p, 'enrichment'),
    pagination: async (o, p, i) => ({...result(demoPagination(o, p, i), 'pagination'), meta: {requests: 1, checks: {passed: true, checks: []}, richnessChecks: {valid: true, issues: []}}}),
    scene: async (s, b, index) => Object.assign(b.pages[index], {imageAssetId: 'image-page-' + String(index).padStart(4, '0'), imageUrl: PNG, imageMeta: {quality: 'final'}}),
    cover: async (s, b) => (b.cover = {imageAssetId: 'image-cover-0001', imageUrl: PNG, meta: {quality: 'final'}}),
  };
  const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(page => ({...page, ko: page.textKo, en: page.textEn})), sceneBriefs: p.sceneBriefs, worldId: p.worldId, storyDraftId: p.id, textGenerationSettings: p.textSettings});
  const book = await runFullAuto(state, job, {operations: ops, buildBook, save: () => true});
  assert.ok(seen.sheets.length >= 1 && seen.sheets.every(model => model === 'gemini-3-pro-image'), JSON.stringify(seen.sheets));
  assert.ok(seen.backgrounds.length >= 1 && seen.backgrounds.every(model => model === 'gemini-3-pro-image'));
  assert.equal(book.generationSnapshot.imageModelConfig.model, 'gemini-3-pro-image');
  assert.equal(world.providerConfig.google.model, 'gemini-3.1-flash-lite-image', 'the World keeps the newer choice for new books');
  // A job made with the provider default keeps the default after a later choice.
  const second = createFullAutoJob(state, wizard);
  assert.equal(second.imageModelConfig.model, 'gemini-3.1-flash-lite-image');
  delete world.providerConfig.google.model;
  const third = createFullAutoJob(state, wizard);
  assert.equal('model' in third.imageModelConfig, false);
});

/* ---------- 8. legacy byte identity ---------- */
// Re-derive from the pre-R13 sources with PRE_R13_APP_ROOT=<checkout of 67be17e donghwa-workshop>.
const PRE_R13_ENGINE_SHA256 = 'e2ce53ee825cc53496cc286babb2f923b6df04c209e471450af624afa00dc320';
const PRE_R13_APP_SHA256 = '982f288a9dcfb053ef20b82dc94f96fc6d1523ed5c74cb2ec9002d337a7011a5';
test('R13 legacy: settings saved before R13 send byte-identical requests, models and estimates', async () => {
  const root = new URL('../', import.meta.url);
  const engine = await legacyEngineSnapshot(root), app = await legacyAppSnapshot(root);
  assert.equal(engine.text.length, 87);
  assert.ok(engine.images.length >= 64);
  if (process.env.PRE_R13_APP_ROOT) {
    const pre = pathToFileURL(`${process.env.PRE_R13_APP_ROOT.replace(/\/$/, '')}/`);
    assert.deepEqual(engine, await legacyEngineSnapshot(pre));
    assert.deepEqual(app, await legacyAppSnapshot(pre));
  }
  assert.equal(createHash('sha256').update(JSON.stringify(engine)).digest('hex'), PRE_R13_ENGINE_SHA256);
  assert.equal(createHash('sha256').update(JSON.stringify(app)).digest('hex'), PRE_R13_APP_SHA256);
});

test('R13 legacy: the normalized settings of a pre-R13 save gain no field', () => {
  const saved = {engine: 'anthropic', providers: {anthropic: {stageModels: {medium: 'claude-haiku-5-5', upper: 'not-a-model'}}}};
  const settings = getTextGenerationSettings({settings: {textGeneration: saved}});
  assert.deepEqual(Object.keys(settings.providers.anthropic), ['model', 'stageModels']);
  assert.deepEqual(settings.providers.anthropic.stageModels, {medium: 'claude-haiku-5-5', upper: 'claude-opus-5-5'});
});

test('R13 shell: cache v37 precaches the model list module', () => {
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v37";/);
  assert.ok(sw.includes('"./text-generation/model-list.js"'));
});
