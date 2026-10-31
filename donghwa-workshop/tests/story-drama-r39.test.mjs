import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, sceneReferenceRecords} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, renderStoryQualityPlan} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse, inspectOutlineRules, outlineRequestSchema, inspectStory} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanPaginationRules, leanOpeningsPaginationRules, leanVisibleInput, leanOutlineView, leanBibleBlock, leanPageView} from '../dist/story-generation/prompt-diet.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {normalizeOutlineResponse} from '../dist/story-generation/outline-normalize.js';
import {validatePagination, hardOutlineViolations} from '../dist/story-generation/schemas.js';
import {picturePlanPictureLine, picturePlanNote} from '../dist/story-generation/picture-plan.js';
import {buildScenePrompt} from '../dist/image-generation/scene-prompt.js';
import {copyLayoutFields, LAYOUT_FIELDS} from '../dist/book-layout.js';
import {createFullAutoJob, fullAutoProgress} from '../dist/full-auto.js';
import {pagesNeedingImages} from '../dist/story-generation/page-tools.js';
import {ecoOutlinePrompt, ecoJobInit, ecoAcceptOutline, ecoAcceptPages, ecoMissingPictures, ecoPicturePrompts, ecoPagesPrompt} from '../dist/eco-mode.js';
import {imageWork, imageCountLabel, approvalImageWork, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {getPrintHTML} from '../dist/output.js';
import {chairScores, runStoryCouncil, COUNCIL_CALLS} from '../dist/story-generation/council.js';
import {EXPRESSION_DECK, expressionCardById, chooseExpression} from '../dist/story-generation/expression-deck.js';
import {hasStoryDrama, storyDramaPolicy, TRY_KINDS, BACKDROPS, settleStoryDrama, storyDramaViolations, storyDramaWriterLine, storyDramaK1Block, storyDramaSummary, tryKindsOf, normalizeDramaPitch, pitchRepeatsTry, dramaBibleLines, settleDramaPlans, plainBackdropFor, backdropRule, withBackdropSchema, settleBackdrops, isTextOnlyPage, textOnlyPageIndexes, textOnlyTint, textOnlySVG} from '../dist/story-generation/story-drama.js';

/**
 * 2026-10-27 R39 이야기의 드라마. The parent on a finished 16-page K2 book
 * (umbrella): "overall better, but the story is too flat — more creative,
 * more of a story: the hero talking alone on a cut-out, a thought on an
 * empty page, the picture and the words stronger together; and why is there
 * a dinosaur on the cover?" A new diet draft freezes input.storyDrama
 * {version: 1}: its outline names a kind for every try (never two alike),
 * what each try changes, a secret the child sees before the hero, the
 * companion's own want and a flipped refrain; the writers' room pitches
 * carry the same; the picture plan adds where the eye lands, where the
 * secret sits and a plain or text-only backdrop; a text-only page is never
 * drawn, counted or bought and renders as its words on a flat colour; the
 * cover shows the story's own cast. Drafts without the marker are unchanged
 * (R12 pins; the R35–R38 tests on dated inputs).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '놀이터에서 자꾸 도망가는 그림자 잡기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `d-${Object.keys(extra).join('-') || 'default'}`});
const dated = (input) => { const copy = structuredClone(input); delete copy.storyDrama; return copy; };
const firstCalls = async (input, outline) => {
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); throw new Error('stop after the first request'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}}).catch(() => {});
  return calls;
};
const ctxFor = (state, wizard, draftBook = null, page = 0) => ({getState: () => state, getWizard: () => wizard, setWizard() {}, getDraft: () => draftBook, setDraft() {}, getEditPage: () => page, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => '<img alt="">'});
const BOOK_INPUT = {promptDiet: {version: 1}, promptPolicy: {version: 1}, storyChange: {version: 1}, storyDrama: {version: 1}, bookFormat: {version: 1, id: 'pictureLed'}};
const attemptBeats = (outline) => outline.beats.filter((b) => b.type === 'attempt');

test('R39 the marker: every new diet draft freezes storyDrama; the model JSON never shows it; it reads only with the diet and the R38 contract; a FULL AUTO job carries it', () => {
  const state = setup();
  const led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'}), k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  for (const input of [led, wordy, k1]) assert.deepEqual(input.storyDrama, storyDramaPolicy());
  assert.equal(hasStoryDrama(led), true);
  assert.equal(hasStoryDrama(dated(led)), false);
  assert.equal(hasStoryDrama({...led, storyChange: undefined}), false, 'the drama rides on the R38 change contract');
  assert.equal(hasStoryDrama({...led, promptDiet: undefined}), false, 'off the diet nothing reads it');
  assert.equal('storyDrama' in leanVisibleInput(led), false);
  assert.equal(normalizeStoryInput({...led, storyDrama: {version: 2}}).storyDrama, undefined, 'an unknown version is dropped');
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.storyDrama, storyDramaPolicy());
});

test('R39 the outline contract: the schema asks for tryKind and consequence per beat, secret (not K1), companion and refrain.flip; the rules say what they are; a missing or repeated try kind and a missing secret stop the outline; clean-up keeps the fields on asked-for drafts only; the demo carries them', () => {
  const state = setup(), led = draft(state), old = dated(led), k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  const schema = outlineRequestSchema(led), beat = schema.properties.beats.items;
  assert.deepEqual(beat.properties.tryKind.enum, [...TRY_KINDS, 'none']);
  assert.ok(beat.required.includes('tryKind') && beat.required.includes('consequence'));
  assert.ok(schema.required.includes('secret') && schema.required.includes('companion'));
  assert.equal(schema.properties.refrain.properties.flip.maxLength, 150);
  assert.ok(!('tryKind' in outlineRequestSchema(old).properties.beats.items.properties), 'an R38 draft asks for none');
  assert.ok(!('secret' in outlineRequestSchema(old).properties));
  assert.ok(!('secret' in outlineRequestSchema(k1).properties), 'a K1 book has no hidden clue');
  assert.ok(outlineRequestSchema(k1).properties.beats.items.required.includes('tryKind'));
  // R49: a manners draft asks for a secret only when the story has one; the R39 sentence stays on drafts without the marker.
  const r49 = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.match(r49, /Return secret only when the story really has one[^\n]*"" when the story has no such thing — never make something that cannot hide \(someone's own hair, a feeling\) the secret\./);
  assert.doesNotMatch(r49, /Return secret: one thing/);
  assert.equal(outlineRequestSchema(led).properties.secret.minLength, undefined, 'the schema takes ""');
  const {storyManners, ...plain} = led;
  const rules = leanOutlineRules(plain, {count: 8, attempts: 3});
  assert.equal(outlineRequestSchema(plain).properties.secret.minLength, 1);
  assert.match(rules, /\nDRAMA: the attempt beats are different kinds of trying, never the same move again a little bigger — return tryKind on every beat: "force"[^\n]*"trick"[^\n]*"ask"[^\n]*"wait"[^\n]*"giveup"[^\n]*Two attempt beats never share a kind\. Return consequence[^\n]*Return secret: one thing the child can see in the pictures from early on that the hero has not noticed[^\n]*Return companion: what the companion wants for themselves[^\n]*refrain\.flip:[^\n]*\n/);
  assert.match(rules, /\nPICTURE PLAN, three more fields: picturePlan\.focus[^\n]*picturePlan\.secret[^\n]*picturePlan\.backdrop — "scene"[^\n]*"plain"[^\n]*at most two beats[^\n]*"none"[^\n]*at most one beat, never the first or the last, only when carrier is "words"[^\n]*\n/);
  assert.doesNotMatch(leanOutlineRules(k1, {count: 7, attempts: 2}), /Return secret/);
  assert.match(leanOutlineRules(k1, {count: 7, attempts: 2}), /\nDRAMA: /);
  assert.doesNotMatch(leanOutlineRules(old, {count: 8, attempts: 3}), /DRAMA|three more fields/);
  assert.doesNotMatch(leanOutlineRules(draft(state, {bookFormatId: 'wordy'}), {count: 8, attempts: 3}), /three more fields/, '글이 많은 책 plans no pictures');
  // The demo outline: three tries of three kinds, a secret, the companion's want.
  const outline = demoOutline(led);
  assert.deepEqual(tryKindsOf(outline), ['ask', 'force', 'wait']);
  assert.ok(attemptBeats(outline).every((b) => b.consequence));
  assert.match(outline.secret, /도시락 통/);
  assert.match(outline.companion, /도시락/);
  assert.equal('secret' in demoOutline(old), false);
  assert.equal('tryKind' in attemptBeats(demoOutline(old))[0], false);
  assert.equal(inspectOutlineRules(outline, led).violations.some((v) => ['try_kinds', 'secret_missing'].includes(v.code)), false);
  // Hard violations: a try without a kind, two tries of one kind, no secret (K2); K1 needs no secret.
  const noKind = structuredClone(outline); delete attemptBeats(noKind)[1].tryKind;
  assert.ok(hardOutlineViolations(inspectOutlineRules(noKind, led)).some((v) => v.code === 'try_kinds'));
  const twice = structuredClone(outline); attemptBeats(twice)[1].tryKind = 'ask';
  assert.ok(hardOutlineViolations(inspectOutlineRules(twice, led)).some((v) => v.code === 'try_kinds' && /서로 달라야/.test(v.message)));
  const noSecret = structuredClone(outline); delete noSecret.secret;
  assert.ok(hardOutlineViolations(inspectOutlineRules(noSecret, plain)).some((v) => v.code === 'secret_missing'));
  assert.deepEqual(storyDramaViolations(noSecret, led), [], 'R49: a manners draft may have no secret');
  assert.deepEqual(storyDramaViolations({...demoOutline(k1), secret: undefined}, k1), []);
  assert.deepEqual(storyDramaViolations(noKind, old), [], 'nothing is asked of an R38 outline');
  // Clean-up: a kind on a non-attempt beat is dropped, an unknown kind is dropped, nothing kept where nothing was asked.
  const messy = structuredClone(outline);
  messy.beats[0].tryKind = 'force'; messy.beats[0].consequence = 'x';
  attemptBeats(messy)[0].tryKind = 'Trick '; attemptBeats(messy)[2].tryKind = 'magic';
  messy.secret = '  비밀  '; messy.companion = ''; messy.refrain = {text: '또르르', usedAtBeats: [1], flip: ' 또르르, 쿵 '};
  const shaped = normalizeOutlineResponse(messy, led).outline;
  assert.equal('tryKind' in shaped.beats[0], false);
  assert.equal(attemptBeats(shaped)[0].tryKind, 'trick');
  assert.equal('tryKind' in attemptBeats(shaped)[2], false);
  assert.equal(shaped.secret, '비밀');
  assert.equal('companion' in shaped, false);
  assert.equal(shaped.refrain.flip, '또르르, 쿵');
  const stripped = normalizeOutlineResponse({...outline, refrain: {text: 'a', usedAtBeats: [1], flip: 'b'}}, old).outline;
  assert.ok(!('secret' in stripped) && !('companion' in stripped) && !('flip' in stripped.refrain) && attemptBeats(stripped).every((b) => !('tryKind' in b) && !('consequence' in b)));
  assert.deepEqual(settleStoryDrama({secret: 'x', beats: [{type: 'attempt', tryKind: 'ask'}]}, old), {beats: [{type: 'attempt'}]});
  // The lean outline view (pagination, eco pages) carries the secret and the companion.
  assert.deepEqual(Object.keys(leanOutlineView(outline)).filter((k) => ['secret', 'companion'].includes(k)), ['secret', 'companion']);
  // Eco builds the same request and refuses the same answers.
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true, topic: '숲에서 노래하는 돌 찾기'}), backgroundIds: ['forest']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoOutlinePrompt(job.input), /\nDRAMA: /);
  assert.match(ecoOutlinePrompt(job.input), /"tryKind"/);
  const ecoOutline = demoOutline(normalizeStoryInput(job.input));
  assert.equal(ecoAcceptOutline(JSON.stringify(ecoOutline), job.input).ok, true);
  const sameKind = structuredClone(ecoOutline); attemptBeats(sameKind)[1].tryKind = attemptBeats(sameKind)[0].tryKind;
  assert.equal(ecoAcceptOutline(JSON.stringify(sameKind), job.input).ok, false, 'two tries of one kind are refused');
});

test('R39 the writers: an attempt beat hears its kind and consequence, the beats before the turn hear the secret the child sees, the turn hears the seeing, a beat with a companion hears the companion\'s want, the close hears the flipped refrain; the K1 writer gets the block; R38 outlines hear nothing', async () => {
  const state = setup(), led = draft(state), outline = demoOutline(led);
  outline.refrain = {text: '후우, 후우', usedAtBeats: [3, 5], flip: '후우, 후우 — 노래가 됐어요'};
  const beat = (type) => outline.beats.find((b) => b.type === type), tries = attemptBeats(outline);
  assert.match(storyDramaWriterLine(outline, tries[0], 'ko'), /^\[시도 종류\] 이번 시도는 부탁으로 해 보는 거예요 — 앞 시도와 다른 방법이에요\. 결과: 개구리는[^\n]*다음 비트는 여기서 시작해요\.\n\[비밀\] 아이는 그림에서 이미 봐요: 돌 틈에 낀[^\n]*주인공은 아직 몰라요\.\n\[조연의 몫\] 친구는 노래보다 도시락을 먼저 열고 싶어 해요 — 조연은 돕는 역할이 아니라 제 바람대로 움직여요\.$/);
  assert.match(storyDramaWriterLine(outline, tries[1], 'en'), /^\[This try\] The hero tries by force — a different way from the try before\. What it changes: [^\n]*The next beat starts from that\.\n\[The secret\] The child can already see it in the picture: [^\n]*\n\[The companion's own want\] /);
  assert.match(storyDramaWriterLine(outline, beat('turn'), 'ko'), /^\[비밀\] 주인공이 드디어 봐요: [^\n]*말은 적게, 보는 순간 하나로\.\n\[조연의 몫\]/);
  assert.match(storyDramaWriterLine(outline, beat('close'), 'ko'), /\[되풀이 뒤집기\] 마지막에 되풀이 줄이 이렇게 바뀌어 돌아와요: "후우, 후우 — 노래가 됐어요"\.$/);
  assert.doesNotMatch(storyDramaWriterLine(outline, beat('close'), 'ko'), /\[비밀\]|\[시도 종류\]/, 'the close beat hears neither the secret nor a try');
  assert.equal(storyDramaWriterLine({...outline, companion: ''}, {...beat('setup'), characters: ['yuha']}, 'ko').includes('[조연의 몫]'), false);
  const oldOutline = demoOutline(dated(led));
  assert.equal(storyDramaWriterLine(oldOutline, attemptBeats(oldOutline)[0], 'ko'), '', 'an R38 outline carries no drama fields');
  assert.match(storyDramaK1Block(outline), /^\[시도·비밀·조연\] 시도는 서로 다른 방법이에요: 3비트 부탁으로 → [^/]*\/ 4비트 힘으로 → [^/]*\/ 5비트 기다리며 → [^.]*\. 아이가 주인공보다 먼저 보는 것: [^\n]*조연의 바람: [^\n]*되풀이 줄은 마지막에 이렇게 바뀌어요: "후우, 후우 — 노래가 됐어요"\.$/);
  assert.equal(storyDramaK1Block(demoOutline(dated(led))), '');
  // The beat writer's first request (the setup beat) carries the secret; the K1 writer's user message carries the block.
  const calls = await firstCalls(led, demoOutline(led));
  assert.match(calls[0].user, /\n\[비밀\] 아이는 그림에서 이미 봐요: 돌 틈에 낀/);
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  const k1Calls = await firstCalls(k1, demoOutline(k1));
  assert.match(k1Calls[0].user, /\n\n\[시도·비밀·조연\] 시도는 서로 다른 방법이에요: /);
  const oldCalls = await firstCalls(dated(led), demoOutline(dated(led)));
  assert.doesNotMatch(oldCalls[0].user, /\[비밀\]|\[시도 종류\]/);
  // Eco's pages request sees the outline's secret and companion (the lean view).
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoPagesPrompt(job.input, demoOutline(normalizeStoryInput(job.input))), /"secret":"돌 틈에 낀/);
});

test('R39 the writers\' room: a drama draft\'s pitches carry tryKinds, secret and companion into the bible and the outline block; the chair scores a repeated try as no ladder; the reader may say whether the secret was seen; an R38 draft\'s room is unchanged', async () => {
  // The plain room (no 정성 모드 candidates): three pitches in one request, five calls.
  const state = setup(), led = normalizeStoryInput({...draft(state), orchestrationPolicy: undefined}), old = dated(led);
  const base = (planted) => ({title: `피치 ${planted}`, logline: `유하가 ${planted} 소리를 따라가요`, stakes: '못 찾으면 저녁 노래를 못 불러요', planted: {name: planted, nameEn: 'a thing', firstSeen: '가방 고리'}, ladder: ['꿀길', '다리', '동굴'], lowPoint: '바닥', turn: {seen: '그림자가 통을 가리켜요', realized: '통이었구나', overturns: '돌이 노래한다는 믿음'}, payoff: '손으로 불어요', echo: '통을 안고'});
  const pitches = [
    {...base('종'), tryKinds: ['force', 'force', 'ask'], secret: '통 모서리가 보여요', companion: '도시락을 먼저 열고 싶어요'},
    {...base('장화'), tryKinds: ['ask', 'trick', 'wait'], secret: '통 모서리가 보여요', companion: '먼저 집에 가고 싶어요'},
    {...base('우산'), tryKinds: ['wait', 'giveup', 'trick'], secret: '', companion: ''},
  ];
  const verdict = (pitch) => ({pitch, stakes: 2, ladder: 2, lowPoint: 2, turn: 2, payoff: 2, direction: 2, veto: false, vetoReason: '', fixes: []});
  const art = (pitch) => ({pitch, drawableTurn: 2, plantedVisible: 2, lowPointVisible: 2, variety: 2, motifs: [], veto: false, vetoReason: '', fixes: []});
  const reaction = (pitch, secretSeen) => ({pitch, nextQuestion: 2, retell: '통이 노래했어', retellHasTurn: true, scary: '', ...(secretSeen === undefined ? {} : {secretSeen})});
  const roomEngine = (drama) => ({id: 'openai', calls: [], async complete(req) {
    this.calls.push(req);
    const system = String(req.system), user = String(req.user), reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
    if (/20년 써 온 작가/u.test(system) && /\[피치 3개 쓰기\]/u.test(user)) return reply({pitches: drama ? pitches : pitches.map(({tryKinds, secret, companion, ...rest}) => rest)});
    if (/\[바이블 확정\]/u.test(user)) return reply({bible: {...pitches[1], title: '바이블', visual: {pictures: [], motifs: [], plantedPlacementEn: ''}}});
    if (/그림책 편집자/u.test(system)) return reply({verdicts: [verdict(1), verdict(2), verdict(3)], pick: 2});
    if (/아트 디렉터/u.test(system)) return reply({verdicts: [art(1), art(2), art(3)], pick: 2});
    if (/세 아이다|네 아이다|다섯 아이다|여섯 아이다|세 아이|아이다/u.test(system)) return reply({reactions: [reaction(1, drama ? true : undefined), reaction(2, drama ? true : undefined), reaction(3, drama ? false : undefined)], favorite: 2});
    throw new Error(`unexpected request: ${system.slice(0, 40)}`);
  }});
  const engine = roomEngine(true);
  const {record} = await runStoryCouncil(led, {engine}, {engineFor: async () => engine}), bible = record.bible;
  assert.equal(engine.calls.length, COUNCIL_CALLS);
  const pitchCall = engine.calls.find((c) => /\[피치 3개 쓰기\]/u.test(c.user));
  assert.match(pitchCall.user, /\ntryKinds\(시도 3개의 종류를 차례로 — force 힘으로·trick 꾀로·ask 부탁으로·wait 기다리며·giveup 포기하듯 — 같은 종류를 두 번 쓰지 않는다[^\n]*secret\(아이는 그림에서 일찍부터 보지만 주인공은 모르는 것 한 줄[^\n]*companion\(조연이 이 이야기에서 제 스스로 바라는 것/);
  assert.deepEqual(pitchCall.jsonSchema.properties.pitches.items.properties.tryKinds, {type: 'array', items: {type: 'string', enum: [...TRY_KINDS]}, minItems: 3, maxItems: 3});
  const readerCall = engine.calls.find((c) => /\[출력\] JSON만\. 피치마다 reaction/u.test(c.user));
  assert.match(readerCall.user, /secretSeen\(주인공보다 먼저 알아차릴 수 있는 게 있으면 true\)/);
  assert.equal(readerCall.jsonSchema.properties.reactions.items.properties.secretSeen.type, 'boolean');
  assert.deepEqual(record.pitches[1].tryKinds, ['ask', 'trick', 'wait']);
  assert.equal(record.pitches[1].secret, '통 모서리가 보여요');
  assert.equal(record.verdicts.reader[2].secretSeen, false);
  // The chair: pitch 1 repeats "force", so its ladder scores 0 whatever the editor said (12 → 10).
  assert.equal(record.scores[0].editor, 10);
  assert.equal(record.scores[1].editor, 12);
  assert.deepEqual(chairScores([verdict(1)], [art(1)], [reaction(1)], 1, [pitches[0]])[0].editor, 10);
  assert.deepEqual(chairScores([verdict(1)], [art(1)], [reaction(1)], 1)[0].editor, 12, 'without pitches nothing changes');
  assert.equal(pitchRepeatsTry(pitches[0]), true);
  assert.equal(pitchRepeatsTry(pitches[2]), false);
  assert.deepEqual(normalizeDramaPitch({tryKinds: ['Force', 'nope', 'wait', 'ask'], secret: ' s ', companion: ''}, 3), {tryKinds: ['force', 'wait', 'ask'], secret: 's'});
  // The bible carries them and the outline block prints them.
  assert.deepEqual(bible.tryKinds, ['ask', 'trick', 'wait']);
  const block = leanBibleBlock(bible, led);
  assert.match(block, /\nThe tries, each of a different kind: by asking → by a trick → by waiting\. What the child sees before the hero: 통 모서리가 보여요\. The companion's own want: 먼저 집에 가고 싶어요\.$/);
  assert.equal(dramaBibleLines({}), '');
  // An R38 draft: no drama instructions, no tryKinds in the schema, the reader's old schema, the pitch carries no extra fields.
  const oldEngine = roomEngine(false);
  const oldRun = await runStoryCouncil(old, {engine: oldEngine}, {engineFor: async () => oldEngine});
  const oldPitch = oldEngine.calls.find((c) => /\[피치 3개 쓰기\]/u.test(c.user));
  assert.doesNotMatch(oldPitch.user, /tryKinds/);
  assert.equal('tryKinds' in oldPitch.jsonSchema.properties.pitches.items.properties, false);
  assert.equal('secretSeen' in oldEngine.calls.find((c) => /reaction\{pitch/u.test(c.user)).jsonSchema.properties.reactions.items.properties, false);
  assert.equal('tryKinds' in oldRun.record.pitches[1], false);
  assert.equal(leanBibleBlock(oldRun.record.bible, old).includes('The tries, each'), false);
});

test('R39 the picture plan: focus, the secret\'s corner and a backdrop join the plan; clean-up caps plain at two and text-only at one, never on the first or last beat and only on a words beat; the picture line and the parent\'s note carry them; R38 drafts keep none', () => {
  const state = setup(), led = draft(state), old = dated(led);
  const plan = (i, extra = {}) => ({version: 1, carrier: 'both', picture: `picture ${i}`, shot: 'wide', space: 'airy', hook: '', ...extra});
  const outline = {beats: Array.from({length: 8}, (_, i) => ({index: i + 1, type: 'attempt', picturePlan: plan(i + 1)}))};
  Object.assign(outline.beats[0].picturePlan, {backdrop: 'plain', focus: 'the far hill'});
  Object.assign(outline.beats[1].picturePlan, {backdrop: 'plain', focus: ' a hand ', secret: 'the box corner, bottom right'});
  Object.assign(outline.beats[2].picturePlan, {backdrop: 'PLAIN'});
  Object.assign(outline.beats[3].picturePlan, {backdrop: 'plain'});
  Object.assign(outline.beats[4].picturePlan, {backdrop: 'none', carrier: 'words', words: '생각'});
  Object.assign(outline.beats[5].picturePlan, {backdrop: 'none', carrier: 'words', words: '둘째 생각'});
  Object.assign(outline.beats[6].picturePlan, {backdrop: 'none'});
  Object.assign(outline.beats[7].picturePlan, {backdrop: 'none', carrier: 'words', focus: 'x'.repeat(100)});
  const settled = settleDramaPlans(structuredClone(outline), led).beats.map((b) => b.picturePlan);
  assert.equal('backdrop' in settled[0], false, 'never the first beat');
  assert.equal(settled[1].backdrop, 'plain');
  assert.equal(settled[2].backdrop, 'plain');
  assert.equal('backdrop' in settled[3], false, 'plain is capped at two');
  assert.equal(settled[4].backdrop, 'none');
  assert.equal('backdrop' in settled[5], false, 'text-only is capped at one');
  assert.equal('backdrop' in settled[6], false, 'text-only needs a words beat');
  assert.equal('backdrop' in settled[7], false, 'never the last beat');
  assert.equal(settled[1].focus, 'a hand');
  assert.equal(settled[7].focus.length, 80);
  assert.equal(settled[1].secret, 'the box corner, bottom right');
  const kept = settleDramaPlans(structuredClone(outline), old).beats.map((b) => b.picturePlan);
  assert.ok(kept.every((p) => !('backdrop' in p) && !('focus' in p) && !('secret' in p)), 'an R38 draft keeps none of the three');
  // The outline normalizer runs it (through the request path): a drama draft's plan keeps its backdrop.
  const demo = demoOutline(led);
  demo.beats[2].picturePlan = plan(3, {backdrop: 'plain', focus: 'the frog'});
  assert.equal(normalizeOutlineResponse(demo, led).outline.beats[2].picturePlan.backdrop, 'plain');
  assert.equal('backdrop' in normalizeOutlineResponse(structuredClone(demo), old).outline.beats[2].picturePlan, false);
  // The picture line and the note.
  const full = plan(1, {focus: 'the frog', secret: 'the box corner, bottom right', backdrop: 'plain'});
  assert.match(picturePlanPictureLine(full), /; the eye lands on the frog; what the child can see and the hero has not noticed: the box corner, bottom right — small, in the same corner as before, never pointed at; no place at all: the character alone on a flat single-colour background[^\n]*\. Keep it within the actual event above\.$/);
  assert.doesNotMatch(picturePlanPictureLine(plan(1)), /eye lands|has not noticed|no place at all/);
  assert.match(picturePlanNote(full), / \/ 시선 · the frog \/ 비밀 · the box corner, bottom right \/ 단색 바탕 \(생각·독백\)$/);
  assert.match(picturePlanNote(plan(1, {backdrop: 'none'})), /그림 없이 글만$/);
});

test('R39 the picture request: a plain-backdrop page is drawn with no place and no place reference (sent and recorded alike); the cover of a drama book draws only the lead; R38 books are unchanged', () => {
  const snapshot = {characterSheets: [{characterId: 'yuha', characterSnapshot: {nameEn: 'Yuha'}}], backgrounds: [{id: 'home', name: '유하네 집', imageUrl: 'asset:home'}], backgroundReferenceByPage: {2: ['home']}};
  const page = {pageNo: 3, beatIndex: 3, kind: 'page', ko: '혼자 생각해요.', en: 'I think.', scene: {where: 'home', action: 'Yuha stands alone, thinking.', timeOfDay: 'day'}, staging: {shot: 'wide'}};
  const bookOf = (input, backdrop) => ({characterIds: ['yuha', 'greenie'], sceneBriefs: [], storyInput: input, pagination: {cover: {sceneAction: 'Yuha and Greenie the dinosaur hold the umbrella.'}}, outline: {beats: [{index: 3, picturePlan: {version: 1, carrier: 'words', words: '생각', shot: 'wide', space: 'airy', hook: '', ...(backdrop ? {backdrop} : {})}}]}});
  const plain = bookOf(BOOK_INPUT, 'plain'), scene = bookOf(BOOK_INPUT), old = bookOf({...BOOK_INPUT, storyDrama: undefined}, 'plain');
  assert.equal(plainBackdropFor(plain, page), true);
  assert.equal(plainBackdropFor(plain, {...page, backdrop: 'plain', beatIndex: 9}), true, 'the entry field counts too');
  assert.equal(plainBackdropFor(scene, page), false);
  assert.equal(plainBackdropFor(old, page), false, 'an R38 book keeps its place on every page');
  assert.equal(plainBackdropFor(plain, page, {cover: true}), false);
  assert.ok(!sceneReferenceRecords(snapshot, 2, {closeView: plainBackdropFor(plain, page)}).some((r) => r.role === 'background'));
  const prompt = (book, cover = false) => buildScenePrompt({book, page, pageIndex: 2, snapshot, place: {background: {name: '유하네 집'}}, earlierPages: [], cover});
  const plainPrompt = prompt(plain);
  assert.match(plainPrompt, /\n\nLocation: none\. This page has no place: Yuha alone on a flat, single-colour background taken from the style palette, with big quiet empty space around the figure — a thought, a line spoken to the reader\. No place reference image is attached; draw no room, no ground line, no scenery[^\n]*Light as day[^\n]*No words, captions, watermark or logos\./);
  assert.doesNotMatch(plainPrompt, /approved place sheet|유하네 집/);
  assert.match(plainPrompt, /no place at all: the character alone on a flat single-colour background/);
  assert.match(prompt(scene), /Location: [^\n]*place sheet/i);
  assert.match(prompt(old), /Location: [^\n]*place sheet/i);
  // The cover: the lead only, whatever the pagination's sentence says.
  const cover = prompt(plain, true);
  assert.match(cover, /Actual event: Yuha and Greenie the dinosaur hold the umbrella\.\. Draw only Yuha on this cover; if that sentence names anyone else, leave them out\./);
  assert.doesNotMatch(cover, /Location: none/);
  assert.doesNotMatch(prompt(old, true), /Draw only Yuha on this cover/);
  // The pagination rules ask for a cover of the story's cast (drama drafts only).
  const state = setup(), led = draft(state);
  assert.match(leanOpeningsPaginationRules(led, {cues: ['arrival']}), /\nCOVER: cover\.sceneAction shows the main character \(the first supplied character\) in one moment of this story, alone; a second character only when that character acts in the approved beats; a character who is not in the beats does not appear, and the cast is not lined up together\.\n/);
  assert.doesNotMatch(leanPaginationRules(dated(draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages'))), /\nCOVER:/);
});

test('R39 the text-only page: the pagination asks for backdrop, settles it only where the plan says so, keeps it through rewrites and checks; a text-only page is never drawn, counted or bought (simple, FULL AUTO, eco, approval), and renders as its words on a flat colour in ④ and in print; R38 drafts carry none', async () => {
  const state = setup();
  const input = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages'), old = dated(input);
  assert.match(leanPaginationRules(input), /\nBACKDROP: every entry returns backdrop — "scene"[^\n]*"plain"[^\n]*"none" for the one entry of the beat whose picturePlan\.backdrop is "none": that entry has no picture[^\n]*never the first or the last entry[^\n]*\n/);
  assert.equal(backdropRule(old), '');
  assert.equal(backdropRule(draft(state, {bookFormatId: 'wordy'})), '');
  const schema = withBackdropSchema({properties: {pages: {items: {required: ['pageNo'], properties: {pageNo: {}}}}}}, input);
  assert.deepEqual(schema.properties.pages.items.properties.backdrop, {type: 'string', enum: [...BACKDROPS]});
  assert.deepEqual(schema.properties.pages.items.required, ['pageNo', 'backdrop']);
  assert.equal('backdrop' in withBackdropSchema({properties: {pages: {items: {required: [], properties: {}}}}}, old).properties.pages.items.properties, false);
  // A demo book whose beat 3 plans a text-only page and beat 4 a plain one.
  const outline = demoOutline(input), prose = demoProse(outline, input), pagination = demoPagination(outline, prose, input);
  outline.beats[2].picturePlan = {version: 1, carrier: 'words', words: '생각', backdrop: 'none'};
  outline.beats[3].picturePlan = {version: 1, carrier: 'picture', picture: 'the tower', backdrop: 'plain'};
  const idx3 = pagination.pages.findIndex((p) => p.beatIndex === 3), idx4 = pagination.pages.findIndex((p) => p.beatIndex === 4);
  const marked = structuredClone(pagination);
  marked.pages.forEach((p, i) => { p.backdrop = i === idx3 ? 'none' : i === idx4 ? 'plain' : 'scene'; });
  marked.pages[idx3 + 1].backdrop = 'none';
  marked.pages[0].backdrop = 'none';
  settleBackdrops(marked, outline, input);
  assert.equal(marked.pages[idx3].backdrop, 'none');
  assert.equal(marked.pages[idx4].backdrop, 'plain');
  assert.equal('backdrop' in marked.pages[idx3 + 1], false, 'a second text-only entry (and one the plan did not ask for) is dropped');
  assert.equal('backdrop' in marked.pages[0], false, 'never the first entry');
  assert.ok(marked.pages.filter((p, i) => i !== idx3 && i !== idx4).every((p) => !('backdrop' in p)), '"scene" is no field');
  const blank = structuredClone(marked); blank.pages[idx3].textKo = ''; blank.pages[idx3].textEn = '';
  assert.equal('backdrop' in settleBackdrops(blank, outline, input).pages[idx3], false, 'a text-only entry needs its text');
  assert.ok(settleBackdrops(structuredClone(marked), outline, old).pages.every((p) => !('backdrop' in p)), 'an R38 draft carries none');
  // The checks pass the marked book; eco accepts it; the field survives a rewrite copy.
  assert.deepEqual(validatePagination(marked, input, outline), {valid: true, errors: []});
  assert.equal(inspectStory(outline, marked, input).passed, true);
  assert.deepEqual(textOnlyPageIndexes(marked.pages), [idx3]);
  assert.equal(copyLayoutFields(marked.pages[idx3], {pageNo: 4}).backdrop, 'none');
  assert.equal('backdrop' in copyLayoutFields({pageNo: 4}, {pageNo: 4, backdrop: 'none'}), false, 'a rewrite cannot invent one');
  assert.deepEqual(LAYOUT_FIELDS, ['kind', 'openingNo', 'side', 'entryId', 'cue'], 'the R12 layout fields are unchanged');
  assert.equal(leanPageView(marked.pages[idx3]).backdrop, 'none');
  const ecoJob = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true, koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12, topic: '숲에서 노래하는 돌 찾기'}), backgroundIds: ['forest']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  const ecoInput = normalizeStoryInput(ecoJob.input), ecoOutline = demoOutline(ecoInput);
  ecoOutline.beats[2].picturePlan = {version: 1, carrier: 'words', words: '생각', backdrop: 'none'};
  const ecoPages = demoPagination(ecoOutline, demoProse(ecoOutline, ecoInput), ecoInput);
  const ecoIdx = ecoPages.pages.findIndex((p) => p.beatIndex === 3);
  ecoPages.pages.forEach((p, i) => { p.backdrop = i === ecoIdx ? 'none' : 'scene'; });
  const accepted = ecoAcceptPages(JSON.stringify(ecoPages), ecoOutline, ecoJob.input, {bookId: 'eco-text-only'});
  assert.equal(accepted.ok, true, JSON.stringify(accepted.errors || accepted.findings));
  assert.equal(accepted.pagination.pages[ecoIdx].backdrop, 'none');
  assert.ok(accepted.pagination.pages.filter((_, i) => i !== ecoIdx).every((p) => !('backdrop' in p)));
  // Image bookkeeping: the text-only page is not missing, not counted, not drawn.
  const final = (i) => ({imageAssetId: `img-${i}`, imageMeta: {quality: 'final'}});
  const book = {id: 'b', pages: marked.pages.map((p, i) => ({...p, ko: p.textKo, en: p.textEn, ...(i === idx3 || i === 5 ? {} : final(i))})), cover: {imageAssetId: 'cover'}, autoGenerationComplete: true, storyInput: input, outline};
  assert.equal(isTextOnlyPage(book.pages[idx3]), true);
  assert.deepEqual(imageWork(book).missing, [5]);
  assert.equal(imageCountLabel(book), '그림 10 / 11');
  assert.deepEqual(pagesNeedingImages(book), [5]);
  assert.deepEqual(ecoMissingPictures(book), [5]);
  assert.ok(!ecoPicturePrompts(state, {...book, eco: true, title: '책'}).some((row) => row.index === idx3));
  const done = {...book, pages: book.pages.map((p, i) => (i === 5 ? {...p, ...final(5)} : p))};
  assert.deepEqual(imageWork(done).missing, []);
  assert.equal(imageWork(done).needsRun, false);
  assert.equal(approvalImageWork(done, 'openai').finalize, false, 'nothing left to finalize');
  const job = {completed: {}, book: done, input, stopBefore: null}, without = {...job, book: {...done, pages: done.pages.filter((_, i) => i !== idx3)}};
  assert.deepEqual([fullAutoProgress(job).total, fullAutoProgress(job).done], [fullAutoProgress(without).total, fullAutoProgress(without).done], 'the text-only page is not a picture to make');
  assert.equal(fullAutoProgress(job).done - fullAutoProgress({...job, book: {...done, cover: null}}).done, 1, 'pictures and the cover are counted as before');
  // ④ shows the words on a flat colour and offers no drawing; the eco ④ offers no prompt or upload.
  const w = ensureSimpleWizard(state, {...wizardOf({simpleFlow: true}), simpleStep: 4, step: 4});
  const html = renderSimpleCreate(ctxFor(state, w, {...done, title: '책', readingCheck: {passed: true, pages: done.pages.map(() => ({passed: true}))}}, idx3));
  assert.match(html, new RegExp(`<div class="text-only-art simple-text-only" style="background:${textOnlyTint(idx3)}"><p class="text-only-words">${marked.pages[idx3].textKo.slice(0, 6)}`));
  assert.match(html, /그림 없이 글만 있는 쪽/);
  assert.doesNotMatch(html, /data-simple-action="draw-page"|data-simple-action="redraw-page"/);
  const ecoHtml = renderSimpleCreate(ctxFor(state, w, {...done, eco: true, title: '책', readingCheck: {passed: true, pages: done.pages.map(() => ({passed: true}))}}, idx3));
  assert.doesNotMatch(ecoHtml, /data-simple-action="eco-prompt"|data-simple-action="eco-upload"/);
  assert.match(renderSimpleCreate(ctxFor(state, w, {...done, eco: true, title: '책', readingCheck: {passed: true, pages: done.pages.map(() => ({passed: true}))}}, idx3 + 1)), /data-simple-action="eco-prompt"/, 'the next page still offers them');
  // Print: the leaf's picture is a flat colour (the leaf typesets the words); the tint is stable.
  const printable = {...done, title: '책', language: 'bilingual', cover: null, pages: done.pages.map(({imageAssetId, imageMeta, ...p}) => p)};
  const printed = getPrintHTML(printable, {layout: 'single', language: 'bilingual', textPosition: 'below', pages: `${idx3 + 1}`}, state.characters);
  assert.match(printed, new RegExp(encodeURIComponent(`fill="${textOnlyTint(idx3)}"`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(textOnlySVG(2, {wide: true}), /viewBox="0 0 2048 880"/);
  assert.equal(textOnlyTint(7), textOnlyTint(1));
  assert.equal(isTextOnlyPage({backdrop: 'plain'}), false);
});

test('R39 the screens, the deck and the shell: ③, the eco outline and the pro card name the tries, the secret and the companion; the telling slot has the aside card; the shell precaches the module; no author, title or studio in the module', () => {
  const state = setup(), input = draft(state);
  const outline = demoOutline(input); outline.storyShape = structuredClone(input.storyShape);
  assert.equal(storyDramaSummary(outline), `시도 · 부탁·힘·기다리 / 비밀 · ${outline.secret} / 조연 · ${outline.companion}`);
  assert.equal(storyDramaSummary(demoOutline(dated(input))), '');
  assert.match(renderStoryQualityPlan({outline, input}), /<br>달라지는 것 · [^<]+<br>시도 · 부탁·힘·기다리 \/ 비밀 · [^<]+<\/p>/);
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  job.outline = demoOutline(normalizeStoryInput(job.input)); job.eco.step = 'pages';
  const withJob = {...state, fullAutoJobs: {...state.fullAutoJobs, [job.id]: job}};
  const w = ensureSimpleWizard(withJob, {...wizardOf({simpleFlow: true}), step: 3, simpleStep: 3, simpleJobId: job.id, simplePicksTouched: true});
  const html = renderSimpleCreate(ctxFor(withJob, w));
  assert.match(html, / · 시도 · 부탁·힘·기다리 \/ 비밀 · /);
  assert.match(html, /<small class="simple-plan-note">시도 · 부탁·힘·기다리 \/ 비밀 · [^<]+<\/small>/);
  const aside = expressionCardById('aside');
  assert.equal(aside.slot, 'telling');
  assert.equal(aside.name, '한 발 물러선 화자');
  assert.equal(EXPRESSION_DECK.telling.length, 8);
  assert.ok(Array.from({length: 60}, (_, i) => chooseExpression({seed: `주제 ${i}:0`}).cards.telling).some((hand) => hand.includes('aside')), 'the card is dealt');
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v(?:8[7-9]|9[0-9])";/);
  assert.match(sw, /"\.\/story-generation\/story-drama\.js",/);
  const module = readFileSync(new URL('../dist/story-generation/story-drama.js', import.meta.url), 'utf8');
  assert.doesNotMatch(module, /Haughton|호튼|Oh No, George|Shh! We Have a Plan|Little Owl Lost|A Bit Lost|Goodnight Already/i);
});
