// R31a: K1 books skip the writers' room and story spine (k1-book.js); these
// fixtures test the room and the editor round, so they use a K2 page book.
globalThis.__DONGHWA_R12_OPENINGS__ = false;
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto, COUNCIL_REVIEW_STATUS, COUNCIL_REVIEW_PHASE, fullAutoProgress} from '../dist/full-auto.js';
import {renderFullAutoLauncher, renderFullAutoJobs, redirectCouncil} from '../dist/full-auto-ui.js';
import {estimateCouncilCost} from '../dist/text-generation/models.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {renderSimpleCreate, ensureSimpleWizard, simpleJobs, simpleStepForJob, simpleStepAccess} from '../dist/simple-create.js';
import {stopReportAvailable, buildStopReport} from '../dist/story-generation/stop-report.js';

/**
 * 2026-10-20 R22 회의 결과 보고 진행: with the parent setting on (the default),
 * a FULL AUTO run parks after the writers' room scores the pitches
 * (status 'council-review', no text yet, nothing failed). The parent picks a
 * pitch and leaves a note, or rewrites the direction for a new meeting; the
 * resumed run replays the paid rounds from the journal. The option is frozen
 * on the job; a demo never parks; a job made with the option off never parks.
 */
function setup() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '유하와 달토끼의 별 찾기', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'};
  return {state, wizard};
}
const result = (data, stage) => ({data, usage: {input: 10, output: 20, costUsdEstimated: .01}, meta: {stage, requests: 1, model: 'mock'}});
const pitch = (n, title) => ({title, logline: `유하가 ${title}을 따라가요 ${n}`, stakes: '저녁 노래를 못 불러요', planted: {name: '작은 종', nameEn: 'a small bell', firstSeen: '가방 고리'}, ladder: ['시도 1', '시도 2'], lowPoint: '그냥 집에 갈까', turn: {seen: '돌 틈의 종', realized: '"내 종이잖아!"', overturns: '남의 종이 아니었어'}, payoff: '종을 울려요', echo: '머리맡의 종'});
/** The record the real council saves when it parks (phase review, the chair's pick). */
const parkedRecord = () => ({version: 1, direction: '3~4세 독자. 반전이 분명하게', conditions: [], reader: {id: 'K1', age: '3~4세'}, phase: 'review', recommended: 2, chosen: null, overrode: false, parentChoice: null, pitches: [pitch(1, '따르릉'), pitch(2, '빨간 장화의 종'), pitch(3, '노란 우산')], scores: [{pitch: 1, editor: 10, art: 7, reader: 2, score: 9.2, vetoes: ['독자: 반전을 되말하지 못함']}, {pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []}, {pitch: 3, editor: 3, art: 4, reader: 3, score: 3.3, vetoes: ['편집자: 잃는 것이 없음']}], verdicts: {editor: [], art: [], reader: [], picks: {editor: 2, art: 2, reader: 2}}, bible: null, decisions: [], roles: {chair: 'speaking', author: 'waiting', editor: 'done', art: 'done', reader: 'done'}});
/**
 * Text-only operations whose outline parks the way the real council does: the
 * rounds are saved through onCheckpoint (with their usage), then a CouncilHold
 * is thrown; with a councilChoice the outline is written.
 */
function ops() {
  const seen = [];
  return {seen, ops: {
    preflight: async () => {},
    plan: async () => result(seen.planned ? {reuseCharacterIds: [], newCharacters: [], reuseBackgroundIds: ['home', ...seen.planned], newBackgrounds: [], reason: '있는 재료로'} : {reuseCharacterIds: [], newCharacters: [{name: '달토친구', nameEn: 'Moon Rabbit', kind: 'rabbit', description: '크림색 털과 긴 귀, 파란 조끼', traits: ['호기심'], catchphrase: '나는 별을 볼래!', color: '#e0d4b0'}], reuseBackgroundIds: ['home'], newBackgrounds: [{name: '달빛 언덕', nameEn: 'Moon Hill', type: 'space', description: '달의 낮은 언덕', layout: '둥근 돌 세 개와 낮은 길, 건물 없음'}, {name: '별빛 정원', nameEn: 'Star Garden', type: 'garden', description: '별빛 아래 작은 정원', layout: '작은 둥근 화단과 곧은 흙길, 문과 건물 없음'}], reason: '달토끼와 두 장소를 더해요.'}, 'materials'),
    characterSheet: async () => { throw Error('a text run never buys a sheet'); },
    // (the plan is reused by later jobs of the same state: the ids of the two new places, once made)
    backgroundSheet: async () => { throw Error('a text run never buys a sheet'); },
    outline: async (input, options) => {
      seen.push({councilHold: options.councilHold, councilChoice: options.councilChoice, councilHistory: options.councilHistory, direction: input.direction});
      if (options.councilHold && !options.councilChoice) {
        const checkpoint = {version: 1, kind: 'council', contextFingerprint: 'fp', completed: {a: 1, b: 1, c: 1, d: 1}, record: parkedRecord()};
        await options.onCheckpoint({stage: 'council', councilCheckpoint: checkpoint, usage: {input: 40, output: 20}, meta: {stage: 'council', requests: 4, resumedCalls: 0}});
        const error = Error('기획 회의 결과를 보고 피치를 고르거나 방향을 고쳐 이어 가 주세요.');
        error.name = 'CouncilHold';
        error.stage = 'council';
        error.usageRecorded = true;
        error.usage = {input: 40, output: 20};
        error.meta = {stage: 'council', requests: 4, held: true};
        error.councilCheckpoint = checkpoint;
        throw error;
      }
      const outline = demoOutline(input);
      outline.council = {...parkedRecord(), phase: 'done', chosen: options.councilChoice?.pick || 2, parentChoice: options.councilChoice ? {pick: options.councilChoice.pick, note: options.councilChoice.note || ''} : null, roles: null};
      return result(outline, 'outline');
    },
    briefs: async (o, i) => result(demoSceneBriefs(o, i), 'sceneBriefs'),
    prose: async (o, i) => result(demoProse(o, i), 'prose'),
    enrichment: async p => result(p, 'enrichment'),
    pagination: async (o, p, i) => ({...result(demoPagination(o, p, i), 'pagination'), meta: {requests: 1, checks: {passed: true, checks: []}, richnessChecks: {valid: true, issues: []}}}),
    scene: async () => { throw Error('a text run never draws'); },
    cover: async () => { throw Error('a text run never draws'); },
  }};
}
const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(x => ({...x, ko: x.textKo, en: x.textEn})), outline: p.outline, prose: p.prose, pagination: structuredClone(p.pagination), storyInput: p.input});

test('R22 the option is a parent setting frozen on the job: on by default, off by setting or argument, never for a demo', () => {
  const {state, wizard} = setup();
  assert.equal(createFullAutoJob(state, wizard).councilReview, true);
  assert.equal(createFullAutoJob(state, wizard, {councilReview: false}).councilReview, undefined, 'no key when off: older pins and fixtures keep their shape');
  assert.equal('councilReview' in createFullAutoJob(state, wizard, {demo: true, planMode: 'selection'}), false, 'a demo never meets, so it never parks');
  state.settings.councilReview = false;
  assert.equal(createFullAutoJob(state, wizard).councilReview, undefined);
  assert.equal(createFullAutoJob(state, wizard, {councilReview: true}).councilReview, true, 'the launcher\'s own box wins over the setting');
  assert.equal(COUNCIL_REVIEW_STATUS, 'council-review');
});

test('R22 FULL AUTO parks after the room, keeps the rounds and their usage, then resumes with the parent\'s pitch to the text hold', async () => {
  const {state, wizard} = setup();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text'});
  const {ops: operations, seen} = ops();
  const progress = [];
  const parked = await runFullAuto(state, job, {operations, buildBook, onProgress: (e) => progress.push(e.message)});
  assert.equal(parked, undefined, 'no book yet');
  assert.equal(job.status, COUNCIL_REVIEW_STATUS);
  assert.equal(job.phase, COUNCIL_REVIEW_PHASE);
  assert.equal(job.currentStep, null);
  assert.equal(job.error, null);
  assert.equal(job.failure, undefined, 'a hold is not a failure');
  assert.equal(stopReportAvailable(job), false);
  assert.equal(job.completed.outline, undefined);
  assert.equal(job.completed.plan !== undefined, true, 'the material plan stays done');
  assert.equal(job.councilCheckpoint.record.phase, 'review');
  assert.equal(job.councilCheckpoint.record.recommended, 2);
  assert.deepEqual(seen, [{councilHold: true, councilChoice: null, councilHistory: [], direction: undefined}]);
  const councilRow = job.usage.calls.find(c => c.stage === 'council');
  assert.ok(councilRow, 'the four paid rounds are billed once, through the checkpoint');
  assert.equal(councilRow.requests, 4);
  assert.equal(councilRow.input, 40);
  assert.equal(councilRow.failed, undefined, 'not billed again as a failed call');
  assert.equal(job.usage.calls.filter(c => c.stage === 'council').length, 1);
  assert.equal(progress.at(-1), COUNCIL_REVIEW_PHASE);
  assert.ok(fullAutoProgress(job).fraction < 1);
  // The stop report (opened from the status window) names the parked meeting.
  const report = buildStopReport(job);
  assert.match(report, /## 기획 회의/u);
  assert.match(report, /피치 2 \(의장 추천 · 부모 선택 대기\): 빨간 장화의 종/u);
  // The parent picks pitch 1 with a note; the run goes on to the text hold.
  job.councilChoice = {pick: 1, note: '토토가 더 많이', at: '2026-10-20T00:00:00.000Z'};
  const book = await runFullAuto(state, job, {operations, buildBook});
  assert.equal(job.status, 'text-review');
  assert.equal(book, job.book);
  assert.ok(job.completed.outline);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], {councilHold: true, councilChoice: {pick: 1, note: '토토가 더 많이', at: '2026-10-20T00:00:00.000Z'}, councilHistory: [], direction: undefined});
  assert.equal(job.outline.council.parentChoice.pick, 1);
  assert.equal(job.usage.calls.filter(c => c.stage === 'council').length, 1, 'the resumed meeting bought nothing new in this mock');
  // A job made with the option off never parks.
  const plain = createFullAutoJob(state, wizard, {stopBefore: 'text', councilReview: false}), second = ops();
  second.seen.planned = state.backgrounds.filter(b => ['달빛 언덕', '별빛 정원'].includes(b.name)).map(b => b.id);
  await runFullAuto(state, plain, {operations: second.ops, buildBook});
  assert.equal(plain.status, 'text-review');
  assert.deepEqual([...second.seen], [{councilHold: undefined, councilChoice: undefined, councilHistory: undefined, direction: undefined}], 'no council options at all: the request path is R20\'s');
});

test('R22 방향 고쳐 다시 회의: the direction moves onto the input, the meeting is forgotten, the reason is logged for the next room', async () => {
  const {state, wizard} = setup();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text'});
  const {ops: operations, seen} = ops();
  await runFullAuto(state, job, {operations, buildBook});
  assert.equal(job.status, COUNCIL_REVIEW_STATUS);
  redirectCouncil(job, '  절정에서 아이가 아기 여우의 두려움에 공감하게 ');
  assert.equal(job.input.direction, '절정에서 아이가 아기 여우의 두려움에 공감하게');
  assert.equal(job.wizard.direction, '절정에서 아이가 아기 여우의 두려움에 공감하게');
  assert.equal(job.councilCheckpoint, undefined, 'the old rounds are gone: the next run meets again');
  assert.equal(job.councilChoice, null);
  assert.deepEqual(job.councilHistory.map(h => [h.kind, h.what, h.why]), [['revised', '방향 적음: “절정에서 아이가 아기 여우의 두려움에 공감하게”', '회의 결과를 보고 부모가 다시 회의를 요청']]);
  // The next run meets again with the history, parks again, and the choice goes through.
  await runFullAuto(state, job, {operations, buildBook});
  assert.equal(job.status, COUNCIL_REVIEW_STATUS);
  assert.equal(seen[1].direction, '절정에서 아이가 아기 여우의 두려움에 공감하게');
  assert.deepEqual(seen[1].councilHistory, job.councilHistory);
  redirectCouncil(job, '');
  assert.equal('direction' in job.input, false, 'an empty direction removes the key (the derived direction line again)');
  assert.equal('direction' in job.wizard, false);
  assert.equal(job.councilHistory.at(-1).what, '방향 지움: “절정에서 아이가 아기 여우의 두려움에 공감하게” (수준·가치·끝맺음에서 정한 방향으로)');
  redirectCouncil(job, '');
  assert.equal(job.councilHistory.at(-1).what, '같은 방향으로 다시 회의');
  assert.equal(job.councilHistory.length, 3);
  // One more meeting is priced from the job's frozen text settings (five economy calls).
  const cost = estimateCouncilCost(job);
  assert.ok(cost.costUsd > 0 && cost.costUsd < 0.2, String(cost.costUsd));
  assert.equal(cost.pricingUnknown, false);
  assert.deepEqual(estimateCouncilCost({...job, demo: true}), {costUsd: 0, pricingUnknown: false});
  assert.deepEqual(estimateCouncilCost(null), {costUsd: 0, pricingUnknown: false});
});

test('R22 the pro launcher offers the option, the job cards name the parked meeting, the simple library opens it', () => {
  const {state, wizard} = setup();
  assert.match(renderFullAutoLauncher(state, wizard), /id="full-auto-council-review" type="checkbox" role="switch"[^>]* checked>/u);
  state.settings.councilReview = false;
  assert.match(renderFullAutoLauncher(state, wizard), /id="full-auto-council-review" type="checkbox" role="switch"[^>]*>/u);
  const job = {id: 'auto-r22', status: COUNCIL_REVIEW_STATUS, phase: COUNCIL_REVIEW_PHASE, stopBefore: null, input: {topic: '달토끼', pageCount: 12, councilPolicy: {version: 1}}, wizard: {topic: '달토끼'}, usage: {calls: []}, imageUsage: {}, notes: [], completed: {}, councilCheckpoint: {record: parkedRecord()}, updatedAt: '2026-10-20T00:00:00Z'};
  state.fullAutoJobs = {[job.id]: job};
  const pro = renderFullAutoJobs(state);
  assert.match(pro, /FULL AUTO · 기획 회의 결과 확인<\/span>/u);
  assert.match(pro, /data-full-auto-action="status" data-id="auto-r22">회의 결과 보기<\/button>/u);
  assert.doesNotMatch(pro, /쪽마다 검수|이어서 만들기/u);
  assert.match(pro, /data-full-auto-action="delete"/u, 'a parked story can still be deleted');
  const simpleJob = {...job, id: 'auto-r22-s', stopBefore: 'text', wizard: {simpleFlow: true, topic: '달토끼'}};
  state.fullAutoJobs = {[simpleJob.id]: simpleJob};
  const simple = renderFullAutoJobs(state, {simple: true});
  assert.match(simple, /<span class="role-tag">회의 결과 확인<\/span>/u);
  assert.match(simple, /data-full-auto-action="simple-open"/u);
  assert.deepEqual(simpleJobs(state).map(j => j.id), ['auto-r22-s'], 'listed among the stories to resume');
  assert.equal(simpleStepForJob(simpleJob), 3, 'no text yet: ③');
});

test('R22 ③ of a parked story: the open room, the choice form, 계속 and 다시 회의, within the button limit; the setting line', () => {
  const {state, wizard} = setup();
  const job = {id: 'auto-r22', status: COUNCIL_REVIEW_STATUS, phase: COUNCIL_REVIEW_PHASE, stopBefore: 'text', allowNew: true, planMode: 'auto', councilReview: true,
    wizard: {simpleFlow: true, topic: wizard.topic, characterIds: ['yuha'], backgroundIds: ['home'], language: 'bilingual', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E0'},
    input: {topic: wizard.topic, pageCount: 12, councilPolicy: {version: 1}}, completed: {plan: 'x', input: 'x'}, usage: {calls: []}, imageUsage: {}, notes: [], councilCheckpoint: {record: parkedRecord()}, updatedAt: '2026-10-20T00:00:00Z'};
  state.fullAutoJobs = {[job.id]: job};
  const ctx = (w, d = null) => ({getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => d, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: c => `<svg aria-label="${c.name}"></svg>`, cover: () => '', illustration: () => ''});
  const w = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id});
  const html = renderSimpleCreate(ctx(w));
  assert.match(html, /<div class="council-room-wrap"><div class="council-room  phase-review">/u, 'the room is open, not folded, not pulsing');
  assert.match(html, /<li class="active" aria-current="step">부모 선택<\/li>/u);
  assert.match(html, /<div class="council-review" id="council-review">/u);
  assert.equal((html.match(/<input type="radio" name="council-pick"/gu) || []).length, 3);
  assert.match(html, /name="council-pick" value="2"[^>]*checked/u);
  assert.match(html, /<textarea id="council-note"/u);
  assert.match(html, /<input id="council-direction" maxlength="200" value=""/u);
  assert.match(html, /추가 예상 약 \$\d+\.\d{2,3}\./u);
  assert.match(html, /council-choice-actions/u);
  for (const action of ['council-continue', 'council-redirect', 'abandon']) assert.ok(html.includes(`data-simple-action="${action}"`));
  assert.match(html, /data-simple-action="council-continue"[^>]*>이 안으로 계속<\/button>/u);
  assert.doesNotMatch(html, /data-simple-action="(retry|restart|start-text|start-demo|stop|open-review)"/u);
  assert.doesNotMatch(html, /class="simple-progress"/u, 'no progress bar: nothing runs');
  assert.match(html, /role="switch" aria-checked="true"[^>]*data-simple-action="toggle-council-review" disabled/u, 'frozen on the job');
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]).filter(tag => !/simple-card|data-simple-nav=/.test(tag));
  assert.ok(buttons.length <= 12, `${buttons.length} buttons: ${buttons.join(' ')}`);
  assert.equal(simpleStepAccess(state, w).find(r => r.step === 3)?.mode, 'status');
  // The setting line before any job: on by default, 끄기 enabled; off → 켜기.
  const fresh = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3});
  const before = renderSimpleCreate(ctx(fresh));
  assert.match(before, /role="switch" aria-checked="true"[^>]*data-simple-action="toggle-council-review"/u);
  state.settings.councilReview = false;
  assert.match(renderSimpleCreate(ctx(fresh)), /role="switch" aria-checked="false"[^>]*data-simple-action="toggle-council-review"/u);
  // A demo story has no meeting and no line.
  const demo = {...job, id: 'auto-demo', demo: true, status: 'paused', councilCheckpoint: undefined};
  delete demo.councilReview;
  state.fullAutoJobs['auto-demo'] = demo;
  const demoHtml = renderSimpleCreate(ctx(ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: 'auto-demo'})));
  assert.doesNotMatch(demoHtml, /회의 결과 보고 진행/u);
});
