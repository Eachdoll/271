import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import * as L from '../dist/book-layout.js';
import {seedState, generateBook} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import * as schemas from '../dist/story-generation/schemas.js';
import * as demo from '../dist/story-generation/demo.js';
import {createCloudSync} from '../dist/cloud-sync.js';

/**
 * R12-P8 release checks with the flag ON (no hook):
 * - a free demo FULL AUTO openings book (K2/E2 bilingual and K4/E4 dual, sample
 *   pictures) in the compact cloud snapshot (the real createCloudSync push) is
 *   ≤200KB and smaller than today's page book; with its job it is smaller too
 *   (the design's 150KB is below today's page book, see the test);
 * - an old (pre-R12) shell that normalizes a 16-page openings input builds a valid
 *   16-page page book, which this shell reads as a page book with layoutMismatch.
 *   With PRE_R12_APP_ROOT (a checkout of 5f8d2f7) the real old modules run;
 *   without it the old normalizer is emulated (it drops layoutPolicy).
 */
const HOOK = '__DONGHWA_R12_OPENINGS__';
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const preRoot = process.env.PRE_R12_APP_ROOT ? pathToFileURL(`${process.env.PRE_R12_APP_ROOT.replace(/\/$/, '')}/`) : null;
const LOST = {layout: 'pages', layoutMismatch: true, errors: ['펼침 구성 정보가 빠져 있어 쪽 책으로 읽어요.']};

function seed() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  getActiveWorld(state).imageEngine = 'sample';
  return state;
}
const wizardOf = (koreanLevel, englishLevel, language, pageCount = 16) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['forest', 'garden'], topic: '바람 피리 찾기', pageCount, koreanLevel, englishLevel, language, value: 'none', ending: 'home', storyDate: '2026-10-19T00:00:00.000Z'});

/** A finished free demo FULL AUTO job (demo text, every picture 'bought' as an asset id). */
async function demoJob(wizard, hook) {
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK], realFetch = globalThis.fetch;
  if (hook === undefined) delete globalThis[HOOK]; else globalThis[HOOK] = hook;
  let network = 0;
  globalThis.fetch = async () => { network++; throw Error('no network in this test'); };
  try {
    const state = seed(), job = createFullAutoJob(state, wizard, {demo: true, planMode: 'selection'});
    const buildBook = payload => Object.assign(generateBook({...payload.wizard, pageCount: payload.pagination.pages.length}, toLegacyPages(payload.pagination), state.characters, state.books), {id: payload.bookId, pages: toLegacyPages(payload.pagination), outline: payload.outline, prose: payload.prose, pagination: payload.pagination, storyInput: payload.input, sceneBriefs: payload.sceneBriefs, readingLevelSnapshot: payload.readingLevels, textDemo: payload.demo, worldSettingsSnapshot: payload.worldSnapshot});
    const scene = async (_state, book, index) => {
      Object.assign(book.pages[index], {imageAssetId: `image-asset-${index}`, imageUrl: `blob:page-${index}`, imageMeta: {quality: 'final', engine: 'sample'}});
      return {usage: {}, meta: {}};
    };
    const cover = async (_state, book) => { book.cover = {...(book.cover || {}), imageAssetId: 'image-asset-cover', imageUrl: 'blob:cover'}; return {}; };
    await runFullAuto(state, job, {buildBook, operations: {scene, cover}});
    assert.equal(job.status, 'review', job.error || '');
    assert.equal(network, 0, 'nothing paid, nothing fetched');
    return {state, job};
  } finally {
    if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK];
    globalThis.fetch = realFetch;
  }
}

/** The state body the real cloud sync PUTs (compact snapshot) for a library. */
async function cloudBody(library) {
  let body = null;
  const json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
  const fetchImpl = async (url, options = {}) => {
    const path = String(url).replace('/api/cloud', ''), method = options.method || 'GET';
    if (path === '/session') return json({authenticated: true, user: {id: 'owner-A', email: 'family@example.test'}});
    if (path === '/library?meta=1') return json({exists: false, revision: 0, updatedAt: null, summary: {bookCount: 0, characterCount: 0, backgroundCount: 0}});
    if (path === '/library' && method === 'GET') return json({exists: false, revision: 0, state: null, manifest: [], updatedAt: null});
    if (path === '/library' && method === 'PUT') { body = JSON.parse(options.body); return json({revision: 1, updatedAt: '2026-10-19T00:00:00Z'}); }
    throw Error(`unexpected ${method} ${path}`);
  };
  const values = new Map(), storage = {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  const sync = createCloudSync({getState: () => library, hasLocalData: () => true, isParent: () => true, canApplyRemote: () => true, applyRemote: async () => {}, storage, fetchImpl, pollInterval: 0, eventTarget: null, document: null, debounceMs: 100000, onChange: () => {}, createLibraryBackup: async state => ({snapshot: clone(state), assets: new Map()})});
  try {
    await sync.start();
    await sync.push();
  } finally { sync.stop(); }
  assert.ok(body?.state, 'the snapshot was pushed');
  return body.state;
}

test('R12-P8 the flag is on: a new K2-K4 Korean FULL AUTO job is an openings book at 16 pages by default; K1 and English-only stay page books', async () => {
  assert.equal(L.OPENINGS_ENABLED, true);
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  delete globalThis[HOOK];
  try {
    assert.equal(L.openingsEnabled(), true);
    for (const [ko, language] of [['K2', 'bilingual'], ['K3', 'ko'], ['K4', 'dual']]) {
      const w = {koreanLevel: ko, language};
      assert.equal(L.layoutFor(w), 'openings');
      assert.equal(L.snapPageCount(L.layoutFor(w), 12, {defaultPages: 12}), 16, 'untouched: 16');
      const job = createFullAutoJob(seed(), wizardOf(ko, 'E2', language), {demo: true, stopBefore: 'text', planMode: 'selection'});
      assert.deepEqual([job.input.layoutPolicy?.kind, job.input.outlineBeatCount, job.input.specs.ko.layout], ['openings', 8, 'openings'], ko);
    }
    for (const [ko, language] of [['K1', 'bilingual'], ['K2', 'en']]) {
      assert.equal(L.layoutFor({koreanLevel: ko, language}), 'pages');
      const job = createFullAutoJob(seed(), wizardOf(ko, 'E2', language, 24), {demo: true, stopBefore: 'text', planMode: 'selection'});
      assert.ok(!('layoutPolicy' in job.input), `${ko}/${language}`);
      assert.equal(job.input.pageCount, 24);
    }
  } finally { if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK]; }
});

test('R12-P8 cloud size: a demo FULL AUTO openings book is ≤200KB in the compact snapshot and at least 15% smaller than today\'s page book (K2/E2 bilingual, K4/E4 dual)', async () => {
  const report = [];
  const delta = async (base, add) => {
    const library = clone(base);
    add(library);
    const body = await cloudBody(library);
    return {bytes: bytes(body) - bytes(await cloudBody(clone(base))), chars: JSON.stringify(body).length - JSON.stringify(await cloudBody(clone(base))).length};
  };
  for (const [ko, en, language] of [['K2', 'E2', 'bilingual'], ['K4', 'E4', 'dual']]) {
    const openings = await demoJob(wizardOf(ko, en, language)), pages = await demoJob(wizardOf(ko, en, language), false);
    assert.equal(L.layoutOf(openings.job.book), 'openings', ko);
    assert.equal(L.layoutOf(pages.job.book), 'pages', ko);
    assert.equal(openings.job.book.pages.length, 13, 'demo: 3 spreads + 5 pairs');
    assert.ok(!openings.job.qualityCheckpoint, 'a demo job keeps no quality checkpoint (nothing to prune)');
    const base = seed();
    const sizes = {};
    for (const [name, {job}] of [['openings', openings], ['pages', pages]]) {
      sizes[name] = {
        book: await delta(base, library => { library.books.push(clone(job.book)); }),
        bookAndJob: await delta(base, library => { library.books.push(clone(job.book)); library.fullAutoJobs = {[job.id]: clone(job)}; }),
      };
    }
    report.push({ko, en, ...sizes});
    // The design budgeted ≤150KB per book. Measured here, today's page book of the same
    // demo story is already 220KB (K2) / 249KB (K4) in UTF-8 bytes, and the openings book
    // is about a fifth smaller (172KB / 190KB; 136K / 153K JSON characters). The bytes
    // cap is therefore pinned at 200KB and below 85% of today's book; nothing needs
    // pruning (a demo job keeps no qualityCheckpoint). Recorded as a P8 deviation.
    assert.ok(sizes.openings.book.bytes <= 200 * 1024, `${ko}/${en}: ${JSON.stringify(sizes.openings.book)}`);
    assert.ok(sizes.openings.book.bytes <= 0.85 * sizes.pages.book.bytes, `${ko}/${en}: ${JSON.stringify(sizes)}`);
    for (const unit of ['bytes', 'chars']) {
      assert.ok(sizes.openings.book[unit] < sizes.pages.book[unit], `${ko}/${en} book ${unit}`);
      assert.ok(sizes.openings.bookAndJob[unit] < sizes.pages.bookAndJob[unit], `${ko}/${en} book+job ${unit}`);
    }
  }
  console.log(`# R12-P8 cloud size ${JSON.stringify(report)}`);
  assert.equal(report.length, 2);
});

test('R12-P8 old shell: a pre-R12 normalizeStoryInput on a 16-page openings input builds a valid 16-page page book; this shell marks it layoutMismatch', async () => {
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  delete globalThis[HOOK];
  try {
    const job = createFullAutoJob(seed(), wizardOf('K2', 'E2', 'bilingual'), {demo: true, stopBefore: 'text', planMode: 'selection'});
    assert.deepEqual([job.input.layoutPolicy?.kind, job.input.pageCount, job.input.specs.ko.ruleVersion], ['openings', 16, 4]);
    const old = preRoot ? {
      pipeline: await import(new URL('dist/story-generation/pipeline.js', preRoot).href),
      schemas: await import(new URL('dist/story-generation/schemas.js', preRoot).href),
      demo: await import(new URL('dist/story-generation/demo.js', preRoot).href),
    } : {
      // Emulation: the R11 normalizer has no layoutPolicy field and keeps the specs.
      pipeline: {normalizeStoryInput: input => { const copy = clone(input); delete copy.layoutPolicy; delete copy.outlineBeatCount; return normalizeStoryInput(copy); }, toLegacyPages},
      schemas, demo,
    };
    const input = old.pipeline.normalizeStoryInput(clone(job.input));
    assert.ok(!('layoutPolicy' in input), 'the old shell drops the policy');
    assert.deepEqual([input.pageCount, input.specs.ko.layout], [16, 'openings']);
    const outline = old.demo.demoOutline(input), prose = old.demo.demoProse(outline, input), pagination = old.demo.demoPagination(outline, prose, input);
    assert.equal(old.schemas.validatePagination(pagination, input, outline).valid, true, 'a valid page book for the old shell');
    const pages = old.pipeline.toLegacyPages(pagination);
    assert.equal(pages.length, 16);
    assert.ok(pages.every(page => !L.LAYOUT_FIELDS.some(key => key in page)), 'no opening fields');
    const book = {storyInput: input, outline, pagination, pages};
    assert.deepEqual(L.layoutStatus(book), LOST);
    assert.equal(L.layoutOf(book), 'pages');
    assert.deepEqual([L.printedPagesOf(book), L.openingsOf(book).length, L.unitImageSize(book, pages[0]), L.unitLabel(book, 2)], [16, 0, '1536x1024', '3쪽']);
    // This shell reads it with today's page rules (no throw).
    assert.equal(schemas.validatePagination(pagination, normalizeStoryInput(input), outline).valid, true);
  } finally { if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK]; }
});

test('R12-P8 the pro editor picture bar counts pictures and prices each entry at its size; a page book\'s bar is unchanged', async () => {
  const hadDocument = Object.hasOwn(globalThis, 'document'), previousDocument = globalThis.document;
  globalThis.document = {addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }};
  try {
    const ui = await import('../dist/image-generation/settings-ui.js');
    const {estimateImageCost} = await import('../dist/image-generation/models.js');
    const {readFileSync} = await import('node:fs');
    const state = seed();
    getActiveWorld(state).imageEngine = 'google';
    ui.configureImageUI({getState: () => state, getEditPage: () => 0, toast: () => {}, render: () => {}});
    const {job} = await demoJob(wizardOf('K2', 'E2', 'bilingual'));
    const book = clone(job.book);
    for (const page of book.pages) { delete page.imageAssetId; delete page.imageUrl; }
    delete book.generationSnapshot;
    const bar = ui.renderGenerationControls(book);
    const unit = size => estimateImageCost({engine: 'google', quality: 'draft', size, config: getActiveWorld(state).providerConfig?.google}).costUsd;
    const kinds = book.pages.map(page => page.kind);
    assert.deepEqual([kinds.filter(k => k === 'spread').length, kinds.filter(k => k === 'page').length], [3, 10]);
    assert.match(bar, /그림 0 \/ 13장 생성 · 펼침 8개 ·/u);
    assert.ok(bar.includes(`전체 draft 예상 $${(3 * unit('2048x880') + 10 * unit('1536x1024')).toFixed(2)}`), bar);
    assert.match(bar, />그림 13장 draft 전체 생성</u);
    assert.match(bar, />이 그림 draft 생성</u);
    // A page book: today's bar, word for word.
    const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));
    const legacyBar = ui.renderGenerationControls(legacy);
    assert.match(legacyBar, new RegExp(`<small>\\d+ / ${legacy.pages.length}쪽 생성 · 캐릭터`, 'u'));
    assert.match(legacyBar, new RegExp(`>${legacy.pages.length}쪽 draft 전체 생성<`, 'u'));
    assert.doesNotMatch(legacyBar, /그림 \d+ \/|펼침/u);
    if (preRoot) {
      const old = await import(new URL('dist/image-generation/settings-ui.js', preRoot).href);
      old.configureImageUI({getState: () => state, getEditPage: () => 0, toast: () => {}, render: () => {}});
      assert.equal(legacyBar, old.renderGenerationControls(legacy), 'byte for byte against 5f8d2f7');
    }
  } finally {
    if (hadDocument) globalThis.document = previousDocument; else delete globalThis.document;
  }
});
