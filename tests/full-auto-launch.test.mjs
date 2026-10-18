import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {seedState, generateBook} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, captureBookGenerationSnapshot} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {toLegacyPages} from '../dist/story-generation/pipeline.js';
import {bindSeriesBackgrounds} from '../dist/story-generation/continuity.js';
import {revokeImageURLs} from '../dist/image-generation/assets.js';
import {configureFullAutoUI, startFullAutoJob, runFullAutoJob} from '../dist/full-auto-ui.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {generateBookPageImage, rewriteBookPage, applyPageText, isBookClaimedForRun, claimBookForRun, releaseBookForRun} from '../dist/story-generation/page-tools.js';

// FIX-IMG 1: the exported runner claims the book before its first await, so a
// page tool cannot slip into the gap before runFullAuto marks the job running.
// In-memory IndexedDB for saveImage and a fetch that refuses every network call.
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
  globalThis.fetch = async (url, ...rest) => {
    if (String(url?.url || url).startsWith('data:')) return oldFetch(url, ...rest);
    paidFetches++;
    throw Error('network is not allowed in this test: ' + String(url).slice(0, 60));
  };
  const store = new Map();
  globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
  globalThis.document ||= {addEventListener() {}, querySelector() {return null;}};
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
function configure(state) {
  const ui = {toasts: [], saves: 0};
  configureFullAutoUI({getState: () => state, save: () => {ui.saves++; return true;}, toast: m => ui.toasts.push(String(m?.message || m)), isParent: () => true,
    protectedAction: f => f(), onStarted() {}, buildBook: appBuilder(state), openReview: async () => {}, showModal() {}, closeModal() {}, modalHeader: t => t});
  return ui;
}
const refuse = name => async () => {throw Error(name + ' must not run here');};
const useNavigator = value => Object.defineProperty(globalThis, 'navigator', {value, configurable: true, writable: true});

test('a page tool called right after a hold is released is refused, and the run draws each page once', async () => {
  paidFetches = 0;
  const {state, wizard} = setup();
  configure(state);
  const job = await startFullAutoJob(wizard, {demo: true, planMode: 'selection', stopBefore: 'pages'});
  assert.equal(job.status, 'pages-ready', job.error || '');
  const book = job.book, before = Object.keys(job.imageUsage || {}).length;
  assert.equal(isBookClaimedForRun(book.id), false);
  let toolDraws = 0;
  const tool = () => generateBookPageImage(state, book, 0, {save: () => true, generate: async () => {toolDraws++; throw Error('the page tool must not draw');}});
  // A slow run lock stands in for the credential decrypt and cloud fetch before runFullAuto marks the job running.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  useNavigator({locks: {request: async (name, options, callback) => {await new Promise(resolve => setTimeout(resolve, 30)); return callback({name});}}});
  let run;
  try {
    run = runFullAutoJob(job.id, {stopBefore: null});
    // Same tick: the job still shows its hold, but the book is claimed.
    assert.equal(job.status, 'pages-ready');
    assert.equal(isBookClaimedForRun(book.id), true);
    await assert.rejects(tool(), /만드는 중/);
    await Promise.resolve(); await Promise.resolve();
    await assert.rejects(tool(), /만드는 중/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(job.status, 'pages-ready', 'still waiting for the run lock');
    await assert.rejects(tool(), /만드는 중/);
    await assert.rejects(rewriteBookPage(state, book, 0, {rewrite: refuse('rewrite')}), /만드는 중/);
    await assert.rejects(applyPageText(state, book, 0, {ko: '끼어든 글'}), /만드는 중/);
    await run;
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator;
  }
  assert.equal(job.status, 'review', job.error || '');
  assert.equal(toolDraws, 0);
  assert.notEqual(book.pages[0].ko, '끼어든 글');
  assert.equal(Object.keys(job.imageUsage).length - before, 13, '12 pages and the cover, each bought once');
  assert.equal(new Set(book.pages.map(p => p.imageAssetId)).size, 12);
  assert.equal(paidFetches, 0);
  // The claim ends with the run: page tools work again.
  assert.equal(isBookClaimedForRun(book.id), false);
  assert.equal((await applyPageText(state, book, 1, {ko: '유하가 다시 웃어요.', save: () => true})).changed, true);
});

test('a run that fails before drawing releases its claim', async () => {
  const {state, wizard} = setup();
  const ui = configure(state);
  const job = await startFullAutoJob(wizard, {demo: true, planMode: 'selection', stopBefore: 'pages'});
  assert.equal(job.status, 'pages-ready', job.error || '');
  getActiveWorld(state).revision++;
  const run = runFullAutoJob(job.id, {stopBefore: null});
  assert.equal(isBookClaimedForRun(job.book.id), true);
  await run;
  assert.equal(job.status, 'failed');assert.match(ui.toasts.at(-1), /World 설정이 바뀌/);
  assert.equal(isBookClaimedForRun(job.book.id), false);
  assert.ok(job.book.pages.every(p => !p.imageAssetId), 'nothing was drawn');
});

test('claims pair up: a book stays claimed until every claim is released', () => {
  assert.equal(claimBookForRun(''), false);assert.equal(isBookClaimedForRun(''), false);
  claimBookForRun('book-a');claimBookForRun('book-a');
  releaseBookForRun('book-a');assert.equal(isBookClaimedForRun('book-a'), true);
  releaseBookForRun('book-a');assert.equal(isBookClaimedForRun('book-a'), false);
  releaseBookForRun('book-a');assert.equal(isBookClaimedForRun('book-a'), false, 'an extra release is harmless');
});

// ---- FIX-IMG-2: a stop that lands during the preflight or a save ends the run 'paused', never in a hold ----
async function textHeld() {
  const {state, wizard} = setup();
  const job = createFullAutoJob(state, wizard, {demo: true, planMode: 'selection', stopBefore: 'text'});
  await runFullAuto(state, job, {buildBook: appBuilder(state)});
  assert.equal(job.status, 'text-review', job.error || '');
  assert.equal(job.book.generationSnapshot, undefined, 'a text hold freezes no snapshot');
  return {state, job};
}
const noImages = {characterSheet: refuse('character sheet'), backgroundSheet: refuse('background sheet'), scene: refuse('scene'), cover: refuse('cover')};

test('a stop pressed during the preflight of a release to pages ends paused, with no snapshot frozen', async () => {
  const {state, job} = await textHeld(), controller = new AbortController(), statuses = [];
  job.stopBefore = 'pages';
  await assert.rejects(runFullAuto(state, job, {signal: controller.signal, buildBook: appBuilder(state), save: () => {statuses.push(job.status); return true;},
    operations: {...noImages, preflight: async () => {controller.abort();}}}), {name: 'AbortError'});
  assert.equal(job.status, 'paused');assert.equal(job.error, null);
  assert.equal(job.book.generationSnapshot, undefined, 'page tools would read a snapshot as ready to draw');
  assert.ok(!statuses.includes('pages-ready'), 'the hold was never saved');assert.equal(statuses.at(-1), 'paused');
});

test('a stop pressed while the run saves is honoured before the snapshot and before the hold', async () => {
  // During the save that marks the job running: nothing is frozen and the job ends paused.
  {
    const {state, job} = await textHeld(), controller = new AbortController(), statuses = [];
    job.stopBefore = 'pages';
    await assert.rejects(runFullAuto(state, job, {signal: controller.signal, buildBook: appBuilder(state), operations: noImages,
      save: () => {statuses.push(job.status); if (job.status === 'running') controller.abort(); return true;}}), {name: 'AbortError'});
    assert.equal(job.status, 'paused');assert.equal(job.book.generationSnapshot, undefined);
    assert.ok(!statuses.includes('pages-ready'));
  }
  // During the save of the hold itself: the stop wins and the saved status ends paused.
  {
    const {state, job} = await textHeld(), controller = new AbortController(), statuses = [];
    job.stopBefore = 'pages';
    let reports = 0;
    await assert.rejects(runFullAuto(state, job, {signal: controller.signal, buildBook: appBuilder(state), operations: noImages, onProgress: p => {if (p.message === '그림 준비 완료') reports++;},
      save: () => {statuses.push(job.status); if (job.status === 'pages-ready') controller.abort(); return true;}}), {name: 'AbortError'});
    assert.equal(job.status, 'paused');assert.equal(statuses.at(-1), 'paused');assert.equal(reports, 0, 'the hold is never announced');
  }
  // Resuming a pages hold whose snapshot exists: a stop during the preflight also ends paused.
  {
    const {state, wizard} = setup(), controller = new AbortController();
    const job = createFullAutoJob(state, wizard, {demo: true, planMode: 'selection', stopBefore: 'pages'});
    await runFullAuto(state, job, {buildBook: appBuilder(state)});
    assert.equal(job.status, 'pages-ready');assert.ok(job.book.generationSnapshot);
    await assert.rejects(runFullAuto(state, job, {signal: controller.signal, buildBook: appBuilder(state), operations: {...noImages, preflight: async () => controller.abort()}}), {name: 'AbortError'});
    assert.equal(job.status, 'paused');
    assert.ok(job.book.pages.every(p => !p.imageAssetId), 'no page was drawn');
  }
  // Without a stop the same release still reaches its hold.
  const {state, job} = await textHeld();
  job.stopBefore = 'pages';
  await runFullAuto(state, job, {buildBook: appBuilder(state), operations: noImages});
  assert.equal(job.status, 'pages-ready');assert.ok(job.book.generationSnapshot);
});
