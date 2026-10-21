import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {runStoryCouncil, bibleOutlineRules} from '../dist/story-generation/council.js';
import {renderCouncilReviewForm} from '../dist/story-generation/council-room.js';
import {orchestrationPolicy, orchestrationPolicyFor, hasOrchestrationPolicy, checkTensionCurve, tensionRange, PLOT_ANGLES, tensionBars} from '../dist/story-generation/orchestration.js';
import {estimateStoryTextCost, councilDecisionCosts} from '../dist/text-generation/models.js';
import {getTextGenerationSettings} from '../dist/text-generation/settings-ui.js';

/**
 * 2026-10-21 R29 정성 모드: a new draft freezes input.orchestrationPolicy
 * (on by default, the beat writer's tier medium unless chosen). Its writers'
 * room first settles one growth design, then asks three candidates from
 * three angles in parallel (the author model) with a tension curve each; a
 * failing curve is asked once more, then kept with notes. The bible carries
 * the growth and the curve into the outline rules. Drafts without the policy
 * meet exactly as before (tests/story-council.test.mjs).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'greenie'], backgroundIds: ['home', 'forest'], topic: '바람 피리 찾기', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const baseInput = (extra = {}) => normalizeStoryInput({bookId: 'r29', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha', traits: ['관찰하는 아이']}, {id: 'toto', name: '토토', nameEn: 'Toto', traits: ['느긋한 친구']}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'pond', name: '연못 길'}], topic: '비 오는 날 달팽이 찾기', pageCount: 12, language: 'bilingual', endingType: 'home_sleep', moral: '함께 기다리기', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, craftPolicy: {version: 1}, arcPolicy: {version: 1}, councilPolicy: {version: 1}, orchestrationPolicy: {version: 1, writerTier: 'medium'}, ...extra});

test('R29 the policy is frozen on new drafts (on by default, medium writer), kept by normalize and never sent to a model', () => {
  const state = setup();
  assert.deepEqual(inputFromWizard(state, wizard).input.orchestrationPolicy, {version: 1, writerTier: 'medium'});
  state.settings.textGeneration = {...(state.settings.textGeneration || {}), writerTier: 'upper'};
  assert.deepEqual(inputFromWizard(state, wizard).input.orchestrationPolicy, {version: 1, writerTier: 'upper'});
  state.settings.textGeneration.orchestration = false;
  assert.equal('orchestrationPolicy' in inputFromWizard(state, wizard).input, false, 'turned off: no key');
  assert.equal(orchestrationPolicyFor({settings: {}}).writerTier, 'medium');
  assert.deepEqual(orchestrationPolicy({writerTier: 'odd'}), {version: 1, writerTier: 'medium'});
  assert.ok(hasOrchestrationPolicy(baseInput()));
  assert.deepEqual(baseInput().orchestrationPolicy, {version: 1, writerTier: 'medium'});
  assert.deepEqual(getTextGenerationSettings({settings: {textGeneration: {engine: 'openai', orchestration: false, writerTier: 'upper'}}}).orchestration, false);
});

test('R29 the tension curve check: late peak, calm end, not flat, in range, one per beat', () => {
  const range = tensionRange({specs: {ko: {id: 'K2'}}});
  assert.deepEqual(range, {min: 0, max: 4, spread: 2});
  assert.deepEqual(checkTensionCurve([1, 2, 3, 3, 4, 2, 1], 7, range), []);
  assert.match(checkTensionCurve([2, 2, 2, 2, 2, 2, 2], 7, range).join(' '), /평평/);
  assert.match(checkTensionCurve([1, 4, 2, 2, 2, 1, 0], 7, range).join(' '), /너무 일러요/);
  assert.match(checkTensionCurve([0, 1, 2, 3, 3, 4, 4], 7, range).join(' '), /끝은 풀려야/);
  assert.match(checkTensionCurve([1, 2], 7, range).join(' '), /비트 7개/);
  assert.equal(tensionRange({specs: {ko: {id: 'K3'}}}).max, 5);
  assert.equal(tensionBars([0, 2, 5]), '▁▃▇');
});

const good = [1, 2, 3, 3, 4, 2, 1], flat = [2, 2, 2, 2, 2, 2, 2];
const pitch = (n, angle, tension) => ({title: `후보 ${n}`, logline: `유하가 달팽이를 찾아요 ${n}`, stakes: '못 찾으면 저녁 노래를 못 불러요', planted: {name: '빨간 장화', nameEn: 'a red boot', firstSeen: '현관 옆'}, ladder: ['연못을 봐요', '숲을 봐요'], lowPoint: '"그냥 갈까" 하고 작게 말해요', turn: {seen: '장화 속 달팽이', realized: '"여기 있었네!"', overturns: '멀리 있는 줄 알았던 친구'}, payoff: '장화를 살짝 기울여요', echo: '머리맡의 장화', angle, tension});
function room({flatAngle = 'humor', fixOnRetry = false} = {}) {
  const asked = {};
  return {id: 'openai', calls: [], async complete(req) {
    this.calls.push(req);
    const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
    const user = String(req.user), system = String(req.system);
    if (/\[성장 설계 — 후보를 쓰기 전에/u.test(user)) return reply({growth: {want: '달팽이 친구 찾기', need: '기다리는 법', flaw: '서두름'}, theme: '기다림', lesson: '천천히 보면 보여요'});
    if (/\[피치 1개 쓰기\]/u.test(user)) {
      const angle = /angle="(\w+)"/u.exec(user)[1], n = PLOT_ANGLES.findIndex((a) => a.id === angle) + 1;
      asked[angle] = (asked[angle] || 0) + 1;
      const bad = angle === flatAngle && !(fixOnRetry && asked[angle] > 1);
      return reply({pitch: pitch(n, angle, bad ? flat : good)});
    }
    if (/\[바이블 확정\]/u.test(user)) return reply({bible: {...pitch(2, 'adventure', [1, 2, 2, 3, 4, 2, 0]), title: '장화 속 달팽이', visual: {pictures: [1, 2, 3, 4, 5, 6, 7].map((i) => ({beatIndex: i, ko: `${i}`, en: `Yuha looks into a red boot on beat ${i}`})), motifs: [], plantedPlacementEn: 'by the door'}}});
    if (/그림책 편집자/u.test(system)) return reply({verdicts: [1, 2, 3].map((p) => ({pitch: p, stakes: 2, ladder: 2, lowPoint: 2, turn: 2, payoff: 2, direction: p === 2 ? 2 : 1, veto: false, vetoReason: '', fixes: []})), pick: 2});
    if (/아트 디렉터/u.test(system)) return reply({verdicts: [1, 2, 3].map((p) => ({pitch: p, drawableTurn: 2, plantedVisible: 2, lowPointVisible: 2, variety: 2, motifs: [], veto: false, vetoReason: '', fixes: []})), pick: 2});
    if (/세 아이다/u.test(system)) return reply({reactions: [1, 2, 3].map((p) => ({pitch: p, nextQuestion: 2, retell: '장화 속에 있었어', retellHasTurn: true, scary: ''})), favorite: 2});
    throw new Error(`unexpected request: ${user.slice(0, 60)}`);
  }};
}

test('R29 the room settles the growth first, asks three angled candidates on the author model, retries a flat curve once and binds the bible', async () => {
  const input = baseInput(), engine = room(), saved = [];
  const result = await runStoryCouncil(input, {engine, onCheckpoint: (cp) => saved.push(cp)}, {engineFor: async () => engine});
  const users = engine.calls.map((c) => String(c.user));
  assert.match(users[0], /\[성장 설계 — 후보를 쓰기 전에/u, 'the growth design comes first');
  const candidates = users.filter((u) => /\[피치 1개 쓰기\]/u.test(u));
  assert.equal(candidates.length, 4, 'three angles + one retry for the flat curve');
  for (const u of candidates) assert.match(u, /want: 달팽이 친구 찾기 \/ need: 기다리는 법 \/ flaw: 서두름/u, 'every candidate shares the growth design');
  assert.deepEqual([...new Set(candidates.map((u) => /angle="(\w+)"/u.exec(u)[1]))].sort(), ['adventure', 'heart', 'humor']);
  assert.match(candidates.at(-1), /\[이전 답의 문제 — 고쳐서 다시\][\s\S]*평평/u);
  const humor = result.record.pitches.find((p) => p.angle === 'humor');
  assert.ok(humor.curveNotes?.length, 'still flat after one retry: kept with notes, no third request');
  assert.ok(result.record.pitches.every((p) => p.growth?.need === '기다리는 법'));
  const editor = engine.calls.find((c) => /그림책 편집자/u.test(String(c.system)));
  assert.match(String(editor.user), /growth: want와 need가 다르고/u);
  const bible = result.record.bible;
  assert.deepEqual(bible.growth, {want: '달팽이 친구 찾기', need: '기다리는 법', flaw: '서두름'});
  assert.equal(bible.lesson, '천천히 보면 보여요');
  assert.deepEqual(bible.tension, [1, 2, 2, 3, 4, 2, 0]);
  assert.match(bibleOutlineRules(bible, input), /GROWTH \(binding\)[\s\S]*TENSION per beat \(0 calm … high\): 1:1 2:2 3:2 4:3 5:4 6:2 7:0/u);
  // Resume: the saved journal answers every call.
  const again = room();
  await runStoryCouncil(input, {engine: again, councilCheckpoint: saved.at(-1).councilCheckpoint}, {engineFor: async () => again});
  assert.equal(again.calls.length, 0);
  // The parent's choice shows each angle, its curve and the shared growth.
  const form = renderCouncilReviewForm({...result.record, recommended: 2});
  assert.match(form, /성장 설계 · 달팽이 친구 찾기 → 기다리는 법/u);
  assert.match(form, /pitch-angle">마음 이야기/u);
  assert.match(form, /긴장 ▂▃▄▄▅▃▂/u);
});

test('R29 a bible curve that fails the check falls back to the chosen candidate\'s curve', async () => {
  const engine = room({flatAngle: 'none'});
  const original = engine.complete.bind(engine);
  engine.complete = async (req) => (/\[바이블 확정\]/u.test(String(req.user)) ? {json: {bible: {...pitch(2, 'adventure', flat), visual: {pictures: [], motifs: [], plantedPlacementEn: ''}}}, usage: {input: 1, output: 1}, meta: {requests: 1}} : original(req));
  const result = await runStoryCouncil(baseInput(), {engine}, {engineFor: async () => engine});
  assert.deepEqual(result.record.bible.tension, good);
});

test('R29 estimates: the growth design and three candidates on the author model; a parked meeting owes only the bible', () => {
  const settings = getTextGenerationSettings({settings: {textGeneration: {engine: 'openai'}}});
  const plain = estimateStoryTextCost({settings, pageCount: 12, council: true}),
    rich = estimateStoryTextCost({settings, pageCount: 12, council: true, orchestration: true});
  const row = (e, stage) => e.stages.find((r) => r.stage === stage);
  assert.equal(row(plain, 'council').requestCount, 5);
  assert.equal(row(rich, 'council').requestCount, 4);
  assert.equal(row(rich, 'plotCandidates').requestCount, 4);
  assert.equal(rich.requestCount, plain.requestCount + 3);
  assert.ok(rich.costUsd > plain.costUsd);
  assert.equal(estimateStoryTextCost({settings, pageCount: 12, orchestration: true}).requestCount, estimateStoryTextCost({settings, pageCount: 12}).requestCount, 'no meeting, no candidates');
  const job = {input: {pageCount: 12, councilPolicy: {version: 1}, orchestrationPolicy: {version: 1, writerTier: 'medium'}}, textSettings: settings, usage: {calls: []}};
  const parked = councilDecisionCosts(job);
  assert.ok(Math.abs(parked.continueUsd - (rich.costUsd - row(rich, 'plotCandidates').costUsd - row(rich, 'council').costUsd * 3 / 4)) < 1e-9);
});
