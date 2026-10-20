import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract, plotContractRules} from '../dist/story-generation/plot-contract.js';
import {normalizeStoryInput, generateOutline, inspectOutlineRules, customEnding, endingRuleLine, paginateStory} from '../dist/story-generation/pipeline.js';
import {validateOutline} from '../dist/story-generation/schemas.js';
import {normalizeOutlineResponse} from '../dist/story-generation/outline-normalize.js';
import {endingCanonBlock} from '../dist/story-generation/quality-adapter.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';

/**
 * 2026-10-20 "이야기 끝맺음을 직접 입력했는데도 집으로 돌아오는 이야기가 돼":
 * a typed ending was sent as endingType home_sleep plus a note, and every
 * rule (outline, contract, pagination, the quality template) asked for a
 * return home; the quality path never saw the note at all. A typed ending is
 * now endingType "custom": the start is home, the end is wherever the parent
 * put it. Drafts without a typed ending send the same bytes as before.
 */
const NOTE = '바닷가에서 친구들과 조개를 나눠 들고 노래하며 끝나요';
function baseInput(extra = {}) {
  return {bookId: 'ending', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'toto', name: '토토', nameEn: 'Toto'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'beach', name: '바닷가', type: 'sea'}], topic: '바닷가 조개 줍기', pageCount: 12, language: 'bilingual', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, ...extra};
}
const fake = (answer) => ({id: 'openai', calls: [], async complete(req) { this.calls.push(req); return {json: await answer(req, this.calls.length), usage: {input: 1, output: 1}, meta: {requests: 1}}; }});

test('the pro wizard turns a typed ending into endingType custom; an empty one still means home', () => {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '바닷가 조개 줍기', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'custom', endingCustom: NOTE, language: 'bilingual'};
  const custom = inputFromWizard(state, wizard).input;
  assert.equal(custom.endingType, 'custom');
  assert.equal(custom.endingNote, NOTE);
  assert.equal(customEnding(custom), true);
  assert.equal(inputFromWizard(state, {...wizard, endingCustom: '  '}).input.endingType, 'home_sleep');
  assert.equal(inputFromWizard(state, {...wizard, ending: 'home'}).input.endingType, 'home_sleep');
  assert.equal(inputFromWizard(state, {...wizard, ending: 'open'}).input.endingType, 'open');
  const normalized = normalizeStoryInput(baseInput({endingType: 'custom', endingNote: NOTE}));
  assert.equal(normalized.endingType, 'custom');
  assert.equal(normalizeStoryInput(baseInput({endingType: 'weird'})).endingType, 'home_sleep');
  assert.equal(customEnding(normalizeStoryInput(baseInput({endingType: 'custom'}))), false, 'custom without words is not a custom ending');
  assert.match(endingRuleLine(normalized), /^endingType=custom\. The parent wrote how the story ends: "바닷가에서 친구들과 조개를 나눠 들고 노래하며 끝나요"\. The final beat enacts exactly this/);
});

test('the outline request lets the story end away from home only for a typed ending; the legacy request is unchanged', async () => {
  const legacy = normalizeStoryInput(baseInput()), custom = normalizeStoryInput(baseInput({endingType: 'custom', endingNote: NOTE}));
  const answer = (input) => () => { const o = demoOutline(input); o.plotContract = demoPlotContract(o, input); return o; };
  const legacyEngine = fake(answer(legacy));
  await generateOutline(legacy, {engine: legacyEngine}).catch(() => {});
  const legacySystem = legacyEngine.calls[0].system, legacySchema = JSON.stringify(legacyEngine.calls[0].jsonSchema);
  assert.match(legacySystem, /The first and final beat use the SAME supplied home background ID/);
  assert.match(legacySystem, /endingType=home_sleep\. Close calmly at home;/);
  assert.match(legacySystem, /return home with a calm ending/);
  assert.match(legacySchema, /"enum":\["home_sleep","open"\]/);
  assert.doesNotMatch(legacySystem, /custom/);
  const customEngine = fake(answer(custom));
  await generateOutline(custom, {engine: customEngine}).catch(() => {});
  const system = customEngine.calls[0].system, schema = JSON.stringify(customEngine.calls[0].jsonSchema);
  assert.match(system, /the final beat takes place wherever the parent's ending puts it \(any supplied ID, home or not\)/);
  assert.match(system, /endingType=custom\. The parent wrote how the story ends: "바닷가에서/);
  assert.doesNotMatch(system, /Close calmly at home/);
  assert.match(system, /end the way the parent's ending describes, calmly, wherever it happens/);
  assert.match(schema, /"enum":\["home_sleep","open","custom"\]/);
  assert.match(plotContractRules(custom), /end the way the parent's ending describes/);
  assert.match(plotContractRules(legacy), /return home with a calm ending/);
});

test('a typed ending passes the checks with a last beat away from home; a home ending still needs the home at both ends', () => {
  const custom = normalizeStoryInput(baseInput({endingType: 'custom', endingNote: NOTE}));
  const outline = demoOutline(custom); outline.plotContract = demoPlotContract(outline, custom);
  outline.endingType = 'custom';
  const last = outline.beats.at(-1); last.settingKey = 'beach';
  const row = outline.settings.find(s => s.beatIndex === last.index); row.backgroundId = 'beach';
  assert.equal(validateOutline(outline, custom).errors.filter(e => /결말/.test(e)).length, 0);
  const report = inspectOutlineRules(outline, custom);
  assert.ok(!report.violations.some(v => v.code === 'home_start_end'), report.violations.map(v => v.message).join(' / '));
  const home = normalizeStoryInput(baseInput());
  const homeOutline = {...structuredClone(outline), endingType: 'home_sleep'};
  assert.ok(inspectOutlineRules(homeOutline, home).violations.some(v => v.code === 'home_start_end'), 'a home ending at the beach is still flagged');
  // The first beat must still be home even for a typed ending.
  const wrongStart = structuredClone(outline); wrongStart.beats[0].settingKey = 'forest'; wrongStart.settings.find(s => s.beatIndex === wrongStart.beats[0].index).backgroundId = 'forest';
  assert.ok(inspectOutlineRules(wrongStart, custom).violations.some(v => v.code === 'home_start_end' && /시작 비트/.test(v.message)));
  // The response clean-up maps a wrong ending type to the parent's custom one.
  const shaped = normalizeOutlineResponse({...structuredClone(outline), endingType: 'calm'}, custom);
  assert.equal(shaped.outline.endingType, 'custom');
});

test('the quality canon carries the typed ending for the outline and the prose; nothing for other endings', () => {
  const custom = normalizeStoryInput(baseInput({endingType: 'custom', endingNote: NOTE}));
  assert.match(endingCanonBlock(custom), /^ENDING \(the parent's own ending, binding\): "바닷가에서 친구들과 조개를 나눠 들고 노래하며 끝나요"\. The final beat enacts exactly this/);
  assert.match(endingCanonBlock(custom, 'prose'), /The final paragraph enacts it as concrete action and words in the place where it happens/);
  assert.equal(endingCanonBlock(normalizeStoryInput(baseInput())), '');
  assert.equal(endingCanonBlock(normalizeStoryInput(baseInput({endingType: 'open', endingNote: '다음 모험'}))), '');
});

test('pagination of a typed ending does not ask for the home ID at the end', async () => {
  const custom = normalizeStoryInput(baseInput({endingType: 'custom', endingNote: NOTE})), legacy = normalizeStoryInput(baseInput());
  for (const [input, expectEnd] of [[legacy, true], [custom, false]]) {
    const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input);
    const {demoProse, demoPagination} = await import('../dist/story-generation/demo.js');
    const prose = demoProse(outline, input);
    const engine = fake(() => demoPagination(outline, prose, input));
    await paginateStory(outline, prose, input, {engine, repair: false, skipCoherence: true}).catch(() => {});
    const system = engine.calls[0]?.system || '';
    assert.equal(/including the home ID at the beginning and end\./.test(system), expectEnd, `${input.endingType}: ${system.slice(0, 80)}`);
    if (!expectEnd) assert.match(system, /including the home ID at the beginning\./);
  }
});
