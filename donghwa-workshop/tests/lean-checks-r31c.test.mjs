import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
globalThis.__DONGHWA_R12_OPENINGS__ = false;
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, inspectStory, repairPagination, generateProse} from '../dist/story-generation/pipeline.js';
import {checkStory} from '../dist/story-generation/checker.js';
import {inspectSceneBriefs, sceneBriefRules} from '../dist/story-generation/scene-briefs.js';
import {stagePagination} from '../dist/story-generation/staging.js';
import {revisionRules} from '../dist/story-generation/book-revision.js';
import {k1Pagination} from '../dist/story-generation/k1-book.js';
import {leanPaginationRules, leanOpeningsPaginationRules, leanPageRewriteRules, leanSceneBriefRules} from '../dist/story-generation/prompt-diet.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {buildBeatPagePlan} from '../dist/story-generation/pagination.js';
import {demoOutline} from '../dist/story-generation/demo.js';

/**
 * 2026-10-22 R31c 검사·수정 루프 다이어트. The paid A/B after R31b (QA/r31b-ab)
 * showed where the money and the stiffness came from: not the writer but the
 * loop after it. On a diet draft the deterministic checks now ask for a paid
 * rewrite only for the reading level, the structure and safety; everything
 * else is a note. The scene-description length rule is gone, the day's clock
 * is the story's own, the pagination/rewrite/brief/editor prompts are short,
 * the repair loop runs once, and a diet K1 book skips the editor. Drafts
 * without the policy are unchanged (the same fixtures, old behaviour).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wiz = (extra = {}) => ({characterIds: ['yuha'], backgroundIds: ['home', 'forest'], topic: '유하가 스쿨버스를 타고 해니를 만나 유치원에 가는 이야기', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true, ...extra});
const dietInput = (extra) => normalizeStoryInput({...inputFromWizard(setup(), wiz(extra)).input, bookId: 'lean'});
const undiet = (input) => { const {promptDiet, ...rest} = input; return normalizeStoryInput(rest); };
const PAID = new URL('../QA/r31b-ab/K1-r31a.json', import.meta.url);
const paidK1 = () => JSON.parse(readFileSync(PAID, 'utf8'));
const types = (report) => (report.violations || []).reduce((m, v) => { const k = v.type || v.code; m[k] = (m[k] || 0) + 1; return m; }, {});
const codes = (report) => [...new Set((report.warnings || []).map((w) => w.code))];

test('R31c the paid K1 manuscript replayed: the writer’s own twelve pages had two level issues; the old checks rewrote all twelve for the picture length', () => {
  assert.ok(existsSync(PAID), 'the A/B record is in the repo');
  const j = paidK1(), lean = {...j.input, promptDiet: {version: 1}};
  const pages = k1Pagination(j.prose, j.outline, lean);
  assert.equal(pages?.pages?.length, 12);
  const before = inspectStory(j.outline, pages, j.input), after = inspectStory(j.outline, pages, lean);
  assert.equal(types(before).drawable_scene, 12, 'every picture description was 35–52 words');
  assert.equal(before.failedPageNos.length, 12);
  assert.deepEqual(types(after), {level: 3});
  assert.deepEqual(after.failedPageNos, [3, 5]);
  assert.ok(after.warnings.length >= 1 && !after.warnings.some((w) => /8~30/u.test(w.message)), 'no length note either: the rule is gone');
  // The final (rewritten) book under the diet checks: nothing left to buy.
  assert.deepEqual(types(inspectStory(j.outline, j.pagination, lean)), {});
});

test('R31c the paid K1 manuscript through the repair loop: 24 paid page rewrites before, 2 on the diet (one pass, the two level pages)', async () => {
  const j = paidK1();
  const run = async (input) => {
    const calls = [];
    const engine = {id: 'openai', async complete(req) {
      calls.push(req);
      const data = JSON.parse(req.user), required = req.jsonSchema?.required || [];
      // A scene-only request (the old loop's answer to a picture too long) gets the same action back; a page request the same page.
      const sceneOnly = required.includes('action') && !required.includes('textKo');
      return {json: sceneOnly ? {action: data.targetPage.scene.action} : data.targetPage, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}};
    }};
    const pages = k1Pagination(j.prose, j.outline, input);
    const result = await repairPagination(j.outline, j.prose, pages, input, {engine, sceneBriefs: j.sceneBriefs, skipChildGate: true, skipCoherence: true, revise: false});
    return {calls, result};
  };
  const diet = await run({...j.input, promptDiet: {version: 1}});
  assert.equal(diet.calls.length, 2, 'pages 3 and 5, once');
  assert.ok(diet.calls.every((c) => /Fix the listed problems and nothing else/u.test(c.system)));
  assert.ok(diet.calls.every((c) => !/8–30|camera|CAMERA|KEY PROP|physical verb/u.test(c.system)));
  const old = await run(j.input);
  assert.equal(old.calls.length, 24, 'twelve pages, two passes');
});

test('R31c checkStory on the diet: no scene-length rule; verb, whole-book total, refrain count, turn window and repeated endings are notes; the story’s English words are fine at E2', () => {
  const input = dietInput(), plain = undiet(input);
  // Six beats; the turn starts on page 4 (the old window for 12 pages is 8–9), every beat present and in order.
  const outline = {...demoOutline(input), beats: ['setup', 'want', 'attempt', 'turn', 'resolution', 'close'].map((type, i) => ({index: i + 1, type, summary: type, characters: ['yuha'], settingKey: 'home'})), refrain: {text: '쿵!', usedAtBeats: [1]}};
  const beatOf = [1, 2, 3, 4, 4, 4, 4, 4, 4, 5, 6, 6];
  const pages = beatOf.map((beatIndex, i) => ({
    pageNo: i + 1,
    beatIndex,
    textKo: `유하가 노란 버스를 타고 유치원에 가요.${i < 5 ? ' 쿵! 쿵!' : ''}`,
    textEn: i === 0 ? 'Yuha has a handkerchief at kindergarten today.' : 'Yuha gets on the big bus.',
    scene: {who: ['yuha'], where: 'home', action: 'a long description without any listed motion word: ' + 'lovely '.repeat(40), emotion: 'happy', timeOfDay: 'morning', props: []},
  }));
  const opts = {specs: input.specs, allowedNames: ['유하', 'Yuha'], storyWords: ['handkerchief', 'kindergarten']};
  const old = checkStory(outline, pages, opts), lean = checkStory(outline, pages, {...opts, lean: true});
  assert.ok(types(old).drawable_scene >= 12, 'the old checks block the picture length and the verb');
  assert.equal(types(lean).drawable_scene, undefined);
  assert.ok(codes(lean).includes('no-drawable-verb'));
  assert.ok(types(old).refrain > 0); assert.equal(types(lean).refrain, undefined); assert.ok(codes(lean).includes('refrain-count'));
  assert.ok(old.needsRepagination, 'the turn on page 3 asks the old checks for a repagination');
  assert.equal(lean.needsRepagination, false); assert.ok(codes(lean).includes('turn-window'));
  assert.ok(old.violations.some((v) => /책 전체 문장/u.test(v.message)), 'one sentence a page is under the book total');
  assert.ok(!lean.violations.some((v) => /책 전체 문장/u.test(v.message)) && codes(lean).includes('book-sentence-total'));
  assert.ok(types(old).repeated_suffix > 0); assert.equal(types(lean).repeated_suffix, undefined);
  assert.ok(old.violations.some((v) => v.pageNo === 1 && v.language === 'en'), 'handkerchief and kindergarten are outside the E2 list');
  assert.ok(!lean.violations.some((v) => v.pageNo === 1 && v.language === 'en'), 'a story word is fine on the diet');
  // The lean flag follows the frozen policy when storyInput is given.
  assert.deepEqual(types(checkStory(outline, pages, {...opts, storyInput: input})), types(lean));
  assert.deepEqual(types(checkStory(outline, pages, {...opts, storyInput: plain})), types(old));
});

test('R31c scene briefs on the diet: the day is the story’s own, pose and prop style are notes (no fix calls); hard fields still fail; the rules carry no clock or quotas', () => {
  const input = dietInput(), plain = undiet(input), outline = demoOutline(input);
  const briefs = outline.beats.map((b) => ({beatIndex: b.index, timeOfDay: 'morning', weather: {ko: '맑음', en: 'clear'}, light: {ko: '햇빛', en: 'sunlight'}, sounds: [{ko: '부릉', en: 'vroom'}], smellOrTouch: {ko: '보들', en: 'soft'}, creature: {ko: '참새', en: 'sparrow'}, props: [{ko: '가방', en: 'bag'}, {ko: '사랑', en: 'love'}], pose: {ko: '행복해 보여요', en: 'looks happy'}, dialogueLine: '안녕!', humor: '볼이 빵빵'}));
  const old = inspectSceneBriefs(briefs, outline, plain), lean = inspectSceneBriefs(briefs, outline, input);
  assert.ok(old.failedBeatIndexes.length > 0, 'the old checks buy fixes for the evening, the pose and the abstract prop');
  assert.deepEqual(lean.failedBeatIndexes, []);
  assert.ok(lean.notes.some((n) => /저녁이나 밤/u.test(n)) && lean.notes.some((n) => /감정 표현뿐/u.test(n)));
  const broken = briefs.map((b, i) => (i === 0 ? {...b, timeOfDay: 'dawnish'} : b));
  assert.ok(inspectSceneBriefs(broken, outline, input).hardBeatIndexes.includes(outline.beats[0].index), 'an unknown time is still a hard error');
  assert.match(sceneBriefRules(plain), /final beat evening or night|exactly THREE/u);
  assert.equal(sceneBriefRules(input), leanSceneBriefRules());
  assert.doesNotMatch(sceneBriefRules(input), /evening or night|exactly THREE|at least two kinds|body part/u);
});

test('R31c staging on the diet: the last page keeps the brief’s morning; without the flag it is still moved to the evening', () => {
  const input = dietInput(), outline = demoOutline(input);
  const briefs = outline.beats.map((b) => ({beatIndex: b.index, timeOfDay: 'morning', pose: {en: 'Yuha waves a hand'}}));
  const pages = buildBeatPagePlan(outline, 12).map((row) => ({pageNo: row.pageNo, beatIndex: row.beatIndex, textKo: '유하가 가요.', textEn: 'Yuha goes.', scene: {who: ['yuha'], where: 'home', action: 'Yuha waves a hand', emotion: 'happy', props: []}}));
  const old = stagePagination({pages}, {outline, sceneBriefs: briefs}), lean = stagePagination({pages}, {outline, sceneBriefs: briefs, lean: true});
  assert.equal(old.pages.at(-1).scene.timeOfDay, 'evening');
  assert.ok(old.stagingWarnings.some((w) => w.code === 'time_closing'));
  assert.equal(lean.pages.at(-1).scene.timeOfDay, 'morning');
  assert.equal(lean.stagingWarnings.some((w) => /time_(closing|opening)/u.test(w.code)), false);
});

test('R31c the diet prompts for pagination, page rewrites and the editor are short and carry no quotas; the undieted ones are unchanged', () => {
  const input = dietInput(), plain = undiet(input);
  const rules = leanPaginationRules(input, {custom: true});
  assert.ok(rules.length < 1300, `${rules.length} chars`);
  assert.doesNotMatch(rules, /8–30|physical verb|Never|MUST|camera|architecture/u);
  assert.match(rules, /scene\.action = what the picture shows, in English/u);
  const openings = leanOpeningsPaginationRules({...input, pageCount: 16, specs: {ko: {units: {spread: {min: 4, max: 7}, page: {min: 2, max: 4}}}, en: {units: {spread: {min: 2, max: 4}, page: {min: 1, max: 2}}}}}, {cues: ['reveal', 'calm']});
  assert.match(openings, /exactly 8 openings/u); assert.doesNotMatch(openings, /8–30|at least one spread/u);
  assert.match(leanPageRewriteRules(4, {beatIndex: 2}), /Fix the listed problems and nothing else/u);
  assert.match(leanPageRewriteRules(4, {beatIndex: 2}, {sceneOnly: true}), /what the picture shows/u);
  assert.match(revisionRules(input, 12), /Change a page only when something is actually wrong/u);
  assert.match(revisionRules(input, 12), /at most 3 pages/u);
  assert.doesNotMatch(revisionRules(input, 12), /IMPROVE only the wording|FROZEN_LEVEL_SPECS/u);
  assert.match(revisionRules(plain, 12), /IMPROVE only the wording/u);
});

test('R31c the K1 writer on the diet: no picture-length sentence, no "no text" line; the estimate prices two page fixes and no editor for a diet K1 book', async () => {
  const input = dietInput({koreanLevel: 'K1', englishLevel: 'E0'});
  const outline = demoOutline(input), plan = buildBeatPagePlan(outline, 12), calls = [];
  const page = (n) => ({pageNo: n, ko: '유하가 버스를 타요. 부릉부릉!', en: 'Yuha gets on the bus.', picture: 'Yuha climbs the yellow bus steps while Haeni waves from a window seat, morning light on the road', feeling: 'happy', who: ['yuha'], timeOfDay: 'morning', props: ['bus']});
  const engine = {id: 'openai', async complete(req) { calls.push(req); return {json: {cover: 'Yuha and Haeni on the bus', pages: plan.map((row) => page(row.pageNo))}, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}}; }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine}}).catch(() => {});
  assert.ok(calls.length >= 1);
  assert.doesNotMatch(calls[0].system, /구도, 누가, 어떤 자세|글자는 없어요|한두 문장/u);
  assert.doesNotMatch(calls[0].user, /글자 없음|8~30|30단어/u);
  const settings = setup().settings.textGeneration || {};
  const k1 = estimateStoryTextCost({settings, pageCount: 12, specs: input.specs, editor: true, k1Book: true, diet: true});
  assert.ok(k1.stages.some((row) => row.stage === 'pageFix' && row.requestCount === 2));
  assert.equal(k1.stages.some((row) => row.stage === 'revision'), false, 'a diet K1 book is not read through by the editor');
  const k1Old = estimateStoryTextCost({settings, pageCount: 12, specs: input.specs, editor: true, k1Book: true});
  assert.ok(k1Old.stages.some((row) => row.stage === 'revision') && !k1Old.stages.some((row) => row.stage === 'pageFix'), 'an R31a K1 job is priced as before');
  const k2 = estimateStoryTextCost({settings, pageCount: 12, specs: dietInput().specs, editor: true, council: true, orchestration: true, diet: true});
  assert.ok(k2.stages.some((row) => row.stage === 'pageFix') && k2.stages.some((row) => row.stage === 'revision'));
});
