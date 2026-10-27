import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, renderStoryBeatCard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse, outlineRequestSchema} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanOpeningsPaginationRules, leanPaginationRules} from '../dist/story-generation/prompt-diet.js';
import {normalizeOutlineResponse} from '../dist/story-generation/outline-normalize.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {buildScenePrompt, scenePlanText} from '../dist/image-generation/scene-prompt.js';
import {wantsPicturePlan, normalizePicturePlan, settlePicturePlans, picturePlanSchema, picturePlanOutlineRule, picturePlanWriterLine, picturePlanPictureLine, picturePlanNote, planOf, PICTURE_PLAN_VERSION} from '../dist/story-generation/picture-plan.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoJobInit, ecoOutlinePrompt, ecoPagesPrompt, ecoPicturePrompt} from '../dist/eco-mode.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';

/**
 * 2026-10-24 R36 글·그림 분담. The parent: a picture book like the reference
 * is planned by deciding, beat by beat, whether the words or the picture tells
 * the moment, and how the picture does it. A picture-led diet draft's outline
 * returns beat.picturePlan {carrier, words, picture, shot, space, hook, unit};
 * the writer is told it MAY leave the picture's part unsaid, the pagination
 * prefers the planned unit, the picture request adds one composition line (its
 * planned shot replaces the staging shot), eco shows it in the picture prompt
 * the parent copies. Nothing checks against it; a missing or odd plan is
 * dropped silently. Every other draft is byte-identical.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '유하가 바닷가에서 파도를 처음 만나요', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `b-${Object.keys(extra).join('-') || 'd'}`});
const PLAN = {version: 1, carrier: 'contrast', words: '“괜찮아” 하는 작은 목소리', picture: 'a tiny crab under a wave three times its size', shot: 'wide', space: 'airy', hook: 'the wave curls off the right edge', unit: 'spread'};
const firstCalls = async (input, outline) => {
  const calls = [];
  // R42: the Korean beat and the anchor sniff are answered so the English request (now written after the Korean) is issued too.
  const engine = {id: 'openai', async complete(req) { calls.push(req); if (/첫 장면의 두 초안/u.test(String(req.system))) return {json: {pick: 1, reason: 'r'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; if (/그림책 작가다/u.test(String(req.system))) return {json: {text: '유하가 숲길을 걸어요. 바람이 살랑 불어요.'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; throw new Error('stop after the first request'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}}).catch(() => {});
  return calls;
};

test('R36 only a picture-led diet draft plans its pictures: the outline schema asks for picturePlan per beat (unit only for openings); 글이 많은 책 and legacy schemas are unchanged', () => {
  const state = setup(), led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  const legacy = normalizeStoryInput({...led, promptDiet: undefined});
  assert.equal(wantsPicturePlan(led), true);
  assert.equal(wantsPicturePlan(wordy), false);
  assert.equal(wantsPicturePlan(legacy), false);
  const beat = outlineRequestSchema(led).properties.beats.items;
  assert.ok(beat.required.includes('picturePlan'));
  // R39: focus, secret and backdrop join the plan.
  // R40: and the pocket.
  assert.deepEqual(beat.properties.picturePlan.required, ['carrier', 'words', 'picture', 'shot', 'space', 'hook', 'unit', 'focus', 'secret', 'backdrop', 'pocket']);
  assert.deepEqual(beat.properties.picturePlan.properties.carrier.enum, ['words', 'picture', 'both', 'contrast']);
  assert.equal('picturePlan' in outlineRequestSchema(wordy).properties.beats.items.properties, false);
  assert.equal('picturePlan' in outlineRequestSchema(legacy).properties.beats.items.properties, false);
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.equal('unit' in picturePlanSchema(k1).properties, false, 'a page book plans no spread/pages unit');
  assert.ok(outlineRequestSchema(k1).properties.beats.items.required.includes('picturePlan'));
});

test('R36 the outline request carries one PICTURE PLAN paragraph (who tells it, the picture\'s part, shot, space, hook, unit) as a plan, not a script; other drafts do not', () => {
  const state = setup(), led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  const rules = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.equal((rules.match(/PICTURE PLAN:/g) || []).length, 1);
  assert.match(rules, /\nPICTURE PLAN: for every beat return picturePlan — decide who tells this moment before anyone writes it\.[^\n]*"contrast" \(the words say one thing and the picture shows another[^\n]*unit: spread for one big moment[^\n]*it is a plan for the artist, not a script\.( This book's picture ideas: [^\n]+)?\n/);
  assert.doesNotMatch(rules, /PICTURE PLAN[^\n]*\b(Never|MUST|must|exactly)\b/);
  assert.doesNotMatch(leanOutlineRules(wordy, {count: 8, attempts: 3}), /PICTURE PLAN/);
  assert.equal(picturePlanOutlineRule(wordy), '');
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.doesNotMatch(picturePlanOutlineRule(k1), /unit:/);
  // Eco builds its outline request from the same lines.
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoOutlinePrompt(job.input), /PICTURE PLAN: for every beat return picturePlan/);
  assert.match(ecoOutlinePrompt(job.input), /"picturePlan"/, 'the eco OUTPUT schema names the field');
});

test('R36 a plan is cleaned, never guessed: synonyms map, unknown values drop, a plan with neither carrier nor picture is no plan; the response keeps a clean plan or none and never stops', () => {
  const state = setup(), led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  assert.deepEqual(normalizePicturePlan({carrier: 'Picture', picture: '  a huge  wave ', shot: 'closeup', space: 'roomy', unit: 'spread', extra: 1}, led), {version: PICTURE_PLAN_VERSION, carrier: 'picture', picture: 'a huge wave', shot: 'close', unit: 'spread'});
  assert.equal(normalizePicturePlan({shot: 'wide', space: 'airy'}, led), null);
  assert.equal(normalizePicturePlan('a wave', led), null);
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.equal('unit' in normalizePicturePlan({carrier: 'both', unit: 'spread'}, k1), false);
  const outline = demoOutline(wordy);
  outline.beats[0].picturePlan = {carrier: 'words', picture: 'x'};
  outline.beats[1].picturePlan = {shot: 'nope'};
  const keptLed = settlePicturePlans(structuredClone(outline), led);
  assert.equal(keptLed.beats[0].picturePlan.carrier, 'words');
  assert.equal('picturePlan' in keptLed.beats[1], false, 'an empty plan is dropped');
  const keptWordy = settlePicturePlans(structuredClone(outline), wordy);
  assert.equal(keptWordy.beats.some((b) => 'picturePlan' in b), false, 'a draft that did not ask keeps none');
  // Through the response normalizer (app path and eco).
  const {outline: normalized} = normalizeOutlineResponse(structuredClone(outline), led);
  assert.equal(normalized.beats[0].picturePlan.carrier, 'words');
  const plain = demoOutline(wordy);
  assert.deepEqual(normalizeOutlineResponse(structuredClone(plain), wordy).outline, normalizeOutlineResponse(structuredClone(plain), wordy).outline);
  assert.equal(normalizeOutlineResponse(structuredClone(plain), wordy).outline.beats.some((b) => 'picturePlan' in b), false);
});

test('R36 the beat writer hears who tells the beat — permission to leave the picture\'s part unsaid, and that the words still make sense read alone; no plan, no line', async () => {
  const state = setup(), led = draft(state);
  assert.match(picturePlanWriterLine(PLAN, 'ko'), /^\[그림과 글의 몫\] 글과 그림이 어긋나요[^\n]*그림이 보여 줘요: a tiny crab under a wave three times its size — 글로 다시 말하지 않아도 돼요\. 글의 몫: “괜찮아” 하는 작은 목소리\. 넘김: the wave curls off the right edge\. 읽어 주는 사람이 혼자 읽어도 무슨 일인지는 알 수 있게 써요\.$/);
  assert.match(picturePlanWriterLine({...PLAN, carrier: 'picture'}, 'en'), /^\[Picture and words\] The picture shows: a tiny crab[^\n]*You need not say that in words[^\n]*one short line or a sound is enough\.$/);
  assert.equal(picturePlanWriterLine(null), '');
  const outline = demoOutline(led); outline.refrain = null;
  assert.ok(outline.beats.every((b) => b.picturePlan?.version === 1), 'the picture-led openings demo carries plans');
  const calls = await firstCalls(led, outline);
  const ko = calls.find((c) => /그림책 작가다/u.test(c.system)), en = calls.find((c) => /writing original English/u.test(c.system));
  assert.match(ko.user, /\n\n\[그림과 글의 몫\] 글과 그림이 함께 말해요\. 그림이 보여 줘요: two tiny friends at the edge of a huge green forest/);
  assert.match(en.user, /\[Picture and words\] The picture shows: two tiny friends/);
  const bare = structuredClone(outline); bare.beats.forEach((b) => delete b.picturePlan);
  const bareKo = (await firstCalls(led, bare)).find((c) => /그림책 작가다/u.test(c.system));
  assert.doesNotMatch(bareKo.user, /그림과 글의 몫/);
  assert.equal(bareKo.user, ko.user.replace(/\[그림과 글의 몫\][^\n]*\n\n/, ''), 'the plan line is the only difference');
});

test('R36 the K1 writer\'s map names each beat\'s plan on a picture-led diet draft', async () => {
  const state = setup(), k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  const outline = demoOutline(k1);
  outline.beats[2].picturePlan = {...PLAN, unit: undefined};
  const calls = await firstCalls(k1, outline);
  assert.ok(calls.length, 'the K1 writer was called');
  assert.match(calls[0].user, /\n3 attempt @[^\n]* \/ 그림 계획: 어긋남 · 그림 a tiny crab under a wave three times its size · 글 “괜찮아” 하는 작은 목소리\n/);
  assert.equal((calls[0].user.match(/그림 계획:/g) || []).length, 1);
});

test('R36 pagination prefers the planned unit and turns the plan\'s picture into scene.action; the picture-led demo still paginates and passes', () => {
  const state = setup(), led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  const rules = leanOpeningsPaginationRules(led, {cues: ['arrival']});
  assert.match(rules, /\nPICTURE PLAN: each approved beat carries picturePlan\. scene\.action is that beat's picturePlan\.picture made into this entry's moment; picturePlan\.unit is the planned shape \(spread or two pages\) — follow it unless the beat text clearly needs the other\. The picture's part stays in the picture; the text keeps its own part\.\n(?:WORDLESS: [^\n]*\n)?(?:BACKDROP: [^\n]*\n)?(?:COVER: [^\n]*\n)?(?:ENGLISH FOLLOWS KOREAN: [^\n]*\n)?(?:ENTRANCE: [^\n]*\n)?scene\.who/);
  assert.doesNotMatch(leanOpeningsPaginationRules(wordy, {cues: ['arrival']}), /PICTURE PLAN/);
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.match(leanPaginationRules(k1), /\nPICTURE PLAN: [^\n]*moment\. The picture's part/);
  assert.doesNotMatch(leanPaginationRules(k1), /picturePlan\.unit/);
  const outline = demoOutline(led), pagination = demoPagination(outline, demoProse(outline, led), led);
  const planned = outline.beats.map((b) => b.picturePlan.unit), made = outline.beats.map((b) => pagination.pages.filter((p) => p.beatIndex === b.index)[0].kind === 'spread' ? 'spread' : 'pages');
  assert.deepEqual(made, planned, 'the demo plan matches the demo pagination');
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoPagesPrompt(job.input, demoOutline(normalizeStoryInput(job.input))), /PICTURE PLAN: each approved beat carries picturePlan/);
  assert.match(ecoPagesPrompt(job.input, demoOutline(normalizeStoryInput(job.input))), /"picturePlan":\{"version":1,"carrier":"both"/, 'the approved outline the parent pastes carries the plans');
});

test('R36 the picture request adds one composition line and its planned shot replaces the staging shot; the plan text is declared model-written; no plan, no change', () => {
  const snapshot = {characterSheets: [{characterId: 'yuha', characterSnapshot: {nameEn: 'Yuha'}}]};
  const page = {pageNo: 3, beatIndex: 3, kind: 'page', ko: '“괜찮아.”', en: 'It is fine.', scene: {where: 'beach', action: 'Yuha stands at the water.', timeOfDay: 'day'}, staging: {shot: 'closeup'}};
  const bookOf = (plan) => ({characterIds: ['yuha'], sceneBriefs: [], storyInput: {}, outline: {beats: [{index: 3, ...(plan ? {picturePlan: plan} : {})}]}});
  const prompt = (plan, extra = {}) => buildScenePrompt({book: bookOf(plan), page: {...page, ...extra}, pageIndex: 2, snapshot, place: {background: {name: '바닷가'}}, earlierPages: []});
  const planned = prompt(PLAN), bare = prompt(null);
  assert.match(planned, /PICTURE PLAN \(decided with the story\): the picture alone shows a tiny crab under a wave three times its size; while the words say something else \(“괜찮아” 하는 작은 목소리\); wide view: small figures in a big world; lots of quiet empty space around the figures; page turn: the wave curls off the right edge\. Keep it within the actual event above\./);
  assert.match(planned, /^wide establishing shot;/, 'the planned wide shot replaces the staging close-up');
  assert.match(bare, /^gentle, well-lit close-up shot;/);
  assert.doesNotMatch(bare, /PICTURE PLAN/);
  assert.equal(planned.replace(/ PICTURE PLAN \(decided with the story\)[^\n]*Keep it within the actual event above\./, '').replace(/^wide establishing shot;/, 'gentle, well-lit close-up shot;'), bare, 'the line and the shot are the only differences');
  assert.doesNotMatch(buildScenePrompt({book: bookOf(PLAN), page, pageIndex: 2, snapshot, place: {background: {name: '바닷가'}}, earlierPages: [], cover: true}), /PICTURE PLAN/, 'never on the cover');
  assert.match(picturePlanPictureLine({carrier: 'picture', picture: 'the wave'}), /there are almost no words here, so this picture tells the moment/);
  assert.equal(picturePlanPictureLine(null), '');
  assert.deepEqual(scenePlanText(bookOf(PLAN), page), [PLAN.picture, PLAN.hook, PLAN.words]);
  assert.deepEqual(scenePlanText(bookOf(null), page), []);
  const world = readFileSync(new URL('../dist/image-generation/world.js', import.meta.url), 'utf8');
  assert.match(world, /usesScenePrompt \? sceneBriefText\(book, page\) : null,\n\s+usesScenePrompt && !options\.cover \? scenePlanText\(book, page\) : null,\n\s+\],\n\s+names: bookCastNames/, 'declared in the lenient (model-written) scope');
});

test('R36 shown to the parent: the eco picture prompt they copy carries the plan; eco ③ and the pro beat card show it in Korean; the shell precaches the module', () => {
  const state = setup();
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  const input = normalizeStoryInput(job.input), outline = demoOutline(input), pagination = demoPagination(outline, demoProse(outline, input), input);
  const book = {title: '파도', outline, pagination, pages: pagination.pages, storyInput: input, characterIds: ['yuha', 'greenie'], stylePresetId: state.settings.style};
  const prompt = ecoPicturePrompt(state, book, 0);
  assert.match(prompt, /\nPICTURE PLAN \(decided with the story\): the picture alone shows two tiny friends at the edge of a huge green forest[^\n]*wide view[^\n]*\nThe entry reads/);
  const unplanned = structuredClone(book); unplanned.outline.beats.forEach((b) => delete b.picturePlan);
  assert.doesNotMatch(ecoPicturePrompt(state, unplanned, 0), /PICTURE PLAN/);
  assert.doesNotMatch(ecoPicturePrompt(state, book, 0, {cover: true}), /PICTURE PLAN/);
  // Eco ③ (pages step): the received outline lists each beat's plan.
  job.outline = outline; job.eco.step = 'pages';
  const stateWithJob = {...state, fullAutoJobs: {...state.fullAutoJobs, [job.id]: job}};
  const w = ensureSimpleWizard(stateWithJob, {...wizardOf({simpleFlow: true}), step: 3, simpleStep: 3, simpleJobId: job.id});
  const html = renderSimpleCreate({getState: () => stateWithJob, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
  assert.equal((html.match(/class="simple-plan-note">그림 계획 · /g) || []).length, 8);
  assert.match(html, /그림 계획 · 그림이 말해요 \/ 그림 · the lunch box wedged in the rock[^<]*\/ 가까이 · 여백 많이 · 펼침면 한 장/);
  // The pro beat card.
  const card = renderStoryBeatCard({outline, input}, 0);
  assert.match(card, /<p class="story-note story-plan-note">그림 계획 · 글과 그림이 함께 \/ 그림 · two tiny friends[^<]*\/ 멀리서 · 여백 많이 · 펼침면 한 장<\/p>/);
  const bareOutline = structuredClone(outline); bareOutline.beats.forEach((b) => delete b.picturePlan);
  assert.doesNotMatch(renderStoryBeatCard({outline: bareOutline, input}, 0), /그림 계획/);
  assert.equal(picturePlanNote(null), '');
  assert.equal(planOf(outline, 6).carrier, 'picture', 'the turn is told by its picture');
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v(?:8[2-9]|9[0-9])";/, 'v82 or later');
  assert.match(sw, /"\.\/story-generation\/picture-plan\.js",/);
});
