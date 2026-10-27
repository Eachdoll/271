import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, renderStoryQualityPlan} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanOpeningsPaginationRules, leanPaginationRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {beatBudgets, checkBeatText} from '../dist/story-generation/beat-writer.js';
import {analyzeEstimatedPage, withoutSoundRuns} from '../dist/reading-checker.js';
import {checkStory, pictureLedBookNotes} from '../dist/story-generation/checker.js';
import {unitSpec} from '../dist/book-layout.js';
import {freezeReadingLevels} from '../dist/reading-levels.js';
import {withPageRhythm} from '../dist/page-rhythm.js';
import {BOOK_FORMAT_OPTIONS, PICTURE_LED, PICTURE_LED_UNITS, formatFor, bookFormat, bookFormatRef, isPictureLed, withPictureLed, compositionRule, compositionDirection, pictureLedBudgetLine, pictureLedPaginationLine, bookFormatLabel} from '../dist/book-format.js';
import {STORY_SHAPES, chooseStoryShape, shapeById, STORY_SHAPE_OPTIONS, storyShapeRef} from '../dist/story-generation/story-shapes.js';
import {directionLine} from '../dist/story-generation/council.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {formatSummary, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {ecoPagesPrompt, ecoOutlinePrompt, ecoJobInit} from '../dist/eco-mode.js';

/**
 * 2026-10-24 R35 책 결 (그림책 결). The parent's decision after the reference
 * round: not the art style — the plot composition and the overall composition
 * of a picture-led picture book become the default of every new book. The
 * reference measured a median of 1.5 sentences per spread against our K2 ask
 * of 10–15. New drafts freeze input.bookFormat {version: 1, id: "pictureLed"}
 * and picture-led specs (1–7 sentences a spread, 1–3 a page, English 1–3 / 1–2,
 * a wide book tolerance, a wider count band); the checks judge the level
 * sentence by sentence (pauses split, sound runs counted once, the mean only
 * from three sentences on and only its upper bound, a hard length cap) and the
 * lengths over the book (notes); the outline request carries the three-step
 * composition; the writer is asked for a few sentences and may end a big
 * moment on one sound word. 글이 많은 책 (bookFormatId 'wordy') keeps every
 * R12 budget byte for byte, and drafts, jobs and books without a format are
 * judged exactly as before (the R12 pins).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '유하가 바닷가에서 파도를 처음 만나요', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `b-${Object.keys(extra).join('-') || 'default'}`});
const REFERENCE = JSON.parse(readFileSync(new URL('./fixtures/picture-led-reference-r35.json', import.meta.url), 'utf8'));
const firstCalls = async (input, outline) => {
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); throw new Error('stop after the first request'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}}).catch(() => {});
  return calls;
};
const ctxOf = (state, w) => ({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});

test('R35 the format: picture-led unless 글이 많은 책 is chosen; the refs; withPictureLed puts the units, the wide tolerance, the wider band and the marker on an openings spec and leaves a page spec alone', () => {
  assert.equal(formatFor({}), 'pictureLed');
  assert.equal(formatFor({bookFormatId: 'wordy'}), 'wordy');
  assert.equal(formatFor({bookFormatId: 'anything-else'}), 'pictureLed');
  assert.deepEqual(bookFormat('pictureLed'), {version: 1, id: 'pictureLed'});
  assert.equal(bookFormat('nope'), null);
  assert.deepEqual(bookFormatRef({version: 1, id: 'wordy', extra: 1}), {version: 1, id: 'wordy'});
  assert.equal(bookFormatRef({version: 2, id: 'wordy'}), null);
  assert.equal(isPictureLed({bookFormat: {version: 1, id: 'pictureLed'}}), true);
  assert.equal(isPictureLed({bookFormat: {version: 1, id: 'wordy'}}), false);
  assert.equal(isPictureLed({}), false);
  assert.deepEqual(BOOK_FORMAT_OPTIONS.map(([id]) => id), ['pictureLed', 'wordy']);
  const frozen = withPageRhythm(freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2', koVocabulary: []}, setup().settings, {layout: 'openings'}).specs);
  const led = withPictureLed(frozen, {layout: 'openings'});
  assert.deepEqual(led.ko.units, PICTURE_LED_UNITS.ko);
  assert.deepEqual(led.en.units, PICTURE_LED_UNITS.en);
  assert.deepEqual(led.ko.units.spread, {min: 1, max: 7, target: 2});
  assert.deepEqual(led.ko.sentencesPerPageRange, {min: 1, max: 3});
  assert.equal(led.ko.rhythm.bookTolerance, PICTURE_LED.bookTolerance);
  assert.deepEqual(led.ko.unitTolerance, {...frozen.ko.unitTolerance, countAbove: 5, longOver: 5});
  assert.deepEqual(led.ko.pictureLed, PICTURE_LED);
  assert.equal(led.ko.eojeolPerSentence, frozen.ko.eojeolPerSentence, 'the level\'s sentence length is untouched');
  assert.equal(frozen.ko.units.spread.min, 10, 'the input specs are not mutated');
  const pageSpecs = withPageRhythm(freezeReadingLevels({koreanLevel: 'K1', englishLevel: 'E0', koVocabulary: []}, setup().settings).specs);
  assert.deepEqual(withPictureLed(pageSpecs), pageSpecs, 'a page book (K1, English-only) keeps its specs byte for byte');
  assert.equal('pictureLed' in withPictureLed(pageSpecs).ko, false);
});

test('R35 a new K2 openings draft is picture-led; 글이 많은 책 freezes the R12 specs byte for byte; the lean input shows no format; a K1 page draft carries the format in its input only', () => {
  const state = setup();
  const led = inputFromWizard(state, wizardOf(), {layout: 'openings'}), wordy = inputFromWizard(state, wizardOf({bookFormatId: 'wordy'}), {layout: 'openings'});
  assert.deepEqual(led.input.bookFormat, {version: 1, id: 'pictureLed'});
  assert.deepEqual(wordy.input.bookFormat, {version: 1, id: 'wordy'});
  assert.deepEqual(led.input.specs, led.readingLevels.specs);
  assert.deepEqual(led.input.specs.ko.units.spread, {min: 1, max: 7, target: 2});
  assert.deepEqual(led.input.specs.en.units.spread, {min: 1, max: 3, target: 1});
  assert.deepEqual(wordy.input.specs.ko.units.spread, {min: 10, max: 15, target: 12});
  assert.equal('pictureLed' in wordy.input.specs.ko, false);
  assert.deepEqual(withPictureLed(wordy.input.specs, {layout: 'openings'}), led.input.specs, 'the two formats differ in the specs only');
  // (R37: a picture-led draft also carries its expression cards, after the format.)
  const without = (input) => { const {bookFormat, specs, storyDate, storyExpression, ...rest} = input; return rest; };
  assert.deepEqual(without(led.input), without(wordy.input), 'everything else is the same input');
  assert.equal(Object.keys(wordy.input).at(-1), 'bookFormat', 'the format is the last key, after the voice');
  assert.deepEqual(Object.keys(led.input).slice(-2), ['bookFormat', 'storyExpression']);
  const normalized = normalizeStoryInput({...led.input, bookId: 'n'});
  assert.deepEqual(normalized.bookFormat, {version: 1, id: 'pictureLed'});
  assert.equal(normalizeStoryInput({...led.input, bookFormat: {version: 9, id: 'pictureLed'}, bookId: 'n'}).bookFormat, undefined, 'an unknown format is dropped');
  assert.equal('bookFormat' in leanVisibleInput(normalized), false);
  assert.equal('bookFormat' in leanVisibleInput(normalized, 'pagination'), false);
  const k1 = inputFromWizard(state, wizardOf({koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12})).input;
  assert.deepEqual(k1.bookFormat, {version: 1, id: 'pictureLed'});
  assert.equal('pictureLed' in k1.specs.ko, false, 'a page book carries the format in the input only');
  assert.deepEqual(k1.specs, inputFromWizard(state, wizardOf({koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12, bookFormatId: 'wordy'})).input.specs);
});

test('R35 the reference book: all 16 spreads pass the picture-led K2 spread check (pauses split, sound runs once, one-word spreads fine) and raise no book note; under 글이 많은 책 every spread fails', () => {
  const state = setup(), led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  const spec = unitSpec(led.specs.ko, 'spread'), wordySpec = unitSpec(wordy.specs.ko, 'spread');
  assert.equal(REFERENCE.spreads.length, 16);
  const rows = [], failing = [], wordyFailing = [];
  REFERENCE.spreads.forEach((text, i) => {
    const r = analyzeEstimatedPage(text, spec, {language: 'ko'}), w = analyzeEstimatedPage(text, wordySpec, {language: 'ko'});
    rows.push({pageNo: i + 1, metrics: r.metrics});
    if (r.violations.length) failing.push([i + 1, r.violations.map((v) => v.code)]);
    if (w.violations.length) wordyFailing.push(i + 1);
  });
  assert.deepEqual(failing, [], 'every reference spread passes as a picture-led K2 spread');
  assert.equal(wordyFailing.length, 16, 'the same spreads all fail the 10–15 sentence spec');
  assert.deepEqual(pictureLedBookNotes(rows, led.specs.ko, 'ko'), []);
  // The three-obstacle spread: 따각, 따각 / 뿔, 뿔, 뿔, 뿔 / 찌그덕 ×3 count once each, so its mean is 5.7, not 8.
  const three = analyzeEstimatedPage(REFERENCE.spreads[2], spec, {language: 'ko'}).metrics;
  assert.deepEqual(three.wordsPerSentence, [11, 5, 8]);
  assert.deepEqual(three.lengthsWithoutSoundRuns, [7, 4, 6]);
  // The wordiest spread reads as eleven sentences with its "…" pauses, inside the 1..12 band.
  assert.equal(rows[6].metrics.sentenceCount, 11);
  assert.deepEqual(withoutSoundRuns(['Tap', 'tap', 'TAP', 'goes', 'the', 'stick']), ['Tap', 'goes', 'the', 'stick'], 'tokens come punctuation-free from the tokenizers');
  // The page spec of a non-picture-led draft has no such metric.
  assert.equal('lengthsWithoutSoundRuns' in analyzeEstimatedPage(REFERENCE.spreads[2], wordySpec, {language: 'ko'}).metrics, false);
  // A one-word spread passes; a 13-sentence spread and a 13-eojeol sentence do not; three long-but-capped sentences pass.
  const one = analyzeEstimatedPage('철썩!', spec, {language: 'ko'});
  assert.deepEqual(one.violations, []);
  const many = analyzeEstimatedPage(Array.from({length: 13}, (_, i) => `꼬마 게가 ${i + 1}번 뛰어요.`).join(' '), spec, {language: 'ko'});
  assert.deepEqual(many.violations.map((v) => v.code), ['unit-sentence-count']);
  const over = analyzeEstimatedPage('아주 큰 게는 바닷가 바위 위에서 작은 게를 오래오래 가만히 기다리고 또 기다렸어요.', spec, {language: 'ko'});
  assert.deepEqual(over.violations.map((v) => [v.code, v.pictureLed, v.hardLimit]), [['unit-long-sentences', true, 12]]);
  const longish = analyzeEstimatedPage('파도가 하나 둘 셋 밀려와 모래성을 삼켰어요. 꼬마 게는 큰 게 뒤에 꼭 숨어 숨을 참았어요. 그래도 바다는 자꾸자꾸 더 가까이 왔어요.', spec, {language: 'ko'});
  assert.deepEqual(longish.violations, [], 'eight- and nine-eojeol sentences are fine under the cap');
  // Book notes: four one-word spreads, or long sentences past a third of the book.
  const soundRows = Array.from({length: 4}, (_, i) => ({pageNo: i + 1, metrics: analyzeEstimatedPage('철썩!', spec, {language: 'ko'}).metrics}));
  assert.deepEqual(pictureLedBookNotes(soundRows, led.specs.ko, 'ko').map((n) => [n.code, n.pageNo]), [['book-sound-units', 4]]);
  const longRows = Array.from({length: 3}, (_, i) => ({pageNo: i + 1, metrics: analyzeEstimatedPage('꼬마 게는 큰 게 뒤에 꼭 숨어 숨을 참았어요. 아주 큰 게는 바위 위에서 작은 게를 가만히 기다렸어요. 바다가 왔어요.', spec, {language: 'ko'}).metrics}));
  assert.deepEqual(pictureLedBookNotes(longRows, led.specs.ko, 'ko').map((n) => [n.code, n.pageNo]), [['book-long-share', 1]], 'six of nine sentences over seven eojeol');
  const fewLong = [longRows[0], {pageNo: 2, metrics: analyzeEstimatedPage('바다가 왔어요. 파도가 왔어요. 게가 웃어요. 모래가 반짝여요. 해가 져요. 집에 가요.', spec, {language: 'ko'}).metrics}];
  assert.deepEqual(pictureLedBookNotes(fewLong, led.specs.ko, 'ko'), [], 'two of nine is under a third');
  assert.deepEqual(pictureLedBookNotes(longRows, wordy.specs.ko, 'ko'), [], 'no notes for a spec without the marker');
});

test('R35 the outline request carries the composition (one moment per beat, three encounters of one kind, the picture-told turn, the round ending) and the new shape; the room hears it; 글이 많은 책 and legacy requests are unchanged', () => {
  // R37: a new picture-led draft carries expression cards and gets no plot
  // template (expression-deck-r37 tests that); an R35 draft without cards
  // keeps this composition byte for byte, so it is tested on one here.
  const state = setup(), wordy = draft(state, {bookFormatId: 'wordy'}), led = {...draft(state), storyShape: storyShapeRef(shapeById('three_waves'))};
  delete led.storyExpression;
  assert.notEqual(draft(state).storyShape.id, 'three_waves', 'R37: a wave topic no longer picks the 세 번 shape by itself');
  assert.equal(STORY_SHAPES.length, 29);
  assert.equal(STORY_SHAPE_OPTIONS.length, 30);
  assert.equal(shapeById('three_waves').name, '세 번 되풀이형');
  assert.equal(chooseStoryShape('문을 세 번 두드려요', {level: 'K1'}).id, 'three_waves');
  const rules = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.match(rules, /Each beat summary is one or two concrete sentences: the single moment its picture shows/);
  assert.match(rules, /\nPICTURE-LED BOOK: [^\n]*THREE encounters of ONE kind[^\n]*the picture says it before the words do[^\n]*quiet, round ending[^\n]*single big sound word[^\n]*no lesson line\.\n/);
  assert.match(rules, /\nSTORY SHAPE — 세 번 되풀이형: /);
  assert.equal((rules.match(/PICTURE-LED/g) || []).length, 1);
  const six = leanOutlineRules(led, {count: 6, attempts: 1});
  assert.match(six, /the attempt beat holds three quick encounters of one kind/);
  assert.match(compositionRule({bookFormat: {version: 1, id: 'pictureLed'}}, {k1: true}), /the small one and the big one/);
  assert.equal(compositionRule(wordy), '');
  const wordyRules = leanOutlineRules({...wordy, storyShape: led.storyShape}, {count: 8, attempts: 3});
  assert.match(wordyRules, /Each beat summary is two or three concrete sentences a picture could show/);
  assert.doesNotMatch(wordyRules, /PICTURE-LED/);
  // (R36 adds the PICTURE PLAN paragraph to a picture-led request; picture-plan-r36 tests it.)
  assert.equal(wordyRules, rules.replace(/Each beat summary is one or two concrete sentences: the single moment its picture shows/, 'Each beat summary is two or three concrete sentences a picture could show').replace(/\nPICTURE-LED BOOK: [^\n]*\n/, '\n').replace(/PICTURE PLAN: [^\n]*\n/, '').replace(/PICTURE PLAN, three more fields: [^\n]*\n/, '').replace(/PICTURE PLAN, where the words sit: [^\n]*\n/, ''), 'the two requests differ in those places only (R39 adds the plan\'s three fields to the picture-led one, R40 the pocket)');
  assert.match(directionLine(led), /책 결: 그림책 결 — 펼침마다 글은 몇 문장뿐이고[^\n]*하나가 달라져요\.$/);
  assert.doesNotMatch(directionLine(wordy), /책 결/);
  assert.equal(compositionDirection(wordy), '');
  // Eco mode builds its outline request from the same lines.
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoOutlinePrompt(job.input), /PICTURE-LED BOOK/);
  assert.match(ecoPagesPrompt(job.input, demoOutline(normalizeStoryInput(job.input))), /PICTURE-LED: keep each entry's text as short as its beat allows/);
});

test('R35 the beat writer: budgets 1–7 with the target following the tension; the picture-led 분량 line; the beat check counts the way the page is judged', async () => {
  const state = setup(), led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  const outline = demoOutline(led);
  outline.tension = [0, 1, 2, 3, 4, 2, 1, 0];
  const budgets = beatBudgets(outline, led);
  assert.deepEqual(budgets.map((b) => b.ko), [{min: 1, max: 7, target: 1}, {min: 1, max: 7, target: 2}, {min: 1, max: 7, target: 3}, {min: 1, max: 7, target: 5}, {min: 1, max: 7, target: 6}, {min: 1, max: 7, target: 3}, {min: 1, max: 7, target: 2}, {min: 1, max: 7, target: 1}]);
  assert.deepEqual(budgets.map((b) => b.en.max), Array(8).fill(3));
  const wordyBudgets = beatBudgets({...outline}, wordy);
  assert.deepEqual(wordyBudgets[0].ko, {min: 10, max: 15, target: 10}, 'the R12 budget for 글이 많은 책');
  assert.match(pictureLedBudgetLine({min: 1, max: 7, target: 2}, led.specs.ko), /^\[분량\] 이 비트는 펼침 하나예요: 1~7문장, 보통 2문장\. 그림이 말하게 하고 글은 그림이 못 하는 것만 써요\. 큰 순간이면 소리 한 단어로 끝내도 좋아요\(책에 세 번까지\)\. 한 문장은 12어절까지\.$/);
  const plain = demoOutline(led); plain.refrain = null;
  const calls = await firstCalls(led, plain);
  const ko = calls.find((c) => /그림책 작가다/u.test(c.system));
  assert.ok(ko, 'a Korean beat request was made');
  assert.match(ko.user, /\[분량\] 이 비트는 펼침 하나예요: 1~7문장, 보통 \d문장\./);
  assert.match(ko.user, /등장인물은 고른 인물만: 유하/);
  const spec = led.specs.ko, budget = {min: 1, max: 7, target: 2};
  assert.deepEqual(checkBeatText('철썩!', 'ko', budget, spec, {lean: true}).problems, []);
  assert.deepEqual(checkBeatText(REFERENCE.spreads[6], 'ko', budget, spec, {lean: true}).problems, [], 'eleven sentences with pauses pass the 1..12 band');
  assert.equal(checkBeatText(REFERENCE.spreads[6], 'ko', budget, spec, {lean: true}).sentences, 11);
  assert.match(checkBeatText(Array.from({length: 13}, (_, i) => `꼬마 게가 ${i + 1}번 뛰어요.`).join(' '), 'ko', budget, spec, {lean: true}).problems[0], /문장이 13개로 많아요\(이 비트는 1~7문장, 12개까지 괜찮아요\)/);
  assert.match(checkBeatText('아주 큰 게는 바닷가 바위 위에서 작은 게를 오래오래 가만히 기다리고 또 기다렸어요.', 'ko', budget, spec, {lean: true}).problems[0], /너무 긴 문장이 1개예요\(한 문장 12어절까지\)/);
  assert.deepEqual(checkBeatText(REFERENCE.spreads[2], 'ko', budget, spec, {lean: true}).problems, [], 'sound runs count once');
  // English: one line, a sound word, or three long-ish lines under the cap all pass; a 15-word line does not.
  const en = led.specs.en, enBudget = {min: 1, max: 3, target: 1};
  assert.deepEqual(checkBeatText('Splash!', 'en', enBudget, en, {lean: true}).problems, []);
  assert.deepEqual(checkBeatText('The little crab holds on tight to the big rock.', 'en', enBudget, en, {lean: true}).problems, []);
  assert.match(checkBeatText('The little crab holds on very tight to the big wet rock while the wave comes closer and closer.', 'en', enBudget, en, {lean: true}).problems[0], /너무 긴 문장이 있어요\(한 문장 14단어까지\)/);
});

test('R35 pagination lines and the demo: the openings and page rules carry the picture-led line on a picture-led draft only; the picture-led demo paginates into short entries and passes checkStory; the wordy demo is the R12 text', () => {
  const state = setup(), led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  assert.match(leanOpeningsPaginationRules(led, {cues: ['arrival']}), /Sentence ranges per entry: a spread Korean 1-7, English 1-3; a single page Korean 1-3, English 1-2\.[^\n]*\nKeep the approved events[^\n]*\nPICTURE-LED: keep each entry's text as short as its beat allows[^\n]*never pad a short beat to fill a range\.\n(?:PICTURE PLAN: [^\n]*\n)?(?:WORDLESS: [^\n]*\n)?(?:BACKDROP: [^\n]*\n)?(?:COVER: [^\n]*\n)?(?:ENGLISH FOLLOWS KOREAN: [^\n]*\n)?(?:ENTRANCE: [^\n]*\n)?scene\.who/);
  assert.doesNotMatch(leanOpeningsPaginationRules(wordy, {cues: ['arrival']}), /PICTURE-LED/);
  assert.match(leanOpeningsPaginationRules(wordy, {cues: ['arrival']}), /a spread Korean 10-15/);
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.match(leanPaginationRules(k1), /\nPICTURE-LED: [^\n]*\n(?:PICTURE PLAN: [^\n]*\n)?(?:WORDLESS: [^\n]*\n)?(?:BACKDROP: [^\n]*\n)?(?:COVER: [^\n]*\n)?(?:ENGLISH FOLLOWS KOREAN: [^\n]*\n)?(?:ENTRANCE: [^\n]*\n)?scene\.who/);
  assert.doesNotMatch(leanPaginationRules(draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12, bookFormatId: 'wordy'}, 'pages')), /PICTURE-LED/);
  for (const input of [led, draft(state, {pageCount: 12})]) {
    const outline = demoOutline(input), prose = demoProse(outline, input), pagination = demoPagination(outline, prose, input);
    const koCounts = pagination.pages.map((p) => analyzeEstimatedPage(p.textKo, unitSpec(input.specs.ko, p.kind), {language: 'ko'}).metrics.sentenceCount);
    assert.ok(koCounts.every((n) => n >= 1 && n <= 4), `${input.pageCount}: ${koCounts.join(',')}`);
    assert.deepEqual(pagination.openingAdjustments, []);
    assert.equal(pagination.pages.filter((p) => p.kind === 'spread').length, 3);
    assert.match(prose.ko, /휘이이!/);
    const check = checkStory(outline, pagination, {specs: input.specs, storyInput: input});
    assert.equal(check.passed, true, JSON.stringify(check.checks.filter((c) => !c.passed)));
  }
  const wordyOutline = demoOutline(wordy), wordyProse = demoProse(wordyOutline, wordy);
  assert.match(wordyProse.ko, /^아침 햇살이 숲길 위에 반짝 내려요\./);
  assert.doesNotMatch(wordyProse.ko, /휘이이!/);
});

test('R35 FULL AUTO: a new job freezes the format with its specs; the input step keeps the job\'s own format and specs on resume', async () => {
  const state = setup();
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {demo: true, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.bookFormat, {version: 1, id: 'pictureLed'});
  assert.deepEqual(job.readingLevels.specs.ko.units.spread, {min: 1, max: 7, target: 2});
  const wordyJob = createFullAutoJob(state, wizardOf({simpleFlow: true, bookFormatId: 'wordy'}), {demo: true, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(wordyJob.input.bookFormat, {version: 1, id: 'wordy'});
  assert.deepEqual(wordyJob.readingLevels.specs.ko.units.spread, {min: 10, max: 15, target: 12});
  // Resume at the input step with a wizard that lost its format: the job's own format and frozen specs win.
  const closed = () => { throw new DOMException('tab closed', 'AbortError'); };
  await runFullAuto(state, wordyJob, {operations: {prepare: closed}, buildBook: () => { throw Error('no book'); }}).catch(() => {});
  assert.deepEqual([wordyJob.status, !!wordyJob.completed.plan, !!wordyJob.completed.input], ['paused', true, false], wordyJob.error || '');
  delete wordyJob.wizard.bookFormatId;
  const calls = [];
  const operations = {preflight: async () => {}, outline: async () => { calls.push('outline-reached'); throw new DOMException('stop before the outline', 'AbortError'); }};
  await runFullAuto(state, wordyJob, {operations, buildBook: () => { throw Error('no book'); }}).catch(() => {});
  assert.deepEqual(calls, ['outline-reached']);
  assert.ok(wordyJob.completed.input);
  assert.deepEqual(wordyJob.input.bookFormat, {version: 1, id: 'wordy'});
  assert.deepEqual(wordyJob.input.specs.ko.units.spread, {min: 10, max: 15, target: 12});
  assert.equal('pictureLed' in wordyJob.input.specs.ko, false);
});

test('R35 the screens: ① offers 책 결 with 그림책 결 selected, the format line names 글이 많은 책 only, ③ and the pro card show the format; the shell precaches the module', () => {
  const state = setup();
  const w = ensureSimpleWizard(state, {...wizardOf(), step: 1, simpleStep: 1, simpleFormatOpen: true});
  const html = renderSimpleCreate(ctxOf(state, w));
  const select = html.match(/<select id="bookFormatId">([\s\S]*?)<\/select>/)?.[1] || '';
  assert.match(select, /value="pictureLed" selected>그림책 결 · 글은 짧게, 그림이 말해요 \(기본\)</);
  assert.match(select, /value="wordy" >글이 많은 책/);
  assert.match(html, /<label for="bookFormatId">책 결<\/label>/);
  const wordyHtml = renderSimpleCreate(ctxOf(state, ensureSimpleWizard(state, {...wizardOf({bookFormatId: 'wordy'}), step: 1, simpleStep: 1, simpleFormatOpen: true})));
  assert.match(wordyHtml, /value="wordy" selected/);
  assert.equal(formatSummary(wizardOf()), 'K2 · E2 · 16쪽 · 한 쪽에 한글 + 영어');
  assert.equal(formatSummary(wizardOf({bookFormatId: 'wordy'})), 'K2 · E2 · 16쪽 · 한 쪽에 한글 + 영어 · 글이 많은 책');
  // ③ names the format with the shape and stage (here the eco panel, which shows the line from the start).
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  const stateWithJob = {...state, fullAutoJobs: {...state.fullAutoJobs, [job.id]: job}};
  const w3 = ensureSimpleWizard(stateWithJob, {...wizardOf({simpleFlow: true}), step: 3, simpleStep: 3, simpleJobId: job.id});
  assert.match(renderSimpleCreate(ctxOf(stateWithJob, w3)), /책 결 · 그림책 결 · 무대 · 자연 · 바다/);
  assert.equal(bookFormatLabel(job.input), '그림책 결');
  const input = draft(state), outline = demoOutline(input);
  outline.storyShape = input.storyShape;
  assert.match(renderStoryQualityPlan({outline, input}), /책 결 · 그림책 결 — 글은 짧게, 그림이 말해요<br>이야기 모양 · [^<]+<br>문체 · [^<]+<br>표현 · /);
  assert.match(renderStoryQualityPlan({outline, input: draft(state, {bookFormatId: 'wordy'})}), /책 결 · 글이 많은 책<br>/);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v(?:8[1-9]|9[0-9])";/, 'v81 or later');
  assert.match(sw, /"\.\/book-format\.js",/);
});
