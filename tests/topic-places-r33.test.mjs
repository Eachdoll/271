import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, inspectOutlineRules, preflightOutlineLocations, generateOutline, generateMaterialPlan} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanPaginationRules, leanOpeningsPaginationRules} from '../dist/story-generation/prompt-diet.js';
import {craftOutlineRules} from '../dist/story-generation/craft-rules.js';
import {conditionBlock} from '../dist/story-generation/council.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {hardOutlineViolations, SOFT_OUTLINE_CODES} from '../dist/story-generation/schemas.js';
import {topicPlaceIds, topicPlaceNames, missingTopicPlaces, placeKeywords} from '../dist/story-generation/topic-places.js';
import {createFullAutoJob, selectionMaterialPlan} from '../dist/full-auto.js';
import {inspectAutoMaterialPlan} from '../dist/story-generation/auto-materials.js';
import {recommendPlaces, simpleStepAccess, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {selectableBeatBackgrounds} from '../dist/story-generation/ui.js';
import {ecoOutlinePrompt, ecoJobInit} from '../dist/eco-mode.js';

/**
 * 2026-10-23 R33-1 장소는 주제대로. A beach story used to open at home and
 * detour through a garden and a forest because the rules demanded a home
 * start and two different middle places, the drawer had to hold a home plus
 * two places, and the selection plan filled missing places in drawer order.
 * On the diet the story now goes where the topic puts it; drafts without the
 * policy keep every old rule.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const beachWizard = (extra = {}) => ({characterIds: ['yuha'], backgroundIds: ['beach'], topic: '유하가 바닷가에서 조개를 찾아요', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true, ...extra});
const legacy = (input) => { const copy = structuredClone(input); delete copy.promptDiet; return copy; };
/** A beach-only outline for the input's beats: every beat at the beach. */
function beachOutline(input) {
  const outline = demoOutline(input);
  for (const beat of outline.beats) beat.settingKey = 'beach';
  outline.settings = outline.beats.map(b => ({beatIndex: b.index, backgroundId: 'beach'}));
  return outline;
}

test('R33 the topic names its drawer places; the simple screen and the rules use the same scorer', () => {
  const state = setup(), backgrounds = state.backgrounds;
  assert.deepEqual(topicPlaceIds('유하가 바닷가에서 조개를 찾아요', backgrounds), ['beach']);
  assert.deepEqual(topicPlaceNames('유하가 바닷가에서 조개를 찾아요', backgrounds), ['조개빛 바닷가']);
  assert.deepEqual(recommendPlaces('유하가 바닷가에서 조개를 찾아요', backgrounds), ['beach']);
  assert.deepEqual(topicPlaceIds('비 오는 날 숲 산책', backgrounds), ['forest', 'garden']);
  assert.deepEqual(topicPlaceIds('유하가 유치원에 가요', backgrounds), [], 'no kindergarten in the seed drawer');
  assert.deepEqual(missingTopicPlaces('유하가 유치원에 가요', backgrounds), ['유치원·학교']);
  assert.deepEqual(missingTopicPlaces('유하가 바닷가에서 조개를 찾아요', backgrounds), []);
  assert.ok(placeKeywords(backgrounds.find(b => b.id === 'beach')).includes('조개'));
});

test('R33 a diet beach story needs no home and no second place; a home ending still needs a home; legacy drafts keep home plus two', () => {
  const state = setup();
  const {input} = inputFromWizard(state, beachWizard());
  assert.equal(input.promptDiet?.version, 1);
  assert.equal(input.endingType, 'custom', 'simple mode ends where the topic goes');
  const beachOnly = normalizeStoryInput({...input, backgrounds: input.backgrounds.filter(b => b.id === 'beach')});
  assert.equal(preflightOutlineLocations(beachOnly).valid, true, preflightOutlineLocations(beachOnly).errors.join(' / '));
  const homeEnding = normalizeStoryInput({...beachOnly, endingType: 'home_sleep', endingNote: ''});
  assert.match(preflightOutlineLocations(homeEnding).errors.join(' '), /집·방 배경이 필요/);
  assert.match(preflightOutlineLocations(normalizeStoryInput({...beachOnly, backgrounds: []})).errors.join(' '), /1곳 이상/);
  const old = preflightOutlineLocations(legacy(beachOnly));
  assert.equal(old.valid, false);
  assert.match(old.errors.join(' '), /집·방 배경을 배경 서랍에/);
  assert.match(old.errors.join(' '), /2곳 이상/);
});

test('R33 the outline rules say the story opens where the topic puts it; no visiting quota, no home-first; the pagination scene line names the settingKey', () => {
  const state = setup();
  const input = normalizeStoryInput(inputFromWizard(state, beachWizard()).input);
  const rules = leanOutlineRules(input, {count: 6, attempts: 1, custom: true});
  assert.match(rules, /The story happens where the topic puts it — here 조개빛 바닷가/);
  assert.match(rules, /a home ID only when the topic begins at home or names no place/);
  assert.match(rules, /never to show every place in the drawer/);
  assert.doesNotMatch(rules, /first beat uses a home ID|two or more different ones/);
  const homeEnd = leanOutlineRules(input, {count: 6, attempts: 1, custom: false});
  assert.match(homeEnd, /The last beat ends at a home ID/);
  const many = normalizeStoryInput({...input, backgrounds: [...input.backgrounds, {id: 'p1', name: '장소1', type: 'park'}, {id: 'p2', name: '장소2', type: 'cave'}, {id: 'p3', name: '장소3', type: 'farm'}], preferredBackgroundIds: ['home', 'beach', 'p1', 'p2', 'p3']});
  assert.doesNotMatch(craftOutlineRules(many), /let the story visit/, 'no place-visiting quota on the diet');
  assert.match(craftOutlineRules(legacy(many)), /PLACES \(\d+ non-home locations supplied\)/, 'legacy drafts keep it');
  assert.match(leanPaginationRules(input, {custom: true}), /its settingKey\)/);
  assert.match(leanOpeningsPaginationRules(input, {cues: ['highlight'], custom: false}), /its settingKey; a home ID at the end\)/);
  assert.match(conditionBlock(input).join('\n'), /이야기가 향하는 곳에서 시작하고 필요한 곳만 간다/);
  assert.match(conditionBlock(legacy(input)).join('\n'), /처음은 집/);
});

test('R33 the outline check accepts a beach-only outline on the diet, notes a topic place the outline skips, and still flags the legacy rules off the diet', () => {
  const state = setup();
  const input = normalizeStoryInput(inputFromWizard(state, beachWizard({backgroundIds: ['home', 'beach']})).input);
  const outline = beachOutline(input);
  const report = inspectOutlineRules(outline, input);
  const codes = report.violations.map(v => v.code);
  assert.ok(!codes.includes('home_start_end'), codes.join(','));
  assert.ok(!codes.includes('middle_locations'), codes.join(','));
  assert.equal(hardOutlineViolations(report).length, 0);
  // Away from the topic's place: a note, never a stop.
  const elsewhere = structuredClone(outline);
  for (const beat of elsewhere.beats) beat.settingKey = 'home';
  elsewhere.settings = elsewhere.beats.map(b => ({beatIndex: b.index, backgroundId: 'home'}));
  const noted = inspectOutlineRules(elsewhere, input);
  assert.ok(noted.violations.some(v => v.code === 'topic_place' && /조개빛 바닷가/.test(v.message)));
  assert.ok(SOFT_OUTLINE_CODES.has('topic_place'));
  assert.equal(hardOutlineViolations(noted).length, 0);
  // A home ending on the diet still wants the last beat at home.
  const homeEnding = normalizeStoryInput({...input, endingType: 'home_sleep', endingNote: ''});
  assert.ok(inspectOutlineRules({...outline, endingType: 'home_sleep'}, homeEnding).violations.some(v => v.code === 'home_start_end' && /마무리 비트/.test(v.message)));
  // Off the diet the old rules stand.
  const old = inspectOutlineRules(outline, legacy(input)).violations.map(v => v.code);
  assert.ok(old.includes('home_start_end') && old.includes('middle_locations'), old.join(','));
  // The pro beat chips: every drawer place is usual on the diet; legacy keeps home at the ends.
  assert.deepEqual(selectableBeatBackgrounds(input, 0, 6).map(b => b.id), input.backgrounds.map(b => b.id), 'every drawer place on the diet');
  assert.deepEqual(selectableBeatBackgrounds(legacy(input), 0, 6).map(b => b.id), ['home']);
});

test('R33 a paid outline is not bought again for a home start or a single middle place; the request carries the new place line', async () => {
  const state = setup();
  const input = inputFromWizard(state, beachWizard({backgroundIds: ['home', 'beach']})).input;
  delete input.councilPolicy; delete input.orchestrationPolicy;
  const calls = [];
  const engine = {id: 'openai', async complete(request) { calls.push(request); return {json: beachOutline(normalizeStoryInput(input)), usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
  const result = await generateOutline(input, {engine});
  assert.equal(calls.length, 1, 'one outline, no repair for the place rules');
  assert.equal(result.meta.repairAttempts, 0);
  assert.match(calls[0].system, /The story happens where the topic puts it — here 조개빛 바닷가/);
  assert.ok(result.data.settings.every(s => s.backgroundId === 'beach'));
});

test('R33 the selection plan keeps the parent\'s picks; nothing picked takes the topic\'s places, else the home; the demo still fills home plus two', () => {
  const state = setup();
  const picked = selectionMaterialPlan(state, {characterIds: ['yuha'], backgroundIds: ['beach'], topic: '유하가 바닷가에서 조개를 찾아요'}, {lean: true});
  assert.deepEqual(picked.plan.reuseBackgroundIds, ['beach']);
  assert.deepEqual(picked.filledBackgroundIds, []);
  const topicFill = selectionMaterialPlan(state, {characterIds: ['yuha'], backgroundIds: [], topic: '비 오는 날 숲 산책'}, {lean: true});
  assert.deepEqual(topicFill.plan.reuseBackgroundIds, ['forest', 'garden']);
  const homeFill = selectionMaterialPlan(state, {characterIds: ['yuha'], backgroundIds: [], topic: '유하가 유치원에 가요'}, {lean: true});
  assert.deepEqual(homeFill.plan.reuseBackgroundIds, ['home']);
  assert.throws(() => selectionMaterialPlan({...state, backgrounds: []}, {characterIds: ['yuha'], backgroundIds: [], topic: 'x'}, {lean: true}), /1곳 이상/);
  const demo = selectionMaterialPlan(state, {characterIds: ['yuha'], backgroundIds: ['moon'], topic: '달'});
  assert.deepEqual(demo.plan.reuseBackgroundIds, ['moon', 'home', 'forest'], 'legacy fill in drawer order');
  const catalog = {characters: state.characters, backgrounds: state.backgrounds, pinnedCharacterIds: ['yuha'], allowNew: false};
  const plan = {reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['beach'], newBackgrounds: [], reason: 'x'};
  assert.equal(inspectAutoMaterialPlan(plan, {...catalog, lean: true}).valid, true);
  assert.match(inspectAutoMaterialPlan(plan, catalog).errors.join(' '), /집·방/);
  assert.match(inspectAutoMaterialPlan({...plan, reuseBackgroundIds: []}, {...catalog, lean: true}).errors.join(' '), /1곳 이상/);
  // A new paid job (selection mode) carries only the picked place.
  const job = createFullAutoJob(state, beachWizard(), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false});
  assert.deepEqual(job.input.preferredBackgroundIds, ['beach']);
});

test('R33 the paid material planner is asked for the places the story needs, never a home plus two, on the diet', async () => {
  const state = setup();
  const input = inputFromWizard(state, beachWizard({backgroundIds: ['beach']})).input;
  const calls = [];
  const engine = {id: 'openai', async complete(request) { calls.push(request); return {json: {reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['beach'], newBackgrounds: [], reason: '바닷가면 충분해요.'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
  const result = await generateMaterialPlan(input, {characters: state.characters, backgrounds: state.backgrounds, allowNew: true}, {engine});
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, /Select the places this story needs/);
  assert.doesNotMatch(calls[0].system, /plus TWO DISTINCT non-home story locations|Choose non-home locations that differ/);
  assert.equal(inspectAutoMaterialPlan(result.data, {characters: state.characters, backgrounds: state.backgrounds, pinnedCharacterIds: ['yuha'], allowNew: true, lean: true}).valid, true);
  const legacyCalls = [];
  const legacyEngine = {id: 'openai', async complete(request) { legacyCalls.push(request); return {json: {reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['home', 'beach', 'forest'], newBackgrounds: [], reason: 'x'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
  await generateMaterialPlan(legacy(input), {characters: state.characters, backgrounds: state.backgrounds, allowNew: true}, {engine: legacyEngine});
  assert.match(legacyCalls[0].system, /plus TWO DISTINCT non-home story locations/);
});

test('R33 the simple screen: one place is enough with 자동 추가 off, ② names a topic place the drawer lacks, and the eco request opens at the topic\'s place', () => {
  const state = setup();
  const rows = (w) => simpleStepAccess(state, ensureSimpleWizard(state, {...w, step: 1, simpleStep: 1}));
  const one = {characterIds: ['yuha'], backgroundIds: ['beach'], topic: '유하가 바닷가에서 조개를 찾아요', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', allowNew: false, simplePicksTouched: true};
  assert.equal(rows(one)[2].reachable, true);
  const none = {...one, backgroundIds: []};
  assert.equal(rows(none)[2].reachable, false);
  assert.match(rows(none)[2].reason, /장소를 1곳 이상/);
  const w = ensureSimpleWizard(state, {...one, topic: '유하가 유치원에 가요', step: 2, simpleStep: 2});
  const html = renderSimpleCreate({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
  assert.match(html, /주제의 장소\(유치원·학교\)가 재료 서랍에 없어요/);
  assert.match(html, /주제가 향하는 곳 위주로 1~5곳/);
  const job = ecoJobInit(createFullAutoJob(state, beachWizard(), {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  const prompt = ecoOutlinePrompt(job.input);
  assert.match(prompt, /here 조개빛 바닷가/);
  assert.doesNotMatch(prompt, /first beat uses a home ID/);
});
