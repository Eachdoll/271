import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse, outlineRequestSchema} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanPaginationRules, leanOpeningsPaginationRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {normalizeOutlineResponse} from '../dist/story-generation/outline-normalize.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoPagesPrompt, ecoJobInit, ecoOutlinePrompt} from '../dist/eco-mode.js';
import {preselectMaterials, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {hasStoryCast, hasCastEntrance, storyCastPolicy, storyCastRef, withCastSchema, castRule, settleRelations, castWriterLine, castK1Block, castSummary, castPlanRule, castPaginationLine} from '../dist/story-generation/story-cast.js';

/**
 * 2026-10-27 R43 첫 등장. The parent on a finished K2 draft: "did 해니 come
 * out of nowhere because of the four-or-more rule?" Two causes: ② filled the
 * picks from the drawer in order (R41), and nothing asked a companion's first
 * appearance to be shown. A new diet draft freezes storyCast {version: 1,
 * entrance: true}: every relation row says the beat where the child first
 * sees that companion (firstBeat — settled from the beats) and how they come
 * in (entrance); the writers, the K1 writer and pagination hear it; the
 * material plan takes drawer records for what they can do, never to reach
 * the number; ② preselects only the friends the topic calls for. R41 drafts
 * ({version: 1}) and drafts without the marker are unchanged (R12 pins).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie', 'toto', 'mom'], backgroundIds: ['home', 'beach'], topic: '놀이터에서 자꾸 도망가는 그림자 잡기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `e-${Object.keys(extra).join('-') || 'default'}`});
const r41 = (input) => ({...structuredClone(input), storyCast: {version: 1}});
const RELATIONS = [
  {characterId: 'greenie', relation: '같은 그림자를 먼저 잡고 싶은 라이벌', want: '그림자를 제일 먼저 밟기', firstBeat: 1, entrance: '미끄럼틀 위에서 먼저 소리친다'},
  {characterId: 'toto', relation: '따라 하는 꼬마', want: '유하가 하는 건 다 해 보기', firstBeat: 9, entrance: '덤불 뒤에서 폴짝 나온다'},
  {characterId: 'mom', relation: '제 일로 바쁜 어른', want: '빨래를 다 널기', firstBeat: 2, entrance: '벤치에서 빨래를 개고 있다'},
];
/** An outline whose beats say who is in them: greenie from beat 1, toto from beat 3, mom from beat 2. */
const outlineOf = (input) => {
  const outline = demoOutline(input);
  outline.beats.forEach((beat, i) => { beat.characters = ['yuha', ...(i >= 0 ? ['greenie'] : []), ...(i >= 2 ? ['toto'] : []), ...(i >= 1 ? ['mom'] : [])]; });
  return outline;
};
const firstCalls = async (input, outline) => {
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); if (/첫 장면의 두 초안/u.test(String(req.system))) return {json: {pick: 1, reason: 'r'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; if (/그림책 작가다/u.test(String(req.system))) return {json: {text: '유하가 그림자를 밟아요. 폴짝.'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; if (/writing original English/u.test(String(req.system))) return {json: {text: 'Yuha hops on the shadow.'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; throw new Error('stop'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}}).catch(() => {});
  return calls;
};
const ctxFor = (state, wizard) => ({getState: () => state, getWizard: () => wizard, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});

test('R43 the marker and the picks: every new diet draft freezes storyCast {version: 1, entrance: true}; normalize keeps the frozen shape; ② preselects only the friends the topic calls for and says so; the material plan takes drawer records for what they can do', () => {
  const state = setup(), led = draft(state), old = r41(led);
  assert.deepEqual(led.storyCast, {version: 1, entrance: true});
  assert.deepEqual(storyCastPolicy(), {version: 1});
  assert.deepEqual(storyCastRef({version: 1}), {version: 1});
  assert.deepEqual(storyCastRef({version: 1, entrance: true}), {version: 1, entrance: true});
  assert.deepEqual(storyCastRef({version: 1, entrance: 'yes'}), {version: 1}, 'only true is a value');
  assert.equal(storyCastRef({version: 2}), null);
  assert.deepEqual(normalizeStoryInput(old).storyCast, {version: 1}, 'an R41 draft keeps its shape');
  assert.equal(hasCastEntrance(led), true);
  assert.equal(hasCastEntrance(old), false);
  assert.equal(hasStoryCast(old), true);
  assert.equal(hasCastEntrance({...led, promptDiet: undefined}), false);
  assert.equal('storyCast' in leanVisibleInput(led), false);
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.storyCast, {version: 1, entrance: true});
  // ②: the topic's friends only (R41 filled the rest from the drawer in order).
  assert.deepEqual(preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '공룡 친구와 숲으로 소풍'}).characterIds, ['yuha', 'greenie']);
  assert.deepEqual(preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '비 오는 날 창가에서'}).characterIds, ['yuha'], 'a topic that calls nobody preselects nobody');
  for (let i = 0; i < 4; i++) state.characters.push({id: `extra-${i}`, name: `친구${i}`, nameEn: `Friend${i}`, kind: 'rabbit', likes: '달'});
  const moon = preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '달 토끼와 놀러 간 날'});
  assert.equal(moon.characterIds.length, 4, 'still at most the hero and three');
  assert.ok(moon.characterIds.slice(1).every((id) => id === 'toto' || id.startsWith('extra-')));
  const html = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...wizardOf({simpleFlow: true}), step: 2, simpleStep: 2})));
  assert.match(html, /주제가 부르는 친구만 미리 골라 두었어요 — 나머지는 이야기에 할 일이 있을 때만 자동으로 더해요\./);
  // The material plan's sentence.
  assert.match(castPlanRule(led), /^\nCAST SIZE: 4 or 5 characters in all [^\n]*the parent's picks first, then drawer records that have something to do in this story \(a want of their own that touches the topic\), new ones only when the drawer has none; a record that would only stand in the pictures stays out — fewer characters beat a filler; never more than 5\.$/);
  assert.match(castPlanRule(old), /the parent's picks and fitting drawer records first, new ones only when the drawer runs out; never more than 5\.$/, 'R41 wording on an R41 draft');
});

test('R43 the outline contract: the schema asks firstBeat and entrance per companion; the rule says ENTRANCE; clean-up settles firstBeat from the beats (the model\'s number is replaced) and drops rows nobody appears in; an R41 draft gets none of it', () => {
  const state = setup(), led = draft(state), old = r41(led);
  const schema = outlineRequestSchema(led).properties.relations.items;
  assert.deepEqual(schema.required, ['characterId', 'relation', 'want', 'firstBeat', 'entrance']);
  assert.deepEqual(schema.properties.firstBeat, {type: 'integer', minimum: 1});
  assert.equal(schema.properties.entrance.maxLength, 120);
  const oldSchema = outlineRequestSchema(old).properties.relations.items;
  assert.deepEqual(oldSchema.required, ['characterId', 'relation', 'want']);
  assert.equal('firstBeat' in oldSchema.properties, false);
  assert.equal('relations' in withCastSchema({properties: {}, required: []}, {...led, characters: led.characters.slice(0, 1)}).properties, false);
  const rules = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.match(rules, /No two companions have the same relation\. ENTRANCE: for every companion also return firstBeat \(the beat where the child first sees them\) and entrance \(how they come into the story — walking in, already there busy with their own thing, heard before seen; one short phrase\)\. That beat's summary includes it; nobody is simply present from one line to the next\. A companion with nothing to do in this story stays out of the beats\.\n/);
  assert.match(leanOutlineRules(old, {count: 8, attempts: 3}), /No two companions have the same relation\.\n/);
  assert.doesNotMatch(leanOutlineRules(old, {count: 8, attempts: 3}), /ENTRANCE/);
  // Clean-up: the beats decide firstBeat.
  const outline = outlineOf(led);
  const shaped = normalizeOutlineResponse({...outline, relations: RELATIONS}, led).outline;
  assert.deepEqual(shaped.relations.map((r) => [r.characterId, r.firstBeat, r.entrance]), [['greenie', 1, '미끄럼틀 위에서 먼저 소리친다'], ['toto', 3, '덤불 뒤에서 폴짝 나온다'], ['mom', 2, '벤치에서 빨래를 개고 있다']], 'toto claimed beat 9 but first appears in beat 3');
  const nobody = structuredClone(outline);
  nobody.beats.forEach((b) => { b.characters = b.characters.filter((id) => id !== 'toto'); });
  const absent = settleRelations({beats: nobody.beats, relations: structuredClone(RELATIONS)}, led).relations.find((r) => r.characterId === 'toto');
  assert.deepEqual(absent, {characterId: 'toto', relation: '따라 하는 꼬마', want: '유하가 하는 건 다 해 보기'}, 'a companion in no beat keeps the relation and no entrance');
  assert.deepEqual(settleRelations({relations: [{characterId: 'mom', relation: '바쁜 어른', want: '', firstBeat: 4, entrance: ' 벤치에 앉아 있다. '}]}, led).relations, [{characterId: 'mom', relation: '바쁜 어른', firstBeat: 4, entrance: '벤치에 앉아 있다'}], 'without beats the model\'s number stands');
  assert.deepEqual(settleRelations({relations: [{characterId: 'mom', relation: '바쁜 어른', want: '', firstBeat: 0, entrance: 'x'}]}, led).relations, [{characterId: 'mom', relation: '바쁜 어른'}], 'a bad number is dropped with its entrance');
  const r41Shaped = normalizeOutlineResponse({...outline, relations: RELATIONS}, old).outline;
  assert.deepEqual(Object.keys(r41Shaped.relations[0]), ['characterId', 'relation', 'want'], 'an R41 draft carries no entrance fields');
  // ③ / the pro card / eco.
  assert.equal(castSummary(shaped, led), '관계 · 초록이 같은 그림자를 먼저 잡고 싶은 라이벌 (1비트부터) · 토토 따라 하는 꼬마 (3비트부터) · 엄마 제 일로 바쁜 어른 (2비트부터)');
  assert.equal(castSummary(r41Shaped, old), '관계 · 초록이 같은 그림자를 먼저 잡고 싶은 라이벌 · 토토 따라 하는 꼬마 · 엄마 제 일로 바쁜 어른');
  const ecoJob = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoOutlinePrompt(ecoJob.input), /ENTRANCE: for every companion also return firstBeat/);
  assert.match(ecoOutlinePrompt(ecoJob.input), /"firstBeat"/);
});

test('R43 the writers and pagination: the beat where a companion first appears gets [첫 등장] / [First appearance] after the relations; the K1 block names the entrances; pagination (pages, openings, eco) carries ENTRANCE; an R41 draft hears none of it', async () => {
  const state = setup(), led = draft(state), old = r41(led);
  const outline = normalizeOutlineResponse({...outlineOf(led), relations: RELATIONS}, led).outline;
  const beat3 = outline.beats[2], beat4 = outline.beats[3];
  const ko = castWriterLine(outline, beat3, led, 'ko');
  assert.match(ko, /^\[관계\] 초록이는 같은 그림자를 먼저 잡고 싶은 라이벌 — 바라는 것: 그림자를 제일 먼저 밟기 \/ 토토는 따라 하는 꼬마[^\n]*\n\[첫 등장\] 토토 — 덤불 뒤에서 폴짝 나온다\. 여기서 처음 나와요 — 들어오는 모습이나 이미 거기서 하던 일을 한 줄로 보여 줘요\. 갑자기 옆에 있지 않아요\.$/);
  assert.match(castWriterLine(outline, beat3, led, 'en'), /\n\[First appearance\] 토토 — 덤불 뒤에서 폴짝 나온다\. They appear here for the first time — show them arriving or already there at something of their own, in one line; nobody is simply there\.$/);
  assert.doesNotMatch(castWriterLine(outline, beat4, led, 'ko'), /첫 등장/, 'beat 4 introduces nobody');
  assert.match(castWriterLine(outline, outline.beats[0], led, 'ko'), /\[첫 등장\] 초록이 — 미끄럼틀 위에서 먼저 소리친다\./);
  const calls = await firstCalls(led, outline);
  const third = calls.find((c) => /\[이번 비트\] 3 /u.test(String(c.user)));
  assert.ok(third, 'the writer reached beat 3');
  assert.match(String(third.user), /\n\n\[관계\] [^\n]*\n\[첫 등장\] 토토 — 덤불 뒤에서 폴짝 나온다\./);
  const r41Outline = normalizeOutlineResponse({...outlineOf(old), relations: RELATIONS}, old).outline;
  assert.doesNotMatch(castWriterLine(r41Outline, r41Outline.beats[2], old, 'ko'), /첫 등장/);
  // K1.
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  const k1Outline = normalizeOutlineResponse({...outlineOf(k1), relations: RELATIONS}, k1).outline;
  assert.match(castK1Block(k1Outline, k1), / 첫 등장: 초록이 1비트\(미끄럼틀 위에서 먼저 소리친다\) \/ 토토 3비트\(덤불 뒤에서 폴짝 나온다\) \/ 엄마 2비트\(벤치에서 빨래를 개고 있다\) — 그 쪽에서 들어오는 모습이나 이미 하던 일을 한 줄로 보여 줘요\. 갑자기 옆에 있지 않아요\.$/);
  assert.doesNotMatch(castK1Block(r41Outline, old), /첫 등장/);
  // Pagination.
  assert.match(leanPaginationRules(k1), /\nENTRANCE: on the entry of the beat where a companion first appears \(relations\[\]\.firstBeat, entrance\), scene\.action shows them coming in or already there at their own thing, as the outline says; a companion never simply stands in a picture from one entry to the next\.\nscene\.who/);
  assert.match(leanOpeningsPaginationRules(led, {cues: ['arrival']}), /\nENTRANCE: [^\n]*\nscene\.who/);
  assert.doesNotMatch(leanPaginationRules(r41(k1)) + leanOpeningsPaginationRules(old, {cues: ['arrival']}), /ENTRANCE/);
  assert.equal(castPaginationLine({...led, characters: led.characters.slice(0, 1)}), '', 'a hero alone has no entrances');
  const ecoJob = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoPagesPrompt(ecoJob.input, outline), /ENTRANCE: on the entry/);
});
