// R13 엔진 세부 선택 검수 수정: frozen job estimates, jobs saved before R13,
// unpriced sheet and book costs, model IDs in URL paths, list parsing, and the
// proxy's real adapter for typed models. Fake fetch only; nothing is paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, updateWorldGenerationSettings} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {isModelId, validateModelId, normalizeModelRegistry} from '../dist/text-generation/models.js';
import {fetchProviderModels, parseModelList} from '../dist/text-generation/model-list.js';
import {applySimpleTextModel} from '../dist/text-generation/settings-ui.js';
import {applyImageModelChoice} from '../dist/image-generation/settings-ui.js';
import {chosenImageModel, estimateImageCost, getEngineModel} from '../dist/image-generation/models.js';
import {createFullAutoJob, runFullAuto, estimateFullAutoCost, jobImageModelConfig, jobImageSnapshot} from '../dist/full-auto.js';
import {estimateSimpleCosts, bookPricingUnknown, estimatedCostText} from '../dist/story-generation/page-tools.js';
import {sheetPriceText} from '../dist/background-sheets.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {createImageProxyHandler} from '../image-proxy/server.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
function setup() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '유하와 달토끼의 별 찾기', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'};
  return {state, wizard};
}
function ctxFor(state, wizard) {
  let w = wizard, d = null, page = 0;
  return {
    getState: () => state, getWizard: () => w, setWizard: v => { w = v; }, getDraft: () => d, setDraft: v => { d = v; },
    getEditPage: () => page, setEditPage: v => { page = v; }, isSimpleView: () => true, isSimpleMode: () => true,
    materialPortrait: () => '', cover: () => '', illustration: () => '',
  };
}
const costLines = html => html.match(/<ul class="simple-costs">.*?<\/ul>/)[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('R13 review: ③ prices an existing job with its frozen text and picture models, not a later choice', () => {
  const {state, wizard} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  state.settings.textGeneration = {engine: 'openai'};
  applySimpleTextModel(state.settings.textGeneration, 'openai', 'my-unpriced-model');
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-9-image');
  const job = createFullAutoJob(state, {...wizard, simpleFlow: true}, {stopBefore: 'text'});
  job.status = 'paused';
  const render = () => costLines(renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id}))));
  const before = render();
  assert.match(before, /그림 12쪽 \+ 표지 요금 정보 없음/);
  assert.match(before, /글 만들기 [^그]*(일부 요금 미확인|요금 정보 없음)/);
  // The parent picks priced models afterwards: the paused job still draws and
  // writes with its own, so its line must not show their prices.
  applySimpleTextModel(state.settings.textGeneration, 'openai', 'gpt-6-astra');
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-3.1-flash-image');
  assert.equal(render(), before);
  const estimate = estimateFullAutoCost(state, wizard, {job});
  assert.equal(estimate.imagePricingUnknown, true);
  assert.equal(estimate.textPricingUnknown, true);
  // Without a job the current choice is priced as before.
  const fresh = estimateFullAutoCost(state, wizard);
  assert.equal(fresh.imagePricingUnknown, undefined);
  assert.equal(fresh.textPricingUnknown, undefined);
  assert.ok(fresh.imageUnitUsd > 0);
  // And the other way round: a job frozen on a priced model keeps its price.
  const priced = createFullAutoJob(state, {...wizard, simpleFlow: true}, {stopBefore: 'text'});
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-typed-image');
  assert.equal(estimateFullAutoCost(state, wizard, {job: priced}).imageUnitUsd, estimateImageCost({engine: 'google', quality: 'final', size: '1536x1024'}).costUsd);
});

const result = (data, stage) => ({data, usage: {input: 1, output: 1}, meta: {stage, requests: 1}});
function operations(seen) {
  return {
    preflight: async () => {},
    plan: async () => result({reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['home'], newBackgrounds: [{name: '달빛 언덕', nameEn: 'Moon Hill', type: 'space', description: '달의 낮은 언덕', layout: '둥근 돌 세 개와 낮은 길, 건물 없음'}, {name: '별빛 정원', nameEn: 'Star Garden', type: 'garden', description: '별빛 아래 작은 정원', layout: '작은 둥근 화단과 곧은 흙길, 문과 건물 없음'}], reason: '두 장소를 더해요.'}, 'materials'),
    characterSheet: async (s, character, options) => { seen.push(['sheet', Object.hasOwn(options, 'frozenImageModel'), options.frozenImageModel]); return {imageAssetId: 'image-sheet-0001', imageUrl: PNG, seed: 1, meta: {quality: 'final', requestedSeed: 1}}; },
    backgroundSheet: async (s, background, options) => { seen.push(['background', Object.hasOwn(options, 'frozenImageModel'), options.frozenImageModel]); return {imageAssetId: 'image-bg-' + background.id, imageUrl: PNG, seed: 1, meta: {quality: 'final'}}; },
    outline: async input => result(demoOutline(input), 'outline'),
    briefs: async (o, i) => result(demoSceneBriefs(o, i), 'sceneBriefs'),
    prose: async (o, i) => result(demoProse(o, i), 'prose'),
    enrichment: async p => result(p, 'enrichment'),
    pagination: async (o, p, i) => ({...result(demoPagination(o, p, i), 'pagination'), meta: {requests: 1, checks: {passed: true, checks: []}, richnessChecks: {valid: true, issues: []}}}),
    scene: async (s, b, index) => Object.assign(b.pages[index], {imageAssetId: 'image-page-' + String(index).padStart(4, '0'), imageUrl: PNG, imageMeta: {quality: 'final'}}),
    cover: async (s, b) => (b.cover = {imageAssetId: 'image-cover-0001', imageUrl: PNG, meta: {quality: 'final'}}),
  };
}
const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(page => ({...page, ko: page.textKo, en: page.textEn})), sceneBriefs: p.sceneBriefs, worldId: p.worldId, storyDraftId: p.id, textGenerationSettings: p.textSettings});

test('R13 review: a job saved before R13 keeps the provider default after a model is chosen; its resume never switches', async () => {
  const {state, wizard} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  const job = createFullAutoJob(state, wizard);
  delete job.imageModelConfig; // a job saved before R13
  assert.deepEqual(jobImageModelConfig(job), {googlePro: false, modelVariant: 'default'}, 'its World copy says what it drew with');
  assert.deepEqual(jobImageSnapshot(job), {imageModelConfig: {}});
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-3-pro-image');
  const seen = [];
  const book = await runFullAuto(state, job, {operations: operations(seen), buildBook, save: () => true});
  assert.ok(seen.length >= 2);
  assert.ok(seen.every(([, frozen, model]) => frozen && model === null), JSON.stringify(seen));
  assert.equal('model' in book.generationSnapshot.imageModelConfig, false, 'the book draws with the default, not the later Pro pick');
  assert.equal(getActiveWorld(state).providerConfig.google.model, 'gemini-3-pro-image', 'new books still get the new choice');
  // A job without a World copy (none exist in practice) stays undefined: the caller's World applies.
  assert.equal(jobImageModelConfig({}), undefined);
  assert.equal(jobImageSnapshot(undefined), undefined);
});

test('R13 review: a held book of a pre-R13 job is priced and shown with the default model', () => {
  const {state, wizard} = setup();
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  const job = createFullAutoJob(state, {...wizard, simpleFlow: true}, {stopBefore: 'pages'});
  delete job.imageModelConfig;
  const book = {id: job.bookId, pages: Array.from({length: 12}, () => ({ko: '가', en: 'a'})), characterIds: ['yuha'], storyInput: {topic: 'x'}, fullAutoRunId: job.id};
  job.book = book;
  job.status = 'pages-ready';
  (state.fullAutoJobs ||= {})[job.id] = job;
  state.books.push(book);
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-typed-image');
  const costs = estimateSimpleCosts(state, book);
  assert.equal(costs.imagePricingUnknown, undefined, 'the typed model chosen later is not this book\'s model');
  assert.equal(costs.imageUnitUsd, estimateImageCost({engine: 'google', quality: 'final', size: '1536x1024'}).costUsd);
});

test('R13 review: sheet and book cost lines never show an unpriced model as a dollar amount', () => {
  // OpenAI and BFL draw drafts with the chosen model too; a typed one has no price.
  const draft = estimateImageCost({engine: 'openai', quality: 'draft', size: '1536x1024', config: {model: 'gpt-image-9'}});
  assert.equal(draft.pricingUnknown, true);
  assert.equal(sheetPriceText(draft), '요금 정보 없음');
  assert.equal(sheetPriceText(estimateImageCost({engine: 'openai', quality: 'final', size: '1536x1024'})), '예상 $0.17');
  const pricedMeta = {costUsdEstimated: 0.067, costEstimate: {costUsd: 0.067}};
  const unknownMeta = {costUsdEstimated: 0, costEstimate: {costUsd: 0, pricingUnknown: true}};
  assert.deepEqual(bookPricingUnknown({pages: [{imageMeta: pricedMeta}], cover: {meta: pricedMeta}}), {images: false, text: false});
  assert.equal(bookPricingUnknown({pages: [{imageMeta: pricedMeta, imageHistory: [{imageMeta: unknownMeta}]}]}).images, true);
  const custom = {engine: 'openai', providers: {openai: {customModels: ['my-x'], stageModels: {medium: 'my-x', upper: 'my-x'}}}};
  assert.equal(bookPricingUnknown({pages: [{}], textGenerationSettings: custom}).text, true);
  assert.equal(bookPricingUnknown({pages: [{}], textGenerationSettings: {engine: 'openai'}}).text, false);
  assert.equal(bookPricingUnknown({pages: [{}], textDemo: true, textGenerationSettings: custom}).text, false);
  assert.equal(estimatedCostText(0.12, false), '추정 $0.120');
  assert.equal(estimatedCostText(0.12, true), '추정 $0.120 · 일부 요금 미확인');
  assert.equal(estimatedCostText(0, true), '요금 정보 없음');
});

test('R13 review: a model ID never walks out of its URL path; fetched lists are trimmed and deduplicated', async () => {
  for (const id of ['../x', 'a/../b', './a', 'a/./b', '/x', 'x/', 'a//b', '..', '.'])
    assert.equal(isModelId(id), false, id);
  for (const id of ['models/gemini-x', 'fal-ai/flux/dev', 'gpt-5.5', 'a.b', '...a', 'qwen3:8b'])
    assert.equal(isModelId(id), true, id);
  assert.throws(() => validateModelId('../../v1/files'), /모델 ID/);
  assert.equal(chosenImageModel('fal', {model: '../../evil'}), null);
  assert.equal(getEngineModel('fal', 'final', {model: '../../evil'}), 'bytedance/seedream/v5/pro');
  assert.deepEqual(normalizeModelRegistry({customModels: ['../x', 'ok']}), {customModels: ['ok']});
  assert.deepEqual(parseModelList('text', 'anthropic', {data: [{id: ' claude-x '}, {id: 'claude-x'}, {id: '../../x'}, null, {id: 5}]}), [{id: 'claude-x'}]);
  assert.deepEqual(parseModelList('text', 'openai', {data: [{id: 'gpt-b', created: 2}, {id: ' gpt-b ', created: 1}, {id: 'gpt-a', created: 'x'}]}), [{id: 'gpt-b'}, {id: 'gpt-a'}]);
  const list = await fetchProviderModels({kind: 'text', engine: 'openai', config: {proxyEndpoint: 'https://proxy.example.test', fetch: async () => Response.json({models: [' gpt-x', 'gpt-x', {id: 'gpt-y', label: 'Y'}, {id: '../y'}, null, 7]})}});
  assert.deepEqual(list.models, [{id: 'gpt-x'}, {id: 'gpt-y', label: 'Y'}]);
});

test('R13 review: the proxy sends a typed or fetched text model through the real adapter with the conservative shape', async () => {
  const env = {IMAGE_PROXY_ALLOWED_ORIGINS: 'https://story.example', OPENAI_API_KEY: 'server-openai', ANTHROPIC_API_KEY: 'server-anthropic', GOOGLE_IMAGE_API_KEY: 'server-google'};
  const server = http.createServer(createImageProxyHandler({env}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch, upstream = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith(base)) return realFetch(url, options);
    upstream.push({url: String(url), body: JSON.parse(options.body)});
    if (String(url).includes('googleapis')) return Response.json({candidates: [{content: {parts: [{text: '{"ok":true}'}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1}});
    if (String(url).includes('anthropic')) return Response.json({content: [{type: 'text', text: '{"ok":true}'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}});
    return Response.json({choices: [{message: {content: '{"ok":true}'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1}});
  };
  try {
    for (const engine of ['openai', 'anthropic', 'google']) {
      upstream.length = 0;
      const response = await fetch(`${base}/api/text/${engine}`, {method: 'POST', headers: {Origin: 'https://story.example', 'Content-Type': 'application/json'}, body: JSON.stringify({system: 's', user: 'u', jsonSchema: {type: 'object'}, maxTokens: 2000, model: 'my-tuned:v2'})});
      assert.equal(response.status, 200, engine);
      const body = await response.json(), sent = upstream[0];
      assert.equal(body.meta.pricingUnknown, true, engine);
      if (engine === 'google') {
        assert.match(sent.url, /\/models\/my-tuned:v2:generateContent$/);
        assert.deepEqual(sent.body.generationConfig, {maxOutputTokens: 2000});
      } else {
        assert.equal(sent.body.model, 'my-tuned:v2', engine);
        for (const field of ['temperature', 'reasoning_effort', 'response_format', 'thinking', 'output_config', 'tools', 'tool_choice'])
          assert.equal(field in sent.body, false, `${engine} ${field}`);
      }
      assert.doesNotMatch(JSON.stringify(body), /server-(openai|anthropic|google)/);
    }
    // A path-walking ID is not registered: the proxy falls back to the default model.
    upstream.length = 0;
    await fetch(`${base}/api/text/google`, {method: 'POST', headers: {Origin: 'https://story.example', 'Content-Type': 'application/json'}, body: JSON.stringify({system: 's', user: 'u', maxTokens: 100, model: '../../v1/x'})});
    assert.match(upstream[0].url, /\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  } finally {
    globalThis.fetch = realFetch;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
