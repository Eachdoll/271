import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {resolveStoryStageSettings, estimateStoryTextCost, freezeReviewTier, reviewTierOf} from '../dist/text-generation/models.js';
import {getTextGenerationSettings, renderTextSettings} from '../dist/text-generation/settings-ui.js';
import {createFullAutoJob, estimateFullAutoCost} from '../dist/full-auto.js';
import {reviewStoryCoherence, normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {demoProse} from '../dist/story-generation/demo.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';

/**
 * 2026-10-20 R26 검사 모델: a new job or draft freezes textSettings.reviewTier.
 * By default the coherence review's judgement runs on the medium model and its
 * repairs, the read-through and every writing stage stay on the upper model;
 * '검사는 최고 모델로' keeps the judgement upper. A snapshot without the key
 * (every job and draft before R26) reviews on the upper model as before.
 */
function setup() {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  return state;
}
const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '유하와 달토끼의 별 찾기', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'};

test('R26 the review stage resolves to the medium model only for a frozen medium tier', () => {
  const state = setup(), plain = getTextGenerationSettings(state);
  assert.equal('reviewTier' in plain, false, 'settings saved before R26 gain no field');
  const upper = resolveStoryStageSettings(plain, 'coherence').config.model;
  assert.equal(resolveStoryStageSettings(plain, 'coherenceReview').config.model, upper, 'no key: the review stays upper');
  const medium = freezeReviewTier(plain);
  assert.equal(medium.reviewTier, 'medium');
  assert.equal(resolveStoryStageSettings(medium, 'coherenceReview').config.model, resolveStoryStageSettings(medium, 'pagination').config.model, 'medium tier: the medium model');
  assert.notEqual(resolveStoryStageSettings(medium, 'coherenceReview').config.model, upper);
  assert.equal(resolveStoryStageSettings(medium, 'coherence').config.model, upper, 'repairs and the read-through keep the upper model');
  assert.equal(freezeReviewTier({...plain, reviewTier: 'upper'}).reviewTier, 'upper');
  assert.equal(reviewTierOf(plain), 'upper');
  assert.equal(reviewTierOf(medium), 'medium');
});

test('R26 the estimate prices the two reviews on the frozen tier; a snapshot without the key is unchanged', () => {
  const state = setup(), plain = getTextGenerationSettings(state);
  const before = estimateStoryTextCost({settings: plain, pageCount: 16, editor: true, council: true});
  const after = estimateStoryTextCost({settings: freezeReviewTier(plain), pageCount: 16, editor: true, council: true});
  const row = (e, stage) => e.stages.find(r => r.stage === stage);
  assert.equal(row(before, 'coherence').model, 'gpt-6-astra');
  assert.equal(row(after, 'coherence').model, 'gpt-6.1-sol');
  assert.equal(row(after, 'coherence').requestCount, 2);
  assert.equal(row(after, 'revision').model, 'gpt-6-astra', 'the read-through writes pages and stays upper');
  assert.equal(after.requestCount, before.requestCount, 'same calls, cheaper review');
  assert.ok(before.costUsd - after.costUsd > 0.4, `${before.costUsd} → ${after.costUsd}`);
  assert.match(after.note, /\(사건 연결 판정은 한 단계 낮은 모델, 수정·통독은 상위 모델\)/u);
  assert.doesNotMatch(before.note, /사건 연결 판정은/u);
});

test('R26 a new job freezes the tier (medium by default, upper when the parent chose it); a demo job and an old job have none', () => {
  const state = setup();
  assert.equal(createFullAutoJob(state, wizard).textSettings.reviewTier, 'medium');
  assert.equal('reviewTier' in createFullAutoJob(state, wizard, {demo: true, planMode: 'selection'}).textSettings, false);
  state.settings.textGeneration = {...(state.settings.textGeneration || {}), reviewTier: 'upper'};
  assert.equal(getTextGenerationSettings(state).reviewTier, 'upper');
  assert.equal(createFullAutoJob(state, wizard).textSettings.reviewTier, 'upper');
  // The new-story estimate follows the parent's choice; an existing job's estimate follows the job.
  const upperCost = estimateFullAutoCost(state, wizard).textUsd;
  delete state.settings.textGeneration.reviewTier;
  const mediumCost = estimateFullAutoCost(state, wizard).textUsd;
  assert.ok(upperCost > mediumCost, `${upperCost} > ${mediumCost}`);
  const oldJob = createFullAutoJob(state, wizard);
  delete oldJob.textSettings.reviewTier;
  assert.equal(estimateFullAutoCost(state, wizard, {job: oldJob}).textUsd, upperCost, 'a pre-R26 job is priced as before');
});

test('R26 reviewStoryCoherence: the judgement uses coherenceOptions, the repair coherenceRepairOptions', async () => {
  const input = normalizeStoryInput({bookId: 'r26', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha', traits: ['씩씩함']}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲', type: 'forest'}, {id: 'sea', name: '바다', type: 'sea'}], topic: '바람 피리', pageCount: 12, specs: {ko: {id: 'K1'}, en: {id: 'E0'}}, language: 'bilingual'});
  const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input);
  const prose = demoProse(outline, input);
  const seen = [];
  const engine = (name) => ({id: name, async complete(req) {
    seen.push(name);
    if (name === 'judge') return {json: {passed: false, issues: [{code: 'state_conflict', beatIndex: 2, pageNo: null, language: 'ko', severity: 'error', evidence: '소리', suggestion: '고치기'}]}, usage: {input: 1, output: 1}, meta: {requests: 1}};
    throw new Error('repair called');
  }});
  await reviewStoryCoherence(outline, prose, null, input, {coherenceOptions: {engine: engine('judge')}, coherenceRepairOptions: {engine: engine('writer')}}).catch(() => {});
  assert.deepEqual(seen, ['judge', 'writer'], 'the judgement on the review engine, the repair on the repair (upper) engine');
  // Without coherenceRepairOptions (a caller before R26) the repair uses the review options, as before.
  seen.length = 0;
  await reviewStoryCoherence(outline, prose, null, input, {coherenceOptions: {engine: engine('judge')}}).catch(() => {});
  assert.deepEqual(seen, ['judge', 'judge']);
});

test('R26 ③ shows the switch in the folded engine/cost details; locked on a job; the pro text settings carry a box', () => {
  const state = setup();
  const ctx = (w) => ({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
  const html = renderSimpleCreate(ctx(ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3})));
  assert.match(html, /<details class="generation-details"[\s\S]*검사는 최고 모델로[\s\S]*data-simple-action="toggle-review-tier"[\s\S]*<\/details>/u);
  assert.match(html, /id="simple-review-switch" class="setting-switch" role="switch" aria-checked="false"/u);
  const job = createFullAutoJob(state, {...wizard, simpleFlow: true}, {stopBefore: 'text'});
  job.status = 'paused';
  const locked = renderSimpleCreate(ctx(ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id})));
  assert.match(locked, /id="simple-review-switch"[^>]*aria-checked="false"[^>]*data-simple-action="toggle-review-tier" disabled/u);
  assert.match(renderTextSettings(state), /<input id="tg-review-upper" type="checkbox" > 검사는 최고 모델로/u);
  state.settings.textGeneration = {...state.settings.textGeneration, reviewTier: 'upper'};
  getActiveWorld(state).textGeneration = {...getActiveWorld(state).textGeneration, reviewTier: 'upper'};
  assert.match(renderTextSettings(state), /<input id="tg-review-upper" type="checkbox" checked> 검사는 최고 모델로/u);
});
