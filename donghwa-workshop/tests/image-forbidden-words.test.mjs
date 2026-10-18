import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {seedState, generateBook} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, captureBookGenerationSnapshot, sceneGenerationRequest, createCharacterSheetRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto, fullAutoProgress} from '../dist/full-auto.js';
import {toLegacyPages} from '../dist/story-generation/pipeline.js';
import {bindSeriesBackgrounds} from '../dist/story-generation/continuity.js';
import {generateImage} from '../dist/image-generation/providers.js';
import {STYLE_PRESETS, LEGACY_STYLE_PRESETS, forbiddenStyleMatches, validateStylePreset, DEFAULT_FORBIDDEN_STYLE_WORDS} from '../dist/image-generation/styles.js';
import {revokeImageURLs} from '../dist/image-generation/assets.js';

// In-memory IndexedDB for saveImage, as in device-transfer.test.mjs.
const oldDB = globalThis.indexedDB, oldFetch = globalThis.fetch, databases = new Map();
let paidFetches = 0;
before(() => {
  globalThis.indexedDB = {open(name) {
    const request = {};
    queueMicrotask(() => {
      if (!databases.has(name)) databases.set(name, new Map());
      const records = databases.get(name);
      request.result = {objectStoreNames: {contains: () => true}, close() {}, transaction() {
        const tx = {};
        const perform = fn => {const operation = {}; queueMicrotask(() => {operation.result = fn(); operation.onsuccess?.(); tx.oncomplete?.();}); return operation;};
        tx.objectStore = () => ({get: id => perform(() => records.get(id)), put: record => perform(() => {records.set(record.id, record); return record.id;}), delete: id => perform(() => records.delete(id))});
        return tx;
      }};
      request.onsuccess?.();
    });
    return request;
  }};
  // Only local data: URLs may be read; any network request would be a paid or external call.
  globalThis.fetch = async (url, ...rest) => {
    if (String(url?.url || url).startsWith('data:')) return oldFetch(url, ...rest);
    paidFetches++;
    throw Error('network is not allowed in this test: ' + String(url).slice(0, 60));
  };
  const store = new Map();
  globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
});
after(() => {globalThis.indexedDB = oldDB; globalThis.fetch = oldFetch; revokeImageURLs();});

function setup() {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha', 'toto'], backgroundIds: [], topic: '유하와 토토의 별 찾기', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'};
  return {state, wizard};
}
// The app's buildStoryResultBook, reduced to the fields the image path reads.
const appBuilder = state => result => {
  const options = {...result.wizard, pageCount: result.pagination.pages.length, koreanLevel: result.readingLevels.koreanLevel, englishLevel: result.readingLevels.englishLevel};
  const pages = toLegacyPages(result.pagination), book = generateBook(options, pages, state.characters, state.books);
  book.id = result.bookId; book.pages = pages;
  Object.assign(book, {outline: result.outline, storyQuality: result.outline.quality || null, proseCoherence: result.proseCoherence || null, pageCoherence: result.pageCoherence || null,
    sceneBriefs: result.sceneBriefs || [], prose: result.prose, pagination: result.pagination, stage: 'paged', storyInput: result.input, storyDraftId: result.id,
    textGenerationSettings: result.textSettings, textDemo: result.demo, localSample: result.demo, textUsage: result.usage, readingLevelSnapshot: result.readingLevels,
    worldId: result.worldId, worldSettingsSnapshot: structuredClone(result.worldSnapshot), approved: false,
    backgroundIds: [...new Set([...(result.outline.settings || []).map(s => s.backgroundId).filter(Boolean), ...(options.backgroundIds || [])])]});
  try {
    captureBookGenerationSnapshot(state, book);
    book.generationSnapshot.backgroundReferenceByPage = bindSeriesBackgrounds(book, book.generationSnapshot.backgrounds);
  } catch (error) {book.sheetSetupNotice = error.message;}
  return book;
};
const style = (patch = {}) => ({...structuredClone(STYLE_PRESETS[0]), ...patch});
const sample = request => generateImage({referenceImages: [], seed: 7, size: '1024x1024', quality: 'draft', ...request}, {engine: 'sample'});
const forbidden = {code: 'forbidden_style_name'};

test('style text keeps every default forbidden word and the parent-facing style checks', () => {
  for (const preset of [...STYLE_PRESETS, ...LEGACY_STYLE_PRESETS]) assert.equal(validateStylePreset(preset).valid, true, preset.id);
  for (const name of ['Frozen style', 'disney', 'Disney 수채화', '지브리풍 숲']) {
    const result = validateStylePreset(style({id: 'custom-x', isBuiltIn: false, name}));
    assert.equal(result.valid, false, name); assert.ok(result.errors.some(e => e.includes('금칙어')), name);
  }
  assert.deepEqual(forbiddenStyleMatches('a Disneyesque castle'), ['disney']);
  assert.deepEqual(forbiddenStyleMatches('pixar-like faces, disney풍'), ['disney', 'pixar']);
  assert.deepEqual(forbiddenStyleMatches('Studio  Ghibli meadow').sort(), ['ghibli', 'studio ghibli']);
  assert.deepEqual(forbiddenStyleMatches('soft mooncat drawing', ['MoonCat']), ['mooncat']);
  // Latin words match whole words only.
  assert.deepEqual(forbiddenStyleMatches('unfrozen chelsea hotelsand'), []);
  // Style text treats "frozen" strictly; that is why the old ledger header broke every plotContract page.
  assert.deepEqual(forbiddenStyleMatches('FROZEN EVENT AND STATE LEDGER'), ['frozen']);
  for (const word of DEFAULT_FORBIDDEN_STYLE_WORDS) assert.ok(forbiddenStyleMatches(`soft pencil ${word.toUpperCase()}`).includes(word), word);
});

test('material and story text: "frozen" counts only as a style reference, and a cast name plus particle is not 토토로', () => {
  const description = (text, names) => forbiddenStyleMatches(text, [], {scope: 'description', names});
  assert.deepEqual(description('The pond was frozen. FROZEN EVENT AND STATE LEDGER'), []);
  assert.deepEqual(description('Toto stood frozen like a statue, with a frozen look.'), []);
  assert.deepEqual(description('a frozen-style ice palace'), ['frozen']);
  assert.deepEqual(description('a Frozen-like gown'), ['frozen']);
  assert.deepEqual(description('Frozen movie princess dress'), ['frozen']);
  assert.deepEqual(description('겨울왕국 같은 성'), ['겨울왕국']);
  assert.deepEqual(description('Elsa waves'), ['elsa']);
  assert.deepEqual(description('토토로 달려가요'), ['토토로'], 'without a known name it is the film');
  assert.deepEqual(description('토토로 달려가요', ['토토', 'Toto']), []);
  assert.deepEqual(description('유하와 토토로 달려가요', ['토토']), []);
  assert.deepEqual(description('꼬마토토로 인형', ['토토']), ['토토로'], 'only a token that starts with the name');
  assert.deepEqual(description('토토로 달려가요', ['토토로']), ['토토로'], 'a character named after the film is still refused');
});

test('provider check: supplied text only, style names still refused', async () => {
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({name: 'Frozen style'})}), forbidden);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({name: 'disney'})}), forbidden);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style({stylePrompt: 'soft pixar look'})}), forbidden);
  await assert.rejects(sample({prompt: 'a small cat', stylePreset: style(), negativePrompt: 'not ghibli'}), forbidden);
  // A parent's free prompt (no declared parts) is still checked as a whole.
  await assert.rejects(sample({prompt: 'a disney princess', stylePreset: style()}), forbidden);
  assert.ok((await sample({prompt: 'a cat on the frozen pond', stylePreset: style()})).imageUrl);
  // App scaffolding outside the declared parts is never checked.
  assert.ok((await sample({prompt: 'FROZEN LEDGER: Mickey', stylePreset: style(), forbiddenWordCheck: {text: ['a calm cat'], names: []}})).imageUrl);
  await assert.rejects(sample({prompt: 'a calm cat', stylePreset: style(), forbiddenWordCheck: {text: ['Totoro ears'], names: []}}), forbidden);
});

test('character sheet requests still refuse forbidden names in the parent description', async () => {
  const {state} = setup();
  const toto = createCharacterSheetRequest(state, 'toto');
  assert.ok((await generateImage(toto, {engine: 'sample'})).imageUrl);
  state.characters.find(c => c.id === 'toto').description = '디즈니 공주 드레스';
  await assert.rejects(generateImage(createCharacterSheetRequest(state, 'toto'), {engine: 'sample'}), forbidden);
});

test('demo FULL AUTO with the sample engine draws every page and the cover of a plotContract book', async () => {
  paidFetches = 0;
  const {state, wizard} = setup();
  assert.equal(getActiveWorld(state).imageEngine, 'sample');
  const job = createFullAutoJob(state, wizard, {demo: true, planMode: 'selection', stopBefore: 'pages'});
  await runFullAuto(state, job, {buildBook: appBuilder(state)});
  assert.equal(job.status, 'pages-ready');
  const book = job.book;
  assert.ok(book.outline.plotContract, 'the demo outline carries a plot contract');
  // A scene request for this book passes the provider check with the real ledger in its prompt.
  const request = sceneGenerationRequest(state, book, 0, {quality: 'final'});
  assert.match(request.prompt, /LOCKED EVENT AND STATE LEDGER/); assert.doesNotMatch(request.prompt, /FROZEN EVENT/);
  assert.ok((await generateImage(request, {engine: 'sample'})).imageUrl);
  // Page text "토토로 달려가요" is 토토 + particle in a book where 토토 is in the cast.
  book.pages[1].ko = '토토로 달려가요.';
  assert.ok((await generateImage(sceneGenerationRequest(state, book, 1, {quality: 'final'}), {engine: 'sample'})).imageUrl);
  // A parent-entered place description is still checked.
  const place = book.generationSnapshot.backgrounds[0], kept = place.description;
  place.description = 'a Frozen-style ice palace';
  const placed = book.pages.findIndex((p, i) => sceneGenerationRequest(state, book, i).forbiddenWordCheck.text.includes('a Frozen-style ice palace'));
  assert.ok(placed >= 0);
  await assert.rejects(generateImage(sceneGenerationRequest(state, book, placed), {engine: 'sample'}), forbidden);
  place.description = kept;

  job.stopBefore = null;
  const finished = await runFullAuto(state, job, {buildBook: appBuilder(state)});
  assert.equal(job.status, 'review', job.error || ''); assert.equal(job.error, null);
  assert.equal(finished.pages.length, 12);
  assert.ok(finished.pages.every(p => p.imageAssetId && p.imageMeta?.quality === 'final' && p.imageMeta.engine === 'sample'));
  assert.match(finished.pages[0].imageMeta.prompt, /LOCKED EVENT AND STATE LEDGER/);
  assert.ok(finished.cover?.imageAssetId); assert.equal(fullAutoProgress(job).fraction, 1);
  assert.equal(paidFetches, 0);
  assert.ok(job.usage.calls.every(c => !c.costUsd && !c.costUsdEstimated));
});
