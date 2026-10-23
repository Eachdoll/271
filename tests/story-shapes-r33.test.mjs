import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard, storyShapeFor, renderStoryQualityPlan} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateOutline} from '../dist/story-generation/pipeline.js';
import {leanOutlineRules, leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {directionLine} from '../dist/story-generation/council.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {approvedBookRecord} from '../dist/story-generation/quality-gates.js';
import {STORY_SHAPES, STORY_SHAPE_OPTIONS, chooseStoryShape, storyShapeRule, storyShapeDirection, recentShapeIds, shapeById, storyShapeRef, isStoryShapeId} from '../dist/story-generation/story-shapes.js';
import {renderQualityPatternSelector} from '../dist/story-generation/quality-settings.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoOutlinePrompt, ecoJobInit, ecoAcceptOutline} from '../dist/eco-mode.js';
import {renderSimpleCreate, ensureSimpleWizard, formatSummary} from '../dist/simple-create.js';

/**
 * 2026-10-23 R33-2 이야기 모양. The six plot-pattern cards were the only
 * choice, and on the diet the pick did nothing. Now 28 shapes (소리 모험형,
 * 정답 누적형, …) are chosen once per draft — the parent's pick or the topic's
 * best fit, skipping the latest books' shapes — frozen in the input, carried
 * as one STORY SHAPE line of the lean outline request, heard by the writers'
 * room, kept on the outline and remembered by the book record. Drafts
 * without the diet are byte-identical (R12 pins).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizardOf = (extra = {}) => ({characterIds: ['yuha'], backgroundIds: ['home', 'beach'], topic: '유하가 바닷가에서 조개를 찾아요', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const legacy = (input) => { const copy = structuredClone(input); delete copy.promptDiet; return copy; };
const plotPatterns = JSON.parse(await readFile(new URL('../dist/story-quality/data/plot_patterns.json', import.meta.url), 'utf8'));

test('R33 the catalog: 28 shapes with unique ids, the six package patterns among them by id and name, each with a level list and a one-line spark', () => {
  assert.equal(STORY_SHAPES.length, 28);
  assert.equal(new Set(STORY_SHAPES.map(s => s.id)).size, 28);
  for (const card of plotPatterns) {
    const shape = shapeById(card.id);
    assert.ok(shape, `package pattern ${card.id} is a shape`);
    assert.equal(shape.name, card.name);
  }
  for (const shape of STORY_SHAPES) {
    assert.ok(shape.levels.length >= 2 && shape.levels.every(l => /^K[1-4]$/.test(l)), shape.id);
    assert.ok(shape.line.length > 40 && shape.shape.length > 8 && shape.bestFor.length >= 3, shape.id);
  }
  assert.ok(isStoryShapeId('sound_adventure') && isStoryShapeId('answer_pile'));
  assert.equal(STORY_SHAPE_OPTIONS.length, 29);
  assert.equal(STORY_SHAPE_OPTIONS[0][0], 'auto');
  assert.deepEqual(storyShapeRef(shapeById('answer_pile')), {version: 1, id: 'answer_pile', name: '정답 누적형'});
  assert.equal(storyShapeRef({id: 'nope'}), null);
});

test('R33 the chooser: the pick wins, else the topic\'s best fit for the level, skipping recent shapes, deterministic', () => {
  assert.equal(chooseStoryShape('아무 주제', {pick: 'answer_pile', level: 'K1'}).id, 'answer_pile', 'an explicit pick is honoured whatever the level');
  assert.equal(chooseStoryShape('유하가 숨바꼭질을 해요', {level: 'K2'}).id, 'hide_and_seek');
  assert.equal(chooseStoryShape('유하가 북 소리를 따라 모험을 떠나요', {level: 'K2'}).id, 'sound_adventure');
  const next = chooseStoryShape('유하가 북 소리를 따라 모험을 떠나요', {level: 'K2', recentIds: ['sound_adventure']}).id;
  assert.ok(['mystery_sound', 'search_wrong_answers'].includes(next), `the latest book's shape is skipped for the next sound shape (${next})`);
  assert.equal(chooseStoryShape('왜 하늘은 파랄까?', {level: 'K2'}).id, 'why_chain');
  assert.notEqual(chooseStoryShape('왜 하늘은 파랄까?', {level: 'K1'}).id, 'why_chain', 'a K2+ shape is not offered to a K1 book');
  assert.equal(chooseStoryShape('x', {pick: 'no-such-shape', level: 'K2', seed: 'a'}).id, chooseStoryShape('x', {pick: 'auto', level: 'K2', seed: 'a'}).id, 'an unknown pick is auto');
  const a = chooseStoryShape('유하', {level: 'K2', seed: 'seed-1'}), b = chooseStoryShape('유하', {level: 'K2', seed: 'seed-1'});
  assert.equal(a.id, b.id, 'the same seed gives the same shape');
  const all = STORY_SHAPES.filter(s => s.levels.includes('K2')).map(s => s.id);
  assert.ok(all.includes(chooseStoryShape('유하', {level: 'K2', recentIds: all.slice(0, 3)}).id));
  assert.ok(chooseStoryShape('유하', {level: 'K2', recentIds: all}), 'all recent: still a shape');
  assert.equal(storyShapeRule({id: 'sound_adventure'}).startsWith('STORY SHAPE — 소리 모험형: An adventure led by sounds'), true);
  assert.match(storyShapeRule({id: 'sound_adventure'}), /Lean on this shape; it is a spark, not a checklist\.$/);
  assert.equal(storyShapeRule({id: 'nope'}), '');
  assert.equal(storyShapeDirection({id: 'answer_pile'}), '이야기 모양: 정답 누적형 — 수수께끼를 하나씩 맞히며 조각(답)을 모아 마지막에 큰 답이 돼요.');
});

test('R33 a new draft freezes its shape: the pro pick, else the topic; the input carries it, the model\'s JSON never shows it', () => {
  const state = setup();
  const picked = inputFromWizard(state, wizardOf({storyQualityPatternId: 'sound_adventure'})).input;
  assert.deepEqual(picked.storyShape, {version: 1, id: 'sound_adventure', name: '소리 모양형'.replace('모양형', '모험형')});
  assert.equal(picked.storyQuality.patternId, 'sound_adventure');
  const auto = inputFromWizard(state, wizardOf({topic: '유하가 숨바꼭질을 해요'})).input;
  assert.equal(auto.storyShape.id, 'hide_and_seek');
  const simple = inputFromWizard(state, wizardOf({storyShapeId: 'answer_pile', simpleFlow: true})).input;
  assert.equal(simple.storyShape.id, 'answer_pile', 'the simple screen\'s own select');
  const normalized = normalizeStoryInput(picked);
  assert.deepEqual(normalized.storyShape, picked.storyShape);
  assert.equal('storyShape' in leanVisibleInput(normalized), false);
  assert.equal(JSON.stringify(leanVisibleInput(normalized)).includes('sound_adventure'), false);
  assert.deepEqual(storyShapeFor(state, {topic: '유하가 숨바꼭질을 해요'}, {level: 'K2'}), {version: 1, id: 'hide_and_seek', name: '숨바꼭질형'});
  // A settings default is a pick too.
  state.settings.storyQuality = {...(state.settings.storyQuality || {}), patternId: 'first_time'};
  assert.equal(inputFromWizard(state, wizardOf()).input.storyShape.id, 'first_time');
});

test('R33 the lean outline request carries one STORY SHAPE line and the writers\' room hears it; without the diet nothing changes', async () => {
  const state = setup();
  const input = normalizeStoryInput(inputFromWizard(state, wizardOf({storyQualityPatternId: 'sound_adventure'})).input);
  const rules = leanOutlineRules(input, {count: 6, attempts: 1, custom: false});
  assert.match(rules, /\nSTORY SHAPE — 소리 모험형: An adventure led by sounds[^\n]*spark, not a checklist\.\n/);
  assert.equal((rules.match(/STORY SHAPE/g) || []).length, 1);
  const bare = normalizeStoryInput({...input, storyShape: undefined});
  assert.doesNotMatch(leanOutlineRules(bare, {count: 6, attempts: 1, custom: false}), /STORY SHAPE/);
  assert.match(directionLine(input), /돌아온다\. 이야기 모양: 소리 모험형 — 소리를 내며·따라가며 떠나는 모험\. 쪽마다 새 소리말이 생겨요\. 무대: 자연 · 바다 — [^.]+\.$/);
  assert.match(directionLine({...input, direction: '웃기게'}), /^5~6세 독자\. 웃기게 이야기 모양: 소리 모험형/);
  assert.equal(directionLine(legacy(input)), directionLine(legacy(bare)), 'off the diet the shape is silent');
  assert.doesNotMatch(directionLine(legacy(input)), /이야기 모양/);
  // The paid request: the diet system prompt differs from the shapeless one only by that line; the accepted outline keeps the shape.
  const request = async (source) => {
    const calls = [];
    const draft = structuredClone(source); delete draft.councilPolicy; delete draft.orchestrationPolicy;
    const engine = {id: 'openai', async complete(req) { calls.push(req); return {json: demoOutline(normalizeStoryInput(draft)), usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
    const result = await generateOutline(draft, {engine});
    return {calls, result};
  };
  const shaped = await request(input), plain = await request(bare);
  assert.equal(shaped.calls.length, 1);
  assert.equal(shaped.calls[0].user, plain.calls[0].user, 'the JSON input is the same');
  assert.equal(shaped.calls[0].system.replace(/\nSTORY SHAPE — [^\n]*\n/, '\n'), plain.calls[0].system, 'one line apart');
  assert.deepEqual(shaped.result.data.storyShape, input.storyShape);
  assert.equal(plain.result.data.storyShape, undefined);
  // Off the diet (a K1 book takes the app path without the room): the request is byte-identical with or without a frozen shape.
  const k1 = inputFromWizard(state, wizardOf({koreanLevel: 'K1', englishLevel: 'E0', storyQualityPatternId: 'sound_adventure'})).input;
  const k1Request = async (source) => {
    const calls = [];
    const engine = {id: 'openai', async complete(req) { calls.push(req); const outline = demoOutline(normalizeStoryInput(source)); outline.plotContract = demoPlotContract(outline, normalizeStoryInput(source)); return {json: outline, usage: {input: 1, output: 1}, meta: {requests: 1}}; }};
    await generateOutline(source, {engine}).catch(() => {});
    return calls[0];
  };
  const withShape = await k1Request(legacy(k1)), withoutShape = await k1Request(legacy({...k1, storyShape: undefined}));
  assert.ok(withShape && withoutShape);
  assert.equal(withShape.system, withoutShape.system);
  assert.equal(withShape.user, withoutShape.user);
  assert.doesNotMatch(withShape.system, /STORY SHAPE/);
  assert.doesNotMatch(withShape.user, /"storyShape"/, 'the frozen shape is not story data (storyQuality.patternId was always there)');
});

test('R33 the book record remembers the shape and the next auto pick avoids it; the selectors list the 28 shapes', () => {
  const state = setup();
  const input = normalizeStoryInput(inputFromWizard(state, wizardOf({topic: '유하가 북 소리를 따라 모험을 떠나요'})).input);
  assert.equal(input.storyShape.id, 'sound_adventure');
  const outline = demoOutline(input); outline.storyShape = structuredClone(input.storyShape);
  const record = approvedBookRecord({id: 'b1', approved: true, createdAt: new Date().toISOString(), topic: input.topic, outline, storyInput: input, pages: [], characterIds: ['yuha']});
  assert.equal(record.patternId, 'sound_adventure');
  assert.equal(record.usedElements.patternId, 'sound_adventure');
  assert.deepEqual(recentShapeIds([record, {usedElements: {patternId: 'legacy'}}, {patternId: 'waiting'}]), ['sound_adventure', 'waiting']);
  state.settings.storyQuality = {...(state.settings.storyQuality || {}), approvedBooks: [{bookId: 'b1', approved: true, createdAt: new Date().toISOString(), topic: input.topic, patternId: 'sound_adventure', outline: {beats: outline.beats}, usedElements: {patternId: 'sound_adventure'}}]};
  assert.notEqual(inputFromWizard(state, wizardOf({topic: '유하가 북 소리를 따라 모험을 떠나요'})).input.storyShape.id, 'sound_adventure', 'the latest book\'s shape is skipped');
  assert.equal(inputFromWizard(state, wizardOf({topic: '유하가 북 소리를 따라 모험을 떠나요', storyQualityPatternId: 'sound_adventure'})).input.storyShape.id, 'sound_adventure', 'a pick is never skipped');
  const selector = renderQualityPatternSelector({storyQualityPatternId: 'answer_pile'}, {state});
  assert.equal((selector.match(/<option /g) || []).length, 29);
  assert.match(selector, /value="answer_pile" selected/);
  assert.match(selector, /이야기 모양/);
  assert.doesNotMatch(selector, /직접 만든 패턴/);
  state.settings.storyQuality.patterns = [...plotPatterns, {...plotPatterns[0], id: 'my_pattern', name: '우리 집 패턴'}];
  const withCustom = renderQualityPatternSelector({}, {state});
  assert.match(withCustom, /<optgroup label="직접 만든 패턴"><option value="my_pattern" >우리 집 패턴<\/option><\/optgroup>/);
  assert.equal((withCustom.match(/<option /g) || []).length, 30, 'package ids are not listed twice');
  const card = renderStoryQualityPlan({outline: {storyShape: {version: 1, id: 'sound_adventure', name: '소리 모험형'}}});
  assert.match(card, /이야기 모양과 무대/);
  assert.match(card, /이야기 모양 · 소리 모험형 — 소리를 내며/);
  assert.doesNotMatch(card, /재료 다시 뽑기/, 'no reroll button for a shape-only card');
  assert.match(renderStoryQualityPlan({outline: {plan: {pattern: 'journey_repeat', planted: '', twistReveal: '', funnyMoment: '', failureReasons: []}}, demo: true}), /<dd>반복 여정형<\/dd>/);
});

test('R33 the simple screen offers the shape in ①, the format line names a chosen one, and the eco request and its accepted outline carry it', () => {
  const state = setup();
  const w = ensureSimpleWizard(state, {...wizardOf(), step: 1, simpleStep: 1, simpleFormatOpen: true, storyShapeId: 'answer_pile'});
  const ctx = {getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''};
  const html = renderSimpleCreate(ctx);
  const select = html.match(/<select id="storyShapeId">([\s\S]*?)<\/select>/)?.[1] || '';
  assert.equal((select.match(/<option /g) || []).length, 29);
  assert.match(select, /value="answer_pile" selected/);
  assert.match(html, /<label for="storyShapeId">이야기 모양<\/label>/);
  assert.match(formatSummary({...w, stageCategoryId: 'nature_sea'}), /K2 · E2 · 12쪽 · 한 쪽에 한글 \+ 영어 · 정답 누적형 · 자연 · 바다$/);
  assert.equal(formatSummary({...w, storyShapeId: 'auto', stageCategoryId: 'auto'}), 'K2 · E2 · 12쪽 · 한 쪽에 한글 + 영어');
  const job = ecoJobInit(createFullAutoJob(state, {...wizardOf({storyShapeId: 'answer_pile', simpleFlow: true}), backgroundIds: ['beach']}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  assert.equal(job.input.storyShape.id, 'answer_pile');
  const prompt = ecoOutlinePrompt(job.input);
  assert.match(prompt, /STORY SHAPE — 정답 누적형/);
  assert.doesNotMatch(prompt.split('INPUT')[1] || '', /answer_pile/);
  const outline = demoOutline(normalizeStoryInput(job.input));
  for (const beat of outline.beats) beat.settingKey = 'beach';
  outline.settings = outline.beats.map(b => ({beatIndex: b.index, backgroundId: 'beach'}));
  const accepted = ecoAcceptOutline(JSON.stringify(outline), job.input);
  assert.equal(accepted.ok, true, (accepted.errors || []).join(' / '));
  assert.deepEqual(accepted.outline.storyShape, {version: 1, id: 'answer_pile', name: '정답 누적형'});
});
