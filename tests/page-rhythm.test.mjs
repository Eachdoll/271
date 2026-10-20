import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getLevelSpec, freezeReadingLevels} from '../dist/reading-levels.js';
import {unitSpec} from '../dist/book-layout.js';
import {withPageRhythm, rhythmBand, bookBudget, rhythmPromptLine, pictureCarriesPage, PAGE_RHYTHM} from '../dist/page-rhythm.js';
import {analyzeEstimatedPage, analyzeBook} from '../dist/reading-checker.js';
import {checkStory} from '../dist/story-generation/checker.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {buildScenePrompt} from '../dist/image-generation/scene-prompt.js';

/**
 * Page rhythm (2026-10-19): new drafts judge the whole book's sentence total
 * (±20% of the usual total) and let each page breathe (1/3 of the usual
 * minimum, at least 1, up to 1.6 × the usual maximum). K1 included; E0 and E1
 * keep their own rules; every spec without `rhythm` is judged as before.
 */
const specsOf = (ko, en, layout) => freezeReadingLevels({koreanLevel: ko, englishLevel: en}, {}, layout ? {layout} : {}).specs;

test('new specs take rhythm on every level but E0/E1; the bands follow the frozen ranges', () => {
  const k1 = withPageRhythm(specsOf('K1', 'E0'));
  assert.deepEqual(k1.ko.rhythm, {...PAGE_RHYTHM});
  assert.equal(k1.en.rhythm, undefined, 'E0 keeps its 1–2 sentences');
  assert.equal(withPageRhythm(specsOf('K2', 'E1')).en.rhythm, undefined, 'E1 keeps one sentence per page');
  assert.deepEqual(rhythmBand(k1.ko), {min: 1, max: 5}, 'K1 2–3 → 1–5');
  assert.deepEqual(rhythmBand(withPageRhythm(specsOf('K4', 'E4')).ko), {min: 1, max: 13}, 'K4 5–8 → 1–13');
  assert.deepEqual(rhythmBand(withPageRhythm(specsOf('K3', 'E3')).en), {min: 1, max: 7}, 'E3 2–4 → 1–7');
  const open = withPageRhythm(specsOf('K2', 'E2', 'openings'));
  assert.deepEqual(rhythmBand(unitSpec(open.ko, 'spread')), {min: 3, max: 24}, 'a K2 spread 10–15 → 3–24');
  assert.equal(rhythmBand(specsOf('K2', 'E2').ko), null, 'no rhythm, no band');
  // The book budget: usual = range middle per page (an opening unit uses its target), ±20%.
  assert.deepEqual(bookBudget(k1.ko, Array.from({length: 12}, () => ({}))), {target: 30, min: 24, max: 36});
  assert.deepEqual(bookBudget(open.ko, Array.from({length: 8}, () => ({kind: 'spread'}))), {target: 96, min: 76, max: 116});
  assert.equal(bookBudget(specsOf('K1', 'E0').ko, [{}]), null);
});

test('a page check uses the wide band for rhythm specs only', () => {
  const plain = specsOf('K1', 'E0').ko, rhythm = withPageRhythm(specsOf('K1', 'E0')).ko;
  const one = '유하가 크게 웃어요.', five = '유하가 크게 웃어요. 그린이도 함께 웃어요. 바람이 살랑 불어요. 잎이 높이 날아요. 둘이 같이 뛰어요.', six = `${five} 해가 천천히 져요.`;
  const count = (text, spec) => analyzeEstimatedPage(text, spec, {language: 'ko'}).violations.filter(v => v.code === 'sentence-count').length;
  assert.equal(count(one, plain), 1);
  assert.equal(count(five, plain), 1);
  assert.equal(count(one, rhythm), 0);
  assert.equal(count(five, rhythm), 0);
  assert.equal(count(six, rhythm), 1, 'past 1.6 × the usual maximum');
  // Sentence length stays per sentence.
  const long = '유하가 아주 커다란 초록 나뭇잎을 두 손으로 꼭 쥐고 천천히 들어 올려요.';
  assert.ok(analyzeEstimatedPage(long, rhythm, {language: 'ko'}).violations.some(v => v.code === 'sentence-length'));
  // Openings Korean units: the band replaces the ±tolerance and no count note is added.
  const open = unitSpec(withPageRhythm(specsOf('K2', 'E2', 'openings')).ko, 'spread');
  const spread = Array.from({length: 4}, () => '유하가 커다란 돌을 톡톡 두드려요.').join(' ');
  const report = analyzeEstimatedPage(spread, open, {language: 'ko'});
  assert.ok(!report.violations.some(v => v.code === 'unit-sentence-count'));
  assert.ok(!report.warnings.some(w => w.code === 'unit-length-note' && w.sentenceCount === 4 && !w.offSentences && !w.characters));
  const strict = analyzeEstimatedPage(spread, unitSpec(specsOf('K2', 'E2', 'openings').ko, 'spread'), {language: 'ko'});
  assert.ok(strict.violations.some(v => v.code === 'unit-sentence-count'), 'without rhythm a 4-sentence spread is short');
});

function story(specs) {
  const input = normalizeStoryInput({bookId: 'rhythm', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'garden', name: '정원'}], topic: '바람 피리', pageCount: 12, endingType: 'home_sleep', specs});
  const outline = demoOutline(input), prose = demoProse(outline, input);
  return {input, outline, pagination: demoPagination(outline, prose, input)};
}
const check = ({outline, pagination, input}) => checkStory(outline, pagination, {specs: input.specs, allowedNames: ['유하', 'Yuha']});
const S = n => Array.from({length: n}, (_, i) => ['유하가 크게 웃어요.', '바람이 살랑 불어요.', '잎이 높이 날아요.', '그린이가 빨리 뛰어요.', '해가 밝게 떠요.'][i % 5]).join(' ');

test('checkStory: pages may vary; only the book total outside ±20% is a problem, put on the pages furthest from usual', () => {
  const book = story(withPageRhythm(specsOf('K1', 'E0')));
  const korean = report => report.violations.filter(v => v.language === 'ko' && v.type === 'level');
  // 1, 5, 1, 5 … = 36 sentences: every page breathes, the total is inside 24–36.
  book.pagination.pages.forEach((page, i) => { page.textKo = S(i % 2 ? 5 : 1); });
  assert.deepEqual(korean(check(book)), []);
  // Every page at 5 = 60 sentences: over the total; the two longest pages are named.
  book.pagination.pages.forEach(page => { page.textKo = S(5); });
  book.pagination.pages[3].textKo = S(4);
  const over = korean(check(book));
  assert.equal(over.length, 2);
  assert.ok(over.every(v => /책 전체 문장 \d+개가 목표 24~36개를 넘었어요/.test(v.message)));
  assert.ok(!over.some(v => v.pageNo === 4), 'the shorter page is not asked to shrink');
  // Every page at 1 = 12 sentences: under the total; pages are asked to grow.
  book.pagination.pages.forEach(page => { page.textKo = S(1); });
  const under = korean(check(book));
  assert.equal(under.length, 2);
  assert.ok(under.every(v => /밑돌아요\. 이 쪽에 문장을 더해 주세요/.test(v.message)));
  // Without rhythm the same 1/5 book fails page by page, as before.
  const legacy = story(specsOf('K1', 'E0'));
  legacy.pagination.pages.forEach((page, i) => { page.textKo = S(i % 2 ? 5 : 1); });
  assert.equal(korean(check(legacy)).length, 12);
  assert.ok(!korean(check(legacy)).some(v => /책 전체/.test(v.message)));
});

test('analyzeBook reports the book total for a rhythm book', async () => {
  const specs = withPageRhythm(specsOf('K2', 'E2'));
  const pages = Array.from({length: 12}, () => ({ko: S(5), en: 'Yuha runs. Green runs.'}));
  const report = await analyzeBook({pages, readingLevelSnapshot: {specs}}, specs);
  assert.ok(report.violations.some(v => v.code === 'book-sentence-total' && v.language === 'ko' && v.actual === 60));
});

test('prompts name the rhythm for rhythm drafts only; a short page asks the picture to carry the moment', async () => {
  const specs = withPageRhythm(specsOf('K2', 'E2'));
  const line = rhythmPromptLine(specs);
  assert.match(line, /PAGE RHYTHM/);
  assert.match(line, /Korean: 1–5 sentences \(usual 2–3\)/);
  assert.match(line, /within ±20%/);
  assert.equal(rhythmPromptLine(specsOf('K2', 'E2')), '');
  const pipeline = await readFile(new URL('../dist/story-generation/pipeline.js', import.meta.url), 'utf8');
  assert.match(pipeline, /rhythmPromptLine\(input\.specs\)/);
  const page = {pageNo: 3, beatIndex: 2, ko: '유하가 뛰어요.', en: 'Yuha runs.', scene: {action: 'Yuha runs across the garden after a flying leaf.'}};
  assert.equal(pictureCarriesPage(specs, page), true);
  assert.equal(pictureCarriesPage(specs, {...page, ko: S(3)}), false);
  assert.equal(pictureCarriesPage(specsOf('K2', 'E2'), page), false);
  const snapshot = {characterSheets: [{characterId: 'yuha', characterSnapshot: {nameEn: 'Yuha'}}]};
  const prompt = (bookSpecs) => buildScenePrompt({book: {characterIds: ['yuha'], storyInput: {specs: bookSpecs}}, page, pageIndex: 2, snapshot, place: {background: {name: '정원'}}});
  assert.match(prompt(specs), /This page has few words, so the picture alone must tell this moment/);
  assert.doesNotMatch(prompt(specsOf('K2', 'E2')), /few words/);
});

test('new drafts freeze rhythm in their input and readingLevels; normalizeStoryInput keeps it', async () => {
  const {inputFromWizard} = await import('../dist/story-generation/ui.js');
  const {seedState} = await import('../dist/engine.js');
  const {migrateWorldState} = await import('../dist/image-generation/world.js');
  const {migrateReadingSettings} = await import('../dist/reading-ui.js');
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const prepared = inputFromWizard(state, {characterIds: ['yuha'], backgroundIds: [], topic: '바람', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'});
  assert.equal(prepared.input.specs.ko.rhythm.version, 1);
  assert.equal(prepared.input.specs.en.rhythm, undefined);
  assert.equal(prepared.readingLevels.specs.ko.rhythm.version, 1);
  assert.equal(normalizeStoryInput({...prepared.input, bookId: 'x'}).specs.ko.rhythm.bookTolerance, 0.2);
  const sw = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /"\.\/page-rhythm\.js"/);
});
