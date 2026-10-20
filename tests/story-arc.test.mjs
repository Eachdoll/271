import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getLevelSpec} from '../dist/reading-levels.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {normalizeStoryInput, generateOutline, generateProse, inspectOutlineRules} from '../dist/story-generation/pipeline.js';
import {hardOutlineViolations, OUTLINE_SCHEMA, assertValid} from '../dist/story-generation/schemas.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {arcPolicy, hasArcPolicy, arcOutlineRules, arcProseRules, arcSimplifyKeep, arcRevisionRules, inspectArc, plantedHeadNoun} from '../dist/story-generation/arc-rules.js';
import {revisionRules, revisionSchema, revisionAspects, REVISION_SCHEMA, REVISION_ASPECTS} from '../dist/story-generation/book-revision.js';
import {generateQualityOutline, generateQualityProse} from '../dist/story-generation/quality-adapter.js';
import {buildStopReport} from '../dist/story-generation/stop-report.js';
import * as qualityModule from '../story-quality/dist/pipeline.js';

/**
 * 2026-10-20 R19 "통독·퇴고를 거쳐도 이야기가 너무 가벼워": every stage asked for
 * the skeleton of a twist (a planted thing, three different failures) and no
 * stage asked for stakes, rising tries, a low point or a staged reveal; the
 * reference examples showed one line per beat; the simplify pass cut whatever
 * carried the spine. New drafts freeze input.arcPolicy {version: 1}; drafts
 * without it send byte-identical requests.
 */
const NOTE = 'STORY SPINE';
function baseInput(extra = {}) {
  return {bookId: 'arc', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha', traits: ['관찰하는 아이']}, {id: 'toto', name: '토토', nameEn: 'Toto', traits: ['느긋한 친구']}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'pond', name: '연못 길'}], topic: '비 오는 날 달팽이 찾기', pageCount: 12, language: 'bilingual', endingType: 'home_sleep', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, ...extra};
}
const arcInput = (extra = {}) => normalizeStoryInput(baseInput({craftPolicy: {version: 1}, arcPolicy: {version: 1}, ...extra}));
const legacyInput = (extra = {}) => normalizeStoryInput(baseInput({craftPolicy: {version: 1}, ...extra}));
const capture = () => {
  const engine = {id: 'openai', calls: [], async complete(req) { this.calls.push(req); throw new Error('captured'); }};
  return engine;
};

test('the wizard freezes the arc policy; normalizeStoryInput keeps it and the model never sees it', () => {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '비 오는 날', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
  const {input} = inputFromWizard(state, wizard);
  assert.deepEqual(input.arcPolicy, {version: 1});
  assert.ok(hasArcPolicy(input));
  assert.deepEqual(normalizeStoryInput(input).arcPolicy, {version: 1});
  assert.equal(hasArcPolicy(normalizeStoryInput(baseInput())), false);
  assert.equal(hasArcPolicy(normalizeStoryInput(baseInput({arcPolicy: {version: 2}}))), false, 'an unknown version is not the policy');
  assert.deepEqual(arcPolicy(), {version: 1});
});

test('the app outline request adds the story-spine rules only for an arc draft; the model-facing input carries no policy', async () => {
  const legacy = legacyInput(), arc = arcInput();
  const legacyEngine = capture(), arcEngine = capture();
  await generateOutline(legacy, {engine: legacyEngine}).catch(() => {});
  await generateOutline(arc, {engine: arcEngine}).catch(() => {});
  const before = legacyEngine.calls[0].system, after = arcEngine.calls[0].system;
  assert.doesNotMatch(before, /STORY SPINE/u);
  assert.equal(after, before.replace(/(SOUND REFRAIN \(required for this K1\/K2 book\)[^\n]*)/u, `$1\n${arcOutlineRules(arc)}`), 'the spine rules are appended after the craft rules; nothing else changes');
  assert.match(after, /STORY SPINE \(picture-book arc\):\nSTAKES: by the want beat/u);
  assert.match(after, /LOW POINT: the last attempt ends at the lowest moment/u);
  assert.match(after, /TURN = SEEING AGAIN: .* plan\.twistReveal names \(a\) what the protagonist believed, \(b\) what is actually true, \(c\) the planted thing's new role/u);
  assert.match(after, /EMOTION LADDER: emotionArc runs calm → eager/u);
  assert.doesNotMatch(JSON.stringify(arcEngine.calls[0]), /arcPolicy/u);
  assert.equal(JSON.stringify(legacyEngine.calls[0].jsonSchema), JSON.stringify(arcEngine.calls[0].jsonSchema));
  assert.equal(arcOutlineRules(legacy), '');
});

test('the app prose and enrichment requests add the prose spine only for an arc draft', async () => {
  for (const [input, expected] of [[legacyInput(), false], [arcInput(), true]]) {
    const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input);
    const engine = capture();
    await generateProse(outline, input, {engine}).catch(() => {});
    const system = engine.calls[0].system;
    assert.equal(/STORY SPINE IN PROSE:\nSTAKES LINE:/u.test(system), expected, input.arcPolicy ? 'arc' : 'legacy');
    if (expected) {
      assert.match(system, /TURN IN THREE STEPS: .* never writes '알고 보니' or 'it turned out' narration\./u);
      assert.match(system, /PAYOFF: the resolution shows the protagonist's hands doing the solving/u);
    }
  }
  assert.equal(arcProseRules(legacyInput()), '');
  assert.match(arcSimplifyKeep(arcInput()), /^- 뼈대는 줄이지 않는다: want 비트의/u);
  assert.match(arcSimplifyKeep(arcInput(), 'en'), /^- Keep the spine when shortening:/u);
  assert.equal(arcSimplifyKeep(legacyInput()), '');
});

test('the soft check asks the turn to bring the planted thing back; a legacy draft is not checked', () => {
  const arc = arcInput(), legacy = legacyInput();
  const outline = demoOutline(arc); outline.plotContract = demoPlotContract(outline, arc);
  outline.plan = {pattern: 'mystery_sound', planted: '목에 작은 자전거 종이 달린 말 인형. 유하가 집에서 울려 본다', twistReveal: '소리의 정체는 바람이었다', funnyMoment: '재채기', failureReasons: ['wrong_place', 'wrong_method']};
  const turn = outline.beats.find(b => b.type === 'turn');
  const missing = inspectOutlineRules(outline, arc).violations.filter(v => v.code === 'arc_turn_planted');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].beatIndex, turn.index);
  assert.match(missing[0].message, /‘인형’이\(가\) 다시 나오게/u);
  assert.equal(hardOutlineViolations({violations: missing}).length, 0, 'advisory: it never stops the book');
  turn.summary += ' 가방에서 떨어진 말 인형이 돌 틈에서 종을 울려요.';
  assert.equal(inspectOutlineRules(outline, arc).violations.filter(v => v.code === 'arc_turn_planted').length, 0);
  assert.equal(inspectOutlineRules(outline, legacy).violations.filter(v => v.code === 'arc_turn_planted').length, 0);
  assert.deepEqual(inspectArc(outline, legacy), []);
  assert.deepEqual(['작은 북', '빈 물통', '노란 담요 — 유하가 거실에서', '커다란 도장 (초록이 발자국)', '빨간 장화를'].map(plantedHeadNoun), ['북', '물통', '담요', '도장', '장화']);
});

test('the editor read-through gets the spine aspects and instructions only for an arc draft', () => {
  const arc = arcInput({editorPolicy: {version: 1}}), legacy = legacyInput({editorPolicy: {version: 1}});
  assert.equal(revisionSchema(legacy), REVISION_SCHEMA, 'the same object: byte-identical request');
  assert.deepEqual(revisionAspects(legacy), [...REVISION_ASPECTS]);
  assert.doesNotMatch(revisionRules(legacy, 12), /story spine/u);
  const schema = revisionSchema(arc);
  assert.notEqual(schema, REVISION_SCHEMA);
  assert.deepEqual(schema.properties.report.properties.issues.items.properties.aspect.enum, [...REVISION_ASPECTS, 'stakes', 'lowPoint', 'turn']);
  assert.deepEqual(REVISION_SCHEMA.properties.report.properties.issues.items.properties.aspect.enum, [...REVISION_ASPECTS], 'the shared schema is untouched');
  assert.match(revisionRules(arc, 12), /Also, for the story spine \(wording only, the events stay\): a turn page where the narrator explains the answer before the protagonist sees it/u);
  assert.match(revisionRules(arc, 12), /Report these under the aspects stakes, lowPoint and turn\./u);
  assert.equal(arcRevisionRules(legacy), '');
});

const clone = v => JSON.parse(JSON.stringify(v));
const read = async file => JSON.parse(await readFile(new URL(`../story-quality/data/${file}.json`, import.meta.url), 'utf8'));
const goldPart = async part => JSON.parse(await readFile(new URL(`../story-quality/gold/gold_outlines_part${part}.json`, import.meta.url), 'utf8'));
const distilled = JSON.parse(await readFile(new URL('../dist/story-quality/examples/approved-books.json', import.meta.url), 'utf8'));
const data = {inventories: await read('inventories'), gestureDictionary: await read('gesture_dictionary'), plotPatterns: await read('plot_patterns'), worldLibrary: await read('worlds'), goldBooks: [...await goldPart(1), ...await goldPart(2)]};
const schema = () => {const v = clone(OUTLINE_SCHEMA); v.required.push('plotContract'); return v;};
const services = (engine, withDistilled) => ({engineFor: async o => o.engine || engine, qualityData: withDistilled ? {...data, distilledBooks: distilled} : data, qualityModule: async () => qualityModule, outlineRequestSchema: schema, baseSystem: 'APP_BASE_RULES', levelRules: i => `FROZEN_LEVEL_SPECS:${JSON.stringify(i.specs)}`, assertValid, inspectOutlineRules: () => ({valid: true, violations: []})});
const qualityInput = (arc) => normalizeStoryInput(baseInput({craftPolicy: {version: 1}, editorPolicy: {version: 1}, catchphrasePolicy: {limit: 1, omit: []}, ...(arc ? {arcPolicy: {version: 1}} : {}), storyQuality: {enabled: true, useBeamSearch: false, twoPass: true, useDistilledExamples: false, patternId: 'mystery_sound', approvedBooks: []}}));

test('the quality outline request: spine canon, spine cards from 9-point distilled examples, two examples inside the budget; a legacy draft keeps the old examples', async () => {
  const legacy = qualityInput(false), arc = qualityInput(true);
  const legacyEngine = capture(), arcEngine = capture();
  await generateQualityOutline(legacy, {engine: legacyEngine}, services(legacyEngine, true)).catch(() => {});
  await generateQualityOutline(arc, {engine: arcEngine}, services(arcEngine, true)).catch(() => {});
  const before = legacyEngine.calls[0], after = arcEngine.calls[0];
  assert.doesNotMatch(before.system, /STORY SPINE/u);
  assert.match(before.user, /\[참고 예시 — 구조·리듬만 참고/u);
  assert.doesNotMatch(before.user, /튤립 밭 자전거 종소리|바닥\(마지막 시도/u, 'useDistilledExamples off: gold only, old rendering');
  assert.match(after.system, /^STORY SPINE \(picture-book arc\):\nSTAKES:/mu);
  assert.match(after.user, /\[참고 예시 — 뼈대만 참고: 바라는 것이 왜 중요한지/u);
  assert.equal((after.user.match(/\n예시 \d \(주제: /gu) || []).length, 2, 'both examples survive the wider budget');
  assert.match(after.user, /\n 바닥\(마지막 시도 \d\): /u);
  assert.match(after.user, /\n 반전\(\d\): /u);
  assert.match(after.user, /\n 뒤집힌 뜻: /u);
  const topics = [...after.user.matchAll(/예시 \d \(주제: ([^,]+), 패턴: (\w+)\)/gu)].map(m => [m[1], m[2]]);
  for (const [topic, pattern] of topics) {
    assert.equal(pattern, 'mystery_sound');
    const record = distilled.find(b => b.topic === topic);
    if (record) assert.ok(record.feedback.rubricTotal >= 9, `${topic}: ${record.feedback.rubricTotal}`);
  }
  assert.ok(topics.some(([topic]) => distilled.some(b => b.topic === topic)), 'a distilled example is in, without the toggle');
  assert.doesNotMatch(JSON.stringify(after), /arcPolicy/u);
});

test('the quality prose request carries the prose spine in its canon for an arc draft only', async () => {
  for (const [input, expected] of [[qualityInput(false), false], [qualityInput(true), true]]) {
    const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input);
    const engine = capture();
    await generateQualityProse(outline, input, {engine}, services(engine, false)).catch(() => {});
    assert.equal(/STORY SPINE IN PROSE:\nSTAKES LINE:/u.test(engine.calls[0].system), expected);
  }
});

test('the stop report names the spine rules', () => {
  const job = {id: 'j', status: 'failed', phase: '줄거리', error: 'x', input: {...arcInput(), topic: '비'}, textSettings: {engine: 'openai', providers: {}, storyQuality: {enabled: true}}, usage: {calls: []}, completed: {}, failure: {at: '2026-10-20T00:00:00.000Z', step: 'outline', name: 'Error', message: 'x', violations: [], requests: 1}};
  assert.match(buildStopReport(job, {now: new Date('2026-10-20T00:00:00Z')}), /뼈대 규칙 켜짐/u);
  job.input = {...legacyInput(), topic: '비'};
  assert.match(buildStopReport(job, {now: new Date('2026-10-20T00:00:00Z')}), /뼈대 규칙 없음/u);
});
