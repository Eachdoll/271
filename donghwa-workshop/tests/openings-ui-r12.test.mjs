import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {stagePagination} from '../dist/story-generation/staging.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings, renderReadingSelectors, renderReadingCheck} from '../dist/reading-ui.js';
import * as simple from '../dist/story-generation/../simple-create.js';
import {renderChecksPanel} from '../dist/checks-panel.js';
import {analyzeBook} from '../dist/reading-checker.js';

/**
 * R12-P6: reader, simple mode and labels for openings books. Page books keep
 * their markup (the P0 'review' pin and scripts/r12-legacy-dom.mjs --check).
 * The reader and the full flows run in the browser (scripts/r12-openings-browser.mjs).
 */
const clone = value => JSON.parse(JSON.stringify(value));
const HOOK = '__DONGHWA_R12_OPENINGS__';
const LEGACY = JSON.parse(readFileSync(new URL('./fixtures/legacy-page-book-r12.json', import.meta.url), 'utf8'));
const withHook = async (fn, value = true) => {
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  globalThis[HOOK] = value;
  try { return await fn(); } finally { if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK]; }
};
function seed() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  return state;
}
function openingsBook(pageCount = 16) {
  const base = clone(LEGACY);
  const input = normalizeStoryInput({...base.storyInput, layoutPolicy: L.openingsLayoutPolicy(), specs: freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs, pageCount});
  const outline = pageCount === 16 ? base.outline : {...base.outline, beats: base.outline.beats.filter((_, i) => i < 2 || i > 3).map((beat, i) => ({...beat, index: i + 1}))};
  const prose = demoProse(outline, input), pagination = stagePagination(demoPagination(outline, prose, input), {outline, sceneBriefs: base.sceneBriefs, bookId: base.id, openings: true});
  const book = {...base, outline, storyInput: input, prose, pagination, pages: toLegacyPages(pagination), pageCount: pagination.pages.length, readingLevelSnapshot: {specs: input.specs}};
  for (const page of book.pages) { delete page.imageUrl; delete page.imageMeta; delete page.reviewed; }
  return book;
}
const counted = html => [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]).filter(tag => !/simple-card/.test(tag) && !/data-simple-nav=/.test(tag));
function render(book, wizardPatch, page = 0, state = seed()) {
  const job = {id: 'auto-openings-review', status: 'text-review', stopBefore: 'text', wizard: {simpleFlow: true, topic: book.topic}, updatedAt: '2026-10-19T09:00:00.000Z', book};
  book.fullAutoRunId = job.id;
  state.fullAutoJobs = {[job.id]: job};
  let w = simple.ensureSimpleWizard(state, {characterIds: ['yuha', 'greenie'], backgroundIds: [], topic: book.topic, pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', simpleJobId: job.id, ...wizardPatch}), d = book, p = page;
  const ctx = {getState: () => state, getWizard: () => w, setWizard: v => { w = v; }, getDraft: () => d, setDraft: v => { d = v; }, getEditPage: () => p, setEditPage: v => { p = v; }, isSimpleView: () => true, isSimpleMode: () => true,
    materialPortrait: c => `<svg aria-label="${c.name}"></svg>`, cover: () => '<div class="book-cover"></div>', illustration: (_b, i) => `<img alt="${i + 1}">`};
  return simple.renderSimpleCreate(ctx);
}

test('R12-P6 ④ shows the mix, the cue chip, entry labels, a sentence counter and a second pager with 9 counted buttons', () => {
  const book = openingsBook();
  for (const index of [0, 1, 2, 9, 12]) {
    const html = render(book, {simpleStep: 4}, index), page = book.pages[index];
    assert.equal(counted(html).length, 9, `${index}: ${counted(html).join('\n')}`);
    assert.match(html, /펼침 8개 · 펼침면 3 · 낱쪽 10 → 그림 13장 \+ 표지<br>AI가 펼침마다 펼침면\/낱쪽을 골랐어요/u);
    assert.match(html, new RegExp(`${index + 1} / 13 · ${L.unitLabel(book, index).replace(/[()]/gu, '\\$&')}`, 'u'));
    assert.match(html, new RegExp(`<span class="simple-cue">${page.kind === 'spread' ? '펼침면' : '낱쪽'} · ${L.CUES[page.cue]}</span>`, 'u'));
    assert.match(html, new RegExp(`simple-empty-art simple-empty-${page.kind}`, 'u'));
    assert.equal([...html.matchAll(/class="simple-pager/gu)].length, 2, 'a second pager below the text');
    assert.equal([...html.matchAll(/data-simple-nav="(prev|next)"/gu)].length, 4);
    const band = page.kind === 'spread' ? '10~15' : '5~7';
    assert.match(html, new RegExp(`문장 \\d+ · 권장 ${band}`, 'u'));
    assert.match(html, /textarea id="page-ko" lang="ko" rows="\d+"/u);
    assert.match(html, /모든 그림 만들기/u);
    assert.doesNotMatch(html, /모든 쪽 그림 만들기/u);
    assert.match(html, /<span id="simple-image-count">그림 0 \/ 13<\/span> · 좋아요 \d+ \/ 13/u);
    assert.doesNotMatch(html, /\b1[3]쪽\b|>13쪽</u, 'no "N쪽" that counts entries');
  }
  // An out-of-band entry turns the counter orange.
  const off = openingsBook();
  off.pages[0].ko = off.pages[0].textKo = '유하가 걸어요. 유하가 웃어요.';
  assert.match(render(off, {simpleStep: 4}, 0), /simple-sentence-count simple-count-off">문장 2 · 권장 10~15/u);
  // Stale pictures read '글 바뀐 그림'.
  const stale = openingsBook();
  Object.assign(stale.pages[1], {imageAssetId: 'a1', imageUrl: 'asset:a1', imageMeta: {quality: 'final'}, imageStale: true, imageStaleAssetId: 'a1'});
  assert.match(simple.imageCountLabel(stale), /그림 1 \/ 13 · 글 바뀐 그림 1/u);
  // ⑤ names the printed pages, openings and pictures.
  assert.match(render(book, {simpleStep: 5}, 0), /16쪽 · 펼침 8개 · 그림 13장 \+ 표지/u);
  // Twelve pages: 6 openings, 9 entries.
  const twelve = openingsBook(12);
  assert.equal(L.printedPagesOf(twelve), 12);
  const html12 = render(twelve, {simpleStep: 4, pageCount: 12}, 1);
  assert.equal(counted(html12).length, 9);
  assert.match(html12, /펼침 6개 · 펼침면 3 · 낱쪽 6 → 그림 9장 \+ 표지/u);
});

test('R12-P6 ③ shows the picture range and the capped automatic repairs; page wizards keep today\'s lines', async () => {
  await withHook(() => {
    const state = seed();
    const html = render(openingsBook(), {simpleStep: 3, simpleJobId: undefined}, 0, state);
    assert.match(html, /그림 8~15장 \+ 표지 \(펼침면 수에 따라\)/u);
    assert.match(html, /검사 후 자동 수정: 보통 6~13회 · 최대 16회/u);
    assert.match(html, /약 \$[\d.]+~\$?[\d.]+ \(최대 \$?[\d.]+\)/u);
    const twelve = render(openingsBook(), {simpleStep: 3, simpleJobId: undefined, pageCount: 12}, 0, seed());
    assert.match(twelve, /그림 6~11장 \+ 표지/u);
    assert.match(twelve, /보통 5~10회 · 최대 12회/u);
    const k1 = render(openingsBook(), {simpleStep: 3, simpleJobId: undefined, koreanLevel: 'K1', pageCount: 12}, 0, seed());
    assert.match(k1, /그림 12쪽 \+ 표지/u);
    assert.doesNotMatch(k1, /자동 수정/u);
  });
});

test('R12-P6 labels: checks panel, reading table, level names; page books keep "n쪽"', async () => {
  const book = openingsBook();
  book.readingCheck = await analyzeBook(book, book.storyInput.specs, {allowedNames: ['유하', 'Yuha', '초록이', 'Greenie']});
  book.readingCheck.warnings.push({code: 'unit-length-note', language: 'ko', severity: 'warning', advisory: true, unit: 'page', offSentences: 1, mean: 5, sentenceCount: 6, expected: {min: 5, max: 7}, pageIndex: 3});
  const panel = renderChecksPanel(book, {tab: 'reading'});
  assert.match(panel, /펼침 3 · 5쪽\(왼쪽\)으로/u);
  const table = renderReadingCheck(book);
  assert.match(table, /<td>펼침 1 · 1–2쪽 펼침면<\/td>/u);
  const legacy = clone(LEGACY);
  legacy.readingCheck = {passed: false, pages: legacy.pages.map(() => ({passed: true, ko: {metrics: {}}, en: {metrics: {}}})), warnings: [{code: 'out-of-vocabulary', severity: 'warning', language: 'en', actual: 0.2, pageIndex: 2}]};
  assert.match(renderChecksPanel(legacy, {tab: 'reading'}), />3쪽으로</u);
  assert.match(renderReadingCheck(legacy), /<td>1<\/td>/u);
  // Level names say the per-opening amount when openings are on.
  await withHook(() => assert.doesNotMatch(renderReadingSelectors({koreanLevel: 'K2'}), /두 쪽에/u), false);
  await withHook(() => {
    const html = renderReadingSelectors({koreanLevel: 'K2'});
    assert.match(html, /K2 · 그림책 5~6세 · 두 쪽에 10~15문장/u);
    assert.match(html, /K4 · 중학년 이야기 · 두 쪽에 10~16문장/u);
    assert.match(html, /K1 · 그림책 3~4세 · 쪽당 2~3문장</u);
  });
  // Reader heading and summaries.
  assert.equal(L.openingHeading(book, 0), '펼침 1 / 8 · 1–2쪽');
  assert.equal(L.openingHeading(book, 2), '펼침 2 / 8 · 4쪽');
  assert.equal(L.openingHeading(legacy, 2), '3 / 16쪽');
  assert.equal(L.openingsSummary(book), '16쪽 · 펼침 8개 · 그림 13장');
  assert.equal(L.openingsSummary(legacy), null);
  assert.equal(L.openingsMix(book), '펼침 8개 · 펼침면 3 · 낱쪽 10 → 그림 13장 + 표지');
  // R39H: a text-only entry (backdrop "none") is no picture (Codex R39 report: the summary said 8 where 7 were drawn).
  const textOnly = structuredClone(book); textOnly.pages[3].backdrop = 'none';
  assert.equal(L.openingsSummary(textOnly), '16쪽 · 펼침 8개 · 그림 12장');
  assert.equal(L.openingsMix(textOnly), '펼침 8개 · 펼침면 3 · 낱쪽 10 → 그림 12장 + 표지 (글만 있는 쪽 1)');
  // The app's library card and detail use printed pages; the reader branches on the layout.
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /layoutOf\(book\) === "openings" \? printedPagesOf\(book\) : book\.pages\?\.length \|\| 0\}쪽/u);
  assert.match(app, /openingsSummary\(b\) \? esc\(openingsSummary\(b\)\)/u);
  assert.match(app, /reader-page reader-spread/u);
  assert.match(app, /폰을 가로로 돌리면 그림이 커져요/u);
});

test('R12-P6 wizard switches: K1 16 → K2 16, K2 12 → K1 the parent default; a series from an openings book gives 16', async () => {
  await withHook(() => {
    const defaultPages = 12;
    // K1 at 16 (touched) moves to K2: openings snap keeps 16.
    assert.equal(L.snapPageCount(L.layoutFor({koreanLevel: 'K2', language: 'bilingual'}), 16, {touched: true, defaultPages}), 16);
    // K2 at 12 moves to K1: a page book returns to the parent's default when untouched.
    assert.equal(L.snapPageCount(L.layoutFor({koreanLevel: 'K1', language: 'bilingual'}), 12, {touched: false, defaultPages}), defaultPages);
    assert.deepEqual(L.pageCountOptions({koreanLevel: 'K2', language: 'bilingual'}).map(([value, label]) => [value, label]), [[12, '12쪽 · 펼침 6개 (짧게)'], [16, '16쪽 · 펼침 8개 (기본)']]);
    // The next story of a 13-entry openings book starts at its 16 printed pages.
    assert.equal(L.snapPageCount('openings', L.printedPagesOf(openingsBook()), {touched: true}), 16);
    assert.equal(simple.formatSummary({koreanLevel: 'K2', englishLevel: 'E2', pageCount: 16, language: 'bilingual'}), 'K2 · E2 · 16쪽 · 한 쪽에 한글 + 영어');
  });
});
