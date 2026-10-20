import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {isCoherenceCurrent, coherenceReviewRules, coherenceFingerprint} from '../dist/story-generation/coherence.js';
import {reviewStoryCoherence, finalizeStoryPagination, settleCoherenceReport, coherenceNotesForPage, normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {StoryValidationError} from '../dist/story-generation/schemas.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {renderFullAutoJobs} from '../dist/full-auto-ui.js';
import {checkNotes, renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {renderStoryChildGate} from '../dist/story-generation/ui.js';
import {buildStopReport, captureFailure, stopReportAvailable, stopReportFileName, renderStopReportModal} from '../dist/story-generation/stop-report.js';

/**
 * 2026-10-20 "또 실패해": two checks that stopped finished books. The page
 * coherence review kept flagging one English page after its two repairs, and
 * the child simulator's retell answer could not be read. Neither stops a
 * book any more: the review settles its findings as notes (FULL AUTO holds
 * at the text, ④ shows them on the page), an unreadable simulator answer is
 * asked for once more and then skipped, and a 멈춤 리포트 says what happened.
 */
const clone = value => structuredClone(value);
const paragraphs = text => text.split(/\n\s*\n/);
const reviewRequest = request => !!request.jsonSchema?.properties?.passed;
function fixture({craft = false, en = 'E0'} = {}) {
  const input = {characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'green', name: '그린이', nameEn: 'Green'}], backgrounds: [{id: 'home', name: '유하의 집', type: 'home'}, {id: 'forest', name: '숲길'}, {id: 'garden', name: '작은 정원'}], topic: '바람 피리', pageCount: 12, endingType: 'home_sleep', specs: {ko: getLevelSpec('K1'), en: getLevelSpec(en)}, ...(craft ? {craftPolicy: {version: 1}} : {})};
  const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input);
  const authored = demoProse(outline, input), prose = {...authored, paragraphBeats: {ko: outline.beats.map(beat => beat.index), en: outline.beats.map(beat => beat.index)}};
  for (const language of ['ko', 'en']) prose[language] = outline.beats.map(beat => paragraphs(authored[language]).filter((_, index) => authored.paragraphBeats[language][index] === beat.index).join(' ')).join('\n\n');
  const pagination = demoPagination(outline, prose, input);
  return {input, outline, prose, pagination};
}
function engine(answer) {
  const calls = [];
  return {id: 'openai', calls, async complete(request) { calls.push(request); const value = await answer(request, calls.length); if (value instanceof Error) throw value; return {json: clone(value), usage: {input: 10, output: 20}, costUsdEstimated: .01, meta: {modelId: 'test'}}; }};
}
const pageIssue = (pagination, pageNo = 2) => ({passed: false, issues: [{code: 'text_scene_conflict', beatIndex: pagination.pages[pageNo - 1].beatIndex, pageNo, language: 'en', severity: 'error', evidence: pagination.pages[pageNo - 1].textEn, suggestion: 'Restore the first leaf being picked up; the wording describes leaf marks instead.'}]});

test('after its two repairs the page review settles what it still flags as notes when the caller accepts, and the report stays bound to the text', async () => {
  const {input, outline, prose, pagination} = fixture();
  let repairs = 0;
  const mock = engine(request => reviewRequest(request) ? pageIssue(pagination) : {pages: [{...pagination.pages[1], textEn: `${pagination.pages[1].textEn} Again ${++repairs}.`}]});
  // Without the option the stop is unchanged.
  await assert.rejects(reviewStoryCoherence(outline, prose, pagination, input, {engine: mock}), error => error instanceof StoryValidationError && /모순이 남아/.test(error.message));
  assert.equal(mock.calls.length, 5);
  const accepting = engine(request => reviewRequest(request) ? pageIssue(pagination) : {pages: [{...pagination.pages[1], textEn: `${pagination.pages[1].textEn} Again ${++repairs}.`}]}), notes = [];
  const result = await reviewStoryCoherence(outline, prose, pagination, input, {engine: accepting, acceptUnresolvedCoherence: true, onProgress: p => notes.push(p)});
  assert.equal(accepting.calls.length, 5, 'review, repair, review, repair, review: the same budget');
  assert.equal(result.meta.unresolved, 1);
  assert.equal(result.meta.coherence.passed, true);
  assert.equal(result.meta.coherence.unresolved, 1);
  assert.deepEqual(result.meta.coherence.issues.map(issue => issue.severity), ['warning']);
  assert.ok(isCoherenceCurrent(result.meta.coherence, {outline, prose, pagination: result.data.pagination, stage: 'pages'}), 'a settled report is current for exactly this text');
  assert.ok(notes.some(p => p.phase === 'unresolved' && /참고로 남기고/.test(p.message)));
  const edited = clone(result.data.pagination); edited.pages[1].textEn += ' Edited.';
  assert.equal(isCoherenceCurrent(result.meta.coherence, {outline, prose, pagination: edited, stage: 'pages'}), false, 'an edit buys a fresh review as before');
  // The draw path reviews without repairs: one call, then the note.
  const noRepair = engine(() => pageIssue(pagination));
  const drawn = await reviewStoryCoherence(outline, prose, pagination, input, {engine: noRepair, repair: false, acceptUnresolvedCoherence: true});
  assert.equal(noRepair.calls.length, 1);
  assert.equal(drawn.meta.unresolved, 1);
  // Notes land on their page (by pageNo, or by beat when the issue names no page).
  const page = result.data.pagination.pages[1];
  assert.equal(coherenceNotesForPage(result.meta.coherence, page).length, 1);
  assert.equal(coherenceNotesForPage(result.meta.coherence, result.data.pagination.pages[0]).length, 0);
  const beatOnly = settleCoherenceReport({...pageIssue(pagination), issues: [{...pageIssue(pagination).issues[0], pageNo: null}]});
  assert.equal(coherenceNotesForPage(beatOnly, page).length, 1);
  assert.equal(coherenceNotesForPage({...result.meta.coherence, unresolved: 0}, page).length, 0, 'a review that passed on its own leaves no notes');
});

test('the reading-level allowance is sent only for craft-policy drafts whose English is E0/E1', () => {
  const legacy = coherenceReviewRules('pages', normalizeStoryInput({...fixture().input, bookId: 'x'}));
  assert.equal(legacy, coherenceReviewRules('pages'), 'legacy drafts send the previous rules byte for byte');
  const craft = coherenceReviewRules('pages', normalizeStoryInput({...fixture({craft: true}).input, bookId: 'x'}));
  assert.match(craft, /READING-LEVEL ALLOWANCE: The English is written for a beginning reader \(E0/);
  assert.ok(craft.startsWith(legacy));
  assert.equal(coherenceReviewRules('prose', normalizeStoryInput({...fixture({craft: true, en: 'E2'}).input, bookId: 'x'})), coherenceReviewRules('prose'), 'E2 English carries the Korean details');
});

test('a child simulator whose answer cannot be read twice is skipped with a note; the book goes on to its page review', async () => {
  const {input, outline, prose, pagination} = fixture();
  input.storyQuality = {enabled: true, childSimulator: true};
  let curiosity = 0, retell = 0, reviews = 0, progress = [];
  const mock = engine(request => {
    const schema = request.jsonSchema?.properties || {};
    if (schema.passed) { reviews++; return {passed: true, issues: []}; }
    if (schema.retell) { retell++; return {retell: ['유하가 바람 소리를 찾아요.', '유하가 통을 불어요.', '유하가 집으로 가요.'], coveredBeats: outline.beats.map(b => b.index), missingCore: [], confusions: [], coherence: 2}; }
    if (schema.pages && schema.overall) { curiosity++; return {pages: [], dropPages: [], overall: 5}; }
    if (schema.pages) return clone(pagination);
    throw new Error('unexpected ' + Object.keys(schema).join(','));
  });
  const result = await finalizeStoryPagination(outline, prose, pagination, input, {engine: mock, repair: false, onProgress: p => progress.push(p)});
  assert.deepEqual({curiosity, retell, reviews}, {curiosity: 2, retell: 1, reviews: 1});
  assert.equal(result.meta.childGate.skipped, true);
  assert.equal(result.meta.childGate.reason, 'unreadable');
  assert.equal(result.meta.childGate.check, 'curiosity');
  assert.equal(result.meta.childGateCheckpoint.rounds['0'].unreadable.curiosity, 2);
  assert.equal(result.meta.coherence.passed, true);
  assert.ok(result.usage.input >= 40, 'the three simulator calls and the review are all counted');
  assert.ok(progress.some(p => p.stage === 'childGate' && p.phase === 'unreadable'));
  assert.match(renderStoryChildGate(result.meta.childGate), /아이 시뮬레이터 · 건너뜀/);
  assert.equal(renderStoryChildGate({skipped: true, reason: 'disabled'}), '');
});

// ---- FULL AUTO: notes hold a full run at the text; ③ and the cards say so ----
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function setup() {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '유하와 달토끼의 별 찾기', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true};
  return {state, wizard};
}
const paid = (data, stage) => ({data, usage: {input: 10, output: 20, costUsdEstimated: .01}, meta: {stage, requests: 1, model: 'mock'}});
function ops(calls, {unresolved = 1, fail = null} = {}) {
  return {
    preflight: async () => {},
    plan: async () => { throw Error('selection plan needs no model'); },
    characterSheet: async () => { calls.sheets++; return {imageAssetId: 'image-auto-character-0001', imageUrl: image, seed: 1, meta: {quality: 'final', costUsdEstimated: .02}}; },
    backgroundSheet: async () => { calls.sheets++; return {imageAssetId: 'image-auto-background-0001', imageUrl: image, seed: 1, meta: {quality: 'final', costUsdEstimated: .02}}; },
    outline: async input => { const outline = demoOutline(input); outline.plotContract = demoPlotContract(outline, input); return paid(outline, 'outline'); },
    briefs: async (o, i) => paid(demoSceneBriefs(o, i), 'sceneBriefs'),
    prose: async (o, i) => paid(demoProse(o, i), 'prose'),
    enrichment: async p => paid(p, 'enrichment'),
    coherence: async (o, p) => ({...paid({prose: p, pagination: null}, 'coherence'), meta: {stage: 'coherence', requests: 1, coherence: {version: 1, stage: 'prose', passed: true, issues: [], contentFingerprint: coherenceFingerprint({outline: o, prose: p, stage: 'prose'}), repairAttempts: 0}}}),
    // A resumed run with saved pages goes through repairPagination: same answer.
    repairPagination: async (o, p, saved, i) => ops(calls, {unresolved, fail}).pagination(o, p, i),
    pagination: async (o, p, i) => {
      if (fail) { const error = new StoryValidationError('coherence', ['이야기 사건의 모순이 남아 그림 생성을 멈췄어요. 표시된 비트·문장을 수정한 뒤 다시 검사해 주세요.', 'Restore the first leaf being picked up.']); error.coherence = fail(demoPagination(o, p, i)); error.pagination = demoPagination(o, p, i); error.meta = {stage: 'coherence', requests: 3}; error.usage = {input: 30, output: 60}; throw error; }
      const pagination = demoPagination(o, p, i), issue = {code: 'text_scene_conflict', beatIndex: pagination.pages[1].beatIndex, pageNo: 2, language: 'en', severity: 'warning', evidence: pagination.pages[1].textEn, suggestion: 'Restore the first leaf being picked up.'};
      return {...paid(pagination, 'pagination'), meta: {requests: 1, checks: {passed: true, checks: []}, richnessChecks: {valid: true, issues: []}, coherence: {version: 1, stage: 'pages', passed: true, issues: unresolved ? [issue] : [], unresolved, contentFingerprint: coherenceFingerprint({outline: o, prose: p, pagination, stage: 'pages'}), repairAttempts: 2}}};
    },
    scene: async () => { calls.scene++; throw Error('no picture before the parent reads the notes'); },
    cover: async () => { calls.cover++; throw Error('no cover before the parent reads the notes'); },
  };
}
const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(page => ({...page, ko: page.textKo, en: page.textEn})), sceneBriefs: p.sceneBriefs, worldId: p.worldId, storyDraftId: p.id, textGenerationSettings: p.textSettings, outline: p.outline, prose: p.prose, pagination: structuredClone(p.pagination), storyInput: p.input, pageCoherence: p.pageCoherence, readingCheck: {passed: true, pages: p.pagination.pages.map(() => ({passed: true}))}});

test('a full run whose page review left notes holds at the text with a note instead of drawing; ③ and the cards name the notes', async () => {
  const {state, wizard} = setup(), calls = {sheets: 0, scene: 0, cover: 0};
  const job = createFullAutoJob(state, wizard, {planMode: 'selection'});
  assert.equal(job.stopBefore, null);
  const book = await runFullAuto(state, job, {operations: ops(calls), buildBook});
  assert.equal(job.status, 'text-review');
  assert.equal(job.stopBefore, 'text');
  assert.equal(job.pageCoherence.unresolved, 1);
  assert.deepEqual([calls.scene, calls.cover], [0, 0]);
  assert.equal(book, job.book);
  assert.equal(book.generationSnapshot, undefined);
  assert.ok(job.notes.some(note => /사건 연결 지적 1곳이 참고로 남아 그림 전에 멈췄어요/.test(note)));
  assert.equal(job.error, null);
  assert.equal(job.failure, undefined);
  assert.deepEqual(checkNotes(job), ['사건 연결 지적 1곳을 참고로 남겼어요 · ④에서 쪽마다 확인하고 고칠 수 있어요']);
  // ③ names the notes and offers the report; the simple card offers it too.
  const w = ensureSimpleWizard(state, {...structuredClone(wizard), step: 3, simpleStep: 3, simpleJobId: job.id});
  const ctx = {getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => job.book, setDraft() {}, getEditPage: () => 1, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => '<img alt="">'};
  const step3 = renderSimpleCreate(ctx);
  assert.match(step3, /사건 연결 지적 1곳을 참고로 남겼어요/);
  assert.match(step3, /data-simple-action="stop-report"[^>]*>검사 리포트</);
  assert.match(renderFullAutoJobs(state, {simple: true}), /data-full-auto-action="report"/);
  // ④ on the flagged page: the note sits on the badge with the reviewer's suggestion.
  w.simpleStep = 4; ctx.getEditPage = () => 1;
  const step4 = renderSimpleCreate(ctx);
  assert.match(step4, /확인할 곳 1곳/);
  w.simpleBadgeOpen = true;
  assert.match(renderSimpleCreate(ctx), /사건 연결 참고 \(영어\) · Restore the first leaf being picked up\./);
  ctx.getEditPage = () => 0;
  assert.match(renderSimpleCreate(ctx), /읽기 쉬움 ✓/);
  // A run without notes still goes on to the pictures.
  const clean = {sheets: 0, scene: 0, cover: 0}, plain = createFullAutoJob(state, {...wizard, topic: '별 찾기 둘'}, {planMode: 'selection'});
  await assert.rejects(runFullAuto(state, plain, {operations: ops(clean, {unresolved: 0}), buildBook}), /no picture before/);
  assert.equal(plain.stopBefore, null);
  assert.equal(clean.scene, 1);
});

test('a run that still stops keeps a structured failure for the report; retry clears it', async () => {
  const {state, wizard} = setup(), calls = {sheets: 0, scene: 0, cover: 0};
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  const failing = ops(calls, {fail: pagination => ({version: 1, stage: 'pages', passed: false, issues: [{code: 'text_scene_conflict', beatIndex: pagination.pages[1].beatIndex, pageNo: 2, language: 'en', severity: 'error', evidence: pagination.pages[1].textEn, suggestion: 'Restore the first leaf being picked up.'}], repairAttempts: 2, contentFingerprint: 'x'})});
  await assert.rejects(runFullAuto(state, job, {operations: failing, buildBook}), /모순이 남아/);
  assert.equal(job.status, 'failed');
  assert.equal(job.failure.step, 'pagination');
  assert.equal(job.failure.stage, 'coherence');
  assert.equal(job.failure.name, 'StoryValidationError');
  assert.deepEqual(job.failure.violations.slice(1), ['Restore the first leaf being picked up.']);
  assert.equal(job.failure.requests, 3);
  assert.equal(stopReportAvailable(job), true);
  const report = buildStopReport(job, {now: new Date('2026-10-20T09:00:00Z')});
  assert.match(report, /^# 동화공방 멈춤 리포트 · 유하와 달토끼의 별 찾기/);
  assert.match(report, /끝난 단계: 재료 고르기 → 시트 준비 → 줄거리 → 장면 디테일 → 한글·영어 글 → 전문 사건 연결 검사/);
  assert.match(report, /멈춘 단계: 쪽 나누기와 본문 검사 \(일관성 검사\)/);
  assert.match(report, /오류: 일관성 검사 결과를 확인해 주세요/);
  assert.match(report, /\[오류\] 글·장면 불일치 · 비트 \d+ · 2쪽 · 영어/);
  assert.match(report, /지적: Restore the first leaf being picked up\./);
  assert.match(report, /근거 인용: "/);
  assert.match(report, /### 지적된 쪽\n- \*\*2쪽/);
  assert.match(report, /- 비트 1 \[setup\]/);
  assert.match(report, /### 사용량\n- 글 요청 \d+회/);
  assert.match(report, /글 엔진: openai · 경제형 gpt-4\.1-mini · 고급 gpt-6\.1-sol · 상위 gpt-6-astra/);
  // The simple ③ failed screen offers the report next to 다시 시도.
  const w = ensureSimpleWizard(state, {...structuredClone(wizard), step: 3, simpleStep: 3, simpleJobId: job.id});
  const ctx = {getState: () => state, getWizard: () => w, setWizard() {}, getDraft: () => null, setDraft() {}, getEditPage: () => 0, setEditPage() {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''};
  const html = renderSimpleCreate(ctx);
  assert.match(html, /data-simple-action="retry"/);
  assert.match(html, /data-simple-action="stop-report"[^>]*>멈춤 리포트</);
  assert.match(renderFullAutoJobs(state), /data-full-auto-action="report"[^>]*>멈춤 리포트</);
  // 다시 시도 clears the failure before the first step.
  job.status = 'paused';
  await assert.rejects(runFullAuto(state, job, {operations: failing, buildBook}), /모순이 남아/);
  assert.ok(job.failure, 'the new stop is captured again');
  const ok = ops(calls);
  job.status = 'paused';
  await runFullAuto(state, job, {operations: ok, buildBook});
  assert.equal(job.status, 'text-review');
  assert.equal(job.failure, undefined);
});

test('the report never carries keys, endpoints or pictures, and the modal escapes its text', () => {
  const {state, wizard} = setup();
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  job.textSettings.providers.openai.apiKey = 'sk-secret-never';
  job.textSettings.providers.openai.proxyEndpoint = 'https://proxy.example/never';
  job.status = 'failed'; job.error = '줄거리 결과를 확인해 주세요: <b>금지</b>'; job.currentStep = 'outline';
  job.failure = captureFailure(Object.assign(new StoryValidationError('outline', ['주제 낱말이 없어요']), {meta: {requests: 2}}), job);
  job.usage.calls.push({input: 100, output: 50, costUsdEstimated: .5, requests: 2, callId: 'c1', apiKey: 'sk-in-usage', imageUrl: image});
  job.notes.push('첫 패턴을 통과하지 못했어요');
  const report = buildStopReport(job);
  assert.doesNotMatch(report, /sk-secret-never|proxy\.example|sk-in-usage|base64/);
  assert.match(report, /주제 낱말이 없어요/);
  assert.match(report, /메모: 첫 패턴을 통과하지 못했어요/);
  assert.match(report, /글 요청 2회/);
  assert.match(report, /저장된 검사 결과가 없어요/);
  assert.match(stopReportFileName(job, new Date('2026-10-20T09:05:00Z')), /^donghwa-report-2026-10-20-09-05-[a-z0-9]{6}\.md$/, 'ASCII only: a Korean download name is dropped by the browser');
  assert.match(stopReportFileName({id: 'auto-abc123', input: {topic: 'Moon Picnic Day'}}, new Date('2026-10-20T09:05:00Z')), /^donghwa-report-2026-10-20-09-05-moon-picnic-day-abc123\.md$/);
  const modal = renderStopReportModal(report);
  assert.match(modal, /&lt;b&gt;금지&lt;\/b&gt;/);
  assert.doesNotMatch(modal, /<b>금지<\/b>/);
  assert.match(modal, /data-stop-report="copy"/);
  assert.match(modal, /data-stop-report="download"/);
  assert.equal(stopReportAvailable({status: 'text-review', pageCoherence: {unresolved: 0}}), false);
  assert.equal(stopReportAvailable({status: 'text-review', childGate: {skipped: true, reason: 'unreadable'}}), true);
  assert.equal(buildStopReport(null), '');
});
