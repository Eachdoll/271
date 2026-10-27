import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {stagePagination, updatePageStaging, SPREAD_SHOTS} from '../dist/story-generation/staging.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, captureBookGenerationSnapshot, sceneGenerationRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {generateImage} from '../dist/image-generation/providers.js';
import {checkForbiddenWordCheck} from '../dist/image-generation/styles.js';
import {createFullAutoJob, runFullAuto, estimateFullAutoCost, fullAutoProgress, jobPictureTotal} from '../dist/full-auto.js';
import {estimateSimpleCosts} from '../dist/story-generation/page-tools.js';
import {estimateImageCost} from '../dist/image-generation/models.js';

/**
 * R12-P5: openings pictures. A spread is drawn at 2048x880 (21:9) with a fold
 * composition, a page of a pair and the cover at 1536x1024; staging keeps spreads
 * off the fold; estimates show a range before the text and the exact count after.
 * Page books keep every prompt and size (the P0 'scene' pin).
 */
const clone = value => JSON.parse(JSON.stringify(value));
const HOOK = '__DONGHWA_R12_OPENINGS__';
const LEGACY = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));
function seed(imageEngine) {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  if (imageEngine) getActiveWorld(state).imageEngine = imageEngine;
  return state;
}
/** The legacy K2/E2 16-page book rebuilt as an openings book (demo text, staged, with briefs). */
function openingsBook() {
  const base = clone(LEGACY);
  const input = normalizeStoryInput({...base.storyInput, layoutPolicy: L.openingsLayoutPolicy(), specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs, pageCount: 16});
  const prose = demoProse(base.outline, input);
  const raw = demoPagination(base.outline, prose, input);
  const pagination = stagePagination(raw, {outline: base.outline, sceneBriefs: base.sceneBriefs, bookId: base.id, openings: true});
  const book = {...base, storyInput: input, prose, pagination, pages: toLegacyPages(pagination), pageCount: pagination.pages.length};
  for (const page of book.pages) { delete page.imageUrl; delete page.imageMeta; }
  return book;
}

test('R12-P5 a spread is requested at 2048x880, a pair page and the cover at 1536x1024; page books keep 1536x1024', () => {
  const state = seed(), book = openingsBook();
  captureBookGenerationSnapshot(state, book);
  assert.equal(L.layoutOf(book), 'openings');
  const spread = book.pages.findIndex(p => p.kind === 'spread'), page = book.pages.findIndex(p => p.kind === 'page');
  assert.equal(sceneGenerationRequest(state, book, spread, {quality: 'final'}).size, '2048x880');
  assert.equal(sceneGenerationRequest(state, book, page, {quality: 'final'}).size, '1536x1024');
  assert.equal(sceneGenerationRequest(state, book, spread, {cover: true, quality: 'final'}).size, '1536x1024');
  const legacy = clone(LEGACY), legacyState = seed();
  captureBookGenerationSnapshot(legacyState, legacy);
  assert.equal(sceneGenerationRequest(legacyState, legacy, 0, {quality: 'final'}).size, '1536x1024');
  // A book with the policy but legacy entries (an old tab paginated it) draws 3:2 pages.
  const mismatch = {...clone(LEGACY), storyInput: book.storyInput};
  assert.equal(L.layoutOf(mismatch), 'pages');
  captureBookGenerationSnapshot(legacyState, mismatch);
  assert.equal(sceneGenerationRequest(legacyState, mismatch, 0, {quality: 'final'}).size, '1536x1024');
});

test('R12-P5 the spread prompt has the fold rule and no quiet text half, textSide or cue; pages name their binding edge', () => {
  const state = seed(), book = openingsBook();
  captureBookGenerationSnapshot(state, book);
  for (const [index, page] of book.pages.entries()) {
    const request = sceneGenerationRequest(state, book, index, {quality: 'final'});
    assert.doesNotMatch(request.prompt, /\bcalm\b|empty space|quiet empty|textSide|text side/iu, `${index}`);
    assert.doesNotMatch(request.prompt, new RegExp(`\\b${page.cue}\\b|${L.CUES[page.cue] || '@@'}`, 'u'));
    assert.match(request.prompt, /Draw ONLY the single moment in Actual event/u);
    if (page.kind === 'spread') {
      assert.match(request.prompt, /Wide double-page spread in one continuous scene\. The book's fold runs down the vertical centre line: keep every face, hand and the key action out of the middle tenth/u);
      assert.match(request.prompt, / on the (left|right) half\./u);
      assert.match(request.prompt, /One continuous scene, no sheet panels or grids\./u);
    } else assert.match(request.prompt, new RegExp(`This is the ${page.side} page of a two-page opening; keep faces and hands a tenth of the width away from the ${page.side === 'left' ? 'right' : 'left'} \\(binding\\) edge`, 'u'));
    assert.equal(checkForbiddenWordCheck(request.forbiddenWordCheck).ok, true);
  }
  // The non-scene fallback (no staging, no briefs) carries the same spread/page sentence.
  const plain = openingsBook();
  delete plain.sceneBriefs;
  for (const page of plain.pages) { delete page.staging; delete page.sceneBrief; }
  captureBookGenerationSnapshot(state, plain);
  assert.match(sceneGenerationRequest(state, plain, 0, {quality: 'final'}).prompt, /Wide double-page spread in one continuous scene/u);
  assert.match(sceneGenerationRequest(state, plain, 1, {quality: 'final'}).prompt, /This is the left page of a two-page opening/u);
});

test('R12-P5 earlier pages carry every scene but only the previous entry\'s text', () => {
  const state = seed(), book = openingsBook();
  captureBookGenerationSnapshot(state, book);
  const index = 6, prompt = sceneGenerationRequest(state, book, index, {quality: 'final'}).prompt;
  const earlier = JSON.parse(prompt.match(/Earlier page continuity: (\[.*?\])\. Preserve prior/su)[1]);
  assert.equal(earlier.length, index);
  assert.deepEqual(earlier.filter(row => 'textKo' in row).map(row => row.pageNo), [index]);
  assert.ok(earlier.every(row => row.scene && row.scene.action));
  // A page book keeps every earlier page's text.
  const legacy = clone(LEGACY);
  captureBookGenerationSnapshot(state, legacy);
  const legacyEarlier = JSON.parse(sceneGenerationRequest(state, legacy, index, {quality: 'final'}).prompt.match(/Earlier page continuity: (\[.*?\])\. Preserve prior/su)[1]);
  assert.ok(legacyEarlier.every(row => 'textKo' in row));
});

test('R12-P5 staging: spreads alternate halves by opening, never centre or close-up; pair pages default to the outer side', () => {
  const book = openingsBook(), pages = book.pagination.pages;
  for (const page of pages) {
    if (page.kind === 'spread') {
      assert.ok(SPREAD_SHOTS.includes(page.staging.shot), `${page.entryId} ${page.staging.shot}`);
      assert.equal(page.staging.characterSide, page.openingNo % 2 ? 'left' : 'right');
    } else assert.equal(page.staging.characterSide, page.side);
  }
  // A manual centre or close-up on a spread is refused; on a page it is kept.
  const spreadIndex = pages.findIndex(p => p.kind === 'spread'), pageIndex = pages.findIndex(p => p.kind === 'page');
  const context = {outline: book.outline, sceneBriefs: book.sceneBriefs, bookId: book.id, openings: true};
  let next = updatePageStaging(book.pagination, spreadIndex, {characterSide: 'center'}, context);
  assert.notEqual(next.pages[spreadIndex].staging.characterSide, 'center');
  next = updatePageStaging(book.pagination, spreadIndex, {shot: 'closeup'}, context);
  assert.notEqual(next.pages[spreadIndex].staging.shot, 'closeup');
  next = updatePageStaging(book.pagination, spreadIndex, {characterSide: 'right'}, context);
  assert.equal(next.pages[spreadIndex].staging.characterSide, 'right');
  next = updatePageStaging(book.pagination, pageIndex, {characterSide: 'center', shot: 'closeup'}, context);
  assert.deepEqual([next.pages[pageIndex].staging.characterSide, next.pages[pageIndex].staging.shot], ['center', 'closeup']);
  // A stored 'center' on a spread is mapped to the opening's half at prompt time.
  const state = seed(), centred = openingsBook();
  centred.pages[spreadIndex].staging = {...centred.pages[spreadIndex].staging, characterSide: 'center', shot: 'closeup'};
  captureBookGenerationSnapshot(state, centred);
  const prompt = sceneGenerationRequest(state, centred, spreadIndex, {quality: 'final'}).prompt;
  assert.match(prompt, /^wide establishing shot; .* on the left half\./u);
  // Without the openings flag the same pages stage as before (alternating sides).
  const legacy = stagePagination(book.pagination, {outline: book.outline, sceneBriefs: book.sceneBriefs, bookId: book.id});
  assert.deepEqual(legacy.pages.map(p => p.staging.characterSide), legacy.pages.map((_, i) => (i % 2 ? 'right' : 'left')));
});

test('R12-P5 Google asks 21:9 at 2K, OpenAI accepts 2048x880, the sample engine letterboxes a spread', async () => {
  const state = seed(), book = openingsBook();
  captureBookGenerationSnapshot(state, book);
  const request = sceneGenerationRequest(state, book, 0, {quality: 'final'});
  const pixels = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
  const plain = {prompt: request.prompt, stylePreset: request.stylePreset, referenceImages: [], seed: 7, size: request.size, quality: 'final'};
  let googleBody = null;
  await generateImage(plain, {engine: 'google', config: {apiKey: 'fixture', fetch: async (_url, options) => { googleBody = JSON.parse(options.body); return new Response(JSON.stringify({candidates: [{content: {parts: [{inlineData: {mimeType: 'image/png', data: pixels}}]}}]}), {headers: {'Content-Type': 'application/json'}}); }}});
  assert.deepEqual(googleBody.generationConfig.imageConfig, {aspectRatio: '21:9', imageSize: '2K'});
  let openaiSize = null;
  await generateImage(plain, {engine: 'openai', config: {apiKey: 'fixture', fetch: async (_url, options) => { openaiSize = JSON.parse(options.body).size; return new Response(JSON.stringify({data: [{b64_json: pixels}]}), {headers: {'Content-Type': 'application/json'}}); }}});
  assert.equal(openaiSize, '2048x880');
  const sample = await generateImage(request, {engine: 'sample'});
  const svg = decodeURIComponent(sample.imageUrl.replace(/^data:image\/svg\+xml;charset=utf-8,/u, ''));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 2048 880" width="2048" height="880"><rect width="2048" height="880" fill="#[0-9a-f]{6}"\/><svg preserveAspectRatio="xMidYMid meet"/iu);
  const page = await generateImage(sceneGenerationRequest(state, book, 1, {quality: 'final'}), {engine: 'sample'});
  assert.doesNotMatch(decodeURIComponent(page.imageUrl), /preserveAspectRatio/u);
});

test('R12-P5 counts: 8 openings are 9..16 pictures with the cover before the text, exactly 13 + 1 for 3 spreads and 5 pairs', () => {
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  globalThis[HOOK] = true;
  try {
    const state = seed('google');
    const wizard = {characterIds: ['yuha', 'greenie'], pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual'};
    const estimate = estimateFullAutoCost(state, wizard);
    assert.deepEqual([estimate.imageCountMin + 1, estimate.imageCountMax + 1], [9, 16]);
    const page = estimateImageCost({engine: 'google', quality: 'final', size: '1536x1024'}).costUsd, spread = estimateImageCost({engine: 'google', quality: 'final', size: '2048x880'}).costUsd;
    // Entries are s spreads + 2(8 − s) pages (s ≥ 1) plus the cover: the range is its min and max.
    const priced = [1, 8].map(s => s * spread + 2 * (8 - s) * page + page);
    assert.ok(Math.abs(estimate.imagesUsd - Math.max(...priced)) < 1e-9);
    assert.ok(Math.abs(estimate.imagesMinUsd - Math.min(...priced)) < 1e-9);
    assert.ok(estimate.imagesMinUsd <= estimate.imagesUsd);
    assert.ok(Math.abs(estimate.baseUsd - (estimate.textUsd + estimate.imagesUsd)) < 1e-9);
    const simple = estimateSimpleCosts(state, wizard);
    assert.deepEqual([simple.imageCountMin, simple.imageCountMax, simple.imagesNeeded], [8, 15, 16]);
    // Twelve pages: 6 openings, 7..12 pictures with the cover.
    const twelve = estimateFullAutoCost(state, {...wizard, pageCount: 12});
    assert.deepEqual([twelve.imageCountMin + 1, twelve.imageCountMax + 1], [7, 12]);
    // After pagination: exactly 13 entries + the cover, priced by kind.
    const book = openingsBook();
    book.generationSnapshot = {imageEngine: 'google'};
    const after = estimateSimpleCosts(state, book);
    assert.equal(after.imagesNeeded, 14);
    assert.ok(Math.abs(after.imagesUsd - (3 * spread + 10 * page + page)) < 1e-9, `${after.imagesUsd}`);
    // A page book (and the wizard with openings off) keeps today's numbers.
    globalThis[HOOK] = false;
    const legacy = estimateFullAutoCost(state, wizard);
    assert.equal(legacy.imageCountMax, undefined);
    assert.ok(Math.abs(legacy.imagesUsd - 17 * page) < 1e-9);
  } finally {
    if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK];
  }
});

test('R12-P5 FULL AUTO buys each entry once across a resume and labels pictures by entries (sample engine, demo text)', async () => {
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK], priorFetch = globalThis.fetch;
  globalThis[HOOK] = true;
  globalThis.fetch = async () => { throw Error('no network'); };
  try {
    const state = seed('sample');
    const wizard = {characterIds: ['yuha', 'greenie'], backgroundIds: ['forest', 'garden'], topic: '바람 피리 찾기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', value: 'none', ending: 'home', storyDate: '2026-10-19T00:00:00.000Z'};
    const job = createFullAutoJob(state, wizard, {demo: true, planMode: 'selection'});
    assert.equal(jobPictureTotal(job), '펼침 8개 · 16쪽');
    const before = fullAutoProgress(job).total;
    const buildBook = payload => ({id: payload.bookId, title: payload.pagination.cover.title, characterIds: payload.wizard.characterIds, backgroundIds: payload.wizard.backgroundIds, pages: toLegacyPages(payload.pagination), outline: payload.outline, prose: payload.prose, pagination: payload.pagination, storyInput: payload.input, sceneBriefs: payload.sceneBriefs, readingLevelSnapshot: payload.readingLevels, textDemo: payload.demo, worldSettingsSnapshot: payload.worldSnapshot});
    const bought = [], labels = [];
    let stopAt = 4;
    const scene = async (_state, book, index) => {
      if (bought.length + 1 === stopAt) { stopAt = -1; throw new DOMException('tab closed', 'AbortError'); }
      bought.push(index);
      book.pages[index].imageAssetId = `asset-${index}`;
      book.pages[index].imageMeta = {quality: 'final'};
      return {usage: {}, meta: {}};
    };
    const cover = async (_state, book) => { book.cover = {...(book.cover || {}), imageAssetId: 'cover'}; return {}; };
    const onProgress = p => labels.push(p.phase || p.message || '');
    await runFullAuto(state, job, {buildBook, operations: {scene, cover}, onProgress}).catch(() => {});
    assert.equal(job.status, 'paused');
    await runFullAuto(state, job, {buildBook, operations: {scene, cover}, onProgress});
    assert.equal(job.status, 'review', job.error || '');
    assert.equal(job.book.pages.length, 13);
    assert.deepEqual(bought, Array.from({length: 13}, (_, i) => i), 'each entry bought exactly once');
    assert.equal(jobPictureTotal(job), '13장');
    // R39H: a text-only entry is no picture.
    assert.equal(jobPictureTotal({...job, book: {...job.book, pages: job.book.pages.map((page, i) => (i === 2 ? {...page, backdrop: 'none'} : page))}}), '12장');
    assert.equal(fullAutoProgress(job).total, before - 16 + 14, 'the total turns into entries + cover once the book exists');
    assert.ok(Object.keys(job.completed).filter(key => key.startsWith('page:')).length === 13);
  } finally {
    if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK];
    globalThis.fetch = priorFetch;
  }
});
