import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
globalThis.__DONGHWA_R12_OPENINGS__ = false;
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, inspectStory, generateProse} from '../dist/story-generation/pipeline.js';
import {analyzeEstimatedPage} from '../dist/reading-checker.js';
import {getLevelSpec} from '../dist/reading-levels.js';
import {buildStoryWords} from '../dist/story-reading-context.js';
import {leanStoryWordsLine} from '../dist/story-generation/prompt-diet.js';

/**
 * 2026-10-22 R31d 영어 어휘 허용. The r31c paid K2 book (QA/r31c-ab) had its
 * English rewritten six times and still carried three vocabulary flags: the E2
 * list has no inflections (stop but not stopped), the story's own things
 * (seat belts, a handkerchief, the kindergarten) were outside it, and the
 * ledger's state JSON made the beat writer narrate a seat belt five times.
 * On the diet: a lean spec folds regular inflections, the scene briefs' props,
 * creatures and sounds and the backgrounds' English names are story words at
 * every level, and the writer's map carries events and results in words only.
 * Drafts without the policy are unchanged.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const PAID = new URL('../QA/r31c-ab/K2-diet.json', import.meta.url);
const enLevel = (report) => report.violations.filter((v) => v.language === 'en');

test('R31d the paid K2 book replayed: three English vocabulary flags before, none on the diet; the same book without the policy still fails', () => {
  assert.ok(existsSync(PAID));
  const j = JSON.parse(readFileSync(PAID, 'utf8'));
  const lean = inspectStory(j.outline, j.pagination, {...j.input, promptDiet: {version: 1}});
  assert.deepEqual(enLevel(lean), []);
  const {promptDiet, ...plain} = j.input;
  const old = inspectStory(j.outline, j.pagination, plain);
  assert.ok(enLevel(old).length >= 3, `${enLevel(old).length} flags under the old checks`);
  assert.ok(enLevel(old).filter((v) => /등급 외 어휘/u.test(v.message)).length >= 3, 'the three vocabulary-ratio flags');
});

test('R31d a lean spec folds the inflections the list check missed; other specs keep the old verdicts', () => {
  const e2 = getLevelSpec('E2'), lean = {...e2, inflections: true, storyWordsAllowed: true};
  const check = (spec, text, storyWords = []) => analyzeEstimatedPage(text, spec, {language: 'en', allowedNames: ['Yuha'], storyWords}).metrics.outOfVocabWords;
  assert.ok(e2.vocabList.includes('stop') && !e2.vocabList.includes('stopped'));
  assert.deepEqual(check(e2, 'The bus stopped here.'), ['stopped']);
  assert.deepEqual(check(lean, 'The bus stopped here.'), []);
  assert.ok(e2.vocabList.includes('hid') && !e2.vocabList.includes('hide'));
  assert.deepEqual(check(e2, 'Yuha can hide here.'), ['hide']);
  assert.deepEqual(check(lean, 'Yuha can hide here.'), []);
  // Story words count only when the spec allows them (E0 before, every lean spec now).
  assert.deepEqual(check(e2, 'Yuha has a handkerchief.', ['handkerchief']), ['handkerchief']);
  assert.deepEqual(check(lean, 'Yuha has a handkerchief.', ['handkerchief']), []);
});

test('R31d story words on the diet: the briefs’ props, creatures and sounds and the backgrounds’ English names; the legacy list is unchanged', () => {
  const state = setup();
  const input = normalizeStoryInput(inputFromWizard(state, {characterIds: ['yuha'], backgroundIds: ['home', 'forest'], topic: '유하가 스쿨버스를 타고 유치원에 가는 이야기', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true}).input);
  input.backgrounds = input.backgrounds.map((b, i) => (i === 1 ? {...b, nameEn: 'Sunny Kindergarten Courtyard'} : b));
  const outline = {newWordsEn: ['peek', 'rabbit']};
  const briefs = [{beatIndex: 1, props: [{ko: '안전띠', en: 'seat belts'}, {ko: '손수건', en: 'yellow handkerchief'}], sounds: [{ko: '딸깍', en: 'click'}], creature: {ko: '참새', en: 'sparrow'}}];
  const legacy = buildStoryWords(input, outline);
  assert.ok(legacy.includes('peek') && legacy.includes('yuha'));
  for (const w of ['kindergarten', 'courtyard', 'seat', 'belts', 'handkerchief', 'click', 'sparrow']) assert.equal(legacy.includes(w), false, `${w} stays out of the legacy list`);
  assert.deepEqual(buildStoryWords(input, outline, [], {briefs}), legacy, 'briefs without the lean flag change nothing');
  const lean = buildStoryWords(input, outline, [], {briefs, lean: true});
  for (const w of ['kindergarten', 'courtyard', 'seat', 'belts', 'handkerchief', 'click', 'sparrow', 'peek']) assert.ok(lean.includes(w), w);
  assert.match(leanStoryWordsLine(input, outline, briefs), /Story words that are fine at this level: .*handkerchief/u);
});

test('R31d the beat writer’s map on the diet carries events and results in words, not the ledger’s state JSON', async () => {
  const j = JSON.parse(readFileSync(PAID, 'utf8'));
  assert.ok(j.outline.plotContract?.beats?.some((b) => b.stateAfter), 'the paid outline has state JSON per beat');
  const run = async (input) => {
    const calls = [];
    const writer = {id: 'openai', async complete(req) { calls.push(req); const ko = !/English/u.test(req.system) || /Korean K2/u.test(req.system) && !/original English/u.test(req.system); return {json: {text: ko ? '유하가 노란 버스를 타고 유치원에 가요. 해니가 손을 흔들어요. 둘이 나란히 앉아요.' : 'Yuha gets on the bus. Haeni waves at him. They sit side by side.', pick: 1, reason: 'x'}, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}}; }};
    await generateProse(j.outline, input, {engineId: 'openai', engine: writer, qualityEngines: {beatWriter: writer, cheap: writer}, sceneBriefs: j.sceneBriefs}).catch(() => {});
    return calls;
  };
  const diet = await run({...j.input, promptDiet: {version: 1}});
  assert.ok(diet.length >= 1);
  assert.ok(diet.every((c) => !/상태:|끝 상태:/u.test(c.user)), 'no state JSON on the diet');
  assert.ok(diet.some((c) => /→ 결과:/u.test(c.user)), 'results in words stay');
  const {promptDiet, ...plain} = j.input;
  const old = await run(plain);
  assert.ok(old.some((c) => /\/ 상태: \{/u.test(c.user)), 'the undieted map still carries the state JSON');
});
