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
  topicStepButtonCount, approvalImageWork,
} from '../dist/simple-create.js';
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
  assert.match(generate, /승인 예시 함께 쓰기 · <strong>꺼짐/);
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
  assert.match(html, /<strong>꺼짐<\/strong>/);
  assert.equal(fresh.settings.storyQuality, undefined);
});

test('the v31 shell precaches the simple create screen', async () => {
  const {readFileSync} = await import('node:fs');
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE = "donghwa-shell-v32";/);
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
