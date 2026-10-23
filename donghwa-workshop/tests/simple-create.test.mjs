import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {
  UI_MODE_KEY, readUiMode, writeUiMode, nextUiMode,
  renderSimpleCreate, ensureSimpleWizard, formatSummary,
  missingPageText, pageTextProblemMessage, carryFullAutoFields,
  recommendPlaces, recommendFriends, preselectMaterials,
  simpleJobs, simpleStepForJob, jobWizardFrom, isSimpleJob,
  topicStepButtonCount, approvalImageWork, simpleStepAccess, imageWork,
} from '../dist/simple-create.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {ecoJobInit, ecoAcceptOutline, ecoAcceptPages} from '../dist/eco-mode.js';
import {demoOutline, demoProse, demoPagination} from '../dist/story-generation/demo.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {renderFullAutoJobs} from '../dist/full-auto-ui.js';
import {setStoryQualityOption} from '../dist/story-generation/quality-settings.js';
import {renderTextEngineQuick} from '../dist/text-generation/settings-ui.js';
import {renderImageEngineQuick} from '../dist/image-generation/settings-ui.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data};
}
function setup() {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  const wizard = {step: 1, characterIds: ['yuha'], backgroundIds: [], topic: '공룡 친구와 숲으로 소풍', language: 'dual', pageCount: 8, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home'};
  return {state, wizard};
}
function book(jobId, {language = 'dual', pages = 8} = {}) {
  return {
    id: 'book-simple', title: '숲 소풍', language, fullAutoRunId: jobId,
    outline: {titleCandidates: ['숲 소풍', '초록 소풍', '공룡과 소풍']},
    pages: Array.from({length: pages}, (_, i) => ({pageNo: i + 1, ko: `${i + 1}쪽 한글`, en: `Page ${i + 1}`, textKo: `${i + 1}쪽 한글`, textEn: `Page ${i + 1}`})),
    readingCheck: {passed: true, pages: Array.from({length: pages}, () => ({passed: true}))},
  };
}
function ctxFor(state, wizard, draft = null) {
  let w = wizard, d = draft, page = 0;
  return {
    getState: () => state, getWizard: () => w, setWizard: v => { w = v; }, getDraft: () => d, setDraft: v => { d = v; },
    getEditPage: () => page, setEditPage: v => { page = v; }, isSimpleView: () => true, isSimpleMode: () => true,
    materialPortrait: c => `<svg aria-label="${c.name}"></svg>`, cover: () => '<div class="book-cover"></div>', illustration: () => '<img alt="">',
  };
}
/** Visible step buttons, excluding material cards and the page arrows (R9-B2 rule 3). */
function stepButtons(html) {
  return [...html.matchAll(/<button\b[^>]*>/g)].map(m => m[0]).filter(tag => !/simple-card/.test(tag) && !/data-simple-nav=/.test(tag));
}

test('ui mode is per device: simple by default, pro only when stored, unreadable storage is simple', () => {
  assert.equal(readUiMode(memoryStorage()), 'simple');
  assert.equal(readUiMode(memoryStorage({[UI_MODE_KEY]: 'pro'})), 'pro');
  assert.equal(readUiMode(memoryStorage({[UI_MODE_KEY]: 'weird'})), 'simple');
  assert.equal(readUiMode({getItem() { throw new Error('blocked'); }}), 'simple');
  assert.equal(readUiMode(undefined), 'simple');
  const storage = memoryStorage();
  assert.equal(writeUiMode(nextUiMode(readUiMode(storage)), storage), 'pro');
  assert.equal(storage.data.get(UI_MODE_KEY), 'pro');
  assert.equal(writeUiMode(nextUiMode(readUiMode(storage)), storage), 'simple');
  assert.equal(writeUiMode('anything', storage), 'simple');
  assert.equal(writeUiMode('pro', {setItem() { throw new Error('quota'); }}), 'pro');
  // Toggling is a device preference only: the library state is not touched.
  const {state} = setup(), before = JSON.stringify(state);
  writeUiMode('pro', memoryStorage());
  assert.equal(JSON.stringify(state), before);
});

test('each simple step shows at most 12 buttons (material cards and page arrows not counted)', () => {
  const {state, wizard} = setup();
  const job = {id: 'auto-1', status: 'text-review', stopBefore: 'text', wizard: {simpleFlow: true, topic: wizard.topic}, updatedAt: '2026-10-18T01:00:00Z'};
  const draft = book(job.id);
  job.book = draft;
  state.fullAutoJobs = {[job.id]: job};
  // Two more resumable simple jobs: step ① shows at most two cards.
  for (const id of ['auto-2', 'auto-3']) state.fullAutoJobs[id] = {id, status: 'paused', stopBefore: 'text', wizard: {simpleFlow: true, topic: id}, input: {topic: id}, updatedAt: '2026-10-18T00:00:00Z'};
  const counts = {};
  for (const step of [1, 2, 3, 4, 5]) {
    const w = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: step, ...(step >= 3 ? {simpleJobId: step === 3 ? undefined : job.id} : {})});
    if (step === 1) w.simpleFormatOpen = true;
    const html = renderSimpleCreate(ctxFor(state, w, step >= 4 ? draft : null));
    assert.match(html, new RegExp(`data-simple-step="${step}"`));
    assert.equal((html.match(/class="step /g) || []).length, 5, 'one five-step indicator');
    counts[step] = stepButtons(html).length;
    assert.ok(counts[step] <= 12, `step ${step}: ${counts[step]} buttons`);
  }
  // Editing a page swaps 글 고치기 for 저장/취소 and still stays under the cap.
  const editing = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 4, simpleJobId: job.id, simpleEditing: true});
  const editHtml = renderSimpleCreate(ctxFor(state, editing, draft));
  assert.ok(stepButtons(editHtml).length <= 12);
  assert.match(editHtml, /id="page-ko" lang="ko" >/);
  assert.match(editHtml, /data-simple-action="save-text"/);
  // ① content: 6 topic chips, the idea button, the format line and its panel.
  const first = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleFormatOpen: true})));
  assert.equal((first.match(/data-simple-action="topic"/g) || []).length, 6);
  assert.match(first, /id="topic"/);
  assert.match(first, /data-simple-action="idea"/);
  assert.doesNotMatch(first, /data-simple-action="idea"[^>]*disabled/, 'ideas come from the built-in list without a story world');
  assert.doesNotMatch(first, /프로 모드의 이야기 품질 설정|기본 무대를 골라/, 'no pro-mode explanation on the simple screen');
  assert.match(first, /K1 · E0 · 8쪽 · 한글판·영어판 두 권/);
  for (const id of ['language', 'pageCount', 'koreanLevel', 'englishLevel']) assert.match(first, new RegExp(`id="${id}"`));
  assert.doesNotMatch(first, /id="value"|id="ending"|storyWorldId/);
  assert.equal((first.match(/simple-resume-card/g) || []).length, 2);
  // FIX-UI-3: the forced screen's '프로 만들기 화면' takes one card's place at ①,
  // and the cards left out are named (they stay in the library's job list).
  const forcedWizard = ensureSimpleWizard(state, {...structuredClone(wizard), simpleForced: true, simpleFormatOpen: true});
  assert.equal(topicStepButtonCount(forcedWizard), 11);
  const forced = renderSimpleCreate(ctxFor(state, forcedWizard));
  assert.match(forced, /data-simple-action="exit-forced"/);
  assert.equal((forced.match(/simple-resume-card/g) || []).length, 1);
  assert.match(forced, /나머지 2권은 책장의 ‘제작 중인 이야기’에서/);
  assert.ok(stepButtons(forced).length <= 12, `forced ①: ${stepButtons(forced).length} buttons`);
  assert.equal(stepButtons(forced).length, 12);
  // However many simple stories are waiting, ① never passes the limit.
  for (const id of ['auto-4', 'auto-5', 'auto-6']) state.fullAutoJobs[id] = {id, status: 'paused', stopBefore: 'text', wizard: {simpleFlow: true, topic: id}, input: {topic: id}, updatedAt: '2026-10-17T00:00:00Z'};
  for (const simpleForced of [false, true]) {
    const many = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleForced})));
    assert.ok(stepButtons(many).length <= 12, `① with 6 waiting stories (forced: ${simpleForced}): ${stepButtons(many).length}`);
  }
  for (const id of ['auto-4', 'auto-5', 'auto-6']) delete state.fullAutoJobs[id];
  // ④ text is read-only until 글 고치기 and the page has the four page actions.
  const review = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 4, simpleJobId: job.id}), draft));
  assert.match(review, /id="page-ko" lang="ko" readonly/);
  assert.match(review, /id="page-en" lang="en" readonly/);
  for (const action of ['edit-text', 'rewrite-text', 'draw-page', 'like', 'draw-all', 'restart']) assert.match(review, new RegExp(`data-simple-action="${action}"`));
  assert.match(review, /1 \/ 8/);
  assert.match(review, /읽기 쉬움 ✓/);
  // ③ costs: text now, images in the next step; demo is an explicit separate button.
  const generate = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3})));
  assert.match(generate, /data-simple-action="start-text"/);
  assert.match(generate, /data-simple-action="start-demo"/);
  assert.match(generate, /그림은 다음 단계에서/);
  assert.match(generate, /role="switch" aria-checked="false"[^>]*data-simple-action="toggle-distilled"/);
  assert.ok(counts[2] <= 3, 'step ② is cards plus 이전/다음');
});

test('④ shows only the book language and ⑤ offers the outline title candidates', () => {
  const {state, wizard} = setup();
  const job = {id: 'auto-ko', status: 'text-review', stopBefore: 'text', wizard: {simpleFlow: true}, updatedAt: 'x'};
  const ko = book(job.id, {language: 'ko'});
  job.book = ko;
  state.fullAutoJobs = {[job.id]: job};
  const html = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...wizard, simpleStep: 4, simpleJobId: job.id}), ko));
  assert.match(html, /id="page-ko"/);
  assert.doesNotMatch(html, /id="page-en"/);
  const finish = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...wizard, simpleStep: 5, simpleJobId: job.id}), ko));
  assert.equal((finish.match(/name="simple-title"/g) || []).length, 3);
  assert.match(finish, /data-action="preview-draft-print"/);
  assert.match(finish, /data-simple-action="save-book"/);
});

test('approve check follows the book language (ko-only and en-only books need one language)', () => {
  const dual = book('a'), ko = book('a', {language: 'ko'}), en = book('a', {language: 'en'});
  assert.deepEqual(missingPageText(dual), []);
  for (const b of [dual, ko, en]) b.pages[2].en = '';
  for (const b of [dual, ko, en]) b.pages[2].textEn = '';
  assert.deepEqual(missingPageText(dual), [2]);
  assert.deepEqual(missingPageText(ko), [], 'a Korean-only book needs no English text');
  assert.deepEqual(missingPageText(en), [2]);
  en.pages[2].en = 'Page 3';
  en.pages[4].ko = '';
  en.pages[4].textKo = '';
  assert.deepEqual(missingPageText(en), [], 'an English-only book needs no Korean text');
  const bilingual = book('a', {language: 'bilingual'});
  bilingual.pages[0].ko = ' ';
  bilingual.pages[0].textKo = '';
  assert.deepEqual(missingPageText(bilingual), [0]);
  assert.match(pageTextProblemMessage(ko), /한글 글/);
  assert.match(pageTextProblemMessage(en), /영어 글/);
  assert.match(pageTextProblemMessage(dual), /한글·영어 글/);
});

test('a rebuilt book keeps its FULL AUTO link and the job points at the new book', () => {
  const state = {fullAutoJobs: {}};
  const old = {...book('auto-9'), autoReviewPending: true, autoGenerationComplete: true};
  state.fullAutoJobs['auto-9'] = {id: 'auto-9', status: 'review', book: old};
  const rebuilt = {id: old.id, pages: []};
  carryFullAutoFields(state, rebuilt, old);
  assert.equal(rebuilt.fullAutoRunId, 'auto-9');
  assert.equal(rebuilt.autoReviewPending, true);
  assert.equal(rebuilt.autoGenerationComplete, true);
  assert.equal(state.fullAutoJobs['auto-9'].book, rebuilt);
  // A running job keeps drawing into its own book object.
  const running = {fullAutoJobs: {'auto-r': {id: 'auto-r', status: 'running', book: old}}};
  carryFullAutoFields(running, {id: old.id}, {...old, fullAutoRunId: 'auto-r'});
  assert.equal(running.fullAutoJobs['auto-r'].book, old);
  // No prior book or no FULL AUTO link: nothing changes.
  const plain = {id: 'b'};
  carryFullAutoFields(state, plain, null);
  carryFullAutoFields(state, plain, {id: 'b'});
  assert.deepEqual(plain, {id: 'b'});
});

test('places and friends are recommended from the topic and preselected once', () => {
  const {state, wizard} = setup();
  assert.deepEqual(recommendPlaces('달에 놀러 간 날', state.backgrounds), ['moon']);
  assert.ok(recommendPlaces('공룡 친구와 숲으로 소풍', state.backgrounds).includes('forest'));
  assert.ok(recommendPlaces('바닷속 보물 찾기', state.backgrounds).includes('beach'));
  assert.ok(!recommendPlaces('달과 별', state.backgrounds).includes('home'), 'home is never a recommendation');
  assert.deepEqual(recommendFriends('공룡 친구와 소풍', state.characters.slice(1)), ['greenie']);
  preselectMaterials(state, wizard);
  assert.equal(wizard.characterIds[0], 'yuha');
  assert.ok(wizard.characterIds.includes('greenie'));
  assert.equal(wizard.backgroundIds[0], 'home');
  assert.ok(wizard.backgroundIds.includes('forest'));
  wizard.simplePicksTouched = true;
  wizard.topic = '달에 놀러 간 날';
  preselectMaterials(state, wizard);
  assert.ok(!wizard.backgroundIds.includes('moon'), 'a parent pick is never overwritten');
  assert.equal(formatSummary({language: 'ko', koreanLevel: 'K2', pageCount: 12}), 'K2 · 12쪽 · 한글만');
  assert.equal(formatSummary({language: 'en', englishLevel: 'E1', pageCount: 16}), 'E1 · 16쪽 · 영어만');
});

test('simple jobs resume at ③ before the book exists and at ④ after; replaced stories are hidden', () => {
  assert.equal(simpleStepForJob({status: 'running'}), 3);
  assert.equal(simpleStepForJob({status: 'paused'}), 3);
  assert.equal(simpleStepForJob({status: 'failed'}), 3);
  assert.equal(simpleStepForJob({status: 'text-review', book: {}}), 4);
  assert.equal(simpleStepForJob({status: 'pages-ready', book: {}}), 4);
  assert.equal(simpleStepForJob({status: 'review', book: {}}), 4);
  assert.equal(simpleStepForJob({status: 'paused', book: {}}), 4);
  const state = {fullAutoJobs: {
    a: {id: 'a', status: 'text-review', stopBefore: 'text', updatedAt: '2'},
    b: {id: 'b', status: 'running', wizard: {simpleFlow: true}, updatedAt: '3'},
    c: {id: 'c', status: 'paused', stopBefore: null, wizard: {}, updatedAt: '4'},
    d: {id: 'd', status: 'text-review', stopBefore: 'text', simpleReplacedBy: 'b', updatedAt: '5'},
    e: {id: 'e', status: 'final', wizard: {simpleFlow: true}, updatedAt: '6'},
  }};
  assert.deepEqual(simpleJobs(state).map(j => j.id), ['b', 'a']);
  assert.equal(isSimpleJob(state.fullAutoJobs.c), false, 'a pro FULL AUTO job stays in the pro job cards');
  const copy = jobWizardFrom({topic: 't', simpleStep: 3, simpleEditing: true, simpleJobId: 'x', characterIds: ['yuha']}, 'tok');
  assert.deepEqual(copy, {topic: 't', characterIds: ['yuha'], simpleFlow: true, simpleRunToken: 'tok'});
});

test('the 승인 예시 switch spread-merges one key and stays off by default', () => {
  const state = {settings: {storyQuality: {approvedBooks: [{bookId: 'x'}], coachUsage: [1], useBeamSearch: true}}};
  assert.equal(setStoryQualityOption(state, 'useDistilledExamples', true), true);
  assert.deepEqual(state.settings.storyQuality, {approvedBooks: [{bookId: 'x'}], coachUsage: [1], useBeamSearch: true, useDistilledExamples: true});
  setStoryQualityOption(state, 'useDistilledExamples', 'yes');
  assert.equal(state.settings.storyQuality.useDistilledExamples, false, 'only an explicit true turns it on');
  assert.throws(() => setStoryQualityOption(state, 'patterns', true), /바꿀 수 없어요/);
  const fresh = {settings: {}};
  const {wizard} = setup(), full = setup().state;
  const html = renderSimpleCreate(ctxFor(full, ensureSimpleWizard(full, {...wizard, simpleStep: 3})));
  assert.match(html, /role="switch" aria-checked="false"[^>]*data-simple-action="toggle-distilled"/);
  assert.equal(fresh.settings.storyQuality, undefined);
});

test('the shell precaches the simple create screen (cache v33 or later)', async () => {
  const {readFileSync} = await import('node:fs');
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.ok(Number(sw.match(/const CACHE = "donghwa-shell-v(\d+)";/)?.[1]) >= 34);
  assert.ok(sw.includes('"./simple-create.js"'));
});

test('the library review refuses, in both modes, while a simple action or a page operation owns the book', async () => {
  const {readFileSync} = await import('node:fs');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{ isPageOperationBusy \} from "\.\/story-generation\/page-tools\.js";/);
  const start = app.indexOf('  openReview: async (job) => {');
  assert.ok(start > 0);
  const body = app.slice(start, app.indexOf('\n  },\n', start));
  const guard = body.indexOf('if (isSimpleBusy() || isPageOperationBusy(job.book?.id)) {'),
    refuse = body.indexOf('toast("진행 중인 작업이 끝난 뒤 열어 주세요.");'),
    leave = body.indexOf('return;', refuse);
  assert.ok(guard > 0 && refuse > guard && leave > refuse, body);
  // Nothing closes, opens or changes before the refusal returns.
  for (const later of ['closeModal()', 'draft = job.book', 'uiMode === "simple"', 'openSimpleJob(']) {
    assert.ok(body.indexOf(later) > leave, later);
  }
});

test('the pro review keeps pictures a runner marked stale on an idle book, as simple ④ does', async () => {
  const {readFileSync} = await import('node:fs');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('  openReview: async (job) => {');
  const body = app.slice(start, app.indexOf('\n  },\n', start));
  const pro = body.indexOf('closeModal();', body.indexOf('openSimpleJob(')),
    keep = body.indexOf('keepEditedPictures(job.book)'),
    idle = body.indexOf('job.status !== "running"'),
    open = body.indexOf('draft = job.book');
  assert.ok(pro > 0 && idle > pro && keep > idle && open > keep, body);
  assert.match(body.slice(keep, open), /save\(\);/);
});

test('simple settings reuse the existing form ids so the existing handlers save them', () => {
  const {state} = setup();
  const text = renderTextEngineQuick(state);
  for (const id of ['text-engine-form', 'tg-engine', 'tg-provider-fields', 'tg-hybrid', 'tg-hybrid-fields', 'tg-hybrid-local-fields', 'tg-final-engine', 'tg-final-provider-fields', 'tg-story-enrichment', 'tg-image-diversity', 'tg-error'])
    assert.match(text, new RegExp(`id="${id}"`), id);
  assert.match(text, /data-text-field="apiKey"/);
  assert.match(text, /data-text-setting="save-key"/);
  assert.match(text, /data-text-setting="delete-key"/);
  const image = renderImageEngineQuick(state);
  for (const id of ['ig-world-form', 'ig-world-name', 'ig-style', 'ig-engine', 'ig-provider-fields'])
    assert.match(image, new RegExp(`id="${id}"`), id);
  assert.match(image, /type="hidden" id="ig-style" value="watercolor"|type="hidden" id="ig-style" value="[a-z-]+"/);
});

// ---- FIX-UI-3 ----
test('approving draws only pages without a current final picture, and prices only those', () => {
  const finalPage = id => ({imageAssetId: id, imageUrl: 'asset:' + id, imageMeta: {quality: 'final'}});
  const make = () => ({
    pages: Array.from({length: 8}, (_, i) => ({pageNo: i + 1, ko: `${i + 1}쪽`, en: `p${i + 1}`, ...finalPage(`img-${i}`)})),
    cover: {imageAssetId: 'cover-1', meta: {quality: 'final'}},
    fullAutoRunId: 'auto-x',
  });
  // A finished FULL AUTO book: nothing to draw, as before.
  const done = make();
  done.autoGenerationComplete = true;
  assert.deepEqual(approvalImageWork(done, 'openai'), {finalize: false, pages: [], cover: false, stale: []});
  // Stopped after the last picture (the run never recorded its finish): every
  // picture was bought, so approving buys none of them again.
  const paused = make();
  paused.autoGenerationComplete = false;
  assert.deepEqual(approvalImageWork(paused, 'openai'), {finalize: true, pages: [], cover: false, stale: []});
  // Only the missing page, the draft-quality page, the page with the runner's
  // stale mark and the missing cover; a kept picture (parent's choice) is not redrawn.
  const mixed = make();
  delete mixed.pages[2].imageAssetId; delete mixed.pages[2].imageUrl; delete mixed.pages[2].imageMeta;
  mixed.pages[4].imageMeta = {quality: 'draft'};
  Object.assign(mixed.pages[5], {imageStale: true, imageStaleAt: 't', imageStaleAssetId: 'img-5'});
  Object.assign(mixed.pages[6], {simpleTextEditedAssetId: 'img-6', simpleTextEditedAt: 't'});
  delete mixed.cover;
  assert.deepEqual(approvalImageWork(mixed, 'openai'), {finalize: true, pages: [2, 4, 5], cover: true, stale: [5]});
  // A stale mark left on a picture redrawn since is obsolete: that page is current.
  const redrawn = make();
  Object.assign(redrawn.pages[1], {imageStale: true, imageStaleAssetId: 'old-image'});
  assert.deepEqual(approvalImageWork(redrawn, 'openai').pages, []);
  // A pro book drawn in draft quality is finalized whole, as before.
  const pro = make();
  delete pro.fullAutoRunId;
  pro.pages.forEach(p => { p.imageMeta = {quality: 'draft'}; });
  pro.cover = {imageAssetId: 'c', meta: {quality: 'draft'}};
  assert.deepEqual(approvalImageWork(pro, 'openai'), {finalize: true, pages: [0, 1, 2, 3, 4, 5, 6, 7], cover: true, stale: []});
  // The free sample engine with no draft pictures keeps its plain approval.
  const sample = make();
  sample.pages.forEach(p => { delete p.imageAssetId; delete p.imageMeta; });
  assert.equal(approvalImageWork(sample, 'sample').finalize, false);
  sample.pages[1] = {...sample.pages[1], ...finalPage('s1'), imageMeta: {quality: 'draft'}};
  assert.ok(approvalImageWork(sample, 'sample').finalize);
});

test('approve-book and finalizeBook draw and price only the planned pages and cover', async () => {
  const {readFileSync} = await import('node:fs');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const approve = app.slice(app.indexOf('async function approveDraft() {'), app.indexOf('function discardDraft('));
  assert.match(approve, /work = approvalImageWork\(book, engine\)/);
  assert.match(approve, /finalizeImages = work\.finalize && \(work\.pages\.length > 0 \|\| work\.cover\)/);
  assert.match(approve, /pageCount: work\.pages\.length,\s*includeCover: work\.cover,/);
  assert.match(approve, /pages: work\.pages,\s*cover: work\.cover,/);
  assert.doesNotMatch(approve, /pageCount: book\.pages\.length/, 'the confirm never prices every page');
  assert.doesNotMatch(approve, /autoImagesReady/);
  const finalize = app.slice(app.indexOf('async function finalizeBook('), app.indexOf('/** Approve the open draft'));
  // Every page only when every page needs it; otherwise just the listed pages, one by one.
  assert.match(finalize, /if \(redraw\.length === book\.pages\.length\)\s*await generateAllScenes\(/);
  assert.match(finalize, /for \(const \[done, index\] of redraw\.entries\(\)\) \{[\s\S]*?await generateScene\(state, book, index, \{/);
  assert.match(finalize, /if \(cover\) \{[\s\S]*?await generateCover\(/);
});

test('a FULL AUTO story draft is never rebuilt from the story workflow', async () => {
  const {readFileSync} = await import('node:fs');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const accept = app.slice(app.indexOf('async function acceptStoryResult(result) {'), app.indexOf('function renderStoryQuality('));
  const guard = accept.indexOf('if (fullAutoJobOfStory(result.id)) throw Error(FULL_AUTO_NOT_REBUILT);');
  assert.ok(guard > 0, accept);
  assert.ok(accept.indexOf('buildStoryResultBook(result)') > guard, 'the guard runs before any rebuild');
  const regenerate = app.slice(app.indexOf('if (a === "regenerate-text") {'), app.indexOf('if (a === "approve-book") {'));
  assert.ok(regenerate.indexOf('fullAutoJobOfStory(draft.storyDraftId)') < regenerate.indexOf('resumeStoryDraft('), regenerate);
  // '검수 열기' refuses while a simple action or a page operation owns the book, before anything opens.
  const open = app.slice(app.indexOf('async function openAutoJobReview(jobId) {'), app.indexOf('async function acceptStoryResult('));
  const busy = open.indexOf('isSimpleBusy() ||'), refuse = open.indexOf('toast("진행 중인 작업이 끝난 뒤 열어 주세요.");');
  assert.ok(busy > 0 && refuse > busy, open);
  for (const later of ['closeModal()', 'openSimpleJob(', 'openFullAutoReview(']) assert.ok(open.indexOf(later) > refuse, later);
  assert.match(app, /onReady: acceptStoryResult,\s*openAutoReview: openAutoJobReview,/);
});

// ---- R11: moving between the five steps ----
/** A simple job; `text` gives it a held book (글 검수 대기). */
function heldJob(state, id = 'auto-r11', {text = true, status} = {}) {
  const job = {
    id, status: status || (text ? 'text-review' : 'paused'), stopBefore: 'text', allowNew: true, planMode: 'auto',
    wizard: {simpleFlow: true, topic: '공룡 친구와 숲으로 소풍', characterIds: ['yuha', 'greenie', 'auto-friend'], backgroundIds: ['home', 'forest', 'auto-place'], language: 'dual', pageCount: 8, koreanLevel: 'K1', englishLevel: 'E0', qualitySeedOffset: 2},
    plan: {characterIds: ['yuha', 'greenie', 'auto-friend'], backgroundIds: ['home', 'forest', 'auto-place'], newCharacters: [{id: 'auto-friend', name: '새 친구 포포', role: '친구'}], newBackgrounds: [{id: 'auto-place', name: '버섯 언덕', type: 'forest', description: '새로 만든 장소'}]},
    input: {topic: '공룡 친구와 숲으로 소풍'}, completed: {outline: 'x'}, usage: {calls: []}, imageUsage: {}, updatedAt: '2026-10-18T02:00:00Z',
  };
  if (text) job.book = book(id);
  state.fullAutoJobs = {...(state.fullAutoJobs || {}), [id]: job};
  return job;
}
const stepLinks = html => [...html.matchAll(/<button\b[^>]*data-simple-action="goto-step"[^>]*>/g)].map(m => m[0]);
const linkSteps = html => stepLinks(html).map(tag => Number(tag.match(/data-step="(\d)"/)[1]));

test('R11 access matrix: no job, a job without text, a held job, editing and ⑤ while busy', () => {
  const {state, wizard} = setup();
  const rows = (w, opts) => simpleStepAccess(state, w, opts);
  const open = list => list.filter(r => r.reachable).map(r => r.step);
  // No job: ① always; ② needs a safe topic; ③ also needs valid materials; ④⑤ need the text.
  assert.deepEqual(open(rows({...wizard, topic: ''})), [1]);
  assert.match(rows({...wizard, topic: ''})[1].reason, /주제/);
  assert.deepEqual(open(rows(structuredClone(wizard))), [1, 2, 3]);
  assert.deepEqual(rows(structuredClone(wizard)).map(r => r.mode), ['edit', 'edit', 'edit', 'review', 'finish']);
  assert.equal(rows(structuredClone(wizard))[3].reason, '③에서 글을 먼저 만들어 주세요.');
  // 자동 추가 off: ③ waits for home + two places; the check recommends on a copy only.
  const strict = {...structuredClone(wizard), topic: '비 오는 날 숲 산책', allowNew: false};
  assert.deepEqual(open(rows(strict)), [1, 2, 3], 'untouched picks: home + two recommended places fill them first');
  assert.deepEqual(strict.backgroundIds, [], 'the access check never changes the wizard');
  assert.equal(strict.simplePickedFor, undefined);
  // R33: one place is enough — the story goes where the topic puts it.
  assert.deepEqual(open(rows({...strict, topic: '달에 놀러 간 날'})), [1, 2, 3], 'one recommended place is enough');
  const touched = {...strict, simplePicksTouched: true};
  assert.deepEqual(open(rows(touched)), [1, 2]);
  assert.match(rows(touched)[2].reason, /장소를 1곳 이상/);
  // A job without text (stopped before the text): ①② frozen, ③ status, ④⑤ closed.
  const paused = heldJob(state, 'auto-paused', {text: false});
  const bound = {...structuredClone(wizard), simpleJobId: paused.id, simpleStep: 3};
  assert.deepEqual(rows(bound).map(r => [r.mode, r.reachable]), [['frozen', true], ['frozen', true], ['status', true], ['review', false], ['finish', false]]);
  // A held job: ④ always (also while drawing), ⑤ only when nothing is being made.
  const held = heldJob(state, 'auto-held');
  const review = {...structuredClone(wizard), simpleJobId: held.id, simpleStep: 4};
  assert.deepEqual(open(rows(review)), [1, 2, 3, 4, 5]);
  assert.deepEqual(open(rows(review, {busy: true})), [1, 2, 3, 4]);
  assert.match(rows(review, {busy: true})[4].reason, /만드는 중/);
  // A page text edit open: no other step.
  const editing = {...review, simpleEditing: true};
  assert.deepEqual(open(rows(editing)), [4]);
  for (const r of rows(editing).filter(r => r.step !== 4)) assert.equal(r.reason, '고치던 글을 저장하거나 취소해 주세요.');
});

test('R11 step bar: five wrappers, buttons only on open steps other than the current one, all outside the 12-button count', () => {
  const {state, wizard} = setup();
  // Unbound ① with a topic: ② and ③ open; ④⑤ closed with the reason as their title.
  const first = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, structuredClone(wizard))));
  assert.equal((first.match(/class="step [^"]*" role="listitem"/g) || []).length, 5);
  assert.deepEqual(linkSteps(first), [2, 3]);
  for (const tag of stepLinks(first)) {
    assert.match(tag, /data-simple-nav="step"/);
    assert.match(tag, /type="button" class="simple-step-link"/);
  }
  assert.match(first, /aria-label="2단계 재료 고르기로 가기"/);
  assert.match(first, /aria-label="3단계 생성으로 가기"/);
  assert.match(first, /role="listitem" aria-current="step" tabindex="-1"><b>1<\/b>주제 넣기/);
  assert.match(first, /aria-disabled="true" title="③에서 글을 먼저 만들어 주세요\."><b>4<\/b>/);
  assert.ok(stepButtons(first).length <= 12);
  // Focus lands on the current step after a step change: only it is focusable from script.
  assert.equal((first.match(/tabindex="-1"/g) || []).length, 1);
  assert.match(first, /<div class="step active" role="listitem" aria-current="step" tabindex="-1">/);
  // A held story on ④: every other step is a link; ①–③ keep ✓.
  const job = heldJob(state);
  const w4 = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 4, simpleJobId: job.id});
  const review = renderSimpleCreate(ctxFor(state, w4, job.book));
  assert.deepEqual(linkSteps(review), [1, 2, 3, 5]);
  assert.match(review, /data-step="1"[^>]*><b>✓<\/b>주제 넣기/);
  assert.match(review, /data-step="3"[^>]*><b>✓<\/b>생성/);
  assert.match(review, /aria-current="step" tabindex="-1"><b>4<\/b>/);
  assert.ok(stepButtons(review).length <= 12, `④: ${stepButtons(review).length}`);
  // Going back from ④ keeps the ✓ on ①–③ (current step shows its number).
  const back = renderSimpleCreate(ctxFor(state, {...w4, simpleStep: 1}, job.book));
  assert.match(back, /aria-current="step" tabindex="-1"><b>1<\/b>/);
  assert.match(back, /data-step="2"[^>]*><b>✓<\/b>/);
  assert.match(back, /data-step="3"[^>]*><b>✓<\/b>/);
  // Editing a page: no step link at all.
  const editing = renderSimpleCreate(ctxFor(state, {...w4, simpleEditing: true}, job.book));
  assert.deepEqual(linkSteps(editing), []);
  assert.equal((editing.match(/title="고치던 글을 저장하거나 취소해 주세요\."/g) || []).length, 4);
  // The forced ① (opened from a pro card) with stories waiting is still at most 12.
  for (const id of ['auto-w1', 'auto-w2', 'auto-w3']) state.fullAutoJobs[id] = {id, status: 'paused', stopBefore: 'text', wizard: {simpleFlow: true, topic: id}, input: {topic: id}, updatedAt: '2026-10-17T00:00:00Z'};
  const forced = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleForced: true, simpleFormatOpen: true})));
  assert.ok(stepLinks(forced).length >= 2);
  assert.ok(stepButtons(forced).length <= 12, `forced ①: ${stepButtons(forced).length}`);
  // Every step of every kind stays within the cap.
  for (const step of [1, 2, 3, 4, 5]) {
    const html = renderSimpleCreate(ctxFor(state, {...w4, simpleStep: step}, job.book));
    assert.ok(stepButtons(html).length <= 12, `held story step ${step}: ${stepButtons(html).length}`);
  }
});

test('R11 frozen ①/②: the job\'s own topic, format and picks, read only, with 이 주제로 새로 만들기', () => {
  const {state, wizard} = setup();
  const job = heldJob(state);
  const w = ensureSimpleWizard(state, {...structuredClone(wizard), topic: '바뀐 화면 주제', simpleStep: 1, simpleJobId: job.id});
  const first = renderSimpleCreate(ctxFor(state, w, job.book));
  assert.match(first, /공룡 친구와 숲으로 소풍/, 'the job\'s frozen topic, not the screen copy');
  assert.match(first, /책 제목<\/span> <strong>숲 소풍/);
  assert.match(first, /K1 · E0 · 8쪽 · 한글판·영어판 두 권/);
  assert.match(first, /이 이야기에 쓴 주제예요\. 바꾸려면 새 이야기로 만들어요\. 지금 이야기는 그대로 남아요\./);
  for (const gone of ['id="topic"', 'data-simple-action="topic"', 'data-simple-action="idea"', 'data-simple-action="format"', 'simple-resume-card', 'id="language"'])
    assert.ok(!first.includes(gone), gone);
  assert.match(first, /data-simple-action="fork"[^>]*>이 주제로 새로 만들기/);
  assert.doesNotMatch(first, /data-simple-action="fork"[^>]*disabled/);
  assert.match(first, /data-action="library"/);
  assert.match(first, /data-simple-action="next"/);
  assert.ok(stepButtons(first).length <= 4, `frozen ①: ${stepButtons(first).length}`);
  const second = renderSimpleCreate(ctxFor(state, {...w, simpleStep: 2}, job.book));
  assert.doesNotMatch(second, /data-simple-action="(friend|place)"/);
  assert.doesNotMatch(second, /<button[^>]*simple-card/);
  assert.equal((second.match(/<div class="selection simple-card selected" aria-disabled="true">/g) || []).length, 6);
  assert.equal((second.match(/자동 추가<\/span>/g) || []).length, 2, 'the run\'s own friend and place');
  assert.match(second, /새 친구 포포/);
  assert.match(second, /부족한 재료 자동 추가: 켜짐/);
  assert.doesNotMatch(second, /id="simple-allow-new"/);
  for (const action of ['back', 'fork', 'next']) assert.match(second, new RegExp(`data-simple-action="${action}"`));
});

test('R11 ③ with text: 글이 완성됐어요, 이전 and 검수로 가기, no start and no text estimate', () => {
  const {state, wizard} = setup();
  const job = heldJob(state);
  const html = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id}), job.book));
  assert.match(html, /글이 완성됐어요 · 쪽 8개/);
  assert.match(html, /글 만들기 · 완료/);
  assert.doesNotMatch(html, /<span>글 만들기<\/span><strong>/, 'no estimate for text already bought');
  assert.doesNotMatch(html, /data-simple-action="(start-text|start-demo|retry|abandon)"/);
  assert.doesNotMatch(html, /쪽마다 검수하기/);
  assert.match(html, /<div class="wizard-actions"><button[^>]*data-simple-action="back"[^>]*>이전<\/button>/);
  assert.match(html, /data-simple-action="open-review"[^>]*>검수로 가기<\/button><\/div>/);
  assert.doesNotMatch(html, /지금 그림을 만들고 있어요/, 'nothing is drawing');
  // A job without its text keeps the run controls and gains 이전.
  const stopped = heldJob(state, 'auto-stop', {text: false});
  const run = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: stopped.id})));
  for (const action of ['retry', 'abandon', 'back']) assert.match(run, new RegExp(`data-simple-action="${action}"`));
  assert.doesNotMatch(run, /data-simple-action="open-review"/);
});

test('R11 simple library: stories being made in simple words, replaced stories listed once; pro cards unchanged', () => {
  const {state} = setup();
  state.fullAutoJobs = {
    run: {id: 'run', status: 'running', stopBefore: 'text', wizard: {simpleFlow: true}, input: {topic: '달에 놀러 간 날'}, updatedAt: '5'},
    // A pro FULL AUTO run stopped before its text: no hold, no book.
    pro: {id: 'pro', status: 'paused', stopBefore: null, wizard: {topic: '프로 모드 우주 소풍'}, input: {topic: '프로 모드 우주 소풍'}, updatedAt: '6'},
    // A pro run that already has its book (④ asks before each picture).
    probook: {id: 'probook', status: 'paused', stopBefore: null, book: {...book('probook'), title: '프로 모드 숲 그림책', pages: [{imageAssetId: 'a'}, {}]}, updatedAt: '0'},
    held: {id: 'held', status: 'text-review', book: book('held'), updatedAt: '4'},
    drawn: {id: 'drawn', status: 'pages-ready', book: {...book('drawn'), title: '바닷가 모래성', pages: [{imageAssetId: 'a'}, {imageAssetId: 'b'}, {}]}, updatedAt: '3'},
    old: {id: 'old', status: 'text-review', book: {...book('old'), title: '예전 이야기'}, simpleReplacedBy: 'held', updatedAt: '2'},
    done: {id: 'done', status: 'final', book: book('done'), updatedAt: '1'},
  };
  const simple = renderFullAutoJobs(state, {simple: true});
  assert.match(simple, /data-simple="true"/);
  assert.match(simple, /<h3>제작 중인 이야기<\/h3>/);
  assert.doesNotMatch(simple, /FULL AUTO/);
  assert.match(simple, /role-tag">만드는 중<\/span><strong>달에 놀러 간 날/);
  assert.match(simple, /role-tag">글 검수 중<\/span><strong>숲 소풍/);
  assert.match(simple, /role-tag">그림 2\/3<\/span><strong>바닷가 모래성/);
  assert.doesNotMatch(simple, /예전 이야기/, 'a story replaced by 이야기 전체 다시 만들기 is not listed twice');
  assert.match(simple, /role-tag">그림 1\/2<\/span><strong>프로 모드 숲 그림책/, 'a pro run with its book opens in ④');
  assert.doesNotMatch(simple, /프로 모드 우주 소풍/, 'a pro run with no book never opens in ③ (its resume is the whole pipeline)');
  assert.equal((simple.match(/data-full-auto-action="simple-open"/g) || []).length, 4);
  assert.equal((simple.match(/>이어서 만들기</g) || []).length, 4);
  assert.equal((simple.match(/data-full-auto-action="pause"/g) || []).length, 1, '중지 only on the running story');
  assert.doesNotMatch(simple, /data-full-auto-action="(resume|review|simple-review|status)"/, 'opening never runs anything');
  // Pro mode keeps its cards exactly.
  const pro = renderFullAutoJobs(state);
  assert.match(pro, /FULL AUTO · /);
  assert.match(pro, /예전 이야기/);
  assert.match(pro, /프로 모드 우주 소풍/);
  assert.match(pro, /id="full-auto-jobs"/);
  assert.doesNotMatch(pro, /simple-open|data-simple="true"/);
  // Simple mode lists the rest (pro runs with no book) on the pro list below the books.
  const rest = renderFullAutoJobs(state, {rest: true});
  assert.match(rest, /id="full-auto-jobs-rest" data-rest="true"/);
  assert.match(rest, /FULL AUTO · 대기<\/span><strong>프로 모드 우주 소풍/);
  assert.equal((rest.match(/data-auto-job=/g) || []).length, 1, 'only the job the simple panel does not open');
  assert.doesNotMatch(rest, /simple-open/);
  // Every unfinished job is on exactly one of the two lists, except a replaced simple story.
  for (const id of ['run', 'held', 'drawn', 'pro', 'probook'])
    assert.equal([simple, rest].filter(html => html.includes(`data-auto-job="${id}"`)).length, 1, id);
  state.fullAutoJobs = {probook: state.fullAutoJobs.probook};
  assert.equal(renderFullAutoJobs(state, {rest: true}), '', 'no empty pro list');
});

test('R11 app wiring: the kept dialog for a draft on ①–③, the drawing note, the simple library on top, one popstate listener', async () => {
  const {readFileSync} = await import('node:fs');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const open = app.slice(app.indexOf('function simpleDraftOpen() {'), app.indexOf('function uiModeButton('));
  assert.match(open, /!!draft &&\s*\(Number\(wizard\?\.simpleStep\) >= 4 \|\| !!wizard\?\.simpleJobId\)/);
  const discard = app.slice(app.indexOf('function discardDraft(next, { onCancel = null } = {}) {'), app.indexOf('let readerTouch'));
  assert.ok(discard.length > 100);
  // Browser Back past the simple screen leaves through this guard and knows when the parent stays.
  assert.match(discard, /addEventListener\(\s*"donghwa:modal-closed",\s*\(\) => \{\s*if \(!leaving\) onCancel\(\);/);
  assert.match(discard, /\.onclick = \(\) => \{\s*leaving = true;/);
  const leave = app.slice(app.indexOf('leaveToLibrary: (onStay) =>'), app.indexOf('configureSimpleCreate(simpleCtx);'));
  assert.match(leave, /discardDraft\(\s*\(\) => \{\s*view = "library";[\s\S]*\{ onCancel: onStay \}/);
  assert.match(discard, /drawing = simpleDrawingInFlight\(\)/);
  assert.match(discard, /지금 그리는 그림은 나가도 계속 만들어 이 이야기에 보관해요\./);
  const library = app.slice(app.indexOf('function libraryPage() {'), app.indexOf('const managementButton'));
  assert.match(library, /simpleJobs = !childMode && uiMode === "simple"/);
  assert.ok(library.indexOf('renderFullAutoJobs(state, { simple: true })') < library.indexOf('class="shelf-header"'), 'above the books');
  assert.match(library, /!childMode \? renderFullAutoJobs\(state, \{ rest: simpleJobs \}\) : ""/);
  assert.doesNotMatch(app, /pushState|addEventListener\("popstate"/, 'history entries come from the simple screen only');
  const simple = readFileSync(new URL('../dist/simple-create.js', import.meta.url), 'utf8');
  assert.equal((simple.match(/addEventListener\?\.\("popstate"/g) || []).length, 1);
  assert.doesNotMatch(simple, /beforeunload/);
});

test('a stopped story shows its error once: below the bar, not again as the progress line', async () => {
  const {createFullAutoJob} = await import('../dist/full-auto.js');
  const {state, wizard} = setup();
  const message = '이야기 outline 결과를 확인해 주세요: 4번 비트는 검사에서 지적하지 않았으므로 수정할 수 없어요.';
  const job = createFullAutoJob(state, {...structuredClone(wizard), simpleFlow: true}, {demo: true, planMode: 'selection', stopBefore: 'text'});
  Object.assign(job, {status: 'failed', error: message, phase: message});
  const w = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 3, simpleJobId: job.id});
  const html = renderSimpleCreate(ctxFor(state, w));
  assert.equal(html.split(message).length - 1, 1, 'the error text appears exactly once');
  assert.match(html, /id="simple-progress-text">멈춘 곳에서 다시 시도할 수 있어요\.</);
  assert.match(html, /data-simple-action="retry"/);
  // A failed check replays the same way on 다시 시도, so a new outline is offered (cost confirm happens on click).
  assert.match(html, /data-simple-action="restart"[^>]*>줄거리 새로 만들기</);
  // Hotfix 4: the note says what 다시 시도 costs (saved results reused, leftover repairs may be billed).
  assert.match(html, /다시 시도는 저장된 결과를 다시 써서 이미 받은 글을 다시 사지 않아요\. 검사에서 남은 부분만 새로 요청하므로 요금이 조금 들 수 있어요\./);
  assert.doesNotMatch(html, /무료로 다시 검사/);
  Object.assign(job, {error: '클라우드에 연결하지 못했어요.', phase: '클라우드에 연결하지 못했어요.'});
  assert.doesNotMatch(renderSimpleCreate(ctxFor(state, w)), /줄거리 새로 만들기/, 'a network error only offers 다시 시도');
});

/* ---------- R32 에코 모드 (2026-10-22): ③ paste panel, ④ prompt/upload, ⑤ save without a run ---------- */
const ecoWizard = () => ({step: 1, characterIds: ['yuha'], backgroundIds: ['home', 'forest', 'garden'], topic: '유하가 유치원에 가요', language: 'bilingual', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', simplePicksTouched: true});
function ecoJobFor(state) {
  const w = ecoWizard();
  return ecoJobInit(createFullAutoJob(state, {...w, simpleFlow: true, allowNew: false}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
}
const ecoRender = (state, job, step, draft = null) => renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...ecoWizard(), simpleStep: step, simpleJobId: job.id}), draft));

test('R32 ③ offers 에코 모드 next to 글 만들기 and 데모, within the button cap', () => {
  const {state} = setup();
  const html = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...ecoWizard(), simpleStep: 3})));
  assert.match(html, /data-simple-action="start-eco"/);
  assert.match(html, /data-simple-action="start-text"/);
  assert.ok(stepButtons(html).length <= 12, `③: ${stepButtons(html).length}`);
});

test('R32 ③ of an eco job is the paste panel: the request, a copy button, the answer box, no engine or price lines, every step within the cap', () => {
  const {state} = setup(), job = ecoJobFor(state);
  const outline = ecoRender(state, job, 3);
  assert.match(outline, /id="eco-prompt"/);
  assert.match(outline, /id="eco-reply"/);
  assert.match(outline, /data-simple-action="eco-copy"/);
  assert.match(outline, /data-simple-action="eco-accept"/);
  assert.match(outline, /data-simple-action="abandon"/);
  assert.match(outline, /요금 없음/);
  assert.doesNotMatch(outline, /start-text|start-demo|simple-text-engine|글 엔진 요금|쓴 금액/);
  assert.doesNotMatch(outline, /data-simple-action="eco-redo"/, 'nothing to go back to at the first step');
  assert.ok(stepButtons(outline).length <= 12, `outline step: ${stepButtons(outline).length}`);
  // After a refused answer: the errors and the retry note, still within the cap.
  job.eco.errors = ['줄거리 JSON의 모양이 달라요.'];
  const refused = ecoRender(state, job, 3);
  assert.match(refused, /simple-eco-errors/);
  assert.match(refused, /id="eco-fix"/);
  assert.ok(stepButtons(refused).length <= 12, `refused: ${stepButtons(refused).length}`);
  // The pages step shows the accepted outline and the way back.
  job.eco.errors = [];
  const input = normalizeStoryInput(job.input);
  job.outline = ecoAcceptOutline(JSON.stringify(demoOutline(input)), job.input).outline;
  job.eco.step = 'pages';
  const pages = ecoRender(state, job, 3);
  assert.match(pages, /simple-eco-outline/);
  assert.match(pages, /data-simple-action="eco-redo"/);
  assert.match(pages, /ECO MODE: there is no separate prose stage/);
  assert.ok(stepButtons(pages).length <= 12, `pages: ${stepButtons(pages).length}`);
  // The fix step lists the findings and offers 이대로 검수로.
  const k1 = ecoJobInit(createFullAutoJob(state, {...ecoWizard(), koreanLevel: 'K1', englishLevel: 'E1', simpleFlow: true, allowNew: false}, {allowNew: false, stopBefore: 'text', planMode: 'selection', councilReview: false}));
  const k1Input = normalizeStoryInput(k1.input);
  k1.outline = ecoAcceptOutline(JSON.stringify(demoOutline(k1Input)), k1.input).outline;
  const pag = demoPagination(k1.outline, demoProse(k1.outline, k1Input), k1Input);
  const result = ecoAcceptPages(JSON.stringify({cover: pag.cover, pages: pag.pages.map(p => ({pageNo: p.pageNo, beatIndex: p.beatIndex, textKo: p.textKo, textEn: p.textEn, scene: p.scene, variantByCharacter: p.variantByCharacter || {}, isRefrainPage: !!p.isRefrainPage}))}), k1.outline, k1.input, {bookId: k1.bookId});
  assert.equal(result.ok, true);
  assert.equal(result.passed, false);
  Object.assign(k1.eco, {step: 'fix', pagination: result.pagination, report: result.report});
  const fix = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...ecoWizard(), koreanLevel: 'K1', englishLevel: 'E1', simpleStep: 3, simpleJobId: k1.id})));
  assert.match(fix, /data-simple-action="eco-force"/);
  assert.match(fix, /simple-eco-findings/);
  assert.match(fix, /Fix ONLY the entries listed/);
  assert.ok(stepButtons(fix).length <= 12, `fix: ${stepButtons(fix).length}`);
  // The job is a resumable simple job and says so on its ① card.
  assert.ok(simpleJobs(state).some(j => j.id === job.id));
  assert.equal(simpleStepForJob(job), 3);
  const first = renderSimpleCreate(ctxFor(state, ensureSimpleWizard(state, {...ecoWizard(), simpleStep: 1})));
  assert.match(first, /에코 모드 · 2단계 · 쪽 글/);
});

test('R32 ④/⑤ of an eco book: picture request and upload instead of any drawing, no rewrite or restart, the cover from ⑤, save needs every picture', () => {
  const {state} = setup(), job = ecoJobFor(state);
  const draft = {...book(job.id, {language: 'bilingual', pages: 6}), eco: true};
  job.book = draft;
  job.status = 'text-review';
  job.eco.step = 'done';
  const review = ecoRender(state, job, 4, draft);
  assert.match(review, /data-simple-action="eco-prompt"/);
  assert.match(review, /data-simple-action="eco-upload"/);
  assert.match(review, /data-simple-action="eco-prompts"/);
  assert.match(review, /id="eco-upload-input"/);
  assert.match(review, /data-simple-action="edit-text"/);
  for (const paid of ['rewrite-text', 'draw-page', 'redraw-page', 'draw-all', 'restart']) assert.doesNotMatch(review, new RegExp(`data-simple-action="${paid}"`), paid);
  assert.ok(stepButtons(review).length <= 12, `④: ${stepButtons(review).length}`);
  draft.pages[0].imageAssetId = 'image-up-1';
  draft.pages[0].imageMeta = {quality: 'final', engine: 'upload'};
  assert.match(ecoRender(state, job, 4, draft), /그림 다시 올리기/);
  assert.equal(imageWork(draft).needsRun, true, 'pictures still missing');
  const finish = ecoRender(state, job, 5, draft);
  assert.match(finish, /표지 프롬프트/);
  assert.match(finish, /표지 그림 올리기/);
  assert.match(finish, /그림을 ④에서 올린 뒤 저장할 수 있어요/);
  assert.ok(stepButtons(finish).length <= 12, `⑤: ${stepButtons(finish).length}`);
  for (const page of draft.pages) Object.assign(page, {imageAssetId: 'image-up', imageMeta: {quality: 'final', engine: 'upload'}});
  assert.equal(imageWork(draft).needsRun, true, 'the cover is still missing');
  assert.match(ecoRender(state, job, 5, draft), /1쪽 그림을 표지로 쓸 수 있어요/);
  draft.cover = {imageAssetId: 'image-cover', meta: {quality: 'final'}};
  assert.equal(imageWork(draft).needsRun, false, 'an uploaded book needs no run');
  assert.equal(approvalImageWork(draft, 'openai').finalize, true, 'until it is saved, the app would still count it as unfinished');
  draft.autoGenerationComplete = true;
  assert.equal(approvalImageWork(draft, 'openai').finalize, false, 'saved with every picture: nothing is bought');
  assert.match(ecoRender(state, job, 5, draft), /그림이 모두 준비됐어요/);
});
