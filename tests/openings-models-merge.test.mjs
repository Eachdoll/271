// R12 openings × R13 model picker (merge): an openings estimate prices both
// picture sizes with the model frozen on the job or book, never a later World
// choice, and an unpriced model shows '요금 정보 없음' instead of a $ range.
// Fake data only; nothing is paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, updateWorldGenerationSettings} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {stagePagination} from '../dist/story-generation/staging.js';
import {applySimpleTextModel} from '../dist/text-generation/settings-ui.js';
import {applyImageModelChoice} from '../dist/image-generation/settings-ui.js';
import {estimateImageCost} from '../dist/image-generation/models.js';
import {createFullAutoJob, estimateFullAutoCost} from '../dist/full-auto.js';
import {estimateSimpleCosts} from '../dist/story-generation/page-tools.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';

const HOOK = '__DONGHWA_R12_OPENINGS__';
const clone = value => JSON.parse(JSON.stringify(value));
const LEGACY = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));
const WIZARD = {characterIds: ['yuha', 'greenie'], backgroundIds: [], topic: '바람 피리 찾기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', value: 'none', ending: 'home'};
function seed() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  updateWorldGenerationSettings(state, {imageEngine: 'google'});
  return state;
}
async function withOpenings(fn) {
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  globalThis[HOOK] = true;
  try { return await fn(); } finally { if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK]; }
}
function ctxFor(state, wizard) {
  let w = wizard, d = null, page = 0;
  return {getState: () => state, getWizard: () => w, setWizard: v => { w = v; }, getDraft: () => d, setDraft: v => { d = v; }, getEditPage: () => page, setEditPage: v => { page = v; }, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''};
}
const costLines = html => html.match(/<ul class="simple-costs">.*?<\/ul>/)[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
function openingsBook() {
  const base = clone(LEGACY);
  const input = normalizeStoryInput({...base.storyInput, layoutPolicy: L.openingsLayoutPolicy(), specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs, pageCount: 16});
  const prose = demoProse(base.outline, input);
  const pagination = stagePagination(demoPagination(base.outline, prose, input), {outline: base.outline, sceneBriefs: base.sceneBriefs, bookId: base.id, openings: true});
  const book = {...base, textDemo: false, storyInput: input, prose, pagination, pages: toLegacyPages(pagination), pageCount: pagination.pages.length};
  for (const page of book.pages) { delete page.imageUrl; delete page.imageMeta; delete page.imageAssetId; }
  return book;
}

test('merge: an openings job frozen on an unpriced picture model shows no $ range in ③, a later priced pick does not leak in', () => withOpenings(() => {
  const state = seed();
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-9-image');
  const job = createFullAutoJob(state, {...WIZARD, simpleFlow: true}, {stopBefore: 'text'});
  job.status = 'paused';
  assert.equal(job.input.layoutPolicy?.kind, 'openings');
  const estimate = estimateFullAutoCost(state, WIZARD, {job});
  assert.equal(estimate.imagePricingUnknown, true);
  assert.deepEqual([estimate.imageCountMin, estimate.imageCountMax], [8, 15]);
  const render = () => costLines(renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...clone(WIZARD), simpleStep: 3, simpleJobId: job.id}))));
  const before = render();
  assert.match(before, /그림 8~15장 \+ 표지 \(펼침면 수에 따라\) 요금 정보 없음/u);
  assert.match(before, /새 시트가 필요하면 요금 정보 없음/u);
  assert.match(before, /검사 후 자동 수정: 보통 6~13회 · 최대 16회/u);
  assert.match(before, /\(펼침면 수에 따라\) 요금 정보 없음 검사 후/u, 'no $ range on the picture line');
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-3.1-flash-image');
  assert.equal(render(), before);
  // Without the job the current, priced choice gives today's R12 range.
  const fresh = estimateFullAutoCost(state, WIZARD);
  assert.equal(fresh.imagePricingUnknown, undefined);
  const page = estimateImageCost({engine: 'google', quality: 'final', size: '1536x1024', config: {model: 'gemini-3.1-flash-image'}}).costUsd,
    spread = estimateImageCost({engine: 'google', quality: 'final', size: '2048x880', config: {model: 'gemini-3.1-flash-image'}}).costUsd,
    priced = [1, 8].map(s => s * spread + 2 * (8 - s) * page + page);
  assert.ok(Math.abs(fresh.imagesUsd - Math.max(...priced)) < 1e-9);
  assert.ok(Math.abs(fresh.imagesMinUsd - Math.min(...priced)) < 1e-9);
  assert.match(costLines(renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...clone(WIZARD), simpleStep: 3})))), /그림 8~15장 \+ 표지 \(펼침면 수에 따라\) 약 \$[\d.]+~\$[\d.]+/u);
}));

test('merge: an openings book prices spreads and pages with its frozen model; an unpriced text model marks the repairs', () => withOpenings(() => {
  const state = seed(), book = openingsBook();
  book.generationSnapshot = {imageEngine: 'google', imageModelConfig: {googlePro: false, modelVariant: 'default'}};
  applyImageModelChoice(getActiveWorld(state), 'google', 'gemini-typed-image');
  const costs = estimateSimpleCosts(state, book);
  assert.equal(costs.imagePricingUnknown, undefined, 'the later typed pick is not this book\'s model');
  const page = estimateImageCost({engine: 'google', quality: 'final', size: '1536x1024'}).costUsd,
    spread = estimateImageCost({engine: 'google', quality: 'final', size: '2048x880'}).costUsd,
    spreads = book.pages.filter(p => p.kind === 'spread').length,
    pages = book.pages.length - spreads;
  assert.ok(spreads > 0 && pages > 0);
  assert.ok(Math.abs(costs.imagesUsd - (spreads * spread + pages * page + page)) < 1e-9, `${costs.imagesUsd}`);
  assert.ok(Math.abs(costs.spreadUnitUsd - spread) < 1e-9);
  // A book frozen on the typed model: every size is unpriced.
  book.generationSnapshot.imageModelConfig.model = 'gemini-typed-image';
  const unknown = estimateSimpleCosts(state, book);
  assert.equal(unknown.imagePricingUnknown, true);
  assert.equal(unknown.imagesUsd, 0);
  // The page rewrite is priced by entry kind and flags an unpriced text model.
  state.settings.textGeneration = {engine: 'openai'};
  const spreadIndex = book.pages.findIndex(p => p.kind === 'spread'), pageIndex = book.pages.findIndex(p => p.kind === 'page');
  book.textGenerationSettings = clone(state.settings.textGeneration);
  assert.ok(estimateSimpleCosts(state, book, {pageIndex: spreadIndex}).pageTextUsd > estimateSimpleCosts(state, book, {pageIndex}).pageTextUsd);
  applySimpleTextModel(book.textGenerationSettings, 'openai', 'my-unpriced-model');
  const text = estimateSimpleCosts(state, book, {pageIndex});
  assert.equal(text.textPricingUnknown, true);
  applySimpleTextModel(state.settings.textGeneration, 'openai', 'my-unpriced-model');
  const wizardEstimate = estimateFullAutoCost(state, WIZARD);
  assert.equal(wizardEstimate.textPricingUnknown, true);
  assert.equal(wizardEstimate.repairs.pricingUnknown, true);
  assert.equal(wizardEstimate.repairs.maxUsd, 0);
  assert.match(costLines(renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...clone(WIZARD), simpleStep: 3})))), /최대 16회 요금 정보 없음/u);
}));
