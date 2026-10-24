import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, draftStageFor} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateMaterialPlan} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {directionLine} from '../dist/story-generation/council.js';
import {resolveStoryWorld} from '../dist/story-generation/quality-adapter.js';
import {normalizeStoryQualitySettings} from '../dist/text-generation/settings-ui.js';
import {STAGE_CATEGORIES, STAGE_OPTIONS, stageById, worldStageId, stageWorlds, stageFromTopic, stageFor, stagePlaceIds, stageMissing, stageRule, stageDirection, stagePlanLine} from '../dist/story-generation/stage-categories.js';
import {configureStoryQualityUI, renderQualityWorldSelectors, renderStoryQualitySettings, cleanupStoryQualityUI} from '../dist/story-generation/quality-settings.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoOutlinePrompt, ecoJobInit} from '../dist/eco-mode.js';
import {renderSimpleCreate, ensureSimpleWizard, preselectMaterials} from '../dist/simple-create.js';

/**
 * 2026-10-23 R33-3 무대 큰 카테고리. The stage used to be one of 100 world
 * cards or nothing; now ten categories (집·동네, 도시·거리, 시장·축제·골목,
 * 자연 · 바다, 자연 · 산·숲, 자연 · 들판·강·호수, 눈·얼음·사막, 하늘·우주, 옛날,
 * 상상 나라) sit above the cards. A pick (or the chosen card, or the topic)
 * is frozen in the input, carried as one STAGE line of the lean outline
 * request, heard by the writers' room, and ② recommends the drawer places
 * that fit it. Drafts without the diet are byte-identical (R12 pins).
 */
const worldLibrary = JSON.parse(await readFile(new URL('../dist/story-quality/data/worlds.json', import.meta.url), 'utf8'));
const plotPatterns = JSON.parse(await readFile(new URL('../dist/story-quality/data/plot_patterns.json', import.meta.url), 'utf8'));
const qualityData = {worldLibrary, plotPatterns, goldBooks: [], inventories: {twistTypes: []}};
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha'], backgroundIds: ['home', 'beach'], topic: '유하가 바닷가에서 조개를 찾아요', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const legacy = (input) => { const copy = structuredClone(input); delete copy.promptDiet; return copy; };
const field = (html, id) => html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1] || '';

test('R33 ten categories cover the 100 world cards exactly once; a topic names its category', () => {
  assert.equal(STAGE_CATEGORIES.length, 10);
  assert.equal(STAGE_OPTIONS.length, 11);
  const mapped = STAGE_CATEGORIES.flatMap(c => c.worldIds);
  assert.equal(mapped.length, 100);
  assert.equal(new Set(mapped).size, 100);
  for (const world of worldLibrary.worlds) assert.ok(worldStageId(world.id), `${world.id} has a category`);
  for (const id of mapped) assert.ok(worldLibrary.worlds.some(w => w.id === id), `${id} is a real card`);
  assert.equal(worldStageId('jeju_sea'), 'nature_sea');
  assert.equal(worldStageId('drawer'), null);
  assert.equal(stageWorlds('nature_sea', worldLibrary.worlds).length, 9);
  assert.equal(stageWorlds('auto', worldLibrary.worlds).length, 100);
  for (const [topic, id] of [['유하가 바닷가에서 조개를 찾아요', 'nature_sea'], ['비 오는 날 숲 산책', 'nature_mountain'], ['달에 놀러 간 날', 'sky_space'], ['눈 오는 날 눈사람 만들기', 'snow_desert'], ['시장에 심부름 가요', 'market_festival'], ['버스를 타고 도시에 가요', 'city'], ['옛날 옛적 공룡 나라', 'long_ago'], ['과자 나라에 간 유하', 'imagination'], ['유하가 유치원에 가요', 'home_town'], ['강가에서 물수제비', 'nature_field']])
    assert.equal(stageFromTopic(topic)?.id, id, topic);
  assert.equal(stageFromTopic('친구의 생일 파티'), null);
  assert.deepEqual(stageFor({pick: 'city', worldId: 'jeju_sea', topic: '바다'}), {version: 1, id: 'city', name: '도시·거리', from: 'pick'});
  assert.deepEqual(stageFor({pick: 'auto', worldId: 'jeju_sea', topic: '도시'}), {version: 1, id: 'nature_sea', name: '자연 · 바다', from: 'world'});
  assert.deepEqual(stageFor({topic: '유하가 바닷가에서'}), {version: 1, id: 'nature_sea', name: '자연 · 바다', from: 'topic'});
  assert.equal(stageFor({topic: '친구의 생일 파티'}), null);
  assert.equal(stageById('nope'), null);
});

test('R33 a new draft freezes its stage: the pick, else the chosen world card\'s category, else the topic; the model\'s JSON never shows it', () => {
  const state = setup();
  const picked = inputFromWizard(state, wizardOf({stageCategoryId: 'city'})).input;
  assert.deepEqual(picked.stageCategory, {version: 1, id: 'city', name: '도시·거리', from: 'pick'});
  assert.equal(picked.storyQuality.stageCategoryId, 'city');
  const fromWorld = inputFromWizard(state, wizardOf({storyWorldId: 'swiss_alps', topic: '유하의 하루'})).input;
  assert.deepEqual(fromWorld.stageCategory, {version: 1, id: 'nature_mountain', name: '자연 · 산·숲', from: 'world'});
  assert.equal('stageCategoryId' in fromWorld.storyQuality, false, 'auto adds no key');
  const fromTopic = inputFromWizard(state, wizardOf()).input;
  assert.equal(fromTopic.stageCategory.from, 'topic');
  assert.equal(fromTopic.stageCategory.id, 'nature_sea');
  const none = inputFromWizard(state, wizardOf({topic: '친구의 생일 파티'})).input;
  assert.equal('stageCategory' in none, false);
  const normalized = normalizeStoryInput(picked);
  assert.deepEqual(normalized.stageCategory, picked.stageCategory);
  assert.equal('stageCategory' in leanVisibleInput(normalized), false);
  assert.deepEqual(draftStageFor(state, {stageCategoryId: 'auto', storyWorldId: 'drawer', topic: '달에 놀러 간 날'}), {version: 1, id: 'sky_space', name: '하늘·우주', from: 'topic'});
  // A settings default is a pick; 자동 stores no key, so older settings normalize as before.
  assert.equal(normalizeStoryQualitySettings({stageCategoryId: 'city'}).stageCategoryId, 'city');
  assert.equal('stageCategoryId' in normalizeStoryQualitySettings({stageCategoryId: 'auto'}), false);
  assert.equal('stageCategoryId' in normalizeStoryQualitySettings({}), false);
  state.settings.storyQuality = {...(state.settings.storyQuality || {}), stageCategoryId: 'imagination'};
  assert.equal(inputFromWizard(state, wizardOf()).input.stageCategory.id, 'imagination');
});

test('R33 the lean outline request carries one STAGE line (the world card\'s own sights when one is chosen); the room and the planner hear it; legacy is silent', async () => {
  const state = setup();
  const input = normalizeStoryInput(inputFromWizard(state, wizardOf({stageCategoryId: 'nature_sea'})).input);
  const rules = leanOutlineRules(input, {count: 6, attempts: 1, custom: false});
  assert.match(rules, /\nSTAGE — 자연 · 바다: The sea — sand, waves, shells, gulls[^\n]*name no real city or country unless the topic does\.\n/);
  assert.equal((rules.match(/STAGE —/g) || []).length, 1);
  const bare = normalizeStoryInput({...input, stageCategory: undefined});
  assert.doesNotMatch(leanOutlineRules(bare, {count: 6, attempts: 1, custom: false}), /STAGE —/);
  const withCard = normalizeStoryInput({...input, storyQuality: {...input.storyQuality, worldId: 'jeju_sea'}});
  withCard.storyWorld = resolveStoryWorld(withCard, qualityData).world;
  const cardRules = leanOutlineRules(withCard, {count: 6, attempts: 1, custom: false});
  assert.match(cardRules, /STAGE — 제주 바다 \(Jeju seaside\): 검은 돌담과 파란 바다 — sights 검은 돌담, 하얀 등대, 귤밭; creatures 작은 게, 소라게, 갈매기; sounds 쏴아, 끼룩\./);
  assert.doesNotMatch(cardRules, /STAGE — 자연 · 바다/);
  assert.equal(stageRule({}), '');
  assert.equal(stageDirection(input), '무대: 자연 · 바다 — 모래·파도·조개·갈매기·등대·바위 웅덩이');
  assert.equal(stageDirection(withCard), '무대: 제주 바다');
  assert.match(directionLine(input), /무대: 자연 · 바다 — 모래·파도·조개·갈매기·등대·바위 웅덩이\. 책 결: 그림책 결 — [^\n]+\.$/);
  assert.doesNotMatch(directionLine(legacy(input)), /무대:/);
  assert.match(stagePlanLine(input), /^ The parent chose the stage "자연 · 바다" \(모래·파도·조개·갈매기·등대·바위 웅덩이\): prefer the supplied places that fit it; when none fits and new places are allowed, create one place there\.$/);
  assert.equal(stagePlanLine({stageCategory: {id: 'nature_sea', from: 'topic'}}), '', 'a topic-guessed stage adds nothing to the planner');
  const calls = [];
  const engine = {id: 'openai', async complete(request) { calls.push(request); return {json: {reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['beach'], newBackgrounds: [], reason: 'x'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
  await generateMaterialPlan(input, {characters: state.characters, backgrounds: state.backgrounds, allowNew: true}, {engine});
  assert.match(calls[0].system, /never add a place only to have more\. The parent chose the stage "자연 · 바다"/);
  const legacyEngine = {id: 'openai', async complete(request) { calls.push(request); return {json: {reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['home', 'beach', 'forest'], newBackgrounds: [], reason: 'x'}, usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
  await generateMaterialPlan(legacy(input), {characters: state.characters, backgrounds: state.backgrounds, allowNew: true}, {engine: legacyEngine});
  assert.doesNotMatch(calls[1].system, /chose the stage/);
});

test('R33 the pro selectors: a stage select narrows the world cards (the chosen card stays), the settings page has the default, the change handler refills the list', () => {
  const state = setup();
  const originalDocument = globalThis.document, handlers = {};
  globalThis.document = {addEventListener: (name, handler) => { handlers[name] = handler; }, querySelector: () => null, querySelectorAll: () => []};
  configureStoryQualityUI({qualityData, getState: () => state, isParent: () => true, save: () => true, render: () => {}, toast: () => {}, setWizardTopic: () => {}});
  try {
    const all = renderQualityWorldSelectors({}, {state});
    assert.equal((field(all, 'stageCategoryId').match(/<option /g) || []).length, 11);
    assert.match(field(all, 'stageCategoryId'), /value="auto" selected/);
    assert.equal((field(all, 'storyWorldId').match(/<option /g) || []).length, 101, '자동: every card');
    const sea = renderQualityWorldSelectors({stageCategoryId: 'nature_sea'}, {state});
    assert.match(field(sea, 'stageCategoryId'), /value="nature_sea" selected/);
    assert.equal((field(sea, 'storyWorldId').match(/<option /g) || []).length, 10, 'drawer + the nine sea cards');
    assert.doesNotMatch(field(sea, 'storyWorldId'), /<optgroup label="과거">/);
    assert.match(field(sea, 'storyWorldId'), /value="drawer" selected/);
    const kept = renderQualityWorldSelectors({stageCategoryId: 'city', storyWorldId: 'jeju_sea'}, {state});
    assert.match(field(kept, 'storyWorldId'), /value="jeju_sea" selected/, 'a chosen card outside the stage stays listed');
    assert.equal((field(kept, 'storyWorldId').match(/<option /g) || []).length, 9, 'drawer + seven city cards + the kept card');
    const settings = renderStoryQualitySettings(state);
    assert.match(settings, /id="quality-default-stageCategoryId"/);
    const worldSelect = {value: 'drawer', innerHTML: ''}, container = {querySelector: () => worldSelect};
    handlers.change({target: {dataset: {qualityWorldField: 'stageCategoryId'}, value: 'sky_space', closest: () => container}});
    assert.equal((worldSelect.innerHTML.match(/<option /g) || []).length, 10, 'drawer + nine sky cards');
    assert.match(worldSelect.innerHTML, /value="moon_base"/);
  } finally {
    cleanupStoryQualityUI();
    globalThis.document = originalDocument;
  }
});

test('R33 the simple screen: ① offers the stage, ② recommends the drawer places that fit it and names a missing one, the eco request carries the STAGE line', () => {
  const state = setup();
  const backgrounds = state.backgrounds;
  assert.deepEqual(stagePlaceIds('nature_sea', backgrounds), ['beach']);
  assert.deepEqual(stagePlaceIds('auto', backgrounds), []);
  assert.equal(stageMissing('city', backgrounds), true);
  assert.equal(stageMissing('nature_sea', backgrounds), false);
  assert.equal(stageMissing('auto', backgrounds), false);
  const ctxOf = (w) => ({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
  const one = ensureSimpleWizard(state, {...wizardOf({topic: '친구의 생일 파티'}), step: 1, simpleStep: 1, simpleFormatOpen: true, stageCategoryId: 'nature_sea'});
  const first = renderSimpleCreate(ctxOf(one));
  assert.equal((field(first, 'stageCategoryId').match(/<option /g) || []).length, 11);
  assert.match(field(first, 'stageCategoryId'), /value="nature_sea" selected/);
  assert.match(first, /<label for="stageCategoryId">무대<\/label>/);
  // ②: a party topic names no place, but the stage recommends the beach.
  const picks = preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '친구의 생일 파티', stageCategoryId: 'nature_sea'});
  assert.deepEqual(picks.backgroundIds, ['home', 'beach']);
  assert.equal(picks.simplePickedFor, '친구의 생일 파티|nature_sea');
  const plain = preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '친구의 생일 파티'});
  assert.deepEqual(plain.backgroundIds, ['home']);
  assert.equal(plain.simplePickedFor, '친구의 생일 파티', 'the key is unchanged without a stage');
  const two = ensureSimpleWizard(state, {...wizardOf({topic: '친구의 생일 파티', backgroundIds: ['home']}), step: 2, simpleStep: 2, stageCategoryId: 'nature_sea', simplePicksTouched: true});
  const second = renderSimpleCreate(ctxOf(two));
  assert.match(second, /data-id="beach"[^>]*>[\s\S]*?<span class="simple-rec">추천<\/span>/);
  assert.doesNotMatch(second, /맞는 장소가 재료 서랍에 없어요/);
  const city = renderSimpleCreate(ctxOf({...two, stageCategoryId: 'city'}));
  assert.match(city, /무대\(도시·거리\)에 맞는 장소가 재료 서랍에 없어요/);
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({stageCategoryId: 'nature_sea', simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.deepEqual(job.input.stageCategory, {version: 1, id: 'nature_sea', name: '자연 · 바다', from: 'pick'});
  assert.match(ecoOutlinePrompt(job.input), /STAGE — 자연 · 바다: The sea/);
});
