import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {normalizeStoryInput, generateMaterialPlan} from '../dist/story-generation/pipeline.js';
import {craftOutlineRules, castSpreadRule, placeSpreadRule} from '../dist/story-generation/craft-rules.js';
import {inspectAutoMaterialPlan, MAX_CAST} from '../dist/story-generation/auto-materials.js';
import {SIMPLE_MATERIAL_LIMITS, preselectMaterials, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';

/**
 * 2026-10-20 "다양성이 부족한 것 같아": the parent could pick only two friends
 * and two places in the simple steps, the planner was told to add only what
 * the topic strictly needed (so it added nothing), and no rule asked the
 * outline to use every companion. New drafts (craft policy) get the rules;
 * legacy drafts send the same bytes.
 */
const cast = (n) => [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, ...Array.from({length: n}, (_, i) => ({id: `c${i}`, name: `친구${i}`, nameEn: `Friend${i}`}))];
const places = (n) => [{id: 'home', name: '집', type: 'home'}, ...Array.from({length: n}, (_, i) => ({id: `p${i}`, name: `장소${i}`}))];
function inputFor({companions = 1, locations = 2, pageCount = 12, policy = true} = {}) {
  return normalizeStoryInput({bookId: 'variety', characters: cast(companions), backgrounds: places(locations), topic: '달에 놀러 간 날', pageCount, endingType: 'home_sleep', language: 'bilingual', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, ...(policy ? {craftPolicy: {version: 1}} : {})});
}

test('the outline asks for every companion to take part and, with three or more places, for three distinct middle places', () => {
  const rules = craftOutlineRules(inputFor({companions: 3, locations: 3}));
  assert.match(rules, /CAST \(3 companions supplied\): every companion is listed in beat\.characters of at least two beats/);
  assert.match(rules, /some join on the way, one may wait at home/);
  assert.match(rules, /PLACES \(3 non-home locations supplied\): the middle beats visit at least 3 distinct/);
  assert.match(craftOutlineRules(inputFor({companions: 1, locations: 2})), /CAST \(1 companion supplied\)/);
  assert.doesNotMatch(craftOutlineRules(inputFor({companions: 1, locations: 2})), /PLACES|wait at home/);
  assert.match(placeSpreadRule(inputFor({locations: 5, pageCount: 16})), /at least 4 distinct/);
  assert.match(placeSpreadRule(inputFor({locations: 5, pageCount: 12})), /at least 3 distinct/);
  assert.equal(castSpreadRule(inputFor({companions: 0})), '');
  assert.equal(craftOutlineRules(inputFor({companions: 3, locations: 3, policy: false})), '', 'legacy drafts: no craft rules at all');
});

test('the planner may plan seven and, for new drafts with 자동 추가 on, is asked to add what the topic calls for', async () => {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const plan = {reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['home', ...state.backgrounds.filter(b => b.id !== 'home').slice(0, 2).map(b => b.id)], newBackgrounds: [], reason: '고른 재료로 충분해요.'};
  const run = async (input, allowNew) => {
    const engine = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); return {json: structuredClone(plan), usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
    await generateMaterialPlan(input, {characters: state.characters, backgrounds: state.backgrounds, allowNew}, {engine});
    return engine.calls[0].system;
  };
  const fresh = await run(inputFor({companions: 1}), true);
  assert.match(fresh, /total cast including pinned characters maximum SEVEN/);
  assert.match(fresh, /VARIETY: when the drawer has no companion or place that the topic clearly calls for/);
  const existingOnly = await run(inputFor({companions: 1}), false);
  assert.match(existingOnly, /maximum SEVEN/);
  assert.doesNotMatch(existingOnly, /VARIETY/);
  const legacy = await run(inputFor({companions: 1, policy: false}), true);
  assert.match(legacy, /total cast including pinned characters maximum FIVE/);
  assert.doesNotMatch(legacy, /VARIETY/);
  // The check behind the planner: seven in all, never eight.
  const catalog = {characters: cast(6), backgrounds: places(3), pinnedCharacterIds: ['yuha']};
  const seven = {...plan, reuseCharacterIds: ['c0', 'c1', 'c2', 'c3'], newCharacters: [{name: '달토끼', nameEn: 'Moon Rabbit', kind: 'rabbit', description: '크림색 털', traits: ['호기심'], catchphrase: '달이다!', color: '#e0d4b0'}, {name: '별벌레', nameEn: 'Star Bug', kind: 'bug', description: '반짝이는 등', traits: ['수줍음'], catchphrase: '반짝!', color: '#ffd700'}], reuseBackgroundIds: ['home', 'p0', 'p1']};
  assert.equal(MAX_CAST, 7);
  assert.equal(inspectAutoMaterialPlan(seven, catalog).valid, true, inspectAutoMaterialPlan(seven, catalog).errors.join(' / '));
  const eight = {...seven, reuseCharacterIds: ['c0', 'c1', 'c2', 'c3', 'c4']};
  assert.match(inspectAutoMaterialPlan(eight, catalog).errors.join(' '), /7명 이하/);
});

test('the simple steps allow six friends and four places but still preselect two of each', () => {
  assert.deepEqual(SIMPLE_MATERIAL_LIMITS, {friends: 6, places: 5, preselectFriends: 2, preselectPlaces: 2});
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  for (let i = 0; i < 6; i++) state.characters.push({id: `extra-${i}`, name: `친구${i}`, nameEn: `Friend${i}`, kind: 'rabbit', likes: '달'});
  for (let i = 0; i < 4; i++) state.backgrounds.push({id: `extra-place-${i}`, name: `달 언덕 ${i}`, nameEn: `Moon Hill ${i}`, type: 'space'});
  const wizard = preselectMaterials(state, {characterIds: ['yuha'], backgroundIds: [], topic: '달 토끼와 놀러 간 날', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true});
  assert.ok(wizard.characterIds.length - 1 <= 2, 'two friends preselected at most');
  assert.ok(wizard.backgroundIds.length <= 3, 'home and two places preselected at most');
  const w = ensureSimpleWizard(state, {...wizard, step: 2, simpleStep: 2});
  const html = renderSimpleCreate({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
  assert.match(html, /친구는 6명까지, 장소는 집과 다른 장소 2~4곳을 골라요/);
  assert.match(html, /최대 6명/);
  assert.match(html, /집 1곳 \+ 다른 장소 2~4곳/);
  assert.match(html, /서랍에 저장돼 다음 이야기에도 쓸 수 있어요/);
});
