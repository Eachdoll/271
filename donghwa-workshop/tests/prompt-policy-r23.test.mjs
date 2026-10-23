import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {layoutFor} from '../dist/book-layout.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateOutline} from '../dist/story-generation/pipeline.js';
import {OUTLINE_SCHEMA, assertValid} from '../dist/story-generation/schemas.js';
import {generateQualityOutline} from '../dist/story-generation/quality-adapter.js';
import {craftOutlineRules} from '../dist/story-generation/craft-rules.js';
import {buildScenePrompt} from '../dist/image-generation/scene-prompt.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {promptPolicy, hasPromptPolicy, bibleSeedOverrides, compactCanonCharacter, compactCanonBackground, outlineLevelLine, compactPlotLines, ARCHITECTURE_LOCK_SHORT} from '../dist/story-generation/prompt-policy.js';
import * as qualityModule from '../story-quality/dist/pipeline.js';

/**
 * 2026-10-20 R23 프롬프트 정비: new drafts freeze input.promptPolicy {version: 1}.
 * Only those drafts get the package's default outline rules back (the app's
 * empty settings arrays no longer override them), a seed that follows the
 * writers' room bible, an outline canon without the level-spec JSON and the
 * palette, PLACES counted over the parent's chosen places, three-line picture
 * ledgers and pitches in the reader's words. Drafts without the policy send
 * byte-identical requests (R12 pins).
 */
const clone = v => JSON.parse(JSON.stringify(v));
function setup() {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  return state;
}
const wizard = {characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'forest'], topic: '바람 피리 찾기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const read = async file => JSON.parse(await readFile(new URL(`../story-quality/data/${file}.json`, import.meta.url), 'utf8'));
const goldPart = async part => JSON.parse(await readFile(new URL(`../story-quality/gold/gold_outlines_part${part}.json`, import.meta.url), 'utf8'));
const data = {inventories: await read('inventories'), gestureDictionary: await read('gesture_dictionary'), plotPatterns: await read('plot_patterns'), worldLibrary: await read('worlds'), goldBooks: [...await goldPart(1), ...await goldPart(2)]};
const schema = () => {const v = clone(OUTLINE_SCHEMA); v.required.push('plotContract'); return v;};
const capture = () => ({id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('captured'); }});
const services = (engine) => ({engineFor: async o => o.engine || engine, qualityData: data, qualityModule: async () => qualityModule, outlineRequestSchema: schema, baseSystem: 'APP_BASE_RULES', levelRules: i => `FROZEN_LEVEL_SPECS:${JSON.stringify(i.specs)}`, assertValid, inspectOutlineRules: () => ({valid: true, violations: []})});
const bible = {title: '빨간 장화의 종', planted: {name: '빨간 장화', nameEn: 'a red boot', firstSeen: '현관 옆'}, turn: {seen: '장화 속에서 울리는 작은 종', realized: '"장화가 종이었어!"', overturns: '남의 소리가 아니라 유하 장화 속 종소리'}, stakes: '저녁 노래', lowPoint: '그냥 갈까', payoff: '종을 울려요', echo: '머리맡의 장화', ladder: ['a', 'b', 'c']};
function policyInput(state, extra = {}) {
  const {input} = inputFromWizard(state, wizard, {layout: layoutFor(wizard)});
  return normalizeStoryInput({...input, storyQuality: {enabled: true, useBeamSearch: false, twoPass: true, patternId: 'mystery_sound', approvedBooks: [], rules: [], banExamples: []}, ...extra});
}
const legacyOf = (input) => { const {promptPolicy: _p, promptDiet: _d, ...rest} = input; return normalizeStoryInput(rest); };

test('R23 the wizard freezes promptPolicy; normalize keeps it; the model never sees it; a FULL AUTO job keeps only its own', () => {
  const state = setup();
  const {input} = inputFromWizard(state, wizard, {layout: layoutFor(wizard)});
  assert.deepEqual(input.promptPolicy, {version: 1});
  assert.deepEqual(promptPolicy(), {version: 1});
  assert.equal(hasPromptPolicy(normalizeStoryInput(input)), true);
  assert.equal(hasPromptPolicy(legacyOf(input)), false);
  assert.equal('promptPolicy' in legacyOf(input), false, 'no key without the policy: byte-identical input');
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text'});
  assert.deepEqual(job.input.promptPolicy, {version: 1});
});

test('R23 the outline request of a policy draft: default rules and ban examples are back, the canon is lean, the level is one line', async () => {
  const state = setup(), input = policyInput(state), engine = capture();
  await generateQualityOutline(input, {engine}, services(engine)).catch(() => {});
  const req = engine.calls[0];
  assert.match(req.user, /\[규칙\]\n1 심을 물건은 비트 1~2에 나오고 반전\(turn\)에서 반드시 다시 쓰인다\./u, 'the package default rules are sent');
  assert.match(req.user, /\[이렇게 쓰지 않는다\]\n✗ 매 비트 같은 꼬리말/u);
  assert.match(req.system, /LEVELS \(summary for this outline\): Korean K2 \(그림책 5~6세; about 12 sentences per opening\); English E2 \(리더스 \(Step 1\); about 4 sentences per opening\)\. 8 beats for 16 pages, one beat per opening \(8 openings\)\./u);
  assert.doesNotMatch(req.system, /FROZEN_LEVEL_SPECS|"vocabList"|"yellow"/u, 'no level-spec JSON or word list in the outline stage');
  assert.doesNotMatch(req.system, /#e9bb4e|"likes"|"clothes"|"hairColor"/u, 'no palette or wardrobe in the outline canon');
  assert.match(req.system, /APP CANON: \{"characters":\[\{"id":"yuha","name":"유하","nameEn":"Yuha","role":"주인공","kind":"child","age":4,"gender":"남자아이","traits":\["호기심 많음","씩씩함","다정함"\],"catchphrase":"내가 먼저 해 볼래!"\}/u);
  assert.ok(req.system.length < 9000, `outline system prompt ${req.system.length} chars (was about 14,000)`);
  // A coach's own rules still replace the defaults.
  const coached = capture();
  await generateQualityOutline(policyInput(state, {storyQuality: {enabled: true, useBeamSearch: false, twoPass: true, patternId: 'mystery_sound', approvedBooks: [], rules: ['코치 규칙 하나'], banExamples: ['✗ 코치 예시']}}), {engine: coached}, services(coached)).catch(() => {});
  assert.match(coached.calls[0].user, /\[규칙\]\n1 코치 규칙 하나\n/u);
  assert.match(coached.calls[0].user, /\[이렇게 쓰지 않는다\]\n✗ 코치 예시/u);
  // The same draft without the policy: empty arrays still override (byte-identical legacy request).
  const legacy = capture();
  await generateQualityOutline(legacyOf(input), {engine: legacy}, services(legacy)).catch(() => {});
  assert.match(legacy.calls[0].user, /\[규칙\]\n\n\[이렇게 쓰지 않는다\]\n/u, 'legacy drafts keep the empty sections');
  assert.match(legacy.calls[0].system, /FROZEN_LEVEL_SPECS/u);
  assert.match(legacy.calls[0].system, /#e9bb4e/u);
});

test('R23 the seed follows the story bible: planted object and turn from the bible, no humour beat, no sub-location line', async () => {
  const state = setup(), input = policyInput(state), engine = capture();
  await generateQualityOutline(input, {engine, storyBibleRules: 'STORY BIBLE (binding; test)', storyBible: bible}, services(engine)).catch(() => {});
  const user = engine.calls[0].user;
  assert.match(user, /- 심을 물건: 빨간 장화 — 비트 1~2에 자연스럽게 등장시키고 반전에서 회수한다\n- 반전 유형: 설계서의 반전 — 남의 소리가 아니라 유하 장화 속 종소리 \(아이가 보는 것: 장화 속에서 울리는 작은 종 → 주인공의 말: "장화가 종이었어!"\)/u);
  assert.doesNotMatch(user, /- 웃음 포인트:|- 세부 장소 후보:/u);
  assert.match(user, /- 배경 생물: /u, 'the random creature and failure reasons stay');
  assert.match(user, /- 시도별 실패 이유: /u);
  // Without a bible the random seed stays whole; without the policy the bible changes nothing in the seed.
  const plain = capture();
  await generateQualityOutline(input, {engine: plain}, services(plain)).catch(() => {});
  assert.match(plain.calls[0].user, /- 웃음 포인트: /u);
  const legacy = capture();
  await generateQualityOutline(legacyOf(input), {engine: legacy, storyBibleRules: 'STORY BIBLE (binding; test)', storyBible: bible}, services(legacy)).catch(() => {});
  assert.match(legacy.calls[0].user, /- 웃음 포인트: /u);
  assert.doesNotMatch(legacy.calls[0].user, /빨간 장화/u);
  assert.deepEqual(bibleSeedOverrides(null), null);
  assert.deepEqual(bibleSeedOverrides({planted: {name: '종'}}), {planted: {ko: '종', en: '종'}, humor: null, subLocations: []});
});

test('R23 PLACES counts the places the parent chose; without chosen places or without the policy the whole drawer counts', () => {
  const state = setup(), input = policyInput(state);
  assert.equal(input.backgrounds.length, 5, 'the whole drawer is supplied');
  assert.deepEqual(input.preferredBackgroundIds, ['home', 'forest']);
  assert.doesNotMatch(craftOutlineRules(input), /PLACES \(/u, 'one chosen non-home place: no spread rule');
  // R31b: a new draft is on the prompt diet (one soft sentence); the PLACES command is for drafts without it.
  const three = normalizeStoryInput({...input, preferredBackgroundIds: ['home', 'forest', 'moon', 'beach']});
  // R33: on the diet the places follow the story — no visiting quota at all.
  assert.doesNotMatch(craftOutlineRules(three), /PLACES|places besides home/u);
  const {promptDiet, ...undieted} = three;
  assert.match(craftOutlineRules(normalizeStoryInput(undieted)), /PLACES \(3 non-home locations supplied\): the middle beats visit at least 3 distinct/u);
  assert.match(craftOutlineRules(legacyOf(input)), /PLACES \(4 non-home locations supplied\): the middle beats visit at least 4 distinct/u, 'legacy counts the drawer, byte for byte');
  assert.doesNotMatch(craftOutlineRules(normalizeStoryInput({...input, preferredBackgroundIds: []})), /PLACES|places besides home/u, 'R33: the diet has no place quota either way');
});

test('R23 the picture request of a policy book: three-line event, two pages of continuity, two-sentence lock; a legacy book is unchanged', () => {
  const state = setup(), input = policyInput(state);
  const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input);
  const page = {pageNo: 3, beatIndex: 2, ko: '유하가 숲길을 걸어요.', en: 'Yuha walks.', scene: {action: 'Yuha walks on the forest path', timeOfDay: 'day'}, staging: {shot: 'wide'}};
  const snapshot = {characterSheets: [{characterId: 'yuha', characterSnapshot: {name: '유하', nameEn: 'Yuha', description: '노란 티셔츠'}}]};
  const place = {background: {name: '초록빛 숲', description: '둥근 나무'}};
  const earlierPages = [{pageNo: 1, summary: 'home'}, {pageNo: 2, summary: 'path'}, {pageNo: 3, summary: 'tree'}];
  const policyBook = {id: 'b', characterIds: ['yuha'], outline, storyInput: input, pages: [page]};
  const lean = buildScenePrompt({book: policyBook, page, pageIndex: 2, snapshot, place, earlierPages});
  assert.match(lean, /EVENT \(beat 2, caused by beat 1\): trigger — .+; attempt — .+; result — .+\. Draw only the moment this page narrates/u);
  assert.doesNotMatch(lean, /LOCKED EVENT AND STATE LEDGER|stateBefore|openPromises/u);
  assert.ok(lean.includes(ARCHITECTURE_LOCK_SHORT));
  assert.match(lean, /Earlier pages: \[\{"pageNo":2,"summary":"path"\},\{"pageNo":3,"summary":"tree"\}\]/u, 'only the last two pages');
  assert.doesNotMatch(lean, /Preserve the exact doorway silhouette/u);
  const legacyBook = {...policyBook, storyInput: legacyOf(input)};
  const full = buildScenePrompt({book: legacyBook, page, pageIndex: 2, snapshot, place, earlierPages});
  assert.match(full, /LOCKED EVENT AND STATE LEDGER \(scope: entire beat, not every page\): \{"version":1/u);
  assert.match(full, /Preserve the exact doorway silhouette/u);
  assert.match(full, /Earlier page continuity: \[\{"pageNo":1/u);
  assert.ok(lean.length < full.length / 1.5, `${lean.length} vs ${full.length}`);
  assert.equal(compactPlotLines(null), '');
});

test('R23 helpers: compact canon rows and the level line for page books', () => {
  assert.deepEqual(compactCanonCharacter({id: 'c', name: '토토', nameEn: 'Toto', role: '친구', kind: 'rabbit', color: '#fff', likes: '당근', clothes: '조끼', traits: ['느긋함', 'a', 'b', 'c'], speechHabit: '음냐'}), {id: 'c', name: '토토', nameEn: 'Toto', role: '친구', kind: 'rabbit', traits: ['느긋함', 'a', 'b'], catchphrase: '음냐'});
  assert.deepEqual(compactCanonBackground({id: 'home', name: '집', kind: '집', color: '#d8b995', description: '큰 창문', mood: '아늑함'}), {id: 'home', name: '집', kind: '집', description: '큰 창문'});
  const line = outlineLevelLine({pageCount: 12, language: 'bilingual', specs: {ko: {id: 'K1', label: '그림책 3~4세', sentencesPerPage: [2, 3]}, en: {id: 'E0', label: '들려주기', sentencesPerPage: 1}}}, 7);
  assert.equal(line, 'LEVELS (summary for this outline): Korean K1 (그림책 3~4세; about 2-3 sentences per page); English E0 (들려주기; about 1 sentences per page). 7 beats for 12 pages. Sentence length, vocabulary and grammar limits bind the later prose stages, never this outline: level changes wording, not causes and consequences.');
  assert.match(outlineLevelLine({pageCount: 12, language: 'ko', specs: {ko: {id: 'K1', label: 'x', sentencesPerPage: 2}, en: {id: 'E0'}}}, 7), /^LEVELS \(summary for this outline\): Korean K1 \(x; about 2 sentences per page\)\. 7 beats/u);
});

test('R23 the author bot pitches in the reader\'s words for a policy draft only', async () => {
  const state = setup();
  const {input: raw} = inputFromWizard(state, {...wizard, topic: '바람 피리 찾기'}, {layout: layoutFor(wizard)});
  const input = normalizeStoryInput({...raw, storyQuality: {enabled: false}});
  const calls = [];
  // R29: answer the growth-design step so the room goes on to its pitch requests.
  const designReply = {json: {growth: {want: '피리 찾기', need: '친구와 함께하기', flaw: '혼자 하려 함'}, theme: '함께', lesson: '같이 찾으면 들려요'}, usage: {input: 1, output: 1}, meta: {requests: 1}};
  const engine = {id: 'openai', async complete(req) { calls.push(req); if (/\[성장 설계 — 후보를 쓰기 전에/u.test(req.user)) return structuredClone(designReply); throw new Error('captured'); }};
  await generateOutline(input, {engine}).catch(() => {});
  // R29: a 정성 모드 room asks for the growth design first; the pitch request is the one that matters here.
  const pitch = (list) => list.find((c) => /\[피치 [13]개 쓰기\]/u.test(c.user));
  assert.match(pitch(calls).user, /\[독자 어휘\] 5~6세 아이가 듣고 되말할 수 있는 말로 쓴다: 한 문장은 짧게, 어려운 낱말·어른 표현·비유 없이, 보이는 물건과 행동으로\./u);
  const legacyCalls = [];
  const legacyEngine = {id: 'openai', async complete(req) { legacyCalls.push(req); if (/\[성장 설계 — 후보를 쓰기 전에/u.test(req.user)) return structuredClone(designReply); throw new Error('captured'); }};
  await generateOutline(legacyOf(input), {engine: legacyEngine}).catch(() => {});
  assert.doesNotMatch(pitch(legacyCalls).user, /\[독자 어휘\]/u);
});
