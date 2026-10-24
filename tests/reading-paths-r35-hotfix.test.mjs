import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings, bookReadingOptions, leanBook} from '../dist/reading-ui.js';
import {analyzeBook} from '../dist/reading-checker.js';
import {validateAndRewriteBook} from '../dist/reading-levels.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {normalizeStoryInput, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {checkStory} from '../dist/story-generation/checker.js';

/**
 * 2026-10-24 R35 hotfix (Codex R35 verification report): the story check that
 * made a diet book judged its English with the lean page spec (pageReadingSpec
 * with lean: E2+ unit tolerance, inflections, the story's own words, the
 * out-of-list share as a note) and its book totals as notes, but the ④ reading
 * badge (checkBookAtLevel → validateAndRewriteBook → analyzeBook) re-judged the
 * same book with the raw frozen spec: the picture-led demo passed its own check
 * and showed '확인할 곳' on ④ (27 findings, 12 of 13 entries). The ④ check now
 * takes the same spec and book-note handling for a diet book; every other book
 * is judged exactly as before.
 */
const HOOK = '__DONGHWA_R12_OPENINGS__';
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['forest', 'garden'], topic: '바람 피리 찾기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', value: 'none', ending: 'home', storyDate: '2026-10-19T00:00:00.000Z', ...extra});
/** The book buildStoryResultBook makes from a finished demo job (the fields the reading check reads). */
async function demoBook(state, extra = {}) {
  const prior = globalThis.fetch, had = Object.hasOwn(globalThis, HOOK), previous = globalThis[HOOK];
  globalThis.fetch = async () => { throw Error('no network'); };
  globalThis[HOOK] = true;
  try {
    const job = createFullAutoJob(state, wizardOf(extra), {demo: true, stopBefore: 'text', planMode: 'selection'});
    const bookOf = (payload) => ({id: payload.bookId, storyInput: payload.input, outline: payload.outline, pagination: payload.pagination, sceneBriefs: payload.sceneBriefs || [], pages: toLegacyPages(payload.pagination), readingLevelSnapshot: payload.readingLevels});
    await runFullAuto(state, job, {buildBook: bookOf});
    assert.equal(job.status, 'text-review', job.error || '');
    return {job, book: job.book};
  } finally {
    globalThis.fetch = prior;
    if (had) globalThis[HOOK] = previous; else delete globalThis[HOOK];
  }
}
/** checkBookAtLevel's analysis, without the modal: the same validateAndRewriteBook call and options. */
const fourCheck = (state, book, options = (candidate, context) => bookReadingOptions(candidate, context, {characters: state.characters})) =>
  validateAndRewriteBook(book, {maxRetries: 0, characters: state.characters, analyze: (candidate, context) => analyzeBook(candidate, context.specs, options(candidate, context))});

test('R35 hotfix: the picture-led demo passes the ④ reading check the way it passed its own story check; the raw path is what Codex saw', async () => {
  const state = setup(), {job, book} = await demoBook(state);
  assert.equal(leanBook(book), true);
  const input = normalizeStoryInput(job.input);
  const story = checkStory(job.outline, job.pagination, {specs: input.specs, storyInput: input, allowedNames: ['유하', 'Yuha', '초록이', 'Greenie']});
  assert.equal(story.checks.find((c) => c.id === 'level').passed, true);
  const checked = await fourCheck(state, book);
  assert.equal(checked.readingCheck.passed, true, JSON.stringify(checked.readingCheck.violations));
  assert.equal(checked.readingCheck.status, 'passed');
  // The pre-fix options (raw unit spec, book totals as violations) reproduce the report's mismatch.
  const raw = await fourCheck(state, book, (candidate, context) => ({allowedNames: context.allowedNames, storyWords: context.storyWords, koVocabulary: null}));
  assert.equal(raw.readingCheck.passed, false);
  assert.ok(raw.readingCheck.violations.some((v) => v.code === 'sentence-length' && v.language === 'en'), 'Morning. is one word under the raw E2 rule');
  // Book totals of a diet book are notes on ④ as in its story check.
  const tight = structuredClone(book);
  tight.readingLevelSnapshot.specs.en.rhythm = {...tight.readingLevelSnapshot.specs.en.rhythm, bookTolerance: 0};
  const noted = await fourCheck(state, tight);
  assert.equal(noted.readingCheck.violations.some((v) => v.code === 'book-sentence-total'), false);
});

test('R35 hotfix: 글이 많은 책 and books without the diet get exactly the options they always had and still pass', async () => {
  const state = setup(), {book: wordy} = await demoBook(state, {bookFormatId: 'wordy'});
  assert.equal(leanBook(wordy), true, 'the wordy demo is a diet draft too, with the R12 specs');
  assert.equal((await fourCheck(state, wordy)).readingCheck.passed, true);
  const legacy = structuredClone(wordy);
  delete legacy.storyInput.promptDiet;
  assert.equal(leanBook(legacy), false);
  const context = {allowedNames: ['유하'], storyWords: ['wind'], specs: legacy.readingLevelSnapshot.specs};
  const options = bookReadingOptions(legacy, context, {characters: state.characters});
  assert.deepEqual(Object.keys(options).sort(), ['allowedNames', 'koVocabulary', 'signal', 'storyWords']);
  assert.equal(options.storyWords, context.storyWords, 'the story words are the context\'s own');
  // With no options a book is judged exactly as before (the raw unit spec, totals as violations).
  const same = await analyzeBook(legacy, legacy.readingLevelSnapshot.specs, {allowedNames: ['유하']});
  const again = await analyzeBook(legacy, legacy.readingLevelSnapshot.specs, {allowedNames: ['유하'], lean: false});
  assert.deepEqual(same, again);
});
