import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getLevelSpec} from '../dist/reading-levels.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoSceneBriefs, inspectSceneBriefs, normalizeSceneBrief, normalizeSceneBriefs, sceneBriefRules, SCENE_BRIEF_SCHEMA, SCENE_BRIEFS_SCHEMA, SCENE_BRIEF_SEVERITY, poseConcern, locateBriefIssue} from '../dist/story-generation/scene-briefs.js';
import {generateSceneBriefs, rewriteSceneBrief, BRIEF_REPAIR_LIMIT, BRIEF_SOFT_REPAIR_LIMIT} from '../dist/story-generation/pipeline.js';
import {describeStoryError} from '../dist/story-generation/schemas.js';

/**
 * 2026-10-19 hotfix 4 (production screenshot: "이야기 sceneBriefs 결과를 확인해 주세요:
 * 동작에는 눈·손·발 등 신체 부위와 그릴 수 있는 행동을 함께 적어 주세요. / …" twice).
 * The pose gate demanded one of ~40 English verbs AND a body-part noun, so
 * ordinary drawable poses failed twice per beat and stopped a paid book.
 */
const clone = v => structuredClone(v);
const POSE_OLD = '동작에는 눈·손·발 등 신체 부위와 그릴 수 있는 행동을 함께 적어 주세요.';
const POSE_SOFT = '동작이 감정 표현뿐이에요(예: looks happy). 눈·손·발 등 신체 부위와 그릴 수 있는 행동을 적어 주세요.';
function fixture(topic = '공룡 친구와 소풍') {
  const input = {characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'garden', name: '정원'}], topic, pageCount: 12, endingType: 'home_sleep', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}};
  const outline = demoOutline(input);
  return {input, outline, briefs: demoSceneBriefs(outline, input)};
}
const fake = fn => ({id: 'openai', calls: [], async complete(req) { this.calls.push(req); const json = await fn(req, this.calls.length); return {json, usage: {input: 10, output: 20}, meta: {model: 'mock'}}; }});
const never = () => fake(() => { throw new Error('no paid call expected'); });
/** The gate as shipped before this hotfix (scene-briefs.js at ebfcbf9). */
const OLD_ACTION = /(?:\b(?:walk|run|lift|hold|point|crouch|blow|hug|hide|listen|splash|climb|carry|wave|peek|tiptoe|touch|reach|bend|stretch|turn|step|look|grasp|pick|put|pull|push|sit|lie|kneel|stand|tap|place|press|blowing|holding|looking|waving|sitting|lying|running|listening)[a-z]*\b)/iu;
const OLD_BODY = /(?:\b(?:hand|arm|foot|feet|toe|finger|head|face|eye|ear|tail|paw|leg|knee|body|shoulder|mouth|back|nose)s?\b)/iu;
const oldGateFails = en => !OLD_ACTION.test(en) || !OLD_BODY.test(en);

test('screenshot: drawable poses without a listed verb or body part pass, and the saved checkpoint resumes with no call', async () => {
  const {input, outline, briefs} = fixture();
  const saved = clone(briefs);
  saved[2].pose = {ko: '유하가 모자에 잎을 담아요', en: 'Yuha scoops leaves into the hat.'};
  saved[4].pose = {ko: '유하가 고개를 끄덕여요', en: 'Yuha nods.'};
  saved[5].pose = {ko: '유하가 연못으로 깡충 뛰어요', en: 'Yuha hops toward the pond.'};
  for (const index of [2, 4, 5]) assert.ok(oldGateFails(saved[index].pose.en), 'the old gate rejected this pose');
  const report = inspectSceneBriefs(saved, outline, input);
  assert.equal(report.valid, true);
  assert.equal(report.passed, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.softIssues, []);
  assert.deepEqual(report.notes, []);
  const engine = never();
  const result = await generateSceneBriefs(outline, input, {engine, sceneBriefs: saved});
  assert.equal(engine.calls.length, 0);
  assert.equal(result.meta.requests, 0);
  assert.deepEqual(result.data, saved);
  assert.equal(result.meta.softIssues, undefined);
  assert.equal(result.meta.briefRepairs, undefined);
  // A pose with neither a known verb nor a body part is a note, never a stop or a call.
  const dreamy = clone(saved);
  dreamy[1].pose = {ko: '유하가 꿈꿔요', en: 'Yuha dreams'};
  assert.equal(poseConcern(dreamy[1].pose), 'advisory');
  const noted = inspectSceneBriefs(dreamy, outline, input);
  assert.equal(noted.passed, true);
  assert.deepEqual(noted.notes, ['2번 장면: 동작에 신체 부위(눈·손·발 등)를 더하면 그림에 도움이 돼요.']);
  const quiet = never();
  const kept = await generateSceneBriefs(outline, input, {engine: quiet, sceneBriefs: dreamy});
  assert.equal(quiet.calls.length, 0);
  assert.deepEqual(kept.meta.checks.notes, noted.notes);
  assert.deepEqual(kept.meta.checks.issues, []);
  assert.equal(JSON.stringify(kept.meta.checks).includes(POSE_OLD), false);
});

test('pose judgement: only an emotion-only English pose needs a repair; Korean body parts and verbs count too', () => {
  for (const en of ['Yuha looks happy.', 'looks happy', 'happy', 'Yuha happy', 'The little rabbit Yuha is very happy', 'feels brave', 'Yuha is so excited and proud!'])
    assert.equal(poseConcern({en, ko: '유하'}), 'soft', en);
  for (const en of ['Yuha feels brave and holds the lantern', 'Yuha is happy and holds the lantern', 'Yuha jumps so happy', 'Yuha is sad, holding the broken leaf', 'Yuha scoops leaves into the hat.', 'Yuha nods.', 'Yuha smiles', 'Green tilts its head', 'holding a leaf in one hand'])
    assert.equal(poseConcern({en, ko: '유하'}), null, en);
  assert.equal(poseConcern({en: 'Yuha dreams', ko: '유하가 꿈꿔요'}), 'advisory');
  assert.equal(poseConcern({en: 'Yuha dreams', ko: '유하가 두 손을 모아요'}), null, 'a Korean body part settles it');
  assert.equal(poseConcern({en: 'Yuha dreams', ko: '유하가 돌을 던져요'}), null, 'a Korean action verb settles it');
  assert.deepEqual(Object.values(SCENE_BRIEF_SEVERITY).filter(s => s === 'hard').length, 4);
});

test('an emotion-only pose is repaired, then kept as a note; the repair request keeps its three-field violations', async () => {
  const {input, outline, briefs} = fixture();
  const first = clone(briefs);
  first[1].pose = {ko: '유하가 행복해요', en: 'Yuha looks happy.'};
  const fixedBrief = {...clone(briefs[1]), pose: {ko: '유하가 두 손을 번쩍 들어요', en: 'Yuha raises both hands'}};
  const engine = fake((req, n) => n === 1 ? {briefs: first} : fixedBrief);
  const result = await generateSceneBriefs(outline, input, {engine});
  assert.equal(engine.calls.length, 2);
  const repair = JSON.parse(engine.calls[1].user);
  assert.equal(repair.targetBeatIndex, 2);
  assert.deepEqual(repair.violations, [{beatIndex: 2, code: 'pose', message: POSE_SOFT}]);
  assert.deepEqual(Object.keys(repair), ['input', 'approvedOutline', 'targetBeatIndex', 'existingBriefs', 'violations']);
  assert.equal(result.meta.checks.passed, true);
  assert.deepEqual(result.meta.briefRepairs, {2: 1});
  assert.equal(result.data[1].pose.en, 'Yuha raises both hands');
  // A model that keeps the feeling: two repairs, then the book goes on with a note.
  const stubborn = fake((req, n) => n === 1 ? {briefs: first} : first[1]);
  const checkpoints = [];
  const kept = await generateSceneBriefs(outline, input, {engine: stubborn, onCheckpoint: cp => checkpoints.push(clone(cp))});
  assert.equal(stubborn.calls.length, 3);
  assert.equal(kept.meta.checks.valid, true);
  assert.equal(kept.meta.checks.passed, false);
  assert.deepEqual(kept.meta.softIssues, [`2번 장면: ${POSE_SOFT}`]);
  assert.deepEqual(kept.meta.briefRepairs, {2: 2});
  assert.deepEqual(checkpoints.at(-1).briefRepairs, {2: 2});
  assert.equal(kept.usage.input, 30);
  // Resumed with that checkpoint (a pause mid-stage): the soft budget is spent, nothing is bought.
  const resumed = await generateSceneBriefs(outline, input, {engine: never(), sceneBriefs: checkpoints.at(-1).sceneBriefs, briefRepairs: checkpoints.at(-1).briefRepairs});
  assert.equal(resumed.meta.requests, 0);
  assert.deepEqual(resumed.meta.softIssues, kept.meta.softIssues);
  assert.equal(BRIEF_SOFT_REPAIR_LIMIT, 2);
});

test('counts: 1~3 sounds and 2~4 props pass, an unusable item is dropped, outside the range is repaired', async () => {
  const {input, outline, briefs} = fixture();
  const loose = clone(briefs);
  loose[0].sounds = [loose[0].sounds[0]];
  loose[1].props = [...loose[1].props, {ko: '작은 바구니', en: 'small basket'}];
  loose[2].props = loose[2].props.slice(0, 2);
  loose[3].sounds = [...loose[3].sounds, {ko: '찰랑', en: 'ripple'}];
  assert.equal(inspectSceneBriefs(loose, outline, input).passed, true);
  const dropped = clone(briefs);
  dropped[3].props[2] = {ko: '풀줄기', en: ''};
  const normalized = normalizeSceneBriefs(dropped);
  assert.equal(normalized[3].props.length, 2);
  assert.equal(inspectSceneBriefs(normalized, outline, input).passed, true);
  assert.deepEqual(normalizeSceneBrief(briefs[0]), briefs[0], 'a valid brief is unchanged');
  assert.deepEqual(normalizeSceneBriefs(briefs), briefs);
  const quiet = never();
  const kept = await generateSceneBriefs(outline, input, {engine: quiet, sceneBriefs: dropped});
  assert.equal(quiet.calls.length, 0);
  assert.equal(kept.data[3].props.length, 2);
  const tooFew = clone(briefs);
  tooFew[4].props = [tooFew[4].props[0]];
  const report = inspectSceneBriefs(tooFew, outline, input);
  assert.equal(report.valid, false);
  assert.deepEqual(report.errors, ['5번 장면: props에 한글·영어 항목 3개가 필요해요.']);
  assert.deepEqual(report.hardBeatIndexes, [5]);
  const engine = fake((req, n) => n === 1 ? {briefs: tooFew} : briefs[4]);
  const result = await generateSceneBriefs(outline, input, {engine});
  assert.equal(engine.calls.length, 2);
  assert.equal(result.meta.checks.passed, true);
});

test('advisories (prop repeats, creature variety, rain props) are notes and never buy a repair', async () => {
  const {input, outline, briefs} = fixture('비 오는 날 소풍');
  const same = clone(briefs);
  for (const brief of same) { brief.props = clone(briefs[0].props); brief.creature = {ko: '작은 새', en: 'small bird'}; }
  const report = inspectSceneBriefs(same, outline, input);
  assert.equal(report.passed, true);
  assert.ok(report.notes.some(n => /소품 세트/.test(n)));
  assert.ok(report.notes.some(n => /배경 생물/.test(n)));
  assert.ok(report.notes.some(n => /우산/.test(n)));
  assert.deepEqual(report.issues, []);
  const engine = fake(() => ({briefs: same}));
  const result = await generateSceneBriefs(outline, input, {engine});
  assert.equal(engine.calls.length, 1);
  assert.deepEqual(result.meta.checks.notes, report.notes);
  assert.equal(result.meta.softIssues, undefined);
  assert.equal(result.meta.briefRepairs, undefined);
});

test('time: synonyms and capitals are normalized; a wrong first time is repaired, then kept as a note', async () => {
  const {input, outline, briefs} = fixture();
  const times = clone(briefs);
  times[0].timeOfDay = 'Morning';
  times[1].timeOfDay = 'noon';
  times[2].timeOfDay = '오후';
  assert.deepEqual(normalizeSceneBriefs(times).slice(0, 3).map(b => b.timeOfDay), ['morning', 'day', 'afternoon']);
  assert.equal(normalizeSceneBrief({beatIndex: '3', timeOfDay: 'DUSK'}).beatIndex, 3);
  assert.equal(normalizeSceneBrief({beatIndex: '3', timeOfDay: 'DUSK'}).timeOfDay, 'evening');
  // Demo times run morning, morning, day …: beat 1 at 'day' alone would also push beat 2 backwards.
  const late = clone(briefs);
  late[0].timeOfDay = 'day';
  late[1].timeOfDay = 'day';
  const engine = fake((req, n) => n === 1 ? {briefs: late} : late[0]);
  const result = await generateSceneBriefs(outline, input, {engine});
  assert.equal(engine.calls.length, 3);
  assert.equal(result.meta.checks.valid, true);
  assert.deepEqual(result.meta.softIssues, ['1번 장면: 첫 장면은 아침부터 시작해요.']);
  const backwards = clone(briefs);
  backwards[3].timeOfDay = 'morning';
  const check = inspectSceneBriefs(backwards, outline, input);
  assert.equal(check.valid, true);
  assert.deepEqual(check.softIssues, ['4번 장면: 시간이 앞 장면보다 뒤로 돌아가지 않게 해 주세요.']);
});

test('a hard issue that survives repairs stops with its scene number, and the cumulative cap ends automatic repairs', async () => {
  const {input, outline, briefs} = fixture();
  const broken = clone(briefs);
  broken[2].weather = {ko: '', en: ''};
  const stubborn = fake((req, n) => n === 1 ? {briefs: broken} : broken[2]);
  const checkpoints = [];
  await assert.rejects(generateSceneBriefs(outline, input, {engine: stubborn, onCheckpoint: cp => checkpoints.push(clone(cp))}),
    e => e.name === 'StoryValidationError' && e.message === '이야기 sceneBriefs 결과를 확인해 주세요: 3번 장면: weather에 한글·영어 설명이 필요해요.' && e.briefRepairs[3] === 2 && e.sceneBriefs.length === briefs.length && e.usage.input === 30);
  assert.equal(stubborn.calls.length, 3);
  assert.deepEqual(checkpoints.at(-1).briefRepairs, {3: 2});
  // 다시 시도: two more attempts for a hard issue, then the cap.
  const again = fake(() => broken[2]);
  await assert.rejects(generateSceneBriefs(outline, input, {engine: again, sceneBriefs: checkpoints.at(-1).sceneBriefs, briefRepairs: checkpoints.at(-1).briefRepairs}),
    e => e.briefRepairs[3] === BRIEF_REPAIR_LIMIT && !/자동 수정을/.test(e.message));
  assert.equal(again.calls.length, 2);
  const capped = never();
  await assert.rejects(generateSceneBriefs(outline, input, {engine: capped, sceneBriefs: checkpoints.at(-1).sceneBriefs, briefRepairs: {3: BRIEF_REPAIR_LIMIT}}),
    e => /^이야기 sceneBriefs 결과를 확인해 주세요: 3번 장면은 자동 수정을 4번 해도 같은 문제가 남아 더 고치지 않아요\. '줄거리 새로 만들기'로 새로 쓸 수 있어요\. \/ 3번 장면: weather에 한글·영어 설명이 필요해요\.$/.test(e.message));
  assert.equal(capped.calls.length, 0);
  // Two scenes with the same problem are told apart; the same scene is not repeated.
  const two = clone(briefs);
  two[1].humor = '';
  two[5].humor = '';
  two[5].dialogueLine = '';
  assert.deepEqual(inspectSceneBriefs(two, outline, input).errors, ['2번 장면: humor를 한글로 작성해 주세요.', '6번 장면: dialogueLine를 한글로 작성해 주세요.', '6번 장면: humor를 한글로 작성해 주세요.']);
  assert.equal(locateBriefIssue({beatIndex: 4, message: '4번 비트의 장면 디테일이 하나씩 필요해요.'}), '4번 비트의 장면 디테일이 하나씩 필요해요.');
  // What the parent reads: the stage token becomes its Korean name, other errors stay as they are.
  assert.equal(describeStoryError('이야기 sceneBriefs 결과를 확인해 주세요: 3번 장면: x'), '장면 디테일 결과를 확인해 주세요: 3번 장면: x');
  assert.equal(describeStoryError('이야기 outline 결과를 확인해 주세요: plan.planted가 비어 있음'), '줄거리 결과를 확인해 주세요: plan.planted가 비어 있음');
  assert.equal(describeStoryError('클라우드에 연결하지 못했어요.'), '클라우드에 연결하지 못했어요.');
  assert.equal(describeStoryError(null), '');
});

test('rewriteSceneBrief keeps a soft issue as a note after three tries and stops on a hard one', async () => {
  const {input, outline, briefs} = fixture();
  const emotional = {...clone(briefs[2]), pose: {ko: '유하가 기뻐요', en: 'Yuha feels glad'}};
  const soft = fake(() => emotional);
  const result = await rewriteSceneBrief(briefs, 3, outline, input, {engine: soft});
  assert.equal(soft.calls.length, 3);
  assert.equal(result.meta.repairAttempts, 3);
  assert.deepEqual(result.meta.softIssues, [`3번 장면: ${POSE_SOFT}`]);
  assert.equal(result.data[2].pose.en, 'Yuha feels glad');
  assert.deepEqual(JSON.parse(soft.calls[1].user).violations, [{beatIndex: 3, code: 'pose', message: POSE_SOFT}]);
  const hard = fake(() => ({...clone(briefs[2]), humor: ''}));
  await assert.rejects(rewriteSceneBrief(briefs, 3, outline, input, {engine: hard}), e => e.message === '이야기 sceneBriefs 결과를 확인해 주세요: 3번 장면: humor를 한글로 작성해 주세요.' && e.usage.input === 30);
  assert.equal(hard.calls.length, 3);
});

test('legacy bytes: the scene-brief prompt and schemas are unchanged, so no saved result is bought again', () => {
  const digest = createHash('sha256').update(`${sceneBriefRules()}\n${JSON.stringify(SCENE_BRIEF_SCHEMA)}\n${JSON.stringify(SCENE_BRIEFS_SCHEMA)}`).digest('hex');
  assert.equal(digest, 'b7740aaafd6b3382239114a2ff17b7f3ebce758a2bdc30bf368c511b58f20686');
});

// ---- the parent's flow: FULL AUTO stops at the brief check, 다시 시도 resumes with the saved briefs ----
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {demoProse, demoPagination} from '../dist/story-generation/demo.js';

function jobSetup() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '공룡 친구와 소풍', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
  return {state, wizard};
}
const stageResult = (data, stage) => ({data, usage: {input: 10, output: 20, costUsdEstimated: 0.01}, meta: {stage, requests: 1, model: 'mock'}});
const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(page => ({...page, ko: page.textKo, en: page.textEn})), sceneBriefs: p.sceneBriefs, worldId: p.worldId, storyDraftId: p.id, textGenerationSettings: p.textSettings});
function jobOps(briefEngines) {
  const counts = {outline: 0, briefs: 0};
  const ops = {
    preflight: async () => {},
    plan: async () => { throw Error('selection plan: no model call'); },
    characterSheet: async () => { throw Error('a text hold buys no sheet'); },
    backgroundSheet: async () => { throw Error('a text hold buys no sheet'); },
    outline: async input => { counts.outline++; return stageResult(demoOutline(input), 'outline'); },
    briefs: async (outline, input, opts) => { counts.briefs++; return generateSceneBriefs(outline, input, {...opts, engine: briefEngines.shift() || never()}); },
    prose: async (outline, input) => stageResult(demoProse(outline, input), 'prose'),
    enrichment: async prose => stageResult(prose, 'enrichment'),
    pagination: async (outline, prose, input) => ({...stageResult(demoPagination(outline, prose, input), 'pagination'), meta: {stage: 'pagination', requests: 1, checks: {passed: true, checks: []}, richnessChecks: {valid: true, issues: []}}}),
  };
  return {ops, counts};
}

test('FULL AUTO: a brief check that still fails stops with the saved briefs and repair count; 다시 시도 buys only the leftover repair', async () => {
  const {state, wizard} = jobSetup();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  assert.equal(job.demo, false);
  let outline = null, broken = null;
  const first = fake((req, n) => {
    const data = JSON.parse(req.user);
    if (n === 1) { outline = data.approvedOutline; broken = demoSceneBriefs(outline, data.input); broken[2].weather = {ko: '', en: ''}; return {briefs: broken}; }
    return broken[2];
  });
  const fixed = fake(req => ({...demoSceneBriefs(outline, JSON.parse(req.user).input)[2]}));
  const {ops, counts} = jobOps([first, fixed]);
  await assert.rejects(runFullAuto(state, job, {operations: ops, buildBook}), e => e.name === 'StoryValidationError');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, '장면 디테일 결과를 확인해 주세요: 3번 장면: weather에 한글·영어 설명이 필요해요.');
  assert.equal(first.calls.length, 3);
  assert.ok(job.completed.outline);
  assert.equal(job.completed.briefs, undefined);
  assert.equal(job.sceneBriefs.length, outline.beats.length);
  assert.deepEqual(job.briefRepairs, {3: 2});
  const failedRow = job.usage.calls.find(row => row.stage === 'sceneBriefs');
  assert.equal(failedRow.requests, 3);
  assert.equal(failedRow.failed, true);
  // 다시 시도: the saved briefs are re-inspected, the outline is not bought again, one repair call fixes beat 3.
  await runFullAuto(state, job, {operations: ops, buildBook});
  assert.equal(job.status, 'text-review');
  assert.equal(job.error, null);
  assert.deepEqual([counts.outline, counts.briefs, fixed.calls.length], [1, 2, 1]);
  assert.equal(JSON.parse(fixed.calls[0].user).targetBeatIndex, 3);
  assert.deepEqual(job.briefRepairs, {3: 3});
  assert.ok(job.completed.briefs);
  assert.equal(job.sceneBriefs[2].weather.en, 'gentle breeze');
  assert.ok(job.book.pages.length > 0, 'the text hold built the book');
});

test('FULL AUTO: a job stopped by the old pose gate resumes from its saved briefs with no scene-brief call at all', async () => {
  const {state, wizard} = jobSetup();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  // The production job: briefs saved by the checkpoint, the stage not completed, no usable pose by the old rule.
  const stopped = fake((req, n) => {
    const data = JSON.parse(req.user);
    const briefs = demoSceneBriefs(data.approvedOutline, data.input);
    briefs[2].pose = {ko: '유하가 모자에 잎을 담아요', en: 'Yuha scoops leaves into the hat.'};
    briefs[4].pose = {ko: '유하가 고개를 끄덕여요', en: 'Yuha nods.'};
    if (n !== 1) throw new Error('the pose is drawable: no repair expected');
    return {briefs};
  });
  const {ops, counts} = jobOps([stopped]);
  await runFullAuto(state, job, {operations: ops, buildBook});
  assert.equal(job.status, 'text-review');
  assert.deepEqual([counts.outline, counts.briefs, stopped.calls.length], [1, 1, 1]);
  assert.equal(job.briefRepairs, undefined);
  assert.equal(job.sceneBriefs[2].pose.en, 'Yuha scoops leaves into the hat.');
  assert.ok(!('briefRepairs' in job), 'no repair: the job gains no key');
});
