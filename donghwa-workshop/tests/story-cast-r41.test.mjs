import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, renderStoryQualityPlan} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse, outlineRequestSchema} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanVisibleInput, leanOutlineView} from '../dist/story-generation/prompt-diet.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {normalizeOutlineResponse} from '../dist/story-generation/outline-normalize.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoOutlinePrompt, ecoJobInit, ecoAcceptOutline} from '../dist/eco-mode.js';
import {preselectMaterials, SIMPLE_MATERIAL_LIMITS, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {runStoryCouncil} from '../dist/story-generation/council.js';
import {hasStoryCast, storyCastPolicy, CAST_TARGET, withCastSchema, castRule, settleRelations, castWriterLine, castK1Block, castSummary, castPitchInstructions, castPlanRule} from '../dist/story-generation/story-cast.js';

/**
 * 2026-10-27 R41 등장인물의 관계. The parent on a finished book with two
 * characters (a child and a mother on every page): "from K1 up, make the
 * cast four or five by default and let the story show more varied
 * relationships." The simple picks now take three friends (the hero and
 * three = four), the auto material plan aims at four or five, and a new
 * diet draft freezes input.storyCast {version: 1}: its outline names a
 * relation (never "helps") and a want for every companion, the writers hear
 * each beat's relations, the room's pitches ask for them. Drafts without the
 * marker are unchanged (R12 pins). The same round splits the single-file
 * backup's 150MB picture cap from the cloud's (the family quota).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie', 'toto', 'mom'], backgroundIds: ['home', 'beach'], topic: '놀이터에서 자꾸 도망가는 그림자 잡기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `c-${Object.keys(extra).join('-') || 'default'}`});
const dated = (input) => { const copy = structuredClone(input); delete copy.storyCast; return copy; };
const ctxFor = (state, wizard) => ({getState: () => state, getWizard: () => wizard, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
const firstCalls = async (input, outline) => {
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); throw new Error('stop after the first request'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}}).catch(() => {});
  return calls;
};
const RELATIONS = [{characterId: 'greenie', relation: '같은 그림자를 먼저 잡고 싶은 라이벌', want: '그림자를 제일 먼저 밟기'}, {characterId: 'toto', relation: '따라 하는 꼬마', want: '유하가 하는 건 다 해 보기'}, {characterId: 'mom', relation: '제 일로 바쁜 어른', want: '빨래를 다 널기'}];

test('R41 the picks and the plan: ② preselects the hero and three friends (the topic\'s picks first, the rest of the drawer after); the auto material plan asks for four or five; every new diet draft freezes storyCast; the model JSON never shows it', () => {
  const state = setup();
  assert.deepEqual(SIMPLE_MATERIAL_LIMITS, {friends: 6, places: 5, preselectFriends: 3, preselectPlaces: 2});
  assert.deepEqual(CAST_TARGET, {min: 4, max: 5});
  const picks = preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '공룡 친구와 숲으로 소풍'});
  assert.deepEqual(picks.characterIds, ['yuha', 'greenie', 'toto', 'mom'], 'the dinosaur first (the topic), then the rest of the drawer');
  for (let i = 0; i < 4; i++) state.characters.push({id: `extra-${i}`, name: `친구${i}`, nameEn: `Friend${i}`, kind: 'rabbit', likes: '달'});
  const moon = preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '달 토끼와 놀러 간 날'});
  assert.equal(moon.characterIds.length, 4, 'never more than the hero and three');
  assert.ok(moon.characterIds.slice(1).every((id) => id === 'toto' || id.startsWith('extra-')), 'the moon rabbits come first');
  const led = draft(state), old = dated(led);
  assert.deepEqual(led.storyCast, storyCastPolicy());
  assert.equal(hasStoryCast(led), true);
  assert.equal(hasStoryCast(old), false);
  assert.equal(hasStoryCast({...led, promptDiet: undefined}), false);
  assert.equal('storyCast' in leanVisibleInput(led), false);
  assert.equal(normalizeStoryInput({...led, storyCast: {version: 2}}).storyCast, undefined);
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.storyCast, storyCastPolicy());
  assert.match(castPlanRule(led), /^\nCAST SIZE: 4 or 5 characters in all \(the hero and 3–4 companions who relate to the hero in different ways[^\n]*never more than 5\.$/);
  assert.equal(castPlanRule(old), '');
  const pipeline = readFileSync(new URL('../dist/story-generation/pipeline.js', import.meta.url), 'utf8');
  assert.match(pipeline, /materialVarietyRule\(input, safe\.allowNew\)\}\$\{castPlanRule\(input\)/, 'the auto planner hears the cast size');
  // ② still renders within the button cap with four picked.
  const w = ensureSimpleWizard(state, {...wizardOf({simpleFlow: true}), step: 2, simpleStep: 2});
  const html = renderSimpleCreate(ctxFor(state, w));
  assert.ok([...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/simple-card/.test(t) && !/data-simple-nav=/.test(t)).length <= 12);
});

test('R41 the outline contract: the schema asks for one relation row per companion; the rule says what a relation is (never helps) and that two change; clean-up keeps supplied companions once, drops unknown ids and everything on an R40 draft; the view, ③ and the pro card carry them; eco builds the same request', () => {
  const state = setup(), led = draft(state), old = dated(led), k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  const schema = outlineRequestSchema(led);
  assert.ok(schema.required.includes('relations'));
  assert.deepEqual(schema.properties.relations.items.properties.characterId.enum, ['greenie', 'toto', 'mom']);
  assert.equal(schema.properties.relations.minItems, 3);
  assert.equal('relations' in outlineRequestSchema(old).properties, false, 'an R40 draft asks for none');
  assert.equal('relations' in withCastSchema({properties: {}, required: []}, {...led, characters: led.characters.slice(0, 1)}).properties, false, 'a hero alone has no relations');
  const rules = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.match(rules, /\nCAST: this story has 4 characters and every one of them matters\. Return relations — one row per companion \(every supplied ID except the first\): relation is what that character is to the hero in THIS story, never simply "helps" \(a rival who wants the same thing[^\n]*want is what they want for themselves\. Companions get in the way, go their own way or help by accident; the hero still solves it\. At least two of these relations are different by the end[^\n]*No two companions have the same relation\.\n/);
  assert.match(leanOutlineRules(k1, {count: 7, attempts: 2}), /\nCAST: [^\n]*a little one who copies, a bigger one who goes first[^\n]*/);
  assert.doesNotMatch(leanOutlineRules(k1, {count: 7, attempts: 2}), /a rival who wants the same thing/, 'K1 hears gentler relations');
  assert.doesNotMatch(leanOutlineRules(old, {count: 8, attempts: 3}), /\nCAST: /);
  assert.equal(castRule({...led, characters: led.characters.slice(0, 1)}), '');
  // Clean-up through the normalizer.
  const outline = demoOutline(led);
  const shaped = normalizeOutlineResponse({...outline, relations: [...RELATIONS, {characterId: 'nope', relation: 'x', want: 'y'}, {characterId: 'toto', relation: '두 번째 줄', want: ''}, {characterId: 'greenie', relation: '', want: 'z'}]}, led).outline;
  assert.deepEqual(shaped.relations, RELATIONS.map((row) => ({...row, relation: row.relation.replace(/\.$/, '')})));
  assert.equal('relations' in normalizeOutlineResponse({...outline, relations: RELATIONS}, old).outline, false, 'an R40 draft keeps none');
  assert.deepEqual(settleRelations({relations: [{characterId: 'mom', relation: ' 바쁜 어른. ', want: ' '}]}, led).relations, [{characterId: 'mom', relation: '바쁜 어른'}]);
  assert.equal('relations' in settleRelations({relations: [{characterId: 'nope', relation: 'x'}]}, led), false);
  assert.ok(Object.keys(leanOutlineView({...outline, relations: RELATIONS})).includes('relations'));
  assert.equal(castSummary({...outline, relations: RELATIONS}, led), '관계 · 초록이 같은 그림자를 먼저 잡고 싶은 라이벌 · 토토 따라 하는 꼬마 · 엄마 제 일로 바쁜 어른');
  assert.equal(castSummary(outline, led), '');
  assert.match(renderStoryQualityPlan({outline: {...outline, relations: RELATIONS, storyShape: structuredClone(led.storyShape)}, input: led}), /<br>관계 · 초록이 같은 그림자를 먼저 잡고 싶은 라이벌 · 토토 따라 하는 꼬마 · 엄마 제 일로 바쁜 어른<\/p>/);
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true, topic: '숲에서 노래하는 돌 찾기'}), backgroundIds: ['forest']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoOutlinePrompt(job.input), /\nCAST: this story has 4 characters/);
  assert.match(ecoOutlinePrompt(job.input), /"relations"/);
  const ecoOutline = demoOutline(normalizeStoryInput(job.input));
  assert.equal(ecoAcceptOutline(JSON.stringify({...ecoOutline, relations: RELATIONS}), job.input).ok, true);
  assert.equal(ecoAcceptOutline(JSON.stringify(ecoOutline), job.input).ok, true, 'missing relations are never a structure error');
});

test('R41 the writers and the room: a beat hears the relations of the companions in it (Korean and English), the K1 writer gets the block, the pitch request asks for different relations; R40 outlines hear nothing', async () => {
  const state = setup(), led = draft(state), outline = {...demoOutline(led), relations: RELATIONS};
  const beat = {...outline.beats[1], characters: ['yuha', 'toto', 'mom']};
  assert.equal(castWriterLine(outline, beat, led, 'ko'), '[관계] 토토는 따라 하는 꼬마 — 바라는 것: 유하가 하는 건 다 해 보기 / 엄마는 제 일로 바쁜 어른 — 바라는 것: 빨래를 다 널기. 조연은 제 바람대로 움직여요. 돕기만 하는 사람은 없어요.');
  assert.match(castWriterLine(outline, beat, led, 'en'), /^\[Relations\] 토토 is 따라 하는 꼬마 — wants: [^/]+ \/ 엄마 is 제 일로 바쁜 어른 — wants: 빨래를 다 널기\. Each companion follows their own want; nobody only helps\.$/);
  assert.equal(castWriterLine(outline, {...beat, characters: ['yuha']}, led, 'ko'), '', 'the hero alone hears none');
  assert.equal(castWriterLine(demoOutline(led), beat, led, 'ko'), '', 'no rows, no line');
  assert.match(castK1Block(outline, led), /^\[등장인물의 관계\] 초록이는 같은 그림자를 먼저 잡고 싶은 라이벌\(바라는 것: 그림자를 제일 먼저 밟기\) \/ 토토는 [^/]+ \/ 엄마는 [^.]+\. 조연마다 제 바람대로 움직이고, 끝에서 둘쯤은 달라져요\.$/);
  assert.equal(castK1Block(demoOutline(led), led), '');
  const calls = await firstCalls(led, outline);
  assert.match(calls[0].user, /\n\[관계\] 초록이는 같은 그림자를 먼저 잡고 싶은 라이벌/);
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  const k1Calls = await firstCalls(k1, {...demoOutline(k1), relations: RELATIONS});
  assert.match(k1Calls[0].user, /\n\n\[등장인물의 관계\] /);
  // The room: the pitch request carries the relations sentence on a cast draft only.
  assert.match(castPitchInstructions(led), /^조연마다 주인공과의 관계가 서로 다르고\(돕는 역할만은 없음/);
  assert.equal(castPitchInstructions(dated(led)), '');
  assert.equal(castPitchInstructions({...led, characters: led.characters.slice(0, 2)}), '', 'one companion needs no variety');
  const plain = normalizeStoryInput({...led, orchestrationPolicy: undefined});
  const engine = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('stop'); }};
  await runStoryCouncil(plain, {engine}, {engineFor: async () => engine}).catch(() => {});
  const pitchCall = engine.calls.find((c) => /\[피치 3개 쓰기\]/u.test(c.user));
  assert.match(pitchCall.user, /\n조연마다 주인공과의 관계가 서로 다르고/);
  const oldEngine = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('stop'); }};
  await runStoryCouncil(dated(plain), {engine: oldEngine}, {engineFor: async () => oldEngine}).catch(() => {});
  assert.doesNotMatch(oldEngine.calls.find((c) => /\[피치 3개 쓰기\]/u.test(c.user)).user, /조연마다 주인공과의 관계/);
  // The cloud: the single-file backup keeps its 150MB cap; the cloud (blobs) path is capped at the family quota.
  const output = readFileSync(new URL('../dist/output.js', import.meta.url), 'utf8');
  assert.match(output, /const BACKUP_ASSET_CAP = 150 \* 1024 \* 1024;\nconst CLOUD_ASSET_CAP = 5 \* 1024 \* 1024 \* 1024;/);
  assert.match(output, /assetBytes > \(mode === "blobs" \? CLOUD_ASSET_CAP : BACKUP_ASSET_CAP\)/);
  assert.match(output, /bytes > \(blobs \? CLOUD_ASSET_CAP : BACKUP_ASSET_CAP\)/);
  assert.doesNotMatch(output, /if \(bytes > 150 \* 1024 \* 1024\)|assetBytes > 150 \* 1024 \* 1024/);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /"\.\/story-generation\/story-cast\.js",/);
});
