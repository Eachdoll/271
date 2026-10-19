import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as L from '../dist/book-layout.js';
import {LEVEL_SEED, OPENING_SEED, getLevelSpec, freezeReadingLevels, KOREAN_LEVELS, ENGLISH_LEVELS} from '../dist/reading-levels.js';
import {RICH_LEVEL_OF} from '../dist/story-quality/dist/richThenSimplify.js';
import * as schemas from '../dist/story-generation/schemas.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';

/**
 * R12-P1: the openings policy, its pure helpers (dist/book-layout.js) and the frozen
 * input, with the feature flag OFF. Only an explicit layout 'openings' (or the test
 * hook through layoutFor) makes an openings input; K1, English-only books and every
 * existing draft, job and book stay page books (the P0 pins prove the bytes).
 */
const HOOK = '__DONGHWA_R12_OPENINGS__';
function withHook(value, fn) {
  const had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  if (value === undefined) delete globalThis[HOOK]; else globalThis[HOOK] = value;
  const restore = () => { if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK]; };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (error) { restore(); throw error; }
}
const clone = value => JSON.parse(JSON.stringify(value));
const STORY_DATE = '2026-10-19T00:00:00.000Z';
const POLICY = L.openingsLayoutPolicy();
function seed({imageEngine} = {}) {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  if (imageEngine) getActiveWorld(state).imageEngine = imageEngine;
  return state;
}
const wizardOf = (koreanLevel, englishLevel, pageCount, language, extra = {}) => ({
  characterIds: ['yuha', 'greenie'], backgroundIds: ['forest', 'garden'], topic: '바람 피리 찾기', pageCount, koreanLevel, englishLevel,
  language, value: 'none', ending: 'home', storyDate: STORY_DATE, ...extra,
});

// ---------- fixtures: demo text laid out as openings ----------
const CAST = [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'greenie', name: '초록이', nameEn: 'Greenie'}];
const PLACES = [{id: 'home', type: 'home', name: '유하네 집'}, {id: 'forest', name: '숲'}, {id: 'garden', name: '정원'}];
const OPENING_SPECS = freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, {}, {layout: 'openings'}).specs;
/** Demo prose for pageCount/2 beats, paginated by today's demo, then grouped into openings. */
function openingsBook(pageCount, spreadBeats) {
  const beats = pageCount / 2, legacy = normalizeStoryInput({characters: CAST, backgrounds: PLACES, pageCount: beats === 6 ? 8 : 16, topic: '바람 피리 찾기', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, bookId: `book-${pageCount}`});
  const outline = demoOutline(legacy), prose = demoProse(outline, legacy), base = demoPagination(outline, prose, legacy);
  assert.equal(outline.beats.length, beats);
  const input = normalizeStoryInput({...legacy, pageCount, layoutPolicy: POLICY, specs: OPENING_SPECS});
  const joined = (rows, cue) => ({...rows[0], textKo: rows.map(r => r.textKo).join(' '), textEn: rows.map(r => r.textEn).join(' '), cue});
  const entries = outline.beats.flatMap(beat => {
    const rows = base.pages.filter(page => page.beatIndex === beat.index);
    assert.ok(spreadBeats.includes(beat.index) || rows.length >= 2, `beat ${beat.index} has one demo page`);
    return spreadBeats.includes(beat.index) ? [joined(rows, 'arrival')] : [joined(rows.slice(0, 1), 'two-moments'), joined(rows.slice(1), 'two-moments')];
  });
  const fixed = L.normalizeOpenings(entries, L.buildOpeningPlan(outline, beats), input.specs);
  assert.equal(fixed.needsRepagination, false);
  const pagination = {...base, pages: fixed.pages, openingAdjustments: fixed.openingAdjustments, mixNote: fixed.mixNote};
  return {input, outline, prose, pagination, legacyPagination: base, book: {id: `openings-${pageCount}`, storyInput: input, outline, pagination, pages: toLegacyPages(pagination)}};
}
const B13 = openingsBook(16, [1, 5, 8]), B6 = openingsBook(12, [1, 2, 3, 4, 5, 6]);

// ---------- flag and layout choice ----------
test('R12-P1 the openings flag is off; only the test hook turns layoutFor on, and only for K2-K4 books with Korean', () => {
  assert.equal(L.OPENINGS_ENABLED, false);
  assert.match(readFileSync(new URL('../dist/book-layout.js', import.meta.url), 'utf8'), /export const OPENINGS_ENABLED = false;/u);
  withHook(undefined, () => {
    assert.equal(L.openingsEnabled(), false);
    assert.equal(L.layoutFor({koreanLevel: 'K2', language: 'bilingual'}), 'pages');
  });
  withHook('yes', () => assert.equal(L.openingsEnabled(), false));
  withHook(true, () => {
    assert.equal(L.openingsEnabled(), true);
    for (const koreanLevel of ['K2', 'K3', 'K4', ' k3 ']) for (const language of ['ko', 'bilingual', 'dual', undefined])
      assert.equal(L.layoutFor({koreanLevel, language}), 'openings', `${koreanLevel}/${language}`);
    assert.equal(L.layoutFor({koreanLevel: 'K1', language: 'bilingual'}), 'pages');
    assert.equal(L.layoutFor({koreanLevel: 'K2', language: 'en'}), 'pages');
    assert.equal(L.layoutFor({koreanLevel: 'K5', language: 'ko'}), 'pages');
    assert.equal(L.layoutFor({}), 'pages');
    assert.equal(L.layoutFor(undefined), 'pages');
  });
  assert.deepEqual(schemas.OPENING_PAGE_COUNTS, [12, 16]);
  assert.equal(schemas.OPENING_DEFAULT_PAGES, 16);
  assert.deepEqual(schemas.PAGE_COUNTS, [8, 12, 16, 24]);
  assert.deepEqual(L.LAYOUT_FIELDS, ['kind', 'openingNo', 'side', 'entryId', 'cue']);
  assert.deepEqual(Object.keys(L.CUES), [...L.MODEL_CUES, 'auto-merged']);
  assert.ok(Object.values(L.CUES).every(label => /\p{Script=Hangul}/u.test(label)));
  assert.deepEqual(POLICY, {version: 1, kind: 'openings', spreadImageSize: '2048x880', pageImageSize: '1536x1024'});
  assert.notEqual(L.openingsLayoutPolicy(), L.OPENINGS_LAYOUT_POLICY);
});

test('R12-P1 K1, English-only and en-language K2 wizards stay page books: no layoutPolicy, v3 snapshot, the same input', () => {
  withHook(true, () => {
    for (const wizard of [wizardOf('K1', 'E0', 12, 'bilingual'), wizardOf('K2', 'E2', 16, 'en'), wizardOf('K4', 'E4', 24, 'en'), wizardOf('K1', 'E1', 8, 'dual')]) {
      const name = `${wizard.koreanLevel}/${wizard.language}/${wizard.pageCount}`;
      assert.equal(L.layoutFor(wizard), 'pages', name);
      const state0 = seed(), before = inputFromWizard(state0, wizard);
      for (const prepared of [inputFromWizard(state0, wizard, {layout: L.layoutFor(wizard)}), inputFromWizard(state0, wizard, {layout: 'pages'}), inputFromWizard(state0, wizard, {})]) {
        assert.equal(JSON.stringify(prepared), JSON.stringify(before), name);
        assert.ok(!('layoutPolicy' in prepared.input), name);
        assert.equal(prepared.readingLevels.version, 3);
        assert.equal(prepared.input.specs.ko.ruleVersion, 3);
        assert.ok(!('units' in prepared.input.specs.ko) && !('layout' in prepared.input.specs.en));
      }
      // FULL AUTO and simple mode create their jobs through layoutFor(wizard) too.
      const state = seed(), job = createFullAutoJob(state, wizard, {demo: true});
      assert.ok(!('layoutPolicy' in job.input), name);
      assert.equal(job.readingLevels.version, 3);
      const expected = inputFromWizard(state, wizard).input;
      assert.equal(JSON.stringify({...job.input, bookId: null, storyDate: null}), JSON.stringify({...expected, bookId: null, storyDate: null}), name);
    }
  });
});

// ---------- v4 openings specs ----------
const KO_TABLE = {
  K2: {page: [5, 7, 6], spread: [10, 15, 12], eojeol: {min: 5, max: 7}},
  K3: {page: [5, 7, 6], spread: [10, 15, 12], eojeol: {min: 7, max: 10}, chars: {page: [140, 350], spread: [280, 700]}},
  K4: {page: [5, 8, 6], spread: [10, 16, 13], eojeol: {min: 10, max: 13}},
};
const EN_WORDS = {E3: {page: [40, 80], spread: [80, 160]}, E4: {page: [80, 150], spread: [160, 300]}};
const CHANGED = ['ruleVersion', 'layout', 'sentencesPerPage', 'sentencesPerPageRange', 'units', 'richLevel', 'unitTolerance', 'newWordsPerBook', 'charsPerPage'];
const without = (spec, keys) => Object.fromEntries(Object.entries(spec).filter(([key]) => !keys.includes(key)));
test('R12-P1 freezeReadingLevels with layout openings gives the v4 level-table units; without it, today\'s v3', () => {
  const unit = ([min, max, target], extra = {}) => ({min, max, target, ...extra});
  for (const ko of ['K2', 'K3', 'K4']) for (const en of ENGLISH_LEVELS) {
    const options = {koreanLevel: ko, englishLevel: en, koVocabulary: ['바람'], topicVocabulary: ['kite']};
    const v3 = freezeReadingLevels(options, {}), v4 = freezeReadingLevels(options, {}, {layout: 'openings'});
    assert.deepEqual(freezeReadingLevels(options, {}, {layout: 'pages'}), v3);
    assert.deepEqual(freezeReadingLevels(options, {}, {}), v3);
    assert.equal(v3.version, 3);
    assert.ok(!('layout' in v3));
    assert.deepEqual([v4.version, v4.layout, v4.koreanLevel, v4.englishLevel], [4, 'openings', ko, en]);
    const k = v4.specs.ko, row = KO_TABLE[ko], chars = which => (row.chars ? {chars: {min: row.chars[which][0], max: row.chars[which][1], advisory: true}} : {});
    assert.deepEqual(k.units, {page: unit(row.page, chars('page')), spread: unit(row.spread, chars('spread')), opening: unit(row.spread, chars('spread'))}, `${ko}`);
    assert.deepEqual([k.ruleVersion, k.layout, k.sentencesPerPage], [4, 'openings', row.page[2]]);
    assert.deepEqual(k.sentencesPerPageRange, {min: row.page[0], max: row.page[1]});
    assert.deepEqual(k.wordsPerSentence, row.eojeol);
    assert.deepEqual(k.unitTolerance, {countBelow: 1, countAbove: 2, meanSlack: 0.5, longShareCeil: 1 / 3, longOver: 3});
    assert.deepEqual(k.richLevel, {id: RICH_LEVEL_OF[ko], ...LEVEL_SEED.ko[RICH_LEVEL_OF[ko]]});
    assert.equal(k.newWordsPerBook, ko === 'K2' ? 10 : v3.specs.ko.newWordsPerBook);
    assert.ok(!('charsPerPage' in k), 'K3 characters are advisory only');
    assert.deepEqual(k.vocabList, ['바람']);
    assert.deepEqual(without(k, CHANGED), without(v3.specs.ko, CHANGED));
    // English keeps today's amount per printed page: a spread is twice a page; all strict.
    const e = v4.specs.en, [min, max] = LEVEL_SEED.en[en].sentencesPerPage, target = getLevelSpec(en).sentencesPerPage, words = which => (EN_WORDS[en] ? {words: {min: EN_WORDS[en][which][0], max: EN_WORDS[en][which][1]}} : {});
    assert.deepEqual(e.units, {page: unit([min, max, target], words('page')), spread: unit([2 * min, 2 * max, 2 * target], words('spread')), opening: unit([2 * min, 2 * max, 2 * target], words('spread'))}, en);
    assert.ok(!('unitTolerance' in e), `${en} has no tolerance`);
    assert.deepEqual(e.sentencesPerPageRange, getLevelSpec(en).sentencesPerPageRange);
    assert.deepEqual(e.richLevel, {id: RICH_LEVEL_OF[en], ...LEVEL_SEED.en[RICH_LEVEL_OF[en]]});
    assert.deepEqual([e.ruleVersion, e.layout], [4, 'openings']);
    assert.deepEqual(without(e, CHANGED), without(v3.specs.en, CHANGED));
    assert.ok(L.isOpeningsSpec(k) && L.isOpeningsSpec(e) && !L.isOpeningsSpec(v3.specs.ko));
  }
  assert.deepEqual(OPENING_SEED.richLevelOf, Object.fromEntries(Object.entries(RICH_LEVEL_OF).filter(([id]) => id !== 'K1')));
  const e1 = freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E1'}, {}, {layout: 'openings'}).specs.en;
  assert.deepEqual([e1.maxOutOfVocabRatio, e1.vocabularyPolicy, e1.decodable], [0.1, 'blocking', true], 'E1 keeps its 10% block');
  assert.equal(freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E0'}, {}, {layout: 'openings'}).specs.en.vocabularyPolicy, 'warning', 'E0 vocabulary stays a warning');
  assert.equal(freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E1'}, {}, {layout: 'openings'}).specs.en.units.page.max, 1, 'E1 keeps one sentence per printed page');
  assert.throws(() => freezeReadingLevels({koreanLevel: 'K1', englishLevel: 'E0'}, {}, {layout: 'openings'}), /K2~K4/u);
  for (const lang of ['ko', 'en']) for (const id of Object.keys(LEVEL_SEED[lang])) assert.ok(!('units' in getLevelSpec(id)) && getLevelSpec(id).ruleVersion === 3);
  assert.deepEqual(KOREAN_LEVELS, ['K1', 'K2', 'K3', 'K4']);
});

test('R12-P1 inputFromWizard with an explicit openings layout freezes the policy, v4 specs, one beat per opening and the length-fit policy', () => {
  // Explicit 'openings' works with the flag off: the caller decides, inputFromWizard never re-derives.
  withHook(undefined, () => {
    for (const ko of ['K2', 'K3', 'K4']) for (const pageCount of [12, 16]) for (const language of ['ko', 'bilingual', 'dual']) {
      const wizard = wizardOf(ko, 'E2', pageCount, language), name = `${ko}/${pageCount}/${language}`;
      const pages = inputFromWizard(seed(), wizard), openings = inputFromWizard(seed(), wizard, {layout: 'openings'});
      assert.deepEqual(openings.input.layoutPolicy, POLICY, name);
      assert.equal(openings.input.outlineBeatCount, pageCount / 2, name);
      assert.equal(openings.input.pageCount, pageCount);
      assert.deepEqual(openings.input.prosePolicy, {version: 1, condenseOverBudget: {ko: true, en: true}});
      assert.deepEqual(openings.readingLevels, freezeReadingLevels({...wizard, koVocabulary: []}, seed().settings, {layout: 'openings'}));
      assert.deepEqual(openings.input.specs, openings.readingLevels.specs);
      assert.deepEqual(Object.keys(openings.input).slice(Object.keys(openings.input).indexOf('pageCount'), Object.keys(openings.input).indexOf('pageCount') + 3), ['pageCount', 'layoutPolicy', 'outlineBeatCount']);
      // Everything else is the page input, byte for byte.
      const rest = value => JSON.stringify(without(value.input, ['layoutPolicy', 'outlineBeatCount', 'prosePolicy', 'specs']));
      assert.equal(rest(openings), rest(pages), name);
      const normalized = normalizeStoryInput({...openings.input, bookId: 'b'});
      assert.deepEqual(normalized.layoutPolicy, POLICY);
      assert.notEqual(normalized.layoutPolicy, openings.input.layoutPolicy);
      assert.equal(normalized.outlineBeatCount, pageCount / 2);
    }
    const state = seed();
    for (const pageCount of [8, 14, 24, '20']) assert.throws(() => inputFromWizard(state, wizardOf('K2', 'E2', pageCount, 'bilingual'), {layout: 'openings'}), /12쪽이나 16쪽/u, `${pageCount}`);
    assert.equal(inputFromWizard(state, wizardOf('K2', 'E2', undefined, 'ko'), {layout: 'openings'}).input.pageCount, 12, 'a missing count is the legacy 12');
    assert.throws(() => inputFromWizard(state, wizardOf('K1', 'E0', 16, 'bilingual'), {layout: 'openings'}), /K2~K4/u);
    assert.throws(() => inputFromWizard(state, wizardOf('K2', 'E2', 16, 'en'), {layout: 'openings'}), /K2~K4/u);
    assert.throws(() => inputFromWizard(state, wizardOf('K2', 'E2', 16, 'ko'), {layout: 'spreads'}), /pages 또는 openings/u);
  });
});

test('R12-P1 frozenBeatCount gives 6/8 for openings before the page-book lookup; buildOpeningPlan needs one beat per opening', () => {
  assert.equal(schemas.frozenBeatCount({pageCount: 12, layoutPolicy: POLICY}), 6);
  assert.equal(schemas.frozenBeatCount({pageCount: 16, layoutPolicy: POLICY}), 8);
  assert.equal(schemas.frozenBeatCount({pageCount: '16', layoutPolicy: POLICY}), 8);
  assert.equal(schemas.frozenBeatCount({pageCount: 12, outlineBeatCount: 7, layoutPolicy: POLICY, specs: OPENING_SPECS}), 6);
  assert.equal(schemas.frozenBeatCount({pageCount: 14, layoutPolicy: POLICY}), null);
  assert.equal(schemas.frozenBeatCount({pageCount: 24, layoutPolicy: POLICY}), null);
  // Page books keep their counts (a policy of another kind is no openings policy).
  assert.equal(schemas.frozenBeatCount({pageCount: 12, specs: {ko: getLevelSpec('K2')}}), 7);
  assert.equal(schemas.frozenBeatCount({pageCount: 12, layoutPolicy: {kind: 'pages'}, specs: {ko: getLevelSpec('K2')}}), 7);
  assert.equal(schemas.frozenBeatCount({pageCount: 24, specs: {ko: getLevelSpec('K2')}}), 8);
  const outline = {beats: Array.from({length: 8}, (_, i) => ({index: i + 1, type: i ? 'attempt' : 'setup'}))};
  assert.deepEqual(L.buildOpeningPlan(outline, 8)[2], {openingNo: 3, beatIndex: 3, beatType: 'attempt', printedPages: [5, 6]});
  assert.deepEqual(L.buildOpeningPlan(outline, 8).at(-1).printedPages, [15, 16]);
  assert.throws(() => L.buildOpeningPlan(outline, 6), /비트 8개가 펼침 6개/u);
  assert.throws(() => L.buildOpeningPlan({}, 6), /비트 0개/u);
  assert.throws(() => L.buildOpeningPlan(null, 0), /맞지 않아요/u);
  assert.throws(() => L.buildOpeningPlan(outline, 8.5), /맞지 않아요/u);
});

test('R12-P1 normalizeStoryInput carries layoutPolicy only when present: 12/16 with v4 specs, never 14 or v4 specs without it', () => {
  const legacy = {characters: CAST, backgrounds: PLACES, pageCount: 16, topic: '바람', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, bookId: 'b'};
  const plain = normalizeStoryInput(legacy);
  assert.ok(!('layoutPolicy' in plain));
  for (const policy of [undefined, null, {kind: 'pages'}, {version: 1}]) assert.equal(JSON.stringify(normalizeStoryInput({...legacy, layoutPolicy: policy})), JSON.stringify(plain));
  const openings = {...legacy, layoutPolicy: POLICY, specs: OPENING_SPECS};
  for (const pageCount of [12, 16]) assert.equal(normalizeStoryInput({...openings, pageCount}).outlineBeatCount, pageCount / 2);
  for (const pageCount of [8, 14, 24]) assert.throws(() => normalizeStoryInput({...openings, pageCount}), /펼침 구성 책은 12쪽이나 16쪽/u);
  assert.throws(() => normalizeStoryInput({...legacy, pageCount: 14}), {message: '이야기는 8·12·16·24쪽 중에서 골라 주세요.'});
  for (const pageCount of [12, 16]) {
    assert.throws(() => normalizeStoryInput({...legacy, pageCount, specs: OPENING_SPECS}), /펼침 구성 읽기 규칙은 펼침 구성 책에서만/u);
    assert.throws(() => normalizeStoryInput({...legacy, pageCount, specs: {ko: getLevelSpec('K2'), en: OPENING_SPECS.en}}), /펼침 구성 책에서만/u);
  }
  assert.throws(() => normalizeStoryInput({...openings, specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}}), /K2~K4 한글/u);
  assert.throws(() => normalizeStoryInput({...openings, specs: {ko: OPENING_SPECS.ko, en: getLevelSpec('E2')}}), /K2~K4 한글/u);
  assert.throws(() => normalizeStoryInput({...openings, language: 'en'}), /K2~K4 한글/u);
  assert.throws(() => normalizeStoryInput({...openings, layoutPolicy: {...POLICY, version: 2}}), /펼침 구성 정보/u);
  assert.deepEqual(normalizeStoryInput({...openings, layoutPolicy: {...POLICY, extra: 1}}).layoutPolicy, POLICY);
});

// ---------- the free normalizer ----------
const TYPES = ['setup', 'want', 'attempt', 'attempt', 'attempt', 'turn', 'resolution', 'close'];
const PLAN8 = L.buildOpeningPlan({beats: TYPES.map((type, i) => ({index: i + 1, type}))}, 8);
const koText = (n, tag) => Array.from({length: n}, (_, i) => `${tag}가 ${i + 1}번째로 걸어요.`).join(' ');
const enText = (n, tag) => Array.from({length: n}, (_, i) => `${tag} walks ${i + 1}.`).join(' ');
const entry = (openingNo, beatIndex, tag, nk = 12, ne = 3, extra = {}) => ({openingNo, beatIndex, textKo: koText(nk, tag), textEn: enText(ne, tag), isRefrainPage: false, ...extra});
const rest8 = (from = 2) => TYPES.slice(from - 1).map((_, i) => entry(i + from, i + from, 'x'));
const count = text => (String(text).match(/[.!?]/gu) || []).length;
function normalize(entries, units = OPENING_SPECS) {
  const frozen = structuredClone(entries), realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('no engine call in the normalizer'); };
  try {
    const result = L.normalizeOpenings(entries, PLAN8, units);
    assert.equal(calls, 0);
    assert.deepEqual(entries, frozen, 'the entries are never mutated');
    if (!result.needsRepagination) assert.equal(L.validateOpenings(result.pages, {pageCount: 16}, {beats: PLAN8.map(p => ({index: p.beatIndex}))}).valid, true);
    return result;
  } finally { globalThis.fetch = realFetch; }
}
test('R12-P1 the normalizer fixes the ten attacks for free; only a genuinely missing beat asks for a repagination', () => {
  // (a) 0-based openingNo: grouped by beat, numbered by the app.
  let r = normalize(TYPES.map((_, i) => entry(i, i + 1, `b${i + 1}`)));
  assert.equal(r.needsRepagination, false);
  assert.deepEqual(r.pages.map(p => [p.openingNo, p.pageNo, p.kind, p.side, p.entryId]), TYPES.map((_, i) => [i + 1, i + 1, 'spread', 'spread', `b${i + 1}-spread`]));
  // (b) beat 3 missing, beat-4 text tagged openingNo 3: one repagination, beatIndex never rewritten.
  r = normalize(TYPES.map((_, i) => entry(i + 1, i + 1, `b${i + 1}`)).filter(e => e.beatIndex !== 3).map(e => (e.beatIndex === 4 ? {...e, openingNo: 3} : e)));
  assert.equal(r.needsRepagination, true);
  assert.ok(r.reasons.some(reason => /비트 3\(펼침 3\)/u.test(reason)));
  assert.ok(!r.pages.some(p => p.beatIndex === 3));
  assert.deepEqual(r.pages.filter(p => p.textKo.includes('b4가')).map(p => [p.beatIndex, p.openingNo]), [[4, 4]]);
  assert.equal(r.mixNote, null, 'no mix guard while a beat is missing');
  // (c) openingNo 9 for beat 8 is kept as beat 8's second page, not dropped.
  r = normalize([...TYPES.map((_, i) => entry(i + 1, i + 1, `b${i + 1}`, i === 7 ? 6 : 12)), entry(9, 8, 'closing', 6)]);
  assert.deepEqual(r.pages.filter(p => p.openingNo === 8).map(p => [p.side, p.textKo.slice(0, 2)]), [['left', 'b8'], ['right', 'cl']]);
  // (d) right-then-left by pageNo: re-ordered, so the texts stay on their own side.
  r = normalize([entry(1, 1, 'R', 6, 1, {pageNo: 2}), entry(1, 1, 'L', 6, 1, {pageNo: 1}), ...rest8().map((e, i) => ({...e, pageNo: i + 3}))]);
  assert.deepEqual(r.pages.slice(0, 2).map(p => [p.side, p.textKo[0], p.pageNo]), [['left', 'L', 1], ['right', 'R', 2]]);
  // (e) empty textEn on one page: merged into a spread, both texts kept.
  r = normalize([entry(1, 1, 'a', 6, 2), {...entry(1, 1, 'b', 6, 0), textEn: ''}, ...rest8()]);
  assert.deepEqual([r.pages[0].kind, r.pages[0].cue, count(r.pages[0].textKo), count(r.pages[0].textEn)], ['spread', 'auto-merged', 12, 2]);
  assert.deepEqual(r.openingAdjustments, [{openingNo: 1, action: 'merged', detail: 'empty-language'}]);
  // (f) a 12/2 pair: merged into a 14-sentence spread.
  r = normalize([entry(1, 1, 'a', 12, 2), entry(1, 1, 'b', 2, 1), ...rest8()]);
  assert.deepEqual([r.pages[0].kind, count(r.pages[0].textKo), r.pages[0].textKo.startsWith('a가')], ['spread', 14, true]);
  assert.deepEqual(r.openingAdjustments, [{openingNo: 1, action: 'merged', detail: 'page-out-of-band'}]);
  // (g) three entries for one beat: the two shortest neighbours joined into a 7/6 pair.
  r = normalize([entry(1, 1, 'a', 4, 1), entry(1, 1, 'b', 3, 1), entry(1, 1, 'c', 6, 1), ...rest8()]);
  assert.deepEqual(r.pages.slice(0, 2).map(p => [p.side, count(p.textKo)]), [['left', 7], ['right', 6]]);
  assert.ok(['a가', 'b가'].every(t => r.pages[0].textKo.includes(t)) && r.pages[1].textKo.startsWith('c가'));
  assert.deepEqual(r.openingAdjustments, [{openingNo: 1, action: 'joined', detail: 'extra-entry'}]);
  // (h) all pairs: the closing opening becomes a spread (15 entries = 16 printed pages).
  r = normalize(TYPES.flatMap((_, i) => [entry(i + 1, i + 1, 'l', 6, 1), entry(i + 1, i + 1, 'r', 6, 1)]));
  assert.deepEqual([r.pages.length, L.printedPagesOf(r.pages), r.pages.at(-1).kind, r.pages.at(-1).cue, count(r.pages.at(-1).textKo)], [15, 16, 'spread', 'auto-merged', 12]);
  assert.deepEqual(r.openingAdjustments, [{openingNo: 8, action: 'merged', detail: 'all-pairs'}]);
  // (i) all spreads: kept and noted.
  r = normalize(TYPES.map((_, i) => entry(i + 1, i + 1, 's')));
  assert.deepEqual([r.pages.length, r.mixNote, r.openingAdjustments], [8, 'all-spreads', []]);
  // (j) 13 malformed entries (missing, wrong and 0 openingNo, odd sides): 16 printed pages.
  r = normalize([entry(undefined, 1, 'a', 6, 1), entry(7, 1, 'b', 6, 1, {side: 'right', kind: 'spread'}), entry(2, 2, 'c'), entry(2, 3, 'd', 5, 1), entry(2, 3, 'e', 6, 1), entry(0, 4, 'f'), entry(5, 5, 'g', 6, 1), entry(5, 5, 'h', 6, 1), entry(6, 6, 'i'), entry(7, 7, 'j', 5, 1), entry(7, 7, 'k', 5, 1), entry(8, 8, 'l', 7, 2), entry(8, 8, 'm', 7, 2)]);
  assert.deepEqual([r.needsRepagination, r.pages.length, L.printedPagesOf(r.pages), r.mixNote], [false, 13, 16, null]);
  assert.deepEqual(r.pages.map(p => p.entryId).slice(0, 4), ['b1-left', 'b1-right', 'b2-spread', 'b3-left']);
});

test('R12-P1 normalizer edges: unknown beats are kept aside, cues, refrains, ordering, tolerances and units', () => {
  // An unknown beat is never dropped silently: it is kept in `unplaced` and asks for a repagination.
  let r = normalize([...TYPES.map((_, i) => entry(i + 1, i + 1, 's')), entry(9, 42, 'stray')]);
  assert.equal(r.needsRepagination, true);
  assert.deepEqual(r.unplaced.map(e => e.beatIndex), [42]);
  assert.match(r.reasons[0], /9번째 항목의 비트 42/u);
  r = normalize([...TYPES.map((_, i) => entry(i + 1, i + 1, 's')), null]);
  assert.deepEqual([r.needsRepagination, r.unplaced], [true, [null]]);
  // Not a list: every beat is missing.
  r = L.normalizeOpenings(undefined, PLAN8, OPENING_SPECS);
  assert.deepEqual([r.needsRepagination, r.reasons.length, r.pages.length], [true, 8, 0]);
  // Duplicate or missing pageNo: array order.
  r = normalize([entry(1, 1, 'A', 6, 1, {pageNo: 1}), entry(1, 1, 'B', 6, 1, {pageNo: 1}), ...rest8()]);
  assert.deepEqual(r.pages.slice(0, 2).map(p => p.textKo[0]), ['A', 'B']);
  r = normalize([entry(1, 1, 'A', 6, 1, {pageNo: 3}), entry(1, 1, 'B', 6, 1), ...rest8()]);
  assert.deepEqual(r.pages.slice(0, 2).map(p => p.textKo[0]), ['A', 'B']);
  // Known cues are kept, unknown ones cleared; the app's own 'auto-merged' survives a re-run.
  r = normalize([entry(1, 1, 'a', 12, 3, {cue: 'arrival'}), entry(2, 2, 'b', 12, 3, {cue: 'free text reason'}), entry(3, 3, 'c', 12, 3, {cue: 'constructor'}), entry(4, 4, 'd', 12, 3, {cue: 'auto-merged'}), ...rest8(5)]);
  assert.deepEqual(r.pages.slice(0, 5).map(p => p.cue), ['arrival', null, null, 'auto-merged', null]);
  // A refrain page stays a refrain page after a join; a missing text joins as nothing.
  r = normalize([entry(1, 1, 'a', 4, 1), {...entry(1, 1, 'b', 3, 1, {isRefrainPage: true}), textKo: undefined}, entry(1, 1, 'c', 6, 1), ...rest8()]);
  assert.deepEqual([r.pages[0].isRefrainPage, r.pages[0].textKo, r.pages[0].kind, r.pages[1].isRefrainPage], [true, koText(4, 'a'), 'page', false]);
  // Re-running on its own output changes nothing (idempotent).
  const once = normalize(TYPES.flatMap((_, i) => (i % 2 ? [entry(i + 1, i + 1, 'l', 6, 1, {cue: 'two-moments'}), entry(i + 1, i + 1, 'r', 6, 1, {cue: 'two-moments'})] : [entry(i + 1, i + 1, 's', 12, 3, {cue: 'highlight'})])));
  const twice = normalize(once.pages);
  assert.deepEqual(twice.pages, once.pages);
  assert.deepEqual(twice.openingAdjustments, []);
  // A pair out of the page band whose join misses the spread band too stays a pair.
  r = normalize([entry(1, 1, 'a', 2, 1), entry(1, 1, 'b', 2, 1), ...rest8()]);
  assert.deepEqual(r.pages.slice(0, 2).map(p => p.kind), ['page', 'page']);
  // A page whose Korean text is missing is an empty-language page: merged.
  r = normalize([entry(1, 1, 'a', 6, 1), {...entry(1, 1, 'b', 6, 1), textKo: undefined}, ...rest8()]);
  assert.deepEqual([r.pages[0].kind, r.pages[0].textKo, r.openingAdjustments[0].detail], ['spread', koText(6, 'a'), 'empty-language']);
  // English length never merges.
  r = normalize([entry(1, 1, 'a', 6, 9), entry(1, 1, 'b', 6, 9), ...rest8()]);
  assert.deepEqual(r.openingAdjustments, []);
  // Units as plain ranges, and the frozen tolerance when the specs carry one.
  r = normalize([entry(1, 1, 'a', 9, 1), entry(1, 1, 'b', 4, 1), ...rest8()], {ko: {page: [5, 7], spread: [10, 15]}});
  assert.equal(r.pages[0].kind, 'page', '9 and 4 sentences fit [4, 9]');
  r = normalize([entry(1, 1, 'a', 9, 1), entry(1, 1, 'b', 4, 1), ...rest8()], {ko: {units: OPENING_SPECS.ko.units, unitTolerance: {countBelow: 0, countAbove: 0}}});
  assert.deepEqual([r.pages[0].kind, count(r.pages[0].textKo)], ['spread', 13]);
  for (const units of [undefined, {}, {ko: {page: [5, 7]}}, {ko: {spread: [10, 15]}}]) assert.throws(() => L.normalizeOpenings([], PLAN8, units), /문장 범위/u);
  assert.throws(() => L.normalizeOpenings([], null, OPENING_SPECS), /펼침 계획/u);
  // Fewer than six openings: no mix guard.
  const plan4 = L.buildOpeningPlan({beats: [1, 2, 3, 4].map(index => ({index, type: 'attempt'}))}, 4);
  r = L.normalizeOpenings([1, 2, 3, 4].flatMap(b => [entry(b, b, 'l', 6, 1), entry(b, b, 'r', 6, 1)]), plan4, OPENING_SPECS);
  assert.deepEqual([r.pages.length, r.mixNote, r.openingAdjustments], [8, null, []]);
  r = L.normalizeOpenings([1, 2, 3, 4].map(b => entry(b, b, 's')), plan4, OPENING_SPECS);
  assert.equal(r.mixNote, null);
});

// ---------- structure validation ----------
test('R12-P1 validatePagination accepts 13 entries for 16 printed pages and 6 entries for 12; page books keep their rules', () => {
  for (const [fixture, entries, printed] of [[B13, 13, 16], [B6, 6, 12]]) {
    const {input, outline, pagination} = fixture;
    assert.equal(pagination.pages.length, entries);
    assert.equal(L.printedPagesOf(pagination.pages), printed);
    assert.deepEqual(schemas.validatePagination(pagination, input, outline), {valid: true, errors: []});
    assert.doesNotThrow(() => schemas.assertValid('pagination', pagination, input, outline));
    assert.equal(L.validateOpenings(pagination, input, outline).valid, true);
    assert.equal(L.validateOpenings(pagination.pages, input).valid, true, 'without an outline the beats only need to rise');
  }
  assert.equal(B6.pagination.mixNote, 'all-spreads');
  assert.equal(B13.pagination.pages.map(p => (p.kind === 'spread' ? 'S' : p.side[0])).join(''), 'SlrlrlrSlrlrS');
  assert.deepEqual(L.openingsOf(B13.book).map(o => o.kind), ['spread', 'pair', 'pair', 'pair', 'spread', 'pair', 'pair', 'spread']);
  // The legacy 16 entries do not pass as an openings book, and an openings book's entries are no page book.
  const legacy = schemas.validatePagination(B13.legacyPagination, B13.input, B13.outline);
  assert.equal(legacy.valid, false);
  assert.ok(legacy.errors.some(e => /펼침 정보/u.test(e)));
  const pageInput = {...B13.input}; delete pageInput.layoutPolicy;
  assert.ok(schemas.validatePagination(B13.pagination, pageInput, B13.outline).errors.includes('정확히 16쪽이 필요해요.'));
  // Each entry is still a full StoryPage.
  const broken = clone(B13.pagination); broken.pages[2].textEn = ''; broken.cover = {};
  const result = schemas.validatePagination(broken, B13.input, B13.outline);
  assert.ok(result.errors.includes('3번째 항목: 쪽에 한글·영어 글이 모두 필요해요.') && result.errors.includes('표지 제목과 장면 설명을 확인해 주세요.'));
  assert.ok(schemas.validatePagination({cover: B13.pagination.cover}, B13.input, B13.outline).errors.includes('쪽 나누기 항목 목록이 필요해요.'));
  assert.deepEqual(schemas.validatePagination(null, B13.input, B13.outline).valid, false);
});

test('R12-P1 validateOpenings rejects every broken structure', () => {
  const {input, outline, pagination} = B13, pages = pagination.pages;
  const errorsOf = (edit, options = {}) => { const copy = clone(pages); edit(copy); return L.validateOpenings(copy, {...input, ...options.input}, options.outline === undefined ? outline : options.outline).errors; };
  assert.deepEqual(L.validateOpenings(pages, {...input, pageCount: 14}, outline).errors, ['펼침 구성 책은 12쪽이나 16쪽이어야 해요.']);
  assert.deepEqual(L.validateOpenings(pages, null, outline).errors, ['펼침 구성 책은 12쪽이나 16쪽이어야 해요.']);
  assert.deepEqual(L.validateOpenings({}, input, outline).errors, ['쪽 나누기 항목 목록이 필요해요.']);
  assert.ok(errorsOf(() => {}, {outline: {beats: outline.beats.slice(1)}})[0].includes('비트 7개가 펼침 8개'));
  assert.ok(errorsOf(p => p.splice(0, 9)).includes('펼침 8개에는 쪽 항목이 8~16개 필요해요. 지금 4개예요.'));
  assert.ok(errorsOf(p => p.splice(0, 6)).includes('펼침 8개에는 쪽 항목이 8~16개 필요해요. 지금 7개예요.'));
  assert.ok(L.validateOpenings([...pages, ...pages], input, outline).errors.some(e => /8~16개 필요해요. 지금 26개/u.test(e)));
  const fieldError = index => `${index + 1}번째 항목의 펼침 정보가 맞지 않아요.`;
  assert.ok(errorsOf(p => { p[0].side = 'left'; }).includes(fieldError(0)));
  assert.ok(errorsOf(p => { p[1].kind = 'spread'; }).includes(fieldError(1)));
  assert.ok(errorsOf(p => { p[1].side = 'spread'; }).includes(fieldError(1)));
  assert.ok(errorsOf(p => { p[1].kind = 'wide'; }).includes(fieldError(1)));
  for (const openingNo of [0, 9, 1.5, '2']) assert.ok(errorsOf(p => { p[1].openingNo = openingNo; }).includes(fieldError(1)), `${openingNo}`);
  assert.ok(errorsOf(p => { p[1].entryId = 'b2-right'; }).includes(fieldError(1)));
  assert.ok(errorsOf(p => { p[1].cue = 'constructor'; }).includes(fieldError(1)));
  assert.deepEqual(errorsOf(p => { p[1].cue = null; delete p[2].cue; }), []);
  assert.ok(errorsOf(p => { p[1].pageNo = 7; }).includes(fieldError(1)));
  assert.ok(errorsOf(p => { p[0] = null; }).includes(fieldError(0)));
  // Two openings swapped: out of order and on the wrong beats.
  const swapped = errorsOf(p => { const a = p.splice(1, 2); p.splice(3, 0, ...a); p.forEach((x, i) => (x.pageNo = i + 1)); });
  assert.ok(swapped.some(e => /펼침 순서가 맞지 않아요/u.test(e)) && swapped.some(e => /승인한 비트/u.test(e)));
  assert.ok(errorsOf(p => { p[2].side = 'left'; p[2].entryId = 'b2-left'; }).some(e => /펼침면 하나이거나/u.test(e)));
  assert.ok(errorsOf(p => { p[2].beatIndex = 3; p[2].entryId = 'b3-right'; }).some(e => /서로 다른 비트/u.test(e)));
  const shifted = p => p.forEach(x => { x.beatIndex += 10; x.entryId = `b${x.beatIndex}-${x.side}`; });
  assert.ok(errorsOf(shifted).some(e => /펼침 1에는 승인한 비트 1가/u.test(e)));
  assert.deepEqual(errorsOf(shifted, {outline: null}), [], 'with no outline, rising beats are enough');
  assert.ok(errorsOf(p => { p.forEach(x => { x.beatIndex = 9 - x.openingNo; x.entryId = `b${x.beatIndex}-${x.side}`; }); }, {outline: null}).some(e => /비트 순서가 맞지 않아요/u.test(e)));
  // An opening missing: fewer openings and fewer printed pages.
  const missing = errorsOf(p => { p.splice(1, 2); p.forEach((x, i) => { x.pageNo = i + 1; if (x.openingNo > 1) x.openingNo -= 1; }); });
  assert.ok(missing.includes('펼침이 7개예요. 8개가 필요해요.') && missing.includes('인쇄 쪽 수가 14쪽이에요. 16쪽이 필요해요.'));
});

// ---------- layout of books, drafts and jobs ----------
test('R12-P1 layoutOf needs the policy AND a valid structure; a policy over legacy entries is a page book with layoutMismatch', () => {
  const {book, input, outline, pagination, legacyPagination} = B13;
  assert.equal(L.layoutOf(book), 'openings');
  assert.deepEqual(L.layoutStatus(book), {layout: 'openings', layoutMismatch: false, errors: []});
  const mixed = {...book, pages: toLegacyPages(legacyPagination), pagination: legacyPagination}, frozen = clone(mixed);
  const status = L.layoutStatus(mixed);
  assert.deepEqual([status.layout, status.layoutMismatch, L.layoutOf(mixed)], ['pages', true, 'pages']);
  assert.ok(status.errors.length > 0);
  assert.deepEqual(mixed, frozen, 'layoutOf never marks the book');
  assert.equal(L.printedPagesOf(mixed), 16);
  assert.deepEqual(L.openingsOf(mixed), []);
  assert.equal(L.unitImageSize(mixed, mixed.pages[0]), '1536x1024');
  assert.equal(L.unitLabel(mixed, 3), '4쪽');
  // A book without the policy is a page book whatever its entries say.
  const plain = {...book, storyInput: {...input, layoutPolicy: undefined}};
  assert.deepEqual(L.layoutStatus(plain), {layout: 'pages', layoutMismatch: false, errors: []});
  assert.equal(L.printedPagesOf(plain), 13, 'a page book counts entries');
  assert.equal(L.layoutOf({...book, pages: undefined}), 'openings', 'a book with only a pagination');
  assert.equal(L.layoutOf({storyInput: input}), 'openings', 'a book record before any entry');
  // Drafts and FULL AUTO jobs: input + pagination or book; a bare input before any text.
  assert.equal(L.layoutOf({input, outline, pagination}), 'openings');
  assert.equal(L.layoutOf({input, outline, book: {pages: book.pages}}), 'openings');
  assert.equal(L.layoutOf({input, outline, pagination: legacyPagination}), 'pages');
  assert.equal(L.layoutOf({input}), 'openings');
  assert.equal(L.layoutOf(input), 'openings');
  assert.deepEqual(L.layoutStatus({...input, pageCount: 14}), {layout: 'pages', layoutMismatch: true, errors: ['펼침 구성 책은 12쪽이나 16쪽이어야 해요.']});
  assert.equal(L.layoutOf({pageCount: 16, pages: pagination.pages}), 'pages');
  for (const value of [null, undefined, 'book', [], 3]) assert.equal(L.layoutOf(value), 'pages');
});

test('R12-P1 counting, unit specs, picture sizes and labels go through the helpers', () => {
  const {book, input, pagination} = B13;
  assert.equal(L.printedPagesOf(book), 16);
  assert.equal(L.printedPagesOf({input, pagination}), 16);
  assert.equal(L.printedPagesOf(pagination.pages), 16);
  assert.equal(L.printedPagesOf({input}), 16);
  assert.equal(L.printedPagesOf({}), 0);
  assert.equal(L.printedPagesOf(null), 0);
  assert.equal(L.printedPagesOf([{kind: 'spread'}, {}, null]), 4);
  const openings = L.openingsOf(book);
  assert.equal(openings.length, 8);
  assert.deepEqual(openings[0], {openingNo: 1, beatIndex: 1, kind: 'spread', indices: [0], printedPages: [1, 2]});
  assert.deepEqual(openings[1], {openingNo: 2, beatIndex: 2, kind: 'pair', indices: [1, 2], printedPages: [3, 4]});
  assert.deepEqual(openings.at(-1).printedPages, [15, 16]);
  assert.deepEqual(L.openingsOf(pagination.pages), openings);
  assert.deepEqual(L.openingsOf({input}), []);
  assert.deepEqual(L.openingsOf(null), []);
  assert.deepEqual([L.unitKind(book.pages[0]), L.unitKind(book.pages[1]), L.unitKind(null)], ['spread', 'page', 'page']);
  // Unit specs: page books get their spec back untouched.
  const v3 = getLevelSpec('K2');
  assert.equal(L.unitSpec(v3, 'spread'), v3);
  assert.equal(L.unitSpec(undefined, 'page'), undefined);
  assert.equal(L.unitSpec(OPENING_SPECS.ko, 'cover'), OPENING_SPECS.ko);
  const spread = L.unitSpec(OPENING_SPECS.ko, 'spread');
  assert.deepEqual([spread.unit, spread.sentencesPerPage, spread.sentencesPerPageRange, spread.wordsPerSentence], ['spread', 12, {min: 10, max: 15}, {min: 5, max: 7}]);
  assert.ok(!('wordsPerPage' in spread) && !('advisoryCharsPerPage' in spread));
  const k3 = freezeReadingLevels({koreanLevel: 'K3', englishLevel: 'E3'}, {}, {layout: 'openings'}).specs;
  assert.deepEqual(L.unitSpec(k3.ko, 'page').advisoryCharsPerPage, [140, 350]);
  assert.ok(!('charsPerPage' in L.unitSpec(k3.ko, 'page')), 'K3 characters never block');
  assert.deepEqual(L.unitSpec(k3.en, 'spread').wordsPerPage, [80, 160]);
  assert.deepEqual(L.unitSpec(k3.en, 'opening').sentencesPerPageRange, {min: 4, max: 8});
  // Picture sizes come from the frozen policy; the cover and page books keep 1536x1024.
  assert.deepEqual([L.unitImageSize(book, book.pages[0]), L.unitImageSize(book, book.pages[1]), L.unitImageSize(book)], ['2048x880', '1536x1024', '1536x1024']);
  const custom = {...book, storyInput: {...input, layoutPolicy: {...POLICY, spreadImageSize: '1920x816', pageImageSize: '1200x800'}}};
  assert.deepEqual([L.unitImageSize(custom, custom.pages[0]), L.unitImageSize(custom, custom.pages[1])], ['1920x816', '1200x800']);
  assert.equal(L.unitImageSize({storyInput: {}, pages: []}, {kind: 'spread'}), '1536x1024');
  // Labels match the paper book.
  assert.deepEqual([0, 1, 2, 7, 11, 12].map(i => L.unitLabel(book, i)), ['펼침 1 · 1–2쪽 펼침면', '펼침 2 · 3쪽(왼쪽)', '펼침 2 · 4쪽(오른쪽)', '펼침 5 · 9–10쪽 펼침면', '펼침 7 · 14쪽(오른쪽)', '펼침 8 · 15–16쪽 펼침면']);
  assert.equal(L.unitLabel(book, 40), '41쪽');
  assert.equal(L.unitLabel({input}, 0), '1쪽');
  assert.equal(L.unitLabel({storyInput: {}, pages: [{}]}, 0), '1쪽');
});

test('R12-P1 page-count choices: 12/16 for openings (16 기본), today\'s list otherwise; snapping never changes a page book', () => {
  const today = [[8, '8쪽 · 짧은 이야기'], [12, '12쪽 · 기본'], [16, '16쪽'], [24, '24쪽']];
  withHook(undefined, () => assert.deepEqual(L.pageCountOptions({koreanLevel: 'K2', language: 'bilingual'}), today));
  withHook(true, () => {
    const options = L.pageCountOptions({koreanLevel: 'K2', language: 'bilingual'});
    assert.deepEqual(options, [[12, '12쪽 · 펼침 6개 (짧게)'], [16, '16쪽 · 펼침 8개 (기본)']]);
    options[0][1] = 'changed';
    assert.equal(L.pageCountOptions({koreanLevel: 'K3', language: 'ko'})[0][1], '12쪽 · 펼침 6개 (짧게)');
    assert.deepEqual(L.pageCountOptions({koreanLevel: 'K1', language: 'ko'}), today);
    assert.deepEqual(L.pageCountOptions({koreanLevel: 'K2', language: 'en'}), today);
  });
  // Openings: 16 until touched, then the nearest of 12/16 (a tie goes to 16).
  assert.equal(L.snapPageCount('openings', 12, {defaultPages: 12}), 16);
  assert.equal(L.snapPageCount('openings', 24), 16);
  for (const [value, snapped] of [[12, 12], ['12', 12], [16, 16], [13, 12], [14, 16], [8, 12], [24, 16], ['many', 16], [undefined, 16]])
    assert.equal(L.snapPageCount('openings', value, {touched: true}), snapped, `${value}`);
  // Pages: the settings default until touched, then exactly what was there.
  assert.equal(L.snapPageCount('pages', 16, {defaultPages: 12}), 12);
  assert.equal(L.snapPageCount('pages', 16, {defaultPages: '24'}), '24');
  assert.equal(L.snapPageCount('pages', 16), undefined);
  assert.equal(L.snapPageCount('pages', '24', {touched: true, defaultPages: 12}), '24');
  assert.equal(L.snapPageCount('pages', 13, {touched: true}), 13);
});

test('R12-P1 wizard defaults with the hook on: K2 untouched 16, K1 the settings default, a touched 12 stays, a series from a 13-entry openings book 16', () => {
  // The same calls app.js defaultWizard/startStory and the simple format panel make.
  const fresh = (w, defaultPages) => L.snapPageCount(L.layoutFor(w), defaultPages, {defaultPages});
  const series = (w, previous, defaultPages) => {
    const previousPages = previous && L.layoutOf(previous) === 'openings' ? L.printedPagesOf(previous) : previous?.pageCount;
    return L.snapPageCount(L.layoutFor(w), previousPages || defaultPages, {touched: !!previousPages, defaultPages});
  };
  const levelChange = (before, after, value, touched, defaultPages) => (L.layoutFor(before) === L.layoutFor(after) ? value : L.snapPageCount(L.layoutFor(after), value, {touched, defaultPages}));
  const K2 = {koreanLevel: 'K2', language: 'bilingual'}, K1 = {koreanLevel: 'K1', language: 'bilingual'}, EN = {koreanLevel: 'K2', language: 'en'};
  const legacyBook = {storyInput: {pageCount: 24}, pageCount: 24, pages: Array.from({length: 24}, () => ({}))};
  const book13 = {...B13.book, pageCount: 13};
  withHook(true, () => {
    assert.equal(fresh(K2, 12), 16);
    assert.equal(fresh(K1, 12), 12);
    assert.equal(fresh(K1, 24), 24);
    assert.equal(fresh(EN, 8), 8);
    assert.equal(levelChange(K2, K1, 16, false, 12), 12, 'untouched K2 → K1: the settings default');
    assert.equal(levelChange(K1, K2, 12, false, 12), 16, 'untouched K1 → K2: 16');
    assert.equal(levelChange(K2, K1, 12, true, 12), 12, 'a touched 12 stays 12');
    assert.equal(levelChange(K1, K2, 12, true, 12), 12);
    assert.equal(levelChange(K1, K2, 24, true, 12), 16);
    assert.equal(levelChange(K2, {koreanLevel: 'K3', language: 'ko'}, 12, false, 12), 12, 'within openings nothing moves');
    assert.equal(series(K2, book13, 12), 16);
    assert.equal(series(K1, book13, 12), 16, 'a page wizard after an openings book keeps its printed pages');
    assert.equal(series(K2, legacyBook, 12), 16);
    assert.equal(series(K2, null, 12), 16);
    assert.equal(series(K1, null, 12), 12);
  });
  withHook(undefined, () => {
    // With openings off every value is today's: the settings default, or the previous book's pageCount.
    for (const w of [K2, K1, EN]) {
      assert.equal(fresh(w, 12), 12);
      assert.equal(fresh(w, undefined), undefined);
      assert.equal(series(w, legacyBook, 12), 24);
      assert.equal(series(w, {pageCount: 0}, 12), 12);
      assert.equal(levelChange(K2, w, 24, false, 12), 24);
    }
  });
  // The real call sites.
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8'), simple = readFileSync(new URL('../dist/simple-create.js', import.meta.url), 'utf8');
  assert.match(app, /w\.pageCount = snapPageCount\(layoutFor\(w\), w\.pageCount, \{\n\s+defaultPages: state\.settings\.defaultPages,/u);
  assert.match(app, /previous && layoutOf\(previous\) === "openings"\n\s+\? printedPagesOf\(previous\)\n\s+: previous\?\.pageCount;/u);
  assert.match(app, /wizard\.pageCountTouched = true;/u);
  assert.match(app, /"이야기 길이",\n\s+pageCountOptions\(w\),/u);
  assert.match(simple, /"쪽 수",\n\s+pageCountOptions\(w\),/u);
  assert.match(simple, /if \(target\.id === "pageCount"\) w\.pageCountTouched = true;\n\s+else snapFormatPageCount\(w, before\);/u);
});

// ---------- FULL AUTO: decided once at creation, read back from job.input on resume ----------
async function resumeAtInput(state, job) {
  const calls = [];
  const counted = name => async () => { calls.push(name); throw Error(`no ${name} call expected`); };
  const operations = {preflight: async () => {}, plan: counted('plan'), characterSheet: counted('characterSheet'), backgroundSheet: counted('backgroundSheet'), briefs: counted('briefs'), prose: counted('prose'), enrichment: counted('enrichment'), pagination: counted('pagination'), repairPagination: counted('repairPagination'), coherence: counted('coherence'), scene: counted('scene'), cover: counted('cover'),
    outline: async () => { calls.push('outline-reached'); throw new DOMException('stop before the outline', 'AbortError'); }};
  try { await runFullAuto(state, job, {operations, buildBook: () => { throw Error('no book'); }}); } catch {}
  return calls;
}
const JOB = JSON.parse(readFileSync(new URL('./fixtures/legacy-fullauto-job-r12.json', import.meta.url), 'utf8'));
/** What the pre-R12 input step wrote: a page input from the job's wizard and frozen specs. */
function legacyInputOf(state, job) {
  const wizard = {...job.wizard, characterIds: job.plan.characterIds, backgroundIds: job.plan.backgroundIds}, prepared = inputFromWizard(state, wizard);
  return {...prepared.input, backgrounds: prepared.input.backgrounds.filter(b => job.plan.backgroundIds.includes(b.id)), preferredBackgroundIds: clone(job.plan.backgroundIds), specs: clone(job.readingLevels.specs), bookId: job.bookId, storyDate: job.input.storyDate || job.createdAt};
}
test('R12-P1 the v3 FULL AUTO job fixture resumed at the input step gives the byte-identical page input, with openings on', async () => {
  assert.equal(JOB.readingLevels.version, 3);
  for (const pageCount of [16, 8, 24]) {
    const job = clone(JOB);
    job.wizard.pageCount = job.input.pageCount = pageCount;
    const state = seed({imageEngine: 'openai'});
    const calls = await withHook(true, () => resumeAtInput(state, job));
    assert.deepEqual(calls, ['outline-reached'], `${pageCount}`);
    assert.ok(job.completed.input);
    assert.equal(JSON.stringify(job.input), JSON.stringify(legacyInputOf(state, job)), `${pageCount}`);
    assert.ok(!('layoutPolicy' in job.input));
    assert.equal(job.input.pageCount, pageCount, 'the parent\'s page count is never snapped');
  }
});

test('R12-P1 an openings job keeps its frozen layout on resume, also when the flag is off again; new jobs freeze it once', async () => {
  const state = seed({imageEngine: 'openai'}), job = clone(JOB);
  const frozenPolicy = {...POLICY, spreadImageSize: '1920x816'};
  job.readingLevels = freezeReadingLevels({koreanLevel: 'K2', englishLevel: 'E2'}, state.settings, {layout: 'openings'});
  Object.assign(job.input, {layoutPolicy: frozenPolicy, specs: clone(job.readingLevels.specs), outlineBeatCount: 8});
  const calls = await withHook(undefined, () => resumeAtInput(state, job));
  assert.deepEqual(calls, ['outline-reached']);
  assert.deepEqual(job.input.layoutPolicy, frozenPolicy, 'the job\'s own frozen policy is kept');
  assert.equal(job.input.specs.ko.layout, 'openings');
  assert.deepEqual([job.input.pageCount, job.input.outlineBeatCount], [16, 8]);
  assert.deepEqual(job.input.prosePolicy, {version: 1, condenseOverBudget: {ko: true, en: true}});
  assert.equal(normalizeStoryInput(job.input).outlineBeatCount, 8);
  // createFullAutoJob decides through layoutFor(wizard) and freezes the result.
  await withHook(true, () => {
    for (const pageCount of [12, 16]) {
      const s = seed(), created = createFullAutoJob(s, wizardOf('K2', 'E2', pageCount, 'bilingual'), {demo: true});
      assert.deepEqual(created.input.layoutPolicy, POLICY);
      assert.deepEqual([created.readingLevels.version, created.input.outlineBeatCount, created.input.specs.ko.ruleVersion], [4, pageCount / 2, 4]);
    }
    const s = seed(), before = Object.keys(s.fullAutoJobs || {}).length;
    assert.throws(() => createFullAutoJob(s, wizardOf('K3', 'E3', 24, 'dual'), {demo: true}), /12쪽이나 16쪽/u);
    assert.equal(Object.keys(s.fullAutoJobs || {}).length, before, 'nothing is stored or bought');
  });
  await withHook(undefined, () => {
    const created = createFullAutoJob(seed(), wizardOf('K2', 'E2', 24, 'bilingual'), {demo: true});
    assert.ok(!('layoutPolicy' in created.input));
    assert.equal(created.input.pageCount, 24);
  });
});

// ---------- print text and rewrites ----------
test('R12-P1 splitSpreadText: an exact round trip (NFD too) at a sentence end near the middle, never in a quote or before an attribution', () => {
  const nfcHalves = text => L.splitSpreadText(text).map(half => half.normalize('NFC'));
  const samples = [
    '유하가 숲에 가요. “같이 가자! 어서.” 하고 초록이가 말해요. 바람이 불어요. 나뭇잎이 흔들려요.',
    '유하가 숲길을 걸어요. 초록이가 뒤를 따라와요. 작은 새가 노래해요. 둘은 웃으며 손을 흔들어요.',
    'Yuha walks into the woods with Greenie. “I don’t know where it is. Let us look,” Greenie says. The wind blows. The leaves shake.',
    '한 문장 안에 아주 긴 글이 쉼표도 없이 계속 이어지고 있어요',
  ];
  for (const text of samples) {
    const [left, right] = L.splitSpreadText(text);
    assert.equal(left + right, text);
    const nfd = text.normalize('NFD'), halves = L.splitSpreadText(nfd);
    assert.equal(halves.join(''), nfd, 'NFD round trip');
    assert.deepEqual(halves.map(h => h.normalize('NFC')), nfcHalves(text));
    assert.ok(!/^(?:하며|하고|라고)/u.test(right.normalize('NFC')));
  }
  assert.deepEqual(L.splitSpreadText(samples[0]), ['유하가 숲에 가요. “같이 가자! 어서.” 하고 초록이가 말해요. ', '바람이 불어요. 나뭇잎이 흔들려요.']);
  assert.deepEqual(L.splitSpreadText(samples[1]), ['유하가 숲길을 걸어요. 초록이가 뒤를 따라와요. ', '작은 새가 노래해요. 둘은 웃으며 손을 흔들어요.']);
  // The quote holds an apostrophe and the sentence end nearest the middle; its inside is never a boundary.
  assert.deepEqual(L.splitSpreadText(samples[2]), ['Yuha walks into the woods with Greenie. ', '“I don’t know where it is. Let us look,” Greenie says. The wind blows. The leaves shake.']);
  // Never between a quotation closed by a comma and its speaker: the gap after 'please,”'
  // (65%) is skipped for the nearest allowed whitespace (76%).
  assert.deepEqual(L.splitSpreadText('Yuha runs. “Wait for me, wait for me, please,” Greenie calls out loudly.'), ['Yuha runs. “Wait for me, wait for me, please,” Greenie ', 'calls out loudly.']);
  // No sentence end in 30-70%: the nearest whitespace.
  assert.deepEqual(L.splitSpreadText(samples[3]), ['한 문장 안에 아주 긴 글이 ', '쉼표도 없이 계속 이어지고 있어요']);
  // The only sentence end in the middle is followed by an attribution: the next best place.
  const said = '유하가 웃어요. 초록이도 웃어요. “좋아!” 하고 유하가 외쳐요. 둘은 집으로 가요.';
  assert.ok(!/^하고/u.test(L.splitSpreadText(said)[1]));
  assert.ok(!/^(?:며|고)\b/u.test(L.splitSpreadText('“가자!” 고 말한 유하가 웃으며 뛰어요. 둘은 함께 가요.')[1]));
  assert.equal(L.splitSpreadText('“가자!”\n고 말한 유하.')[1].startsWith('고 '), false);
  // Inside straight quotes and corner quotes too.
  for (const text of ['"가자 가자 어서 가자 같이 가자"', '「가자 가자 어서 가자」', '‘가자 가자 어서 가자’']) assert.deepEqual(L.splitSpreadText(text), [text, '']);
  assert.deepEqual(L.splitSpreadText('“Don’t go.” Yuha says.'), ['“Don’t go.” ', 'Yuha says.']);
  // Nothing to split.
  assert.deepEqual(L.splitSpreadText('가나다라'), ['가나다라', '']);
  assert.deepEqual(L.splitSpreadText('  유하  '), ['  유하  ', '']);
  assert.deepEqual(L.splitSpreadText(''), ['', '']);
  assert.deepEqual(L.splitSpreadText(undefined), ['', '']);
  assert.deepEqual(L.splitSpreadText(' 유하가 가요. 초록이가 와요. '), [' 유하가 가요. ', '초록이가 와요. ']);
});

test('R12-P1 copyLayoutFields puts back exactly the original entry\'s layout fields; policies and specs are validated', () => {
  const original = B13.pagination.pages[1], rewritten = {pageNo: 2, beatIndex: 2, textKo: '새 글이에요.', textEn: 'New text.'};
  const copied = L.copyLayoutFields(original, rewritten);
  assert.deepEqual(Object.fromEntries(L.LAYOUT_FIELDS.map(key => [key, copied[key]])), Object.fromEntries(L.LAYOUT_FIELDS.map(key => [key, original[key]])));
  assert.equal(copied.textKo, '새 글이에요.');
  assert.ok(!('kind' in rewritten), 'the rewrite itself is not changed');
  // A page book's page has none, so a stray field is removed and nothing is added.
  assert.deepEqual(L.copyLayoutFields({pageNo: 1, textKo: 'a'}, {...rewritten, kind: 'spread', cue: 'turn'}), rewritten);
  assert.deepEqual(L.copyLayoutFields(null, {...rewritten, side: 'left'}), rewritten);
  assert.deepEqual(L.copyLayoutFields({...original, cue: null}, rewritten).cue, null);
  // Stored policies.
  assert.deepEqual(L.normalizeLayoutPolicy({...POLICY, note: 'x'}), POLICY);
  for (const bad of [null, [], 'openings', {...POLICY, version: 2}, {...POLICY, kind: 'pages'}, {...POLICY, spreadImageSize: 'wide'}, {...POLICY, pageImageSize: undefined}, {...POLICY, spreadImageSize: 2048}])
    assert.throws(() => L.normalizeLayoutPolicy(bad), /펼침 구성 정보/u);
  assert.equal(L.isOpeningsSpec(null), false);
  assert.equal(L.isOpeningsSpec({...OPENING_SPECS.ko, units: null}), false);
  assert.equal(L.isOpeningsSpec({...OPENING_SPECS.ko, ruleVersion: 3}), false);
  assert.equal(L.isOpeningsSpec({...OPENING_SPECS.ko, layout: 'pages'}), false);
});

test('R12-P1 the service worker precaches book-layout.js without a cache bump (that waits for P8)', () => {
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes('"./book-layout.js",'));
  assert.match(sw, /const CACHE = "donghwa-shell-v35";/u);
});

test('R12-P1 the browser smoke recorded the wizard wiring with the hook off (today\'s values) and on', () => {
  // scripts/r12-wizard-smoke.mjs on this commit's dist (QA/r12-wizard-smoke.json).
  const report = JSON.parse(readFileSync(new URL('../QA/r12-wizard-smoke.json', import.meta.url), 'utf8'));
  assert.deepEqual(report.runs.map(run => run.hook), [false, true]);
  const values = row => [row.value, row.options.map(([value]) => value)], TODAY = [8, 12, 16, 24], OPENINGS = [12, 16];
  for (const {hook: on, pageErrors, paidRequests, steps: {simple, pro, simpleSummary}} of report.runs) {
    assert.deepEqual([pageErrors, paidRequests], [[], []]);
    assert.match(simpleSummary, on ? /16쪽/u : /12쪽/u);
    assert.deepEqual(values(simple.start), on ? [16, OPENINGS] : [12, TODAY]);
    assert.deepEqual(values(simple.k1), [12, TODAY]);
    assert.deepEqual(values(simple.touchedK3), on ? [12, OPENINGS] : [12, TODAY]);
    assert.deepEqual(values(pro.start), on ? [16, OPENINGS] : [12, TODAY]);
    assert.deepEqual(values(pro.touchedK1), [12, TODAY]);
    assert.deepEqual([!!pro.draft.layoutPolicy, pro.draft.outlineBeatCount, pro.draft.readingVersion], on ? [true, 6, 4] : [false, 7, 3]);
    assert.deepEqual(values(pro.series['openings-book-r12-p1']), on ? [16, OPENINGS] : [16, TODAY]);
    assert.deepEqual(values(pro.series['short-page-book-r12-p1']), on ? [12, OPENINGS] : [8, TODAY]);
    assert.deepEqual([simple.fork.summary.match(/(\d+)쪽/u)[1], simple.fork.jobUnchanged], [on ? '16' : '24', true]);
  }
});
