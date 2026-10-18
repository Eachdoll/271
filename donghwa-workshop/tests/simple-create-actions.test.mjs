// R9 FIX-UI: simple create actions driven through the real click handler and the
// real FULL AUTO runner (demo text, free sample engine). A stub document stands
// in for the DOM; confirm dialogs are answered through their buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState, safeTopic} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {configureFullAutoUI, startFullAutoJob, runFullAutoJob, getFullAutoJob} from '../dist/full-auto-ui.js';
import {generateBookPageImage} from '../dist/story-generation/page-tools.js';
import {
  configureSimpleCreate, openSimpleJob, renderSimpleCreate, simpleJobs, imageWork, imageCountLabel,
  IDEA_TOPICS, pickIdeaTopic, isSimpleBusy,
} from '../dist/simple-create.js';

/* ---------- stub DOM ---------- */
const listeners = {};
let modal = null, fields = {};
const button = () => ({onclick: null});
globalThis.document = {
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
  dispatchEvent(event) { for (const fn of [...(listeners[event.type] || [])]) fn(event); },
  querySelector(selector) {
    if (modal && /^#simple-(confirm|choice)-/.test(selector)) return (modal.buttons[selector] ||= button());
    if (selector in fields) return {value: fields[selector], textContent: '', focus() {}};
    return null;
  },
  querySelectorAll() { return []; },
};
const store = new Map();
globalThis.localStorage = {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};

/* ---------- app context ---------- */
const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(x => ({...x, ko: x.textKo, en: x.textEn})), sceneBriefs: p.sceneBriefs, worldId: p.worldId, storyDraftId: p.id, textGenerationSettings: p.textSettings, outline: p.outline, prose: p.prose, pagination: structuredClone(p.pagination), storyInput: p.input, textUsage: p.usage, textDemo: p.demo, readingLevelSnapshot: p.readingLevels, storyCheck: p.storyCheck, fullAutoRunId: p.id});
const state = seedState();
migrateWorldState(state);
migrateReadingSettings(state.settings);
const toasts = [], approvals = [], drawn = [], credentialLinks = [];
let wizard = null, draft = null, editPage = 0, lastAction = null, onSave = null;
const save = () => { onSave?.(); return true; };
const ctx = {
  getState: () => state, getWizard: () => wizard, setWizard: v => { wizard = v; }, getDraft: () => draft, setDraft: v => { draft = v; },
  getEditPage: () => editPage, setEditPage: v => { editPage = v; }, setView() {}, isSimpleMode: () => true, isSimpleView: () => true, isParent: () => true,
  save, render: () => renderSimpleCreate(ctx), toast: (message, options) => toasts.push({message: String(message?.message || message), action: options?.action || null}),
  showModal: html => { modal = {html, buttons: {}}; }, closeModal: () => { document.dispatchEvent({type: 'donghwa:modal-closed'}); modal = null; },
  modalHeader: t => `<h2>${t}</h2>`, protectedAction: f => (lastAction = f()), heading: (t, s, a) => `<h2>${t}</h2>${a}`,
  approveBook: async () => { approvals.push(draft?.id); },
  openCredentialSettings: (kind, engine) => credentialLinks.push([kind, engine]),
  // The image pipeline needs IndexedDB; this stand-in records which book was drawn.
  generateScene: async (_state, book, index) => {
    drawn.push([book.id, index]);
    Object.assign(book.pages[index], {imageAssetId: `asset-${book.id}-${index}-new`, imageMeta: {quality: 'final'}});
    return book.pages[index];
  },
};
configureFullAutoUI({getState: () => state, save, render() {}, toast: m => toasts.push({message: String(m?.message || m), action: null}), isParent: () => true, protectedAction: f => f(), buildBook, openReview: async () => {}, showModal() {}, closeModal() {}, modalHeader: t => t});
configureSimpleCreate(ctx);

/* ---------- helpers ---------- */
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check, label) {
  for (let i = 0; i < 400; i++) { if (check()) return; await tick(); }
  throw Error('timed out: ' + label);
}
/** Click a [data-simple-action] element; returns the action's promise. */
function click(action, data = {}) {
  lastAction = null;
  const target = {dataset: {simpleAction: action, ...data}, disabled: false};
  for (const fn of listeners.click) fn({target: {closest: s => (s.includes('data-simple-action') ? target : null)}, preventDefault() {}});
  return lastAction || Promise.resolve();
}
async function answer(id) {
  await until(() => modal, 'a confirm dialog');
  const html = modal.html;
  assert.ok(modal.buttons['#' + id]?.onclick, `dialog has #${id}: ${html}`);
  modal.buttons['#' + id].onclick();
  return html;
}
async function demoJob(topic) {
  const job = await startFullAutoJob({characterIds: ['yuha'], backgroundIds: [], topic, pageCount: 8, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'dual', simpleFlow: true}, {demo: true, stopBefore: 'text', planMode: 'selection'});
  assert.equal(job.status, 'text-review');
  return job;
}
const finalImage = (page, id) => Object.assign(page, {imageAssetId: id, imageMeta: {quality: 'final'}});
async function finishedJob(topic) {
  const job = await demoJob(topic);
  await runFullAutoJob(job.id, {stopBefore: 'pages'});
  assert.equal(job.status, 'pages-ready');
  job.book.pages.forEach((page, i) => finalImage(page, `asset-${job.book.id}-${i}`));
  job.book.cover = {imageAssetId: `asset-${job.book.id}-cover`};
  job.book.autoGenerationComplete = true;
  job.status = 'review';
  return job;
}
const markStale = page => Object.assign(page, {imageStale: true, imageStaleAt: 'x', imageStaleAssetId: page.imageAssetId});
/** Visible step buttons, excluding material cards and the page arrows (R9-B2 rule 3). */
const buttonCount = html => [...html.matchAll(/<button\b[^>]*>/g)].filter(m => !/simple-card|data-simple-nav=/.test(m[0])).length;
async function open(job, step = 4) {
  assert.equal(await openSimpleJob(ctx, job.id), true);
  wizard.simpleStep = step;
  await tick();
}
function reset() { toasts.length = 0; approvals.length = 0; drawn.length = 0; credentialLinks.length = 0; onSave = null; modal = null; }

/* ---------- tests ---------- */
test('a page drawn after sheet preparation lands on its own book even if another book was opened meanwhile', async () => {
  reset();
  const a = await demoJob('유하와 잃어버린 장갑'), b = await finishedJob('유하와 바닷가 모래성');
  const bAssets = b.book.pages.map(p => p.imageAssetId), bUsage = JSON.stringify(b.imageUsage || {});
  await open(a);
  editPage = 1;
  let switched = false, resumeRefused = null;
  // While the sheets are prepared (the job is running), the parent tries to open B,
  // and the draft is switched to B the way any other path could do it.
  onSave = () => {
    if (switched || a.status !== 'running') return;
    switched = true;
    const before = draft;
    click('resume', {id: b.id}); // refused synchronously: nothing awaited before the busy check
    resumeRefused = draft === before && wizard.simpleJobId === a.id;
    draft = b.book;
  };
  await click('draw-page');
  assert.ok(switched, 'the draft was switched during the preparation');
  assert.equal(resumeRefused, true, 'opening another story is refused while the draw is in flight');
  assert.ok(toasts.some(t => /진행 중인 작업이 끝난 뒤/.test(t.message)));
  assert.deepEqual(drawn, [[a.book.id, 1]], 'only page 2 of book A was drawn');
  assert.equal(a.book.pages[1].imageAssetId, `asset-${a.book.id}-1-new`);
  assert.deepEqual(b.book.pages.map(p => p.imageAssetId), bAssets, 'book B keeps every paid picture');
  assert.equal(JSON.stringify(b.imageUsage || {}), bUsage);
  assert.equal(a.status, 'pages-ready');
  assert.equal(isSimpleBusy(), false);
});

test('saving approves only while the job\'s own book is still open', async () => {
  reset();
  const a = await finishedJob('할머니 댁 다락방'), b = await finishedJob('첫눈이 내린 아침');
  a.book.autoGenerationComplete = false; // the run still has to finish (nothing left to buy)
  a.status = 'pages-ready';
  await open(a, 5);
  onSave = () => { if (a.status === 'running') draft = b.book; };
  await click('save-book');
  assert.equal(a.status, 'review', 'the run finished the book');
  assert.deepEqual(approvals, [], 'book B was not approved in place of book A');
  assert.ok(toasts.some(t => t.message === '다른 책을 보고 있어 저장하지 않았어요. 이 책을 다시 열어 저장해 주세요.'));
  assert.deepEqual(drawn, []);
  // Reopened, the same book saves normally.
  onSave = null;
  await open(a, 5);
  await click('save-book');
  assert.deepEqual(approvals, [a.book.id]);
});

test('stale-only pictures: 그림 그대로 저장 approves without any image work', async () => {
  reset();
  const job = await finishedJob('동물원에서 만난 기린');
  markStale(job.book.pages[2]);
  const assets = job.book.pages.map(p => p.imageAssetId), completed = JSON.stringify(job.completed), usage = JSON.stringify(job.imageUsage || {});
  assert.deepEqual(imageWork(job.book), {missing: [], stale: [2], coverMissing: false, needsRun: false});
  assert.equal(imageCountLabel(job.book), '그림 8 / 8 · 글 바뀐 쪽 1');
  await open(job, 5);
  assert.match(renderSimpleCreate(ctx), /그림 8 \/ 8 · 글 바뀐 쪽 1/);
  const pending = click('save-book');
  const html = await answer('simple-choice-keep');
  await pending;
  assert.match(html, /그림 그대로 저장/);
  assert.match(html, /고친 1쪽 그림 다시 만들고 저장/);
  assert.match(html, /3쪽은 글을 고친 뒤에도/);
  assert.deepEqual(approvals, [job.book.id]);
  assert.deepEqual(drawn, [], 'no page was drawn');
  assert.deepEqual(job.book.pages.map(p => p.imageAssetId), assets);
  assert.equal(JSON.stringify(job.completed), completed, 'the runner never ran');
  assert.equal(JSON.stringify(job.imageUsage || {}), usage);
  assert.equal(job.status, 'review');
});

test('모든 쪽 그림 만들기 names stale pages and lets the parent keep them', async () => {
  reset();
  const job = await finishedJob('반짝이는 조약돌 모으기');
  markStale(job.book.pages[0]);
  delete job.book.pages[3].imageAssetId;
  delete job.book.pages[3].imageMeta;
  job.book.autoGenerationComplete = false;
  job.status = 'pages-ready';
  const staleAsset = job.book.pages[0].imageAssetId;
  await open(job);
  let hiddenDuringRun = null;
  onSave = () => { if (job.status === 'running' && hiddenDuringRun === null) hiddenDuringRun = job.book.pages[0].imageStale !== true; };
  const pending = click('draw-all');
  const html = await answer('simple-choice-missing');
  await pending;
  assert.match(html, /새로 만들 그림: 본문 1쪽/);
  assert.match(html, /글을 고친 쪽: 1쪽/);
  assert.match(html, /빈 그림만 만들기/);
  assert.match(html, /고친 1쪽도 다시 만들기/);
  assert.doesNotMatch(html, /이미 만든 최종 그림은 다시 만들지 않아요/, 'no blanket promise while stale pages are offered');
  assert.equal(hiddenDuringRun, true, 'the kept page is hidden from the run');
  // The run then reaches the missing page (the default image pipeline cannot store a picture under Node).
  assert.equal(job.currentStep, 'page:3', 'the stale page 1 was skipped, page 4 was the first one drawn');
  assert.equal(job.book.pages[0].imageAssetId, staleAsset);
  assert.equal(job.book.pages[0].imageStale, true, 'the stale mark is back after the run');
});

test('a missing image key stops before any confirm or job change, with a 키 입력 action', async () => {
  reset();
  const job = await demoJob('냉장고 속 채소들의 회의'), world = getActiveWorld(state), engine = world.imageEngine;
  world.imageEngine = 'openai';
  try {
    await open(job);
    const before = JSON.stringify({status: job.status, stopBefore: job.stopBefore, completed: job.completed});
    await click('draw-page');
    assert.equal(modal, null, 'no confirm was shown');
    assert.equal(JSON.stringify({status: job.status, stopBefore: job.stopBefore, completed: job.completed}), before);
    const toast = toasts.at(-1);
    assert.match(toast.message, /그림 엔진의 API 키/);
    assert.equal(toast.action?.label, '키 입력');
    toast.action.run();
    assert.deepEqual(credentialLinks, [['image', 'openai']]);
    await click('draw-all');
    await click('save-book');
    assert.equal(modal, null);
    assert.deepEqual(approvals, []);
    assert.equal(JSON.stringify({status: job.status, stopBefore: job.stopBefore, completed: job.completed}), before);
  } finally {
    world.imageEngine = engine;
  }
});

test('③ escape hatch: a stopped story is set aside and the picks stay for a new start', async () => {
  reset();
  const job = await demoJob('바람개비가 멈춘 날');
  // A stopped run before the text was built.
  delete job.book;
  job.status = 'paused';
  await openSimpleJob(ctx, job.id);
  assert.equal(wizard.simpleStep, 3);
  assert.equal(wizard.simpleFlow, undefined, 'the restored wizard drops the simple job marker');
  const topic = wizard.topic, picks = structuredClone(wizard.characterIds);
  let html = renderSimpleCreate(ctx);
  assert.match(html, /data-simple-action="retry"[^>]*>이어서 만들기/);
  assert.match(html, /data-simple-action="abandon"[^>]*>주제·엔진 바꾸기/);
  assert.match(html, /id="simple-text-engine" disabled/);
  assert.ok(buttonCount(html) <= 12, `③ stopped: ${buttonCount(html)} buttons`);
  await click('abandon');
  assert.equal(job.simpleAbandoned, true);
  assert.equal(wizard.simpleJobId, undefined);
  assert.equal(wizard.simpleStep, 1);
  assert.equal(wizard.topic, topic);
  assert.deepEqual(wizard.characterIds, picks);
  assert.ok(!simpleJobs(state).some(j => j.id === job.id), 'hidden from the simple resume cards');
  assert.ok(state.fullAutoJobs[job.id], 'still kept for the pro job list');
  wizard.simpleStep = 3;
  html = renderSimpleCreate(ctx);
  assert.doesNotMatch(html, /id="simple-text-engine" disabled/);
  assert.match(html, /data-simple-action="start-text"/);
  assert.match(html, /data-simple-action="back"/);
});

test('an interrupted run disables the page tools and offers 이어서 만들기', async () => {
  reset();
  const job = await finishedJob('그림자와 술래잡기');
  delete job.book.pages[5].imageAssetId;
  job.book.autoGenerationComplete = false;
  job.stopBefore = null;
  job.status = 'running'; // left by a closed tab
  await open(job);
  const html = renderSimpleCreate(ctx);
  for (const action of ['edit-text', 'rewrite-text', 'redraw-page', 'like'])
    assert.match(html, new RegExp(`data-simple-action="${action}"[^>]*disabled`), action);
  assert.match(html, /data-simple-action="resume-run"/);
  assert.doesNotMatch(html, /data-simple-action="draw-all"/);
  assert.match(html, /data-simple-action="stop"/);
  assert.ok(buttonCount(html) <= 12, `④ interrupted: ${buttonCount(html)} buttons`);
  wizard.simpleStep = 5;
  const finish = renderSimpleCreate(ctx);
  assert.match(finish, /data-simple-action="save-book"[^>]*disabled/);
  assert.match(finish, /data-simple-action="resume-run"/);
  assert.ok(buttonCount(finish) <= 12, `⑤ interrupted: ${buttonCount(finish)} buttons`);
  wizard.simpleStep = 4;
  const pending = click('resume-run');
  const asked = await answer('simple-confirm-no');
  await pending;
  assert.match(asked, /멈춘 그림 만들기를 이어 갈까요/);
  assert.equal(job.status, 'running', 'cancelling the resume changes nothing');
});

test('page buttons are disabled while a page operation on the book is in flight', async () => {
  reset();
  const job = await finishedJob('꿀벌이 꽃밭을 찾아가는 길');
  await open(job);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const op = generateBookPageImage(state, job.book, 0, {generate: () => blocked, save});
  const html = renderSimpleCreate(ctx);
  for (const action of ['edit-text', 'rewrite-text', 'redraw-page', 'like', 'draw-all', 'to-finish'])
    assert.match(html, new RegExp(`data-simple-action="${action}"[^>]*disabled`), action);
  release();
  await op;
  assert.doesNotMatch(renderSimpleCreate(ctx), /data-simple-action="edit-text"[^>]*disabled/);
});

test('아이디어 뽑기 works without a story world and never repeats the current topic', async () => {
  reset();
  assert.ok(IDEA_TOPICS.length >= 40);
  assert.equal(new Set(IDEA_TOPICS).size, IDEA_TOPICS.length);
  for (const topic of IDEA_TOPICS) {
    assert.ok(safeTopic(topic).ok, topic);
    assert.ok(topic.length <= 24, topic);
    assert.doesNotMatch(topic, /같이 가|함께 가|[!?]/, topic);
  }
  for (const r of [0, 0.5, 0.999999]) assert.notEqual(pickIdeaTopic(IDEA_TOPICS[0], () => r), IDEA_TOPICS[0]);
  assert.equal(pickIdeaTopic('', () => 0), IDEA_TOPICS[0]);
  wizard = {step: 1, simpleStep: 1, topic: IDEA_TOPICS[3], characterIds: ['yuha'], backgroundIds: []};
  draft = null;
  fields = {'#topic': IDEA_TOPICS[3]};
  try {
    for (let i = 0; i < 20; i++) {
      const before = wizard.topic;
      fields['#topic'] = before;
      await click('idea');
      assert.ok(IDEA_TOPICS.includes(wizard.topic));
      assert.notEqual(wizard.topic, before);
    }
  } finally {
    fields = {};
  }
});
