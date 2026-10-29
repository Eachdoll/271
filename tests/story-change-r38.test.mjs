import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, sceneReferenceRecords} from '../dist/image-generation/world.js';
import {migrateReadingSettings, bookReadingOptions} from '../dist/reading-ui.js';
import {inputFromWizard, renderStoryQualityPlan} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateProse, inspectOutlineRules, outlineRequestSchema, inspectStory} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanBeatWriterRules, leanProseRules, leanPaginationRules, leanOpeningsPaginationRules, leanVisibleInput, leanOutlineView} from '../dist/story-generation/prompt-diet.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {normalizeOutlineResponse} from '../dist/story-generation/outline-normalize.js';
import {validatePagination, hardOutlineViolations} from '../dist/story-generation/schemas.js';
import {checkStory} from '../dist/story-generation/checker.js';
import {analyzeBook} from '../dist/reading-checker.js';
import {settlePicturePlans, settleShotVariety} from '../dist/story-generation/picture-plan.js';
import {buildScenePrompt, closeViewFor, effectiveStaging} from '../dist/image-generation/scene-prompt.js';
import {pictureLedK1Line} from '../dist/book-format.js';
import {topicEndingNote} from '../dist/story-generation/topic-ending.js';
import {createFullAutoJob, selectionMaterialPlan} from '../dist/full-auto.js';
import {ecoOutlinePrompt, ecoJobInit, ecoAcceptOutline, ecoAcceptPages} from '../dist/eco-mode.js';
import {IDEA_TOPICS, SIMPLE_VALUE_OPTIONS, formatSummary, renderSimpleCreate, ensureSimpleWizard, preselectMaterials} from '../dist/simple-create.js';
import {hasStoryChange, storyChangePolicy, settleStoryChange, storyChangeViolations, storyChangeWriterLine, storyChangeK1Block, storyChangeSummary, storyPlaceRef, isWordlessEntry, wordlessPageIndexes, wordlessRule, pageBookVoiceLine, withWordlessSchema} from '../dist/story-generation/story-change.js';

/**
 * 2026-10-26 R38 달라지는 것·구도·장소·말 없는 쪽. The parent on a finished
 * picture-led book (twelve one-line pages in the same wide living room):
 * "the ending is simple and hard to follow, there is no point, the framing
 * never changes, why does it start at home again?" A new diet draft freezes
 * input.storyChange {version: 1}: its outline must say what is different at
 * the end (change / expectation / ending echo|open) and the writers show it
 * in an action; a planned shot never repeats across more than half the
 * beats; a close view is drawn without the place reference and the request
 * opens with the composition; the ideas carry a place and a want, ① offers
 * 어디서? and a value, a placeless topic no longer opens or ends at home; a
 * picture-led book may leave one middle page without words. Drafts without
 * the marker are unchanged (R12 pins; the R35–R37 tests on undated inputs).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'beach'], topic: '놀이터에서 자꾸 도망가는 그림자 잡기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const draft = (state, extra = {}, layout = 'openings') => normalizeStoryInput({...inputFromWizard(state, wizardOf(extra), {layout}).input, bookId: `c-${Object.keys(extra).join('-') || 'default'}`});
const dated = (input) => { const copy = structuredClone(input); delete copy.storyChange; return copy; };
// R42: a draft frozen before R42 carries storyChange {version: 1} and keeps its one wordless entry; a new draft freezes wordless: false.
const preR42 = (input) => ({...structuredClone(input), storyChange: {version: 1}});
const firstCalls = async (input, outline) => {
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); throw new Error('stop after the first request'); }};
  await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine, cheap: engine}}).catch(() => {});
  return calls;
};
const ctxOf = (state, w) => ({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
const R38_BOOK_INPUT = {promptDiet: {version: 1}, promptPolicy: {version: 1}, storyChange: {version: 1}, bookFormat: {version: 1, id: 'pictureLed'}};

test('R38 the marker: every new diet draft freezes storyChange; the model JSON never shows it or the opening place; a draft without the diet has neither; normalize keeps a drawer place only', () => {
  const state = setup();
  const led = draft(state), wordy = draft(state, {bookFormatId: 'wordy'});
  assert.deepEqual(led.storyChange, storyChangePolicy({wordless: false}));
  assert.deepEqual(wordy.storyChange, storyChangePolicy({wordless: false}), 'the change line is for every diet draft, not only picture-led');
  assert.equal(hasStoryChange(led), true);
  assert.equal(hasStoryChange({storyChange: {version: 1}}), false, 'off the diet nothing reads it');
  assert.equal('storyChange' in leanVisibleInput(led), false);
  const placed = draft(state, {storyPlaceId: 'beach'});
  assert.deepEqual(placed.storyPlace, {version: 1, id: 'beach'});
  assert.equal('storyPlace' in leanVisibleInput(placed), false);
  assert.equal('storyPlace' in draft(state, {storyPlaceId: 'nope'}), false, 'a place outside the drawer is not frozen');
  assert.equal('storyPlace' in draft(state, {storyPlaceId: 'auto'}), false);
  assert.equal(storyPlaceRef({version: 1, id: 'beach'}, led.backgrounds)?.id, 'beach');
  assert.equal(storyPlaceRef({version: 1, id: 'beach'}, []), null);
  assert.equal(normalizeStoryInput({...placed, storyPlace: {version: 1, id: 'nowhere'}}).storyPlace, undefined);
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true, storyPlaceId: 'beach'}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.storyChange, storyChangePolicy({wordless: false}), 'R42: a new job never leaves an entry without words');
  assert.deepEqual(job.input.storyPlace, {version: 1, id: 'beach'});
});

test('R38 the outline contract: the request asks for change, expectation and ending and says what they are; a missing change stops the outline (hard); the fields are cleaned on asked-for drafts and dropped elsewhere; the demo carries them', () => {
  const state = setup(), led = draft(state), old = dated(led);
  const schema = outlineRequestSchema(led);
  assert.ok(['change', 'expectation', 'ending'].every((key) => schema.required.includes(key) && schema.properties[key]));
  assert.deepEqual(schema.properties.ending.enum, ['echo', 'open']);
  assert.ok(!('change' in outlineRequestSchema(old).properties), 'an R37 draft asks for none');
  const rules = leanOutlineRules(led, {count: 8, attempts: 3});
  assert.match(rules, /\nWHAT CHANGES: return change — one sentence, "at first …; by the end …"[^\n]*the last beat shows the change in one action and never says it\. Return ending: "echo"[^\n]*or "open"[^\n]*A story where nothing is different at the end is not finished\.\n/);
  assert.match(rules, /open at a chosen place that is not home; a home ID first only when the topic begins at home or home is the only place chosen/);
  assert.doesNotMatch(leanOutlineRules(old, {count: 8, attempts: 3}), /WHAT CHANGES/);
  assert.match(leanOutlineRules(draft(state, {storyPlaceId: 'beach'}), {count: 8, attempts: 3}), /The story happens where the topic puts it — here Shell Beach|here 조개빛 바닷가/, 'the chosen place leads the Places line');
  // The demo outline carries the three fields on an asked-for draft only.
  const outline = demoOutline(led);
  assert.match(outline.change, /처음엔[^。]*끝에는/);
  assert.equal(outline.ending, 'echo');
  assert.equal('change' in demoOutline(old), false);
  // A model answer without a change line is a hard violation, never a note.
  const missing = structuredClone(outline); delete missing.change;
  const report = inspectOutlineRules(missing, led);
  assert.ok(report.violations.some((v) => v.code === 'change_missing'));
  assert.ok(hardOutlineViolations(report).some((v) => v.code === 'change_missing'));
  assert.equal(inspectOutlineRules(outline, led).violations.some((v) => v.code === 'change_missing'), false);
  assert.deepEqual(storyChangeViolations(missing, old), [], 'nothing is asked of an R37 outline');
  // Clean-up: trimmed values, an unknown ending dropped, nothing kept where nothing was asked.
  const shaped = normalizeOutlineResponse({...outline, change: '  끝에는   달라져요 ', expectation: '', ending: 'Echo '}, led).outline;
  assert.equal(shaped.change, '끝에는 달라져요');
  assert.equal('expectation' in shaped, false);
  assert.equal(shaped.ending, 'echo');
  assert.equal(normalizeOutlineResponse({...outline, ending: 'loop'}, led).outline.ending, undefined);
  const stripped = normalizeOutlineResponse(outline, old).outline;
  assert.ok(!('change' in stripped) && !('expectation' in stripped) && !('ending' in stripped));
  assert.deepEqual(settleStoryChange({change: 'x', ending: 'open'}, old), {});
  // The lean outline view (pagination, eco pages) carries the three fields.
  assert.deepEqual(Object.keys(leanOutlineView(outline)).filter((k) => ['change', 'expectation', 'ending'].includes(k)), ['change', 'expectation', 'ending']);
  // Eco builds the same request and accepts the same outline (a topic the demo outline is about).
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true, topic: '숲에서 노래하는 돌 찾기'}), backgroundIds: ['forest']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.match(ecoOutlinePrompt(job.input), /WHAT CHANGES/);
  assert.match(ecoOutlinePrompt(job.input), /"change"/);
  const ecoOutline = demoOutline(normalizeStoryInput(job.input));
  assert.equal(ecoAcceptOutline(JSON.stringify(ecoOutline), job.input).ok, true);
  const noChange = structuredClone(ecoOutline); delete noChange.change;
  assert.equal(ecoAcceptOutline(JSON.stringify(noChange), job.input).ok, false, 'the eco answer without a change line is refused');
});

test('R38 the writers: the want, the turn and the close beats hear the expectation and what the ending shows; the K1 writer gets the block, the voice line and the wordless page; the page-book voice reaches the beat writer, the app prose and eco; R37 drafts hear nothing of it', async () => {
  const state = setup(), led = draft(state), outline = demoOutline(led);
  const beat = (type) => outline.beats.find((b) => b.type === type);
  assert.match(storyChangeWriterLine(outline, beat('want'), 'ko'), /^\[기대\] 여기서 숲 어딘가에 노래하는 돌이 있을 거예요\./);
  assert.match(storyChangeWriterLine(outline, beat('turn'), 'ko'), /^\[뒤집기\] "숲 어딘가에 노래하는 돌이 있을 거예요\."가 여기서 뒤집혀요\. 아이가 그림에서 먼저 보게, 말은 적게\.$/);
  assert.match(storyChangeWriterLine(outline, beat('close'), 'ko'), /^\[이 책이 끝에서 보여 줄 것\] 처음엔[^\n]*행동 하나로 보여 주고 말로 하지 않아요\. 끝은 첫 장면을 되비추되 하나만 달라져요\.$/);
  assert.match(storyChangeWriterLine({...outline, ending: 'open'}, beat('close'), 'en'), /^\[What the ending shows\][^\n]*in one action, never said\. The ending stays open on a small question or an 'uh-oh'\.$/);
  assert.equal(storyChangeWriterLine(outline, beat('setup'), 'ko'), '');
  assert.equal(storyChangeWriterLine(demoOutline(dated(led)), beat('close'), 'ko'), '', 'no change line, no block');
  assert.match(storyChangeK1Block(outline), /^\[달라지는 것\] 처음엔[^\n]*\/ 처음의 기대: [^\n]*마지막 쪽은 이것을 행동 하나로 보여 주고 말로 하지 않아요\. 끝은 첫 장면을 되비추되 하나만 달라져요\.$/);
  // The beat writer's close beat request carries the block (the whole book's first requests are the setup beat).
  const rules = leanBeatWriterRules(led, outline);
  assert.match(rules.ko, /\n쪽마다 아이가 외치는 말만 두지 않아요: 이야기꾼의 한 줄, 소리말 하나, 올 때마다 한 낱말만 바뀌는 되풀이 줄이 몇 쪽을 맡아요\.$/);
  assert.match(rules.en, / Not every page is the child speaking: let a narrator's line, a sound, or a returning line with one word changed carry some pages\.$/);
  const old = leanBeatWriterRules(dated(led), outline);
  assert.doesNotMatch(old.ko + old.en, /외치는 말만|Not every page/);
  assert.equal(pageBookVoiceLine(draft(state, {bookFormatId: 'wordy'}), 'ko'), '', '글이 많은 책 hears none');
  assert.match(leanProseRules(led), /외치는 말만 두지 않아요/);
  // The K1 writer: the block in the user message, the voice and the wordless line in the system.
  const k1 = draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages');
  assert.match(pictureLedK1Line(preR42(k1)), /\n쪽마다 아이가 외치는 말만 두지 않아요[^\n]*\nNot every page is the child speaking[^\n]*\n말 없는 쪽: 그림이 말하는 비트[^\n]*책에 한 쪽만, 첫 쪽과 마지막 쪽은 아니에요\.$/);
  assert.match(pictureLedK1Line(k1), /Not every page is the child speaking[^\n]*$/, 'R42: a new draft hears the voice line and no wordless line');
  assert.doesNotMatch(pictureLedK1Line(k1), /말 없는 쪽/);
  assert.doesNotMatch(pictureLedK1Line(dated(k1)), /말 없는 쪽|외치는 말만/);
  const k1Calls = await firstCalls(preR42(k1), demoOutline(k1));
  assert.match(k1Calls[0].user, /\n\n\[달라지는 것\] 처음엔/);
  assert.match(k1Calls[0].system, /말 없는 쪽: /);
  // Pagination requests allow the one wordless entry (picture-led R38 drafts only).
  assert.match(leanPaginationRules(preR42(k1)), /\nWORDLESS: one entry in the middle of the book whose beat is told by its picture[^\n]*At most one such entry; never the first or the last\.\n(?:BACKDROP: [^\n]*\n)?(?:COVER: [^\n]*\n)?(?:ENGLISH FOLLOWS KOREAN: [^\n]*\n)?(?:ENTRANCE: [^\n]*\n)?scene\.who/);
  assert.match(leanOpeningsPaginationRules(preR42(led), {cues: ['arrival']}), /\nWORDLESS: /);
  assert.doesNotMatch(leanOpeningsPaginationRules(led, {cues: ['arrival']}) + leanPaginationRules(k1), /WORDLESS/, 'R42: new drafts are not offered a wordless entry');
  assert.equal(wordlessRule(k1), '');
  assert.doesNotMatch(leanPaginationRules(dated(k1)), /WORDLESS/);
  assert.doesNotMatch(leanPaginationRules(draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12, bookFormatId: 'wordy'}, 'pages')), /WORDLESS/);
  assert.equal(wordlessRule(dated(k1)), '');
  // Eco's pages request carries the voice line.
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  const {ecoPagesPrompt} = await import('../dist/eco-mode.js');
  assert.match(ecoPagesPrompt(job.input, demoOutline(normalizeStoryInput(job.input))), /외치는 말만 두지 않아요[^\n]*\nNot every page is the child speaking/);
});

test('R38 the simple-mode ending: a placeless topic ends where it began with one thing changed, never with an added trip home; the old note stays for callers without the flag', () => {
  assert.match(topicEndingNote('그림자와 술래잡기', {change: true}), /주제에 가는 곳이 없으면 이야기가 시작한 곳에서 끝내되 처음과 하나가 달라진 채로 끝내요\. 집으로 돌아가거나 잠드는 장면을 덧붙이지 않아요\.$/);
  assert.match(topicEndingNote('그림자와 술래잡기'), /집에서 편안히 끝내요\.$/);
  const state = setup();
  const job = createFullAutoJob(state, wizardOf({simpleFlow: true, topic: '그림자와 술래잡기'}), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.match(job.input.endingNote, /시작한 곳에서 끝내되/);
  assert.equal(job.input.endingType, 'custom');
});

test('R38 the shot guard: a plan repeated on more than half the beats keeps only the first of each run; three in a row never stay; a varied plan is untouched; an R37 draft keeps every shot', () => {
  const beatsOf = (shots) => shots.map((shot, i) => ({index: i + 1, picturePlan: {version: 1, carrier: 'both', picture: `p${i}`, ...(shot ? {shot} : {})}}));
  const allWide = beatsOf(['wide', 'wide', 'wide', 'wide', 'wide', 'wide', 'wide', 'wide']);
  settleShotVariety(allWide);
  assert.deepEqual(allWide.map((b) => b.picturePlan.shot), ['wide', undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  const runs = beatsOf(['wide', 'wide', 'close', 'wide', 'wide', 'middle', 'wide', 'wide']);
  settleShotVariety(runs);
  assert.deepEqual(runs.map((b) => b.picturePlan.shot), ['wide', undefined, 'close', 'wide', undefined, 'middle', 'wide', undefined], 'six of eight wide: the second of each run goes');
  const triple = beatsOf(['wide', 'close', 'close', 'close', 'middle', 'wide', 'middle', 'close']);
  settleShotVariety(triple);
  assert.deepEqual(triple.map((b) => b.picturePlan.shot), ['wide', 'close', 'close', undefined, 'middle', 'wide', 'middle', 'close'], 'no shot dominates, but three in a row lose the third');
  const varied = beatsOf(['wide', 'close', 'middle', 'wide', 'close', 'middle', 'wide', 'close']);
  settleShotVariety(varied);
  assert.deepEqual(varied.map((b) => b.picturePlan.shot), ['wide', 'close', 'middle', 'wide', 'close', 'middle', 'wide', 'close']);
  // Through settlePicturePlans: the guard is R38-only.
  const state = setup(), led = draft(state);
  const outline = {beats: beatsOf(Array(8).fill('wide'))};
  settlePicturePlans(structuredClone(outline), dated(led));
  const kept = settlePicturePlans(structuredClone(outline), dated(led));
  assert.ok(kept.beats.every((b) => b.picturePlan.shot === 'wide'), 'an R37 draft keeps its twelve wide plans');
  const guarded = settlePicturePlans(structuredClone(outline), led);
  assert.equal(guarded.beats.filter((b) => b.picturePlan.shot).length, 1);
});

test('R38 the picture request: the composition opens the request and carries the plan; a close view of an R38 book is sent and recorded without the place reference and told so; an R37 book is unchanged', () => {
  const snapshot = {characterSheets: [{characterId: 'yuha', characterSnapshot: {nameEn: 'Yuha'}}], backgrounds: [{id: 'home', name: '유하네 집', imageUrl: 'asset:home'}], backgroundReferenceByPage: {2: ['home']}};
  const plan = (shot) => ({version: 1, carrier: 'picture', picture: 'the shadow stretching across the floor', shot, space: 'airy', hook: ''});
  const page = {pageNo: 3, beatIndex: 3, kind: 'page', ko: '', en: '', scene: {where: 'home', action: 'Yuha reaches for the shadow.', timeOfDay: 'day'}, staging: {shot: 'wide'}};
  const bookOf = (input, shot) => ({characterIds: ['yuha'], sceneBriefs: [], storyInput: input, outline: {beats: [{index: 3, picturePlan: plan(shot)}]}});
  const close = bookOf(R38_BOOK_INPUT, 'close'), wide = bookOf(R38_BOOK_INPUT, 'wide'), old = bookOf({promptDiet: {version: 1}, promptPolicy: {version: 1}, bookFormat: {version: 1, id: 'pictureLed'}}, 'close');
  assert.equal(effectiveStaging(close, page).shot, 'closeup');
  assert.equal(closeViewFor(close, page), true);
  assert.equal(closeViewFor(wide, page), false);
  assert.equal(closeViewFor(old, page), false, 'an R37 book keeps its reference on every page');
  assert.equal(closeViewFor(close, page, {cover: true}), false);
  assert.deepEqual(sceneReferenceRecords(snapshot, 2, {closeView: true}).map((r) => r.role), sceneReferenceRecords(snapshot, 2).map((r) => r.role).filter((role) => role !== 'background'), 'only the place reference is left out');
  assert.ok(sceneReferenceRecords(snapshot, 2).some((r) => r.role === 'background'));
  assert.ok(!sceneReferenceRecords(snapshot, 2, {closeView: true}).some((r) => r.role === 'background'));
  const prompt = (book) => buildScenePrompt({book, page, pageIndex: 2, snapshot, place: {background: {name: '유하네 집'}}, earlierPages: []});
  const closePrompt = prompt(close);
  assert.match(closePrompt, /^COMPOSITION FIRST \(decided with the story; it takes precedence over the viewpoint of every reference image\): gentle, well-lit close-up shot\. PICTURE PLAN \(decided with the story\): the picture alone shows the shadow stretching across the floor; there are almost no words here, so this picture tells the moment; close view: faces and hands fill the picture \(gentle, well lit\); lots of quiet empty space around the figures\. Keep it within the actual event above\. Draw this page from this camera — closer, farther, higher or lower than the place reference, but from the same side: what stands on the left of the place stays on the left, nothing is mirrored, and the story's things stay where the earlier pages put them\. gentle, well-lit close-up shot; Yuha on the/);
  assert.match(closePrompt, /\n\nLocation: [^\n]*This is a close view: no place reference image is attached; keep the place's colours, materials and light from these facts, and let the figures fill the frame\. Relight for day\. Style references define rendering only\./);
  assert.doesNotMatch(closePrompt, /approved place sheet/);
  assert.equal((closePrompt.match(/PICTURE PLAN/g) || []).length, 1, 'the plan line moved up, not copied');
  const widePrompt = prompt(wide);
  assert.match(widePrompt, /^COMPOSITION FIRST[^\n]*wide establishing shot\./);
  assert.match(widePrompt, /Location: [^\n]*approved place sheet|Location: [^\n]*place sheet/i);
  const oldPrompt = prompt(old);
  assert.match(oldPrompt, /^gentle, well-lit close-up shot; Yuha on the/);
  assert.doesNotMatch(oldPrompt, /COMPOSITION FIRST|no place reference image/);
  assert.match(oldPrompt, / PICTURE PLAN \(decided with the story\)/);
  assert.doesNotMatch(buildScenePrompt({book: close, page, pageIndex: 2, snapshot, place: {background: {name: '유하네 집'}}, earlierPages: [], cover: true}), /COMPOSITION FIRST/);
});

test('R38 the ideas and ①: every idea names a place and a want; ① offers 어디서? and a value; the format line and the preselects follow them; the selection plan opens at the chosen place; the value reaches the input in Korean', () => {
  assert.equal(IDEA_TOPICS.length, 48);
  const place = /놀이터|공원|바닷가|바다|숲|유치원|시장|도서관|빵집|기차역|동물원|강가|호숫가|언덕|소방서|캠핑장|냉장고|들판|등대|우주|거리|동굴|둥지|꽃밭|텃밭|집|마당|부엌|창가|다락방|밤하늘|구름|정원|달빛/;
  for (const topic of IDEA_TOPICS) assert.match(topic, place, topic);
  assert.equal(IDEA_TOPICS.includes('그림자와 술래잡기'), false);
  const state = setup();
  const w = ensureSimpleWizard(state, {...wizardOf(), step: 1, simpleStep: 1, simpleFormatOpen: true, storyPlaceId: 'beach', value: '용기'});
  const html = renderSimpleCreate(ctxOf(state, w));
  assert.match(html, /<label for="storyPlaceId">어디서\?<\/label><select id="storyPlaceId"><option value="auto" >주제대로 \(자동\)<\/option>[^]*<option value="beach" selected>조개빛 바닷가<\/option>/);
  assert.match(html, /<label for="value">함께 생각할 가치<\/label><select id="value">[^]*<option value="용기" selected>용기<\/option>/);
  assert.equal(SIMPLE_VALUE_OPTIONS[0][0], 'none');
  assert.equal(formatSummary(wizardOf({storyPlaceId: 'beach', value: '용기'}), state.backgrounds), 'K2 · E2 · 16쪽 · 한 쪽에 한글 + 영어 · 조개빛 바닷가에서 · 가치 · 용기');
  assert.equal(formatSummary(wizardOf()), 'K2 · E2 · 16쪽 · 한 쪽에 한글 + 영어', 'nothing chosen, nothing said');
  // ②'s preselect puts the chosen place first and refills when it changes.
  const picked = preselectMaterials(state, {topic: '이가 흔들리기 시작한 날', characterIds: ['yuha'], backgroundIds: [], storyPlaceId: 'forest'});
  assert.deepEqual(picked.backgroundIds.slice(0, 2), ['home', 'forest']);
  const refilled = preselectMaterials(state, {...picked, storyPlaceId: 'beach'});
  assert.ok(refilled.backgroundIds.includes('beach'));
  const plan = selectionMaterialPlan(state, {characterIds: ['yuha'], backgroundIds: [], topic: '이가 흔들리기 시작한 날', storyPlaceId: 'forest'}, {lean: true});
  assert.deepEqual(plan.plan.reuseBackgroundIds, ['forest'], 'the selection plan opens at the chosen place, not at home');
  assert.deepEqual(selectionMaterialPlan(state, {characterIds: ['yuha'], backgroundIds: [], topic: '이가 흔들리기 시작한 날'}, {lean: true}).plan.reuseBackgroundIds, ['home'], 'with no choice and no topic place the home remains the fallback');
  const input = inputFromWizard(state, wizardOf({value: '용기'})).input;
  assert.equal(input.moral, '용기');
  assert.equal(inputFromWizard(state, wizardOf({value: 'none'})).input.moral, '');
});

test('R38 the wordless page: one middle entry of a picture-led R38 book whose beat is told by the picture may be blank — the validator, the generation check and the ④ check all pass it; a second blank page, the first or the last, or an R37 book is a missing text as before', async () => {
  const state = setup();
  // R42: the wordless entry is the pre-R42 contract (a new draft freezes wordless: false — tests/english-mirror-r42).
  const input = preR42(draft(state, {koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, 'pages'));
  const outline = demoOutline(input), prose = demoProse(outline, input), pagination = demoPagination(outline, prose, input);
  outline.beats[2].picturePlan = {version: 1, carrier: 'picture', picture: 'the shadow stretches across the slide'};
  const idx = pagination.pages.findIndex((p) => p.beatIndex === 3);
  const blankAt = (i) => { const copy = structuredClone(pagination); copy.pages[i].textKo = ''; copy.pages[i].textEn = ''; return copy; };
  const wordless = blankAt(idx);
  assert.equal(isWordlessEntry(wordless.pages[idx], idx, wordless.pages, outline, input), true);
  assert.deepEqual([...wordlessPageIndexes(wordless.pages, outline, input)], [idx]);
  assert.deepEqual(validatePagination(wordless, input, outline), {valid: true, errors: []});
  assert.equal(checkStory(outline, wordless, {specs: input.specs, storyInput: input}).passed, true);
  // R38 hotfix (Codex R38 report): the real wrappers — inspectStory (FULL AUTO, pagination repairs) and eco's page accept — pass it too.
  const inspected = inspectStory(outline, wordless, input);
  assert.equal(inspected.passed, true, JSON.stringify(inspected.checks.filter((c) => !c.passed)));
  assert.equal(inspectStory(outline, wordless, dated(input)).passed, false, 'an R37 draft still needs text on every page through the wrapper');
  const ecoJob = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true, koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12, topic: '숲에서 노래하는 돌 찾기'}), backgroundIds: ['forest']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  // R42: eco's job input is a new draft (wordless: false); the wordless entry below is the pre-R42 behaviour.
  ecoJob.input = preR42(ecoJob.input);
  const ecoInputN = normalizeStoryInput(ecoJob.input), ecoOutline = demoOutline(ecoInputN);
  const ecoPages = demoPagination(ecoOutline, demoProse(ecoOutline, ecoInputN), ecoInputN);
  ecoOutline.beats[2].picturePlan = {version: 1, carrier: 'picture', picture: 'the stones in a row, one humming'};
  const ecoIdx = ecoPages.pages.findIndex((p) => p.beatIndex === 3);
  ecoPages.pages[ecoIdx].textKo = ''; ecoPages.pages[ecoIdx].textEn = '';
  const accepted = ecoAcceptPages(JSON.stringify(ecoPages), ecoOutline, ecoJob.input, {bookId: 'eco-wordless'});
  assert.equal(accepted.ok, true, JSON.stringify(accepted.errors || accepted.findings));
  assert.equal(accepted.pagination.pages[ecoIdx].textKo, '');
  // The ④ check (reading-ui's options) skips the entry; without the option the empty page fails as before.
  const book = {pages: wordless.pages.map((p) => ({...p, ko: p.textKo, en: p.textEn})), outline, storyInput: input};
  const options = bookReadingOptions(book, {allowedNames: [], storyWords: [], specs: input.specs}, {characters: input.characters});
  assert.deepEqual([...options.wordlessPages], [idx]);
  const result = await analyzeBook(book, input.specs, options);
  assert.ok(result.pages[idx].wordless && result.pages[idx].passed);
  assert.ok(!result.violations.some((v) => v.pageIndex === idx));
  const plain = await analyzeBook(book, input.specs, {...options, wordlessPages: null});
  assert.ok(plain.violations.some((v) => v.pageIndex === idx), 'the option is what spares it');
  // Not wordless: a beat told by words, a second blank page, the first and the last page, an R37 book.
  const wordy = structuredClone(outline); wordy.beats[2].picturePlan = {version: 1, carrier: 'words', words: '말'};
  assert.equal(validatePagination(wordless, input, wordy).valid, false);
  const twice = blankAt(idx); twice.pages[idx + 1].textKo = ''; twice.pages[idx + 1].textEn = '';
  assert.equal(isWordlessEntry(twice.pages[idx], idx, twice.pages, outline, input), true);
  assert.equal(isWordlessEntry(twice.pages[idx + 1], idx + 1, twice.pages, outline, input), false);
  assert.equal(validatePagination(twice, input, outline).valid, false);
  for (const i of [0, pagination.pages.length - 1]) {
    const edge = structuredClone(outline); edge.beats.find((b) => b.index === pagination.pages[i].beatIndex).picturePlan = {version: 1, carrier: 'picture', picture: 'x'};
    assert.equal(validatePagination(blankAt(i), input, edge).valid, false, `page ${i + 1} is never wordless`);
  }
  assert.equal(validatePagination(wordless, dated(input), outline).valid, false, 'an R37 draft needs text on every page');
  assert.equal(checkStory(outline, wordless, {specs: input.specs, storyInput: dated(input)}).passed, false);
  // The request schema lets the text be empty on R38 picture-led drafts only.
  const schema = withWordlessSchema({properties: {pages: {items: {properties: {textKo: {type: 'string', minLength: 1}, textEn: {type: 'string', minLength: 1}}}}}}, input);
  assert.equal(schema.properties.pages.items.properties.textKo.minLength, 0);
  assert.equal(withWordlessSchema({properties: {pages: {items: {properties: {textKo: {type: 'string', minLength: 1}}}}}}, dated(input)).properties.pages.items.properties.textKo.minLength, 1);
});

test('R38 the screens and the shell: ③, the eco outline and the pro card say what changes; the shell precaches the module', () => {
  const state = setup(), input = draft(state);
  const outline = demoOutline(input); outline.storyShape = structuredClone(input.storyShape);
  assert.equal(storyChangeSummary(outline), `달라지는 것 · ${outline.change} (되비추는 끝)`);
  assert.equal(storyChangeSummary({...outline, ending: 'open'}), `달라지는 것 · ${outline.change} (열린 끝)`);
  assert.equal(storyChangeSummary(demoOutline(dated(input))), '');
  assert.match(renderStoryQualityPlan({outline, input}), /<br>달라지는 것 · 처음엔[^<]+(?:<br>시도 · [^<]+)?<\/p>/);
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  job.outline = demoOutline(normalizeStoryInput(job.input)); job.eco.step = 'pages';
  const withJob = {...state, fullAutoJobs: {...state.fullAutoJobs, [job.id]: job}};
  const w = ensureSimpleWizard(withJob, {...wizardOf({simpleFlow: true}), step: 3, simpleStep: 3, simpleJobId: job.id, simplePicksTouched: true});
  const html = renderSimpleCreate(ctxOf(withJob, w));
  assert.match(html, / · 달라지는 것 · 처음엔/);
  assert.match(html, /<small class="simple-plan-note">달라지는 것 · 처음엔[^<]+<\/small>/);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v(?:8[5-9]|9[0-9])";/);
  assert.match(sw, /"\.\/story-generation\/story-change\.js",/);
});
