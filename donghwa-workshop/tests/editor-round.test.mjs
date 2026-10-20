import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getLevelSpec} from '../dist/reading-levels.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {normalizeStoryInput, finalizeStoryPagination, rewriteStoryPage, enrichProse, inspectStory, budgetFor} from '../dist/story-generation/pipeline.js';
import {applyRevision, revisionFingerprint, hasEditorPolicy, revisionSummary, REVISION_SCHEMA} from '../dist/story-generation/book-revision.js';
import {generateQualityProse, generateQualityOutline} from '../dist/story-generation/quality-adapter.js';
import {assertValid, OUTLINE_SCHEMA, frozenBeatCount} from '../dist/story-generation/schemas.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {getTextGenerationSettings} from '../dist/text-generation/settings-ui.js';
import * as qualityModule from '../story-quality/dist/pipeline.js';

/**
 * Editor round (2026-10-19): a whole-book read-through before the page
 * coherence review, the current book as context for page rewrites and
 * paragraph enrichment, and author-model content fixes in the quality path —
 * for drafts frozen with input.editorPolicy only.
 */
const clone = v => structuredClone(v);
const POLICY = {version: 1};
function book({policy = true} = {}) {
  const input = normalizeStoryInput({bookId: 'editor-book', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'garden', name: '정원'}], topic: '바람 피리', pageCount: 12, endingType: 'home_sleep', specs: {ko: getLevelSpec('K1'), en: getLevelSpec('E0')}, ...(policy ? {editorPolicy: POLICY} : {})});
  const outline = demoOutline(input);
  outline.plotContract = demoPlotContract(outline, input);
  const prose = demoProse(outline, input), pagination = demoPagination(outline, prose, input), briefs = demoSceneBriefs(outline, input);
  return {input, outline, prose, pagination, briefs};
}
const reply = json => ({json, text: JSON.stringify(json), usage: {input: 100, output: 50}, costUsdEstimated: 0.01, meta: {requests: 1, modelId: 'editor-mock'}});
/** Revision answers `revise(data)`; coherence passes; anything else is a test failure. */
function engine(revise, {coherence} = {}) {
  const calls = [];
  return {id: 'openai', calls, async complete(request) {
    const props = request.jsonSchema?.properties || {};
    if (props.report && props.pages) {
      calls.push({kind: 'revision', request});
      const out = revise(JSON.parse(request.user), calls.length);
      return out?.text !== undefined ? {...out, usage: {input: 100, output: 50}, meta: {requests: 1}} : reply(out);
    }
    if (props.passed && props.issues) {
      calls.push({kind: 'coherence', request});
      coherence?.(JSON.parse(request.user));
      return reply({passed: true, issues: []});
    }
    throw new Error(`unexpected request ${Object.keys(props).join(',')}`);
  }};
}
const BETTER_KO = '가방 안에서 달그락 소리가 나요. “노래하는 돌을 찾고 싶어!”';
const editedReply = (data, extra = []) => ({
  report: {overall: '전체 흐름이 좋아요. 2쪽 소리를 더 또렷하게 했어요.', strengths: ['반복되는 소리 표현'], issues: [{pageNo: 2, aspect: 'sensory', note: '소리가 흐릿해요'}, {pageNo: 5, aspect: 'pageTurn', note: '다음 쪽이 궁금하지 않아요'}]},
  pages: [{pageNo: 2, textKo: BETTER_KO, textEn: data.book.pages[1].textEn, reason: '소리를 또렷하게'}, ...extra],
});

test('the read-through runs once before the page coherence review, which reads the revised text', async () => {
  const {input, outline, prose, pagination, briefs} = book();
  let seen = null;
  const mock = engine(data => editedReply(data), {coherence: data => { seen = data.pagination.pages[1].textKo; }});
  const checkpoints = [];
  const result = await finalizeStoryPagination(outline, prose, pagination, input, {engine: mock, sceneBriefs: briefs, revise: true, skipChildGate: true, onCheckpoint: cp => checkpoints.push(clone(cp))});
  assert.deepEqual(mock.calls.map(c => c.kind), ['revision', 'coherence']);
  const sent = JSON.parse(mock.calls[0].request.user);
  assert.equal(sent.book.pages.length, 12, 'the editor reads the whole book');
  assert.equal(sent.book.pages[0].textKo, pagination.pages[0].textKo);
  assert.equal(sent.input.editorPolicy, undefined, 'the switch is not story data for the model');
  assert.deepEqual(Object.keys(sent).sort(), ['approvedOutline', 'book', 'input', 'sceneBriefs']);
  assert.match(mock.calls[0].request.system, /FINAL EDITOR READ-THROUGH/);
  assert.match(mock.calls[0].request.system, /same moment, the same actions and the same props/, 'bilingual books are aligned');
  assert.equal(mock.calls[0].request.maxTokens, budgetFor('revision', input));
  assert.equal(seen, BETTER_KO, 'coherence reviews the revised page');
  assert.equal(result.data.pages[1].textKo, BETTER_KO);
  assert.equal(result.data.pages[1].textEn, pagination.pages[1].textEn);
  assert.deepEqual(result.data.pages[1].scene, pagination.pages[1].scene, 'only the wording changes');
  assert.deepEqual(result.meta.revision.accepted, [{pageNo: 2, languages: ['ko'], reason: '소리를 또렷하게'}]);
  assert.equal(result.meta.revision.report.issues.length, 2);
  assert.equal(result.meta.requests, 2);
  assert.equal(result.usage.input, 200);
  assert.equal(result.meta.coherence.passed, true);
  assert.equal(revisionSummary(result.meta.revision), '책 전체를 읽고 1쪽을 다듬었어요');
  const saved = checkpoints.find(cp => cp.stage === 'revision');
  assert.equal(saved.revisionCheckpoint.sourceFingerprint, revisionFingerprint(pagination));
  assert.equal(saved.revisionCheckpoint.resultFingerprint, revisionFingerprint(result.data));
  assert.equal(saved.pagination.pages[1].textKo, BETTER_KO);
  assert.equal(saved.usage.input, 100);
  // A resume never buys the read-through again: replay from the source, skip on the result.
  for (const start of [pagination, saved.pagination]) {
    const again = engine(() => { throw new Error('no second read-through'); });
    const resumed = await finalizeStoryPagination(outline, prose, start, input, {engine: again, sceneBriefs: briefs, revise: true, skipChildGate: true, revisionCheckpoint: saved.revisionCheckpoint});
    assert.deepEqual(again.calls.map(c => c.kind), ['coherence']);
    assert.equal(resumed.data.pages[1].textKo, BETTER_KO);
    assert.deepEqual(resumed.meta.revision.accepted, result.meta.revision.accepted);
  }
});

test('a revised page that adds a check problem, grows, drops the refrain or names an unknown page is not kept', () => {
  const {input, outline, pagination} = book();
  const inspect = value => inspectStory(outline, value, input);
  const longSentence = '큰 돌을 톡톡 두드리고 또 두드리고 계속 두드리고 낮은 소리가 쿵쿵 울리고 멀리멀리 숲 너머까지 퍼져 나가요.';
  const response = {report: {overall: '', strengths: [], issues: []}, pages: [
    {pageNo: 3, textKo: longSentence, textEn: pagination.pages[2].textEn, reason: '길게'},
    {pageNo: 4, textKo: `${pagination.pages[3].textKo} 하나. 둘. 셋.`, textEn: pagination.pages[3].textEn, reason: '더 길게'},
    {pageNo: 40, textKo: '없는 쪽', textEn: 'none', reason: ''},
    {pageNo: 2, textKo: BETTER_KO, textEn: pagination.pages[1].textEn, reason: '좋게'},
    {pageNo: 2, textKo: '두 번째 답', textEn: 'twice', reason: ''},
  ]};
  const applied = applyRevision(pagination, response, {outline, input, inspect});
  assert.deepEqual(applied.accepted.map(row => row.pageNo), [2]);
  const reasons = Object.fromEntries(applied.rejected.map(row => [row.pageNo, row.reason]));
  assert.equal(reasons[3], 'check');
  assert.equal(reasons[4], 'longer');
  assert.equal(reasons[40], 'unknown_page');
  assert.equal(applied.pagination.pages[2].textKo, pagination.pages[2].textKo);
  assert.equal(applied.pagination.pages[1].textKo, BETTER_KO);
  assert.equal(pagination.pages[1].textKo !== BETTER_KO, true, 'the input pagination is not mutated');
  const refrainOutline = {...outline, refrain: {text: '소리가 나요', usedAtBeats: [2]}};
  const dropped = applyRevision(pagination, {pages: [{pageNo: 2, textKo: '가방이 흔들려요. “노래하는 돌을 찾고 싶어!”', textEn: pagination.pages[1].textEn, reason: ''}]}, {outline: refrainOutline, input, inspect});
  assert.deepEqual(dropped.rejected, [{pageNo: 2, reason: 'refrain'}]);
  // Never more than half the book.
  const many = applyRevision(pagination, {pages: pagination.pages.map(page => ({pageNo: page.pageNo, textKo: page.textKo.replace('요.', '요!'), textEn: page.textEn, reason: ''}))}, {outline, input, inspect});
  assert.ok(many.accepted.length <= 6);
  assert.ok(many.rejected.some(row => row.reason === 'over_limit'));
});

test('an unreadable answer keeps the pages and never stops the book; the billed call is counted', async () => {
  const {input, outline, prose, pagination, briefs} = book();
  const mock = engine(() => ({text: '읽을 수 없는 답'}));
  const result = await finalizeStoryPagination(outline, prose, pagination, input, {engine: mock, sceneBriefs: briefs, revise: true, skipChildGate: true});
  assert.deepEqual(mock.calls.map(c => c.kind), ['revision', 'coherence']);
  assert.deepEqual(result.data.pages.map(p => p.textKo), pagination.pages.map(p => p.textKo));
  assert.equal(result.meta.revision.skipped, true);
  assert.equal(revisionSummary(result.meta.revision), '');
  assert.equal(result.meta.requests, 2);
});

test('no read-through without the policy, without revise, in a demo or for a nested repagination', async () => {
  for (const [label, policy, extra] of [['legacy draft', false, {revise: true}], ['no revise option', true, {}], ['nested', true, {revise: true, skipCoherence: true}]]) {
    const {input, outline, prose, pagination, briefs} = book({policy});
    const mock = engine(() => { throw new Error(`${label}: no read-through`); });
    const result = await finalizeStoryPagination(outline, prose, pagination, input, {engine: mock, sceneBriefs: briefs, skipChildGate: true, ...extra});
    assert.ok(!mock.calls.some(c => c.kind === 'revision'), label);
    assert.equal(result.meta.revision, undefined, label);
  }
  const {input, outline, prose, pagination} = book();
  const demo = await finalizeStoryPagination(outline, prose, pagination, input, {engineId: 'demo', revise: true, skipChildGate: true});
  assert.equal(demo.meta.revision, undefined);
  assert.equal(hasEditorPolicy(input), true);
  assert.equal(hasEditorPolicy(book({policy: false}).input), false);
});

test('page rewrites and paragraph enrichment see the current book only for new drafts', async () => {
  for (const policy of [true, false]) {
    const {input, outline, prose, pagination, briefs} = book({policy});
    const changed = clone(pagination);
    changed.pages[0].textKo = '아침 햇살이 길을 환하게 비춰요. 두 친구가 소풍을 가요.';
    const pageEngine = {id: 'openai', calls: [], async complete(request) { this.calls.push(request); const page = JSON.parse(request.user).targetPage; return reply(page); }};
    await rewriteStoryPage(changed, 3, outline, prose, input, {engine: pageEngine, sceneBriefs: briefs, violations: [{kind: 'page', language: 'ko', pageNo: 3, message: '문장을 짧게 해 주세요.'}]});
    const sent = JSON.parse(pageEngine.calls[0].user);
    if (policy) {
      assert.equal(sent.currentBook.length, 12);
      assert.equal(sent.currentBook[0].textKo, changed.pages[0].textKo, 'an earlier repair is visible');
      assert.match(pageEngine.calls[0].system, /currentBook is every page of the book as it reads now/);
    } else {
      assert.equal(sent.currentBook, undefined);
      assert.doesNotMatch(pageEngine.calls[0].system, /currentBook/);
    }
    const paraEngine = {id: 'openai', calls: [], async complete(request) { this.calls.push(request); return reply({paragraph: JSON.parse(request.user).targetParagraph}); }};
    await enrichProse(prose, outline, input, {engine: paraEngine, sceneBriefs: briefs});
    const para = JSON.parse(paraEngine.calls[1].user);
    if (policy) assert.equal(para.storyInThisLanguage.split('\n\n').length, prose.ko.split('\n\n').length);
    else assert.equal(para.storyInThisLanguage, undefined);
  }
});

const read = async file => JSON.parse(await readFile(new URL(`../story-quality/data/${file}.json`, import.meta.url), 'utf8'));
const goldPart = async part => JSON.parse(await readFile(new URL(`../story-quality/gold/gold_outlines_part${part}.json`, import.meta.url), 'utf8'));
const DATA = {inventories: await read('inventories'), gestureDictionary: await read('gesture_dictionary'), plotPatterns: await read('plot_patterns'), worldLibrary: await read('worlds'), goldBooks: [...await goldPart(1), ...await goldPart(2)]};
const roles = () => {
  const log = [];
  const make = (role, handler) => ({id: `mock-${role}`, async complete(request) { log.push({role, request}); return handler(request); }});
  return {log, make};
};

test('quality path: simplify and emotion fixes are written by the author model for new drafts, the economy model before', async () => {
  for (const policy of [true, false]) {
    const input = normalizeStoryInput({bookId: 'editor-prose', topic: '비 오는 날', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'green', name: '그린이', nameEn: 'Green'}], backgrounds: [{id: 'home', type: 'home', name: '유하의 집'}, {id: 'garden', name: '꽃 정원'}, {id: 'pond', name: '연못 길'}], pageCount: 12, endingType: 'home_sleep', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, storyQuality: {enabled: true, useBeamSearch: false, twoPass: true, childSimulator: false}, ...(policy ? {editorPolicy: POLICY} : {})});
    const outline = {...demoOutline(input), refrain: null};
    const {log, make} = roles();
    const labeled = (request) => {
      const lang = /return English plain/u.test(request.system) ? 'en' : 'ko';
      const frozen = JSON.parse(request.user.match(/FROZEN_APPROVED_OUTLINE_JSON: (.*)\n/u)[1]);
      return {text: frozen.beats.map(beat => `${lang === 'ko' ? `[비트 ${beat.index} · ${beat.type}]` : `[Beat ${beat.index} · ${beat.type}]`} ${lang === 'ko' ? '유하가 작은 잎을 만져요. 그린이가 웃어요. 유하가 “나는 잎을 들어요.”라고 말해요.' : 'Yuha sees a small leaf. Green says, “I see it.” Yuha says, “I hear the wind.”'}`).join('\n\n'), usage: {input: 10, output: 5}, meta: {requests: 1}};
    };
    const qualityEngines = {outline: make('outline', labeled), prose: make('prose', labeled), cheap: make('cheap', labeled)};
    await generateQualityProse(outline, input, {qualityEngines}, {engineFor: async options => options.engine, qualityData: DATA, qualityModule: async () => qualityModule, baseSystem: 'APP', levelRules: () => 'LEVEL', assertValid, normalizeStoryInput});
    const byRole = role => log.filter(row => row.role === role).length;
    assert.ok(byRole('prose') >= 2, `${policy}: rich drafts`);
    if (policy) assert.equal(byRole('cheap'), 0, 'no printed text is written by the economy model');
    else assert.ok(byRole('cheap') >= 2, 'a pre-round draft keeps the economy simplify');
  }
});

test('quality path: the outline fix pass goes to the outline (author) model for new drafts', async () => {
  for (const policy of [true, false]) {
    const input = {bookId: 'editor-fix', qualitySeedOffset: 0, topic: '비 오는 날', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha', traits: ['관찰하는 아이']}, {id: 'green', name: '그린이', nameEn: 'Green', traits: ['느긋한 친구']}], backgrounds: [{id: 'home', type: 'home', name: '유하의 집'}, {id: 'garden', name: '꽃 정원'}, {id: 'pond', name: '연못 길'}], pageCount: 12, endingType: 'home_sleep', moral: '함께 기다리기', specs: {ko: getLevelSpec('K1'), en: getLevelSpec('E0')}, storyQuality: {enabled: true, useBeamSearch: false, twoPass: true, childSimulator: false, patternId: 'auto', worldId: 'drawer', season: 'auto', timeOfDay: 'auto', approvedBooks: []}, ...(policy ? {editorPolicy: POLICY} : {})};
    const {log, make} = roles();
    let seed = {};
    const outlineReply = request => {
      const planted = request.user.match(/- 심을 물건: (.*?) —/u)?.[1] || seed.planted, creature = request.user.match(/- 배경 생물: (.*?) \(/u)?.[1] || seed.creature;
      const reasons = [...request.user.matchAll(/\d차 (잘못된 장소|잘못된 방법|거의 됐는데 방해)/gu)].map(match => ({'잘못된 장소': 'wrong_place', '잘못된 방법': 'wrong_method', '거의 됐는데 방해': 'interrupted'})[match[1]]);
      seed = {planted, creature, reasons: reasons.length ? reasons : seed.reasons};
      let json;
      if (request.user.startsWith('아래 줄거리 JSON에서')) { json = JSON.parse(request.user.split('\n\n').at(-1)); json.beats[2].newElement = '고친 젖은 잎'; }
      else {
        const count = frozenBeatCount(input), types = ['setup', 'want', ...Array.from({length: count - 5}, () => 'attempt'), 'turn', 'resolution', 'close'], places = types.map((_, i) => i === 0 || i === count - 1 ? 'home' : i % 2 ? 'garden' : 'pond');
        let attempt = 0;
        json = {plan: {pattern: request.jsonSchema.properties.plan.properties.pattern.enum[0], planted: seed.planted, twistReveal: '앞에서 본 물건을 다시 이용해요.', funnyMoment: '바람에 잎이 코에 앉아요.', failureReasons: seed.reasons}, titleCandidates: ['바람을 듣는 날', '작은 빗방울', '잎에 담긴 소리'], logline: '유하와 그린이가 빗방울의 흔적을 찾아요.', want: '빗방울의 소리를 찾고 싶어요.', problem: '소리의 위치가 달라져요.', twist: '앞에서 본 물건이 소리를 냈어요.',
          beats: types.map((type, i) => ({index: i + 1, type, summary: `${i % 2 ? '그린이가' : '유하가'} ${['집에서', '정원에서', '연못에서', '돌 옆에서', '길에서', '집 앞에서', '방에서', '창가에서'][i]} ${input.topic}의 흔적을 살펴요. 유하와 그린이가 ${type === 'setup' || type === 'turn' ? seed.planted : '작은 잎'}을 보며 ${type === 'turn' ? seed.creature : '바람'}의 소리를 들어요.`, characters: ['yuha', 'green'], settingKey: places[i], ...(type === 'attempt' ? {failureReason: seed.reasons?.[attempt++] || 'wrong_place'} : {}), newElement: i === 2 ? '' : `새 단서 ${i + 1}`})),
          settings: places.map((id, i) => ({beatIndex: i + 1, backgroundId: id})), emotionArc: types.map(() => 'curious'), refrain: null, newWordsKo: ['빗방울', '흔적', '소리'], newWordsEn: ['drop', 'sound', 'trace'], endingType: 'home_sleep'};
        json.plotContract = demoPlotContract(json, input);
      }
      return {json, text: JSON.stringify(json), usage: {input: 100, output: 50}, meta: {requests: 1}};
    };
    const qualityEngines = {outline: make('outline', outlineReply), prose: make('prose', outlineReply), cheap: make('cheap', outlineReply)};
    const schema = () => { const value = clone(OUTLINE_SCHEMA); value.required.push('plotContract'); return value; };
    try {
      await generateQualityOutline(input, {qualityEngines}, {engineFor: async options => options.engine, qualityData: DATA, qualityModule: async () => qualityModule, outlineRequestSchema: schema, baseSystem: 'APP', levelRules: () => 'LEVEL', assertValid, inspectOutlineRules: () => ({valid: true, violations: []})});
    } catch (error) {
      // The mock outline does not need to pass every check; only the routing matters here.
      if (!log.some(row => row.request.user.startsWith('아래 줄거리 JSON에서'))) throw error;
    }
    const fix = log.find(row => row.request.user.startsWith('아래 줄거리 JSON에서'));
    assert.ok(fix, `${policy}: a fix pass ran`);
    assert.equal(fix.role, policy ? 'outline' : 'cheap');
  }
});

test('estimates: new books include the read-through and the author-model simplify; a job without the policy does not', () => {
  const settings = getTextGenerationSettings({settings: {}});
  const before = estimateStoryTextCost({settings, pageCount: 12}), after = estimateStoryTextCost({settings, pageCount: 12, editor: true});
  assert.ok(!before.stages.some(row => row.stage === 'revision'));
  const revision = after.stages.find(row => row.stage === 'revision');
  assert.equal(revision.requestCount, 1);
  assert.equal(after.requestCount, before.requestCount + 1);
  assert.equal(after.stages.find(row => row.stage === 'simplification').qualityRole, 'prose');
  assert.equal(before.stages.find(row => row.stage === 'simplification').qualityRole, 'cheap');
  assert.ok(after.costUsd > before.costUsd);
  assert.match(after.note, /책 전체 편집자 통독 1회/);
  assert.equal(after.editor, true);
  assert.equal(before.editor, undefined);
  assert.ok(REVISION_SCHEMA.properties.pages.maxItems >= 24);
});

// ---- FULL AUTO and the simple screen ----
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto, fullAutoPayload, estimateFullAutoCost} from '../dist/full-auto.js';

function jobState() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  return {state, wizard: {characterIds: ['yuha'], backgroundIds: [], topic: '바람 피리', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'}};
}
const stageResult = (data, stage) => ({data, usage: {input: 10, output: 20, costUsdEstimated: 0.01}, meta: {stage, requests: 1, model: 'mock'}});
const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(page => ({...page, ko: page.textKo, en: page.textEn})), sceneBriefs: p.sceneBriefs, revision: p.revision, storyDraftId: p.id, textGenerationSettings: p.textSettings});

test('FULL AUTO: a new job freezes the policy, asks for the read-through with the upper model and keeps its checkpoint and report', async () => {
  const {state, wizard} = jobState();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  assert.deepEqual(job.input.editorPolicy, POLICY);
  let seen = null;
  const ops = {
    preflight: async () => {},
    outline: async input => { const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input); return stageResult(outline, 'outline'); },
    briefs: async (outline, input) => stageResult(demoSceneBriefs(outline, input), 'sceneBriefs'),
    prose: async (outline, input) => stageResult(demoProse(outline, input), 'prose'),
    coherence: async (outline, prose) => ({data: {prose}, usage: {input: 0, output: 0}, meta: {requests: 0, coherence: {passed: true}}}),
    pagination: async (outline, prose, input, opts) => {
      seen = opts;
      const pagination = demoPagination(outline, prose, input), revision = {version: 1, accepted: [{pageNo: 2, languages: ['ko'], reason: '소리를 또렷하게'}], rejected: [], report: {overall: '좋아요.', strengths: [], issues: []}};
      await opts.onCheckpoint({stage: 'revision', pagination, revisionCheckpoint: {version: 1, sourceFingerprint: 'a', resultFingerprint: 'b', revision}, usage: {input: 10, output: 20}, meta: {stage: 'pagination', requests: 2}});
      return {...stageResult(pagination, 'pagination'), meta: {stage: 'pagination', requests: 2, checks: {passed: true, checks: []}, richnessChecks: {valid: true, issues: []}, revision}};
    },
  };
  // A resume with saved pages goes through repairPagination with the same options.
  ops.repairPagination = (outline, prose, pagination, input, opts) => ops.pagination(outline, prose, input, opts);
  await runFullAuto(state, job, {operations: ops, buildBook});
  assert.equal(job.status, 'text-review');
  assert.equal(seen.revise, true);
  assert.ok(seen.revisionOptions?.config?.model, 'the read-through uses the upper (coherence) model');
  assert.equal(job.revisionCheckpoint.resultFingerprint, 'b');
  assert.equal(job.revision.accepted[0].pageNo, 2);
  assert.equal(fullAutoPayload(job).revision.accepted.length, 1);
  assert.equal(job.book.revision.accepted.length, 1);
  // A resumed run hands the saved checkpoint back.
  job.completed.pagination = undefined;
  delete job.completed.pagination;
  job.status = 'paused';
  await runFullAuto(state, job, {operations: ops, buildBook});
  assert.equal(seen.revisionCheckpoint.resultFingerprint, 'b');
  // The estimate: a new job includes the read-through, a job saved before the round does not.
  const withPolicy = estimateFullAutoCost(state, wizard, {job});
  const old = clone(job);
  delete old.input.editorPolicy;
  const without = estimateFullAutoCost(state, wizard, {job: old});
  assert.ok(withPolicy.textUsd > without.textUsd);
  assert.equal(estimateFullAutoCost(state, wizard).textUsd, withPolicy.textUsd);
});

test('simple ③ names the read-through once the text is done', async () => {
  const {renderRevisionNote} = await import('../dist/story-generation/ui.js');
  const revision = {version: 1, accepted: [{pageNo: 2, languages: ['ko'], reason: '소리를 또렷하게'}], rejected: [], report: {overall: '흐름이 좋아요.', strengths: [], issues: [{pageNo: 5, aspect: 'pageTurn', note: '다음 쪽이 궁금하지 않아요'}]}};
  const html = renderRevisionNote(revision);
  assert.match(html, /편집자 통독/);
  assert.match(html, /책 전체를 읽고 1쪽을 다듬었어요 · 흐름이 좋아요\./);
  assert.match(html, /2쪽 · 소리를 또렷하게/);
  assert.match(html, /5쪽 · 다음 쪽 궁금함 · 다음 쪽이 궁금하지 않아요/);
  assert.equal(renderRevisionNote(null), '');
  assert.equal(renderRevisionNote({version: 1, skipped: true, accepted: []}), '');
  const simple = await readFile(new URL('../dist/simple-create.js', import.meta.url), 'utf8');
  assert.match(simple, /simple-revision-note/);
  const sw = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /"\.\/story-generation\/book-revision\.js"/);
  assert.match(sw, /donghwa-shell-v(?:4[3-9]|[5-9]\d)/);
});

test('the real paginateStory chain: prose review → pagination → read-through → page review', async () => {
  const {input, outline, prose, briefs} = book();
  const kinds = [];
  const mock = {id: 'openai', async complete(request) {
    const props = request.jsonSchema?.properties || {}, data = JSON.parse(request.user);
    if (props.report && props.pages) { kinds.push('revision'); return reply(editedReply(data)); }
    if (props.passed && props.issues) { kinds.push(data.pagination ? 'coherence-pages' : 'coherence-prose'); return reply({passed: true, issues: []}); }
    if (props.cover) { kinds.push('pagination'); return reply(demoPagination(outline, prose, input)); }
    throw new Error(`unexpected ${Object.keys(props)}`);
  }};
  const {paginateStory} = await import('../dist/story-generation/pipeline.js');
  const result = await paginateStory(outline, prose, input, {engine: mock, sceneBriefs: briefs, revise: true});
  assert.deepEqual(kinds, ['coherence-prose', 'pagination', 'revision', 'coherence-pages']);
  assert.equal(result.data.pages[1].textKo, BETTER_KO);
  assert.equal(result.meta.revision.accepted.length, 1);
  assert.equal(result.meta.requests, 4);
  assert.equal(result.meta.checks.passed, true);
});

test('the editor never stops a book: a page review that fails on the revised pages rolls them back and reviews the original once', async () => {
  const {input, outline, prose, pagination, briefs} = book();
  const kinds = [];
  const mock = {id: 'openai', async complete(request) {
    const props = request.jsonSchema?.properties || {}, data = JSON.parse(request.user);
    if (props.report && props.pages) { kinds.push('revision'); return reply(editedReply(data)); }
    if (props.passed && props.issues) {
      const page = data.pagination.pages[1];
      kinds.push(page.textKo === BETTER_KO ? 'review-revised' : 'review-original');
      return reply(page.textKo === BETTER_KO
        ? {passed: false, issues: [{code: 'state_conflict', beatIndex: page.beatIndex, pageNo: 2, language: 'ko', severity: 'error', evidence: page.textKo.slice(0, 12), suggestion: '소품 상태를 앞 쪽과 맞춰 주세요.'}]}
        : {passed: true, issues: []});
    }
    throw new Error(`unexpected ${Object.keys(props)}`);
  }};
  const checkpoints = [];
  const result = await finalizeStoryPagination(outline, prose, pagination, input, {engine: mock, sceneBriefs: briefs, revise: true, skipChildGate: true, coherenceRepair: false, onCheckpoint: cp => checkpoints.push(clone(cp))});
  assert.deepEqual(kinds, ['revision', 'review-revised', 'review-original']);
  assert.deepEqual(result.data.pages.map(p => p.textKo), pagination.pages.map(p => p.textKo));
  assert.equal(result.meta.revision.rolledBack, true);
  assert.deepEqual(result.meta.revision.rolledBackPages, [2]);
  assert.equal(result.meta.coherence.passed, true);
  assert.equal(result.meta.requests, 3);
  assert.equal(result.usage.input, 300);
  assert.equal(revisionSummary(result.meta.revision), '책 전체를 읽고 다듬었지만 사건 검사와 맞지 않아 원래 글을 그대로 썼어요');
  const last = checkpoints.filter(cp => cp.stage === 'revision').at(-1);
  assert.equal(last.revisionCheckpoint.resultFingerprint, revisionFingerprint(pagination));
  // Resumed after the rollback: no read-through, no review of the revised pages.
  kinds.length = 0;
  await finalizeStoryPagination(outline, prose, pagination, input, {engine: mock, sceneBriefs: briefs, revise: true, skipChildGate: true, revisionCheckpoint: last.revisionCheckpoint});
  assert.deepEqual(kinds, ['review-original']);
});
