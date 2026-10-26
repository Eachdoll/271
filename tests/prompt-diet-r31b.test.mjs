import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.__DONGHWA_R12_OPENINGS__ = false;
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateOutline, generateProse, paginateStory} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {hasPromptDiet, leanLevelLine, leanBibleBlock, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {arcOutlineRules, arcProseRules, inspectArc, hasArcPolicy} from '../dist/story-generation/arc-rules.js';
import {craftOutlineRules, craftProseRules, soundRefrainRequired} from '../dist/story-generation/craft-rules.js';
import {revisionAspects, revisionSchema, REVISION_SCHEMA} from '../dist/story-generation/book-revision.js';
import {estimateFullAutoCost} from '../dist/full-auto.js';

/**
 * 2026-10-21 R31b 프롬프트 다이어트. Measured on the K1 bus request after R31a:
 * the outline request carried a 15,319-character system prompt with 77
 * imperatives, the writer two spec JSON blobs and counters to fill. New
 * drafts freeze promptDiet {version: 1}: every writing request is the short
 * base, the level in a sentence per language, what a good book feels like
 * (no counts), the materials and the output shape. The spine commands, the
 * suspense/planted-object formula, the sound-refrain quota, the package's
 * plot-pattern seed and the spec JSON are not sent. Drafts without the
 * policy are byte-identical (the R12 `requests` pin).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wiz = (extra = {}) => ({characterIds: ['yuha'], backgroundIds: ['home', 'forest'], topic: '유하가 스쿨버스를 타고 해니를 만나 장난치며 유치원에 가는 이야기', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true, ...extra});
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
const QUOTA = /at least|exactly \d|STORY SPINE|SUSPENSE|SOUND REFRAIN|K1 SOUNDS|FROZEN_LEVEL_SPECS|vocabGrade|ruleVersion|maxOutOfListRatio|DETAILED STORYTELLING|PLACE CANON/u;
// The demo outline with the topic's keywords and two middle places, so the first reply passes the outline checks.
const outlineOf = (input) => {
  const o = structuredClone(demoOutline(input)), places = ['forest', 'garden'];
  o.beats.forEach((b, i) => { if (i > 0 && i < o.beats.length - 1) { b.settingKey = places[i % 2]; o.settings[i].backgroundId = places[i % 2]; } });
  o.beats[1].summary += ' 유하가 노란 스쿨버스를 타요.'; o.beats[2].summary += ' 버스에서 해니를 만나요.'; o.beats.at(-1).summary += ' 둘이 유치원에 들어가요.';
  o.plotContract = demoPlotContract(o, input); o.tension = [1, 2, 3, 3, 4, 2, 1]; return o;
};
const bible = {title: '노란 버스', logline: '유하가 버스에서 해니를 만나요', stakes: '혼자 가요', planted: {name: '노란 모자', firstSeen: '현관'}, ladder: ['기다려요', '인사해요'], lowPoint: '고개를 숙여요', turn: {seen: '창문 그림자', realized: '"같이 놀자!"', overturns: '혼자'}, payoff: '손을 잡아요', echo: '노란 모자', growth: {want: '혼자 놀기', need: '함께 놀기', flaw: '낯가림'}, lesson: '같이 놀면 더 재밌어요'};

test('R31b every new draft freezes promptDiet; normalize keeps it; the model never sees it; the spine, suspense, refrain and sound-quota lines are off for it', () => {
  const state = setup();
  for (const w of [wiz(), wiz({koreanLevel: 'K1', englishLevel: 'E0'}), wiz({simpleFlow: false})]) {
    const input = inputFromWizard(state, w).input;
    assert.deepEqual(input.promptDiet, {version: 1});
    assert.ok(hasPromptDiet(normalizeStoryInput(input)));
  }
  const diet = normalizeStoryInput(inputFromWizard(state, wiz()).input), {promptDiet, ...rest} = diet, plain = normalizeStoryInput(rest);
  assert.ok(hasArcPolicy(diet), 'the arc policy stays (reference examples)');
  assert.equal(arcOutlineRules(diet), ''); assert.match(arcOutlineRules(plain), /STORY SPINE/u);
  assert.equal(arcProseRules(diet), ''); assert.match(arcProseRules(plain), /STAKES LINE/u);
  assert.deepEqual(inspectArc({beats: [], twist: ''}, diet), []);
  assert.equal(soundRefrainRequired(diet), false); assert.equal(soundRefrainRequired(plain), true);
  assert.doesNotMatch(craftOutlineRules(diet), QUOTA); assert.match(craftOutlineRules(plain), /SUSPENSE/u);
  assert.equal(craftProseRules(diet), ''); assert.match(craftProseRules(plain), /SOUND WORDS/u);
  assert.deepEqual(revisionAspects(diet).includes('suspense'), false);
  assert.ok(revisionAspects(plain).includes('suspense') && revisionAspects(plain).includes('stakes'));
  assert.notEqual(revisionSchema(diet), REVISION_SCHEMA);
  assert.deepEqual(revisionSchema(diet).properties.report.properties.issues.items.properties.aspect.enum, revisionAspects(diet));
  assert.equal('promptDiet' in leanVisibleInput(diet), false);
  assert.equal('specs' in leanVisibleInput(diet), false, 'no spec JSON in the visible input');
});

test('R31b the level in a sentence: the vocabulary list only for blocking levels, never the spec fields', () => {
  const state = setup();
  const k2 = normalizeStoryInput(inputFromWizard(state, wiz()).input), k1 = normalizeStoryInput(inputFromWizard(state, wiz({koreanLevel: 'K1', englishLevel: 'E0'})).input);
  const ko = leanLevelLine(k2, 'ko'), en = leanLevelLine(k2, 'en'), en0 = leanLevelLine(k1, 'en');
  assert.match(ko, /^Korean K2 \(.+\): about \d+–\d+ sentences per page, \d+–\d+ eojeol each/u);
  assert.match(en, /Use mostly these words/u, 'E2 blocks out-of-list words: the list is given');
  assert.doesNotMatch(leanLevelLine(k2, 'en', {vocab: false}), /Use mostly these words/u);
  assert.match(en0, /Very simple everyday words/u); assert.doesNotMatch(en0, /Use mostly these words/u, 'E0 is advisory: no list');
  assert.match(en0, /Present tense; says, not said/u);
  assert.match(leanLevelLine(k1, 'ko'), /K1 SHORT LINES/u);
  for (const line of [ko, en, en0]) assert.doesNotMatch(line, /vocabGrade|ruleVersion|maxOutOfListRatio|approxLexile/u);
});

test('R31b the K2 outline of a diet draft: the app path with the lean prompt and the room’s pitch as a plan (no package seed, no spine); ≤ 4,000 characters', async () => {
  const state = setup(), input = normalizeStoryInput({...inputFromWizard(state, wiz()).input, bookId: 'd'});
  input.storyQuality = {...input.storyQuality, enabled: true};
  const o = outlineOf(input), calls = [];
  const engine = {id: 'openai', async complete(req) {
    calls.push(req);
    const user = String(req.user), system = String(req.system);
    if (/\[성장 설계 — 후보를 쓰기 전에/u.test(user)) return reply({growth: bible.growth, theme: '첫 만남', lesson: bible.lesson});
    if (/\[피치 1개 쓰기\]/u.test(user)) { const angle = /angle="(\w+)"/u.exec(user)[1]; return reply({pitch: {...bible, angle, tension: [1, 2, 3, 3, 4, 2, 1]}}); }
    if (/\[바이블 확정\]/u.test(user)) return reply({bible: {...bible, visual: {pictures: [1, 2, 3, 4, 5, 6, 7].map((i) => ({beatIndex: i, ko: `${i}`, en: `picture ${i}`})), motifs: [], plantedPlacementEn: 'by the door'}}});
    if (/그림책 편집자/u.test(system)) return reply({verdicts: [1, 2, 3].map((p) => ({pitch: p, stakes: 2, ladder: 2, lowPoint: 2, turn: 2, payoff: 2, direction: 2, veto: false, vetoReason: '', fixes: []})), pick: 2});
    if (/아트 디렉터/u.test(system)) return reply({verdicts: [1, 2, 3].map((p) => ({pitch: p, drawableTurn: 2, plantedVisible: 2, lowPointVisible: 2, variety: 2, motifs: [], veto: false, vetoReason: '', fixes: []})), pick: 2});
    if (/세 아이다/u.test(system)) return reply({reactions: [1, 2, 3].map((p) => ({pitch: p, nextQuestion: 2, retell: '버스에서 만났어', retellHasTurn: true, scary: ''})), favorite: 2});
    return reply(o);
  }};
  const result = await generateOutline(input, {engineId: 'openai', engine, qualityEngines: {outline: engine, prose: engine, cheap: engine}});
  const outlineCall = calls.at(-1);
  // R35 adds the PICTURE-LED composition block (≈ 650 chars); R36 the PICTURE PLAN paragraph (≈ 1,000); measured 5,712.
  // (R38 adds the WHAT CHANGES paragraph: 6,000 → 7,000.)
  assert.ok(outlineCall.system.length <= 7000, `${outlineCall.system.length} chars`);
  assert.doesNotMatch(outlineCall.system + outlineCall.user, QUOTA);
  assert.doesNotMatch(outlineCall.user, /\[플롯 패턴\]|\[정해진 재료\]|반드시 이대로/u, 'no package plot-pattern seed');
  assert.match(outlineCall.system, /THE WRITERS' ROOM CHOSE THIS PITCH — write the outline from it, in your own way/u);
  assert.doesNotMatch(outlineCall.system, /binding|beat for beat/u);
  assert.match(outlineCall.system, /tension\[\]: 7 integers 0–4/u);
  // R31e: no diet draft carries the event ledger (K2 too); a volunteered one is dropped.
  assert.doesNotMatch(outlineCall.system, /plotContract/u, 'no ledger asked for on the diet');
  assert.equal(outlineCall.jsonSchema.required.includes('plotContract'), false);
  assert.match(outlineCall.system, /Surprise is welcome; a formula is not/u);
  assert.doesNotMatch(outlineCall.user, /vocabList|"specs"/u);
  assert.equal(result.data.plotContract, undefined, 'the mock reply volunteered a ledger; the diet outline drops it');
  assert.match(outlineCall.system, /The parent chose|chosen companion|^Design the StoryOutline/mu);
  // The room's condition block carries no refrain line for a diet draft.
  const pitchCall = calls.find((c) => /\[피치 1개 쓰기\]/u.test(c.user));
  assert.doesNotMatch(pitchCall.user, /소리말 후렴/u);
  // The bible block itself.
  assert.match(leanBibleBlock(bible, input), /Growth: wants "혼자 놀기", truly gains "함께 놀기"/u);
  assert.equal(leanBibleBlock(null, input), '');
});

test('R31b the K1 outline of a diet draft has no ledger and the K1 shape once; ≤ 4,000 characters (R33 adds the STORY SHAPE and STAGE lines)', async () => {
  const state = setup(), input = normalizeStoryInput({...inputFromWizard(state, wiz({koreanLevel: 'K1', englishLevel: 'E0'})).input, bookId: 'k'});
  const o = outlineOf(input); delete o.plotContract;
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); return reply(o); }};
  const result = await generateOutline(input, {engine});
  assert.equal(calls.length, 1, 'no repair call for a missing ledger');
  // R31b measured 3,169; R33 adds one STORY SHAPE line and one STAGE line (≈ 500 chars, a spark each, no counters);
  // R35 adds the PICTURE-LED composition block, R36 the PICTURE PLAN paragraph (measured 5,466).
  assert.ok(calls[0].system.length <= 7000, `${calls[0].system.length} chars`);
  assert.doesNotMatch(calls[0].system, QUOTA);
  assert.doesNotMatch(calls[0].system, /plotContract/u);
  assert.equal((calls[0].system.match(/No villain/gu) || []).length, 1, 'the K1 shape is stated once');
  assert.equal(calls[0].jsonSchema.required.includes('plotContract'), false);
  assert.equal(result.data.plotContract, undefined);
  assert.doesNotMatch(calls[0].system, /Use mostly these words/u, 'no vocabulary list at the outline stage');
});

test('R31b the beat writer and the app prose path of a diet draft: voice, not counters; the level in a sentence', async () => {
  const state = setup(), input = normalizeStoryInput({...inputFromWizard(state, wiz()).input, bookId: 'b'}), o = outlineOf(input);
  const calls = [];
  const writer = {id: 'openai', async complete(req) { calls.push(req); const n = Number(/이 비트는 (\d+)문장/u.exec(req.user)?.[1] || 3); const ko = !/original English/u.test(req.system); return reply({text: Array.from({length: n}, (_, i) => ko ? `유하가 젖은 잎을 ${i + 1}번 살짝 만져요.` : `Yuha taps the wet leaf ${i + 1} times.`).join(' '), pick: 1, reason: 'x'}); }};
  await generateProse(o, input, {engineId: 'openai', engine: writer, qualityEngines: {beatWriter: writer, cheap: writer}});
  const beat = calls.find((c) => /\[이번 비트\] 3 /u.test(c.user) && !/original English/u.test(c.system));
  // R31b measured 659; R34 adds the prose palette and this book's five voice cards with examples (≈ 800 chars, a spark, no counters).
  assert.ok(beat.system.length <= 2000, `${beat.system.length} chars`);
  assert.doesNotMatch(beat.system, QUOTA);
  assert.doesNotMatch(beat.system, /EVERY sentence|Never repeat/u);
  assert.match(beat.system, /the way a good picture book sounds read aloud/u);
  assert.match(beat.system, /Korean K2 \(/u);
  // With 정성 모드 off the whole-book app path is lean too (no package passes).
  const {orchestrationPolicy, ...rest} = input, off = normalizeStoryInput(rest);
  off.storyQuality = {...off.storyQuality, enabled: true};
  const calls2 = [];
  const engine = {id: 'openai', async complete(req) { calls2.push(req); return reply({ko: o.beats.map((b) => `유하가 ${b.index}번째로 웃어요.`).join('\n\n'), en: o.beats.map((b) => `Yuha smiles ${b.index} times.`).join('\n\n'), usedRefrainAt: [], paragraphBeats: {ko: o.beats.map((b) => b.index), en: o.beats.map((b) => b.index)}}); }};
  await generateProse(o, off, {engineId: 'openai', engine, qualityEngines: {prose: engine, cheap: engine}});
  assert.equal(calls2.length, 1);
  assert.doesNotMatch(calls2[0].system, QUOTA);
  assert.doesNotMatch(calls2[0].system, /THREE directly quoted|at least ONE specific sensory/u);
  assert.match(calls2[0].system, /one paragraph per approved beat/u);
  assert.doesNotMatch(calls2[0].user, /"specs"|vocabList/u);
});

test('R31b a draft without the policy is untouched: the same old-path prompt pieces, byte for byte (the R12 requests pin holds it)', async () => {
  const state = setup(), diet = normalizeStoryInput({...inputFromWizard(state, wiz()).input, bookId: 'o'});
  const {promptDiet, ...rest} = diet, old = normalizeStoryInput(rest);
  assert.equal(hasPromptDiet(old), false);
  assert.match(arcOutlineRules(old), /STORY SPINE/u);
  assert.match(craftOutlineRules(old), /SUSPENSE: the story asks one question/u);
  assert.equal(revisionSchema(old) === REVISION_SCHEMA, false, 'the arc draft keeps its own schema');
  // The estimate: a new (diet) job is priced on the app path; a frozen job without the policy as before.
  const newJob = estimateFullAutoCost(state, wiz());
  assert.ok(newJob.textUsd > 0);
  const oldJob = {input: old, textSettings: state.settings.textGeneration ? {...state.settings.textGeneration} : {}, wizard: wiz()};
  assert.ok(estimateFullAutoCost(state, wiz(), {job: {...oldJob, textSettings: newJob.textSettings || {engine: 'openai', providers: {}}}}).textUsd >= 0);
});
