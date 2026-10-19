// R9 FIX-UI: simple create actions driven through the real click handler and the
// real FULL AUTO runner (demo text, free sample engine). A stub document stands
// in for the DOM; confirm dialogs are answered through their buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState, safeTopic} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {configureFullAutoUI, startFullAutoJob, runFullAutoJob, getFullAutoJob, openFullAutoReview, renderFullAutoJobs} from '../dist/full-auto-ui.js';
import {createFullAutoJob} from '../dist/full-auto.js';
import {configureStoryUI, renderStoryDrafts} from '../dist/story-generation/ui.js';
import {generateBookPageImage, isPageImageStale, pagesNeedingImages} from '../dist/story-generation/page-tools.js';
import {
  configureSimpleCreate, openSimpleJob, renderSimpleCreate, simpleJobs, imageWork, imageCountLabel,
  IDEA_TOPICS, pickIdeaTopic, isSimpleBusy, isPictureKeptAfterEdit, keepEditedPictures, coherenceCheckDue,
  jobWizardFrom, onSimplePopState, simpleDrawingInFlight,
} from '../dist/simple-create.js';

/* ---------- stub DOM ---------- */
const listeners = {};
let modal = null, fields = {};
const button = () => ({onclick: null});
/**
 * What the stub page shows: `simple` is true once the simple create screen is
 * on the page (a later render is not its first), and `focus` records where
 * the screen moved keyboard focus (the current step of the step bar).
 */
const screen = {simple: false, focus: []};
globalThis.document = {
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
  dispatchEvent(event) { for (const fn of [...(listeners[event.type] || [])]) fn(event); },
  querySelector(selector) {
    if (modal && /^#simple-(confirm|choice)-/.test(selector)) return (modal.buttons[selector] ||= button());
    if (selector in fields) return {value: fields[selector], textContent: '', focus() {}};
    if (selector === '.simple-create') return screen.simple ? {} : null;
    if (selector === '.simple-steps [aria-current="step"]')
      return screen.simple ? {focus: options => screen.focus.push({step: wizard?.simpleStep, options})} : null;
    return null;
  },
  querySelectorAll() { return []; },
};
const store = new Map();
globalThis.localStorage = {getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
// In-memory IndexedDB so the real runner can store the free sample pictures.
// failWrites > 0 makes the next picture writes fail (a run that stops with an error).
const databases = new Map();
let failWrites = 0;
globalThis.indexedDB = {open(name) {
  const request = {};
  queueMicrotask(() => {
    if (!databases.has(name)) databases.set(name, new Map());
    const records = databases.get(name);
    request.result = {objectStoreNames: {contains: () => true}, close() {}, transaction() {
      const tx = {};
      const perform = (fn, write = false) => {
        const operation = {};
        queueMicrotask(() => {
          if (write && failWrites > 0) {
            failWrites--;
            tx.error = Error('test: picture storage is full');
            (tx.onabort || tx.onerror)?.();
            return;
          }
          operation.result = fn();
          operation.onsuccess?.();
          tx.oncomplete?.();
        });
        return operation;
      };
      tx.objectStore = () => ({get: id => perform(() => records.get(id)), put: record => perform(() => { records.set(record.id, record); return record.id; }, true), delete: id => perform(() => records.delete(id))});
      return tx;
    }};
    request.onsuccess?.();
  });
  return request;
}};
// Nothing in these tests may reach the network (paid engines are never called).
const realFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async (url, ...rest) => {
  if (String(url?.url || url).startsWith('data:')) return realFetch(url, ...rest);
  networkCalls++;
  throw Error('network is not allowed in this test: ' + String(url).slice(0, 60));
};

/* ---------- app context ---------- */
const buildBook = p => ({id: p.bookId, title: p.outline.titleCandidates[0], characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, pages: p.pagination.pages.map(x => ({...x, ko: x.textKo, en: x.textEn})), sceneBriefs: p.sceneBriefs, worldId: p.worldId, storyDraftId: p.id, textGenerationSettings: p.textSettings, outline: p.outline, prose: p.prose, pagination: structuredClone(p.pagination), storyInput: p.input, textUsage: p.usage, textDemo: p.demo, readingLevelSnapshot: p.readingLevels, storyCheck: p.storyCheck, fullAutoRunId: p.id});
const state = seedState();
migrateWorldState(state);
migrateReadingSettings(state.settings);
const toasts = [], approvals = [], drawn = [], credentialLinks = [];
let wizard = null, draft = null, editPage = 0, lastAction = null, onSave = null, saveFails = 0;
// saveFails > 0 makes the next saves report a full storage (save() === false).
const save = () => { onSave?.(); if (saveFails > 0) { saveFails--; return false; } return true; };
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
const fullAutoCtx = {getState: () => state, save, render() {}, toast: m => toasts.push({message: String(m?.message || m), action: null}), isParent: () => true, protectedAction: f => f(), buildBook, openReview: async () => {}, showModal() {}, closeModal() {}, modalHeader: t => t};
configureFullAutoUI(fullAutoCtx);
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
/** Click a library job card button ([data-full-auto-action]); resolves when its action is done. */
async function cardClick(action, id) {
  let done = null;
  const target = {dataset: {fullAutoAction: action, id}};
  configureFullAutoUI({...fullAutoCtx, protectedAction: f => (done = f())});
  try {
    for (const fn of listeners.click) fn({target: {closest: s => (s.includes('data-full-auto-action') ? target : null)}, preventDefault() {}});
  } finally {
    configureFullAutoUI(fullAutoCtx);
  }
  await done;
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
/** A demo book the real runner finished with the free sample engine (stored pictures, 'review'). */
async function finishedJob(topic) {
  const job = await demoJob(topic);
  await runFullAutoJob(job.id, {stopBefore: null});
  assert.equal(job.status, 'review', job.error || '');
  assert.ok(job.book.pages.every(page => page.imageAssetId && page.imageMeta?.quality === 'final'));
  assert.ok(job.book.cover?.imageAssetId);
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
function reset() { toasts.length = 0; approvals.length = 0; drawn.length = 0; credentialLinks.length = 0; onSave = null; modal = null; failWrites = 0; saveFails = 0; fields = {}; }
/** A page the run has not drawn yet (no picture, no completed step). */
const dropPicture = (job, index) => { delete job.book.pages[index].imageAssetId; delete job.book.pages[index].imageMeta; delete job.completed['page:' + index]; };
/** A page whose text was edited after drawing and whose picture the parent kept. */
const keptPage = (book, index) => { markStale(book.pages[index]); keepEditedPictures(book, [index]); return book.pages[index].imageAssetId; };
const STOPPED_PAGE = '중지해서 이 쪽 그림은 만들지 않았어요.';
const OTHER_BOOK_OPEN = '다른 책을 보고 있어 저장하지 않았어요. 이 책을 다시 열어 저장해 주세요.';

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
  dropPicture(a, 4); // the finishing run still has a page to draw
  a.book.autoGenerationComplete = false;
  a.status = 'pages-ready';
  await open(a, 5);
  onSave = () => { if (a.status === 'running') draft = b.book; };
  const saving = click('save-book');
  const asked = await answer('simple-confirm-yes');
  await saving;
  assert.match(asked, /남은 그림을 만들고 저장할까요/);
  assert.equal(a.status, 'review', a.error || 'the run finished the book');
  assert.equal(a.book.pages[4].imageMeta?.quality, 'final', 'the runner drew the missing page');
  assert.deepEqual(approvals, [], 'book B was not approved in place of book A');
  assert.ok(toasts.some(t => t.message === OTHER_BOOK_OPEN));
  assert.deepEqual(drawn, []);
  // Reopened, the same book saves normally.
  onSave = null;
  await open(a, 5);
  await click('save-book');
  assert.equal(modal, null);
  assert.deepEqual(approvals, [a.book.id]);
  assert.equal(networkCalls, 0);
});

test('stale-only pictures: 그림 그대로 저장 approves without any image work', async () => {
  reset();
  const job = await finishedJob('동물원에서 만난 기린');
  markStale(job.book.pages[2]);
  const assets = job.book.pages.map(p => p.imageAssetId), completed = JSON.stringify(job.completed), usage = JSON.stringify(job.imageUsage || {});
  assert.deepEqual(imageWork(job.book), {missing: [], stale: [2], coverMissing: false, needsRun: false});
  assert.equal(imageCountLabel(job.book), '그림 8 / 8 · 글 바뀐 쪽 1');
  await open(job, 5);
  // Opening the book turns a leftover runner mark into the kept-picture marker.
  assert.equal(job.book.pages[2].imageStale, undefined);
  assert.equal(job.book.pages[2].simpleTextEditedAssetId, assets[2]);
  assert.match(renderSimpleCreate(ctx), /그림 8 \/ 8 · 글 바뀐 쪽 1/);
  // A second page edited on the open book, not answered yet.
  markStale(job.book.pages[6]);
  assert.match(renderSimpleCreate(ctx), /그림 8 \/ 8 · 글 바뀐 쪽 2/);
  const pending = click('save-book');
  const html = await answer('simple-choice-keep');
  await pending;
  assert.match(html, /그림 그대로 저장/);
  assert.match(html, /고친 2쪽 그림 다시 만들고 저장/);
  assert.match(html, /3·7쪽은 글을 고친 뒤에도/);
  assert.doesNotMatch(html, /이야기 연결 검사/, 'demo text: no check to name');
  assert.deepEqual(approvals, [job.book.id]);
  for (const i of [2, 6]) {
    assert.equal(job.book.pages[i].imageStale, undefined, `page ${i + 1}: no runner-visible mark after keeping`);
    assert.equal(job.book.pages[i].simpleTextEditedAssetId, assets[i]);
  }
  assert.deepEqual(pagesNeedingImages(job.book), []);
  assert.deepEqual(drawn, [], 'no page was drawn');
  assert.deepEqual(job.book.pages.map(p => p.imageAssetId), assets);
  assert.equal(JSON.stringify(job.completed), completed, 'the runner never ran');
  assert.equal(JSON.stringify(job.imageUsage || {}), usage);
  assert.equal(job.status, 'review');
});

test('모든 쪽 그림 만들기 names stale pages; 빈 그림만 keeps those pictures for good', async () => {
  reset();
  const job = await finishedJob('반짝이는 조약돌 모으기');
  dropPicture(job, 3);
  job.book.autoGenerationComplete = false;
  job.status = 'pages-ready';
  const staleAsset = job.book.pages[0].imageAssetId, usage = Object.keys(job.imageUsage || {}).length;
  await open(job);
  // An undecided runner mark on the open book (text saved, no answer given yet).
  markStale(job.book.pages[0]);
  let markDuringRun = null;
  onSave = () => { if (job.status === 'running' && markDuringRun === null) markDuringRun = job.book.pages[0].imageStale === true; };
  const pending = click('draw-all');
  const html = await answer('simple-choice-missing');
  await pending;
  assert.match(html, /새로 만들 그림: 본문 1쪽/);
  assert.match(html, /글을 고친 쪽: 1쪽/);
  assert.match(html, /빈 그림만 만들기/);
  assert.match(html, /고친 1쪽도 다시 만들기/);
  assert.doesNotMatch(html, /이미 만든 최종 그림은 다시 만들지 않아요/, 'no blanket promise while stale pages are offered');
  assert.equal(markDuringRun, false, 'the run never sees a stale mark on the kept page');
  assert.equal(job.status, 'review', job.error || '');
  assert.equal(job.book.pages[3].imageMeta?.quality, 'final', 'the missing page was drawn');
  assert.equal(Object.keys(job.imageUsage).length, usage + 1, 'one picture bought: page 4 only');
  const page = job.book.pages[0];
  assert.equal(page.imageAssetId, staleAsset);
  assert.equal(page.imageStale, undefined, 'no runner-visible mark is left');
  assert.equal(page.imageStaleAssetId, undefined);
  assert.equal(page.simpleTextEditedAssetId, staleAsset, 'the kept marker is bound to the kept picture');
  assert.equal(isPictureKeptAfterEdit(page), true);
  assert.equal(isPageImageStale(page), false);
  assert.deepEqual(pagesNeedingImages(job.book), [], 'pro paths see nothing to draw');
  assert.equal(imageCountLabel(job.book), '그림 8 / 8 · 글 바뀐 쪽 1');
});

test('a kept picture survives a stopped run and a failed run resumed from the library card', async () => {
  reset();
  const job = await finishedJob('할아버지와 함께 낚시한 날');
  for (const i of [4, 5, 6]) dropPicture(job, i);
  job.book.autoGenerationComplete = false;
  job.status = 'pages-ready';
  await open(job);
  // Page 2's text is edited after drawing; the parent answers 취소 (keep the picture).
  editPage = 1;
  const kept = job.book.pages[1].imageAssetId;
  fields = {'#page-ko': job.book.pages[1].ko + ' 물고기가 퐁당 뛰었어요.', '#page-en': job.book.pages[1].en};
  const editing = click('save-text');
  const asked = await answer('simple-confirm-no');
  await editing;
  fields = {};
  assert.match(asked, /이 쪽 그림도 다시 만들까요/);
  const page = () => job.book.pages[1];
  assert.equal(page().imageStale, undefined, 'the keep decision leaves no runner-visible mark');
  assert.equal(page().simpleTextEditedAssetId, kept);
  assert.equal(imageCountLabel(job.book), '그림 5 / 8 · 글 바뀐 쪽 1');
  // 모든 쪽 그림 만들기 → 빈 그림만 만들기, then 중지 while page 5 is being drawn.
  const usageStart = Object.keys(job.imageUsage).length;
  let pressed = false;
  onSave = () => {
    if (!pressed && job.status === 'running' && job.currentStep === 'page:4') {
      pressed = true;
      click('stop');
    }
  };
  const drawing = click('draw-all');
  await answer('simple-choice-missing');
  await drawing;
  onSave = null;
  assert.ok(pressed);
  assert.equal(job.status, 'paused');
  assert.equal(page().imageAssetId, kept);
  // The library card resumes with no question at all; the kept page is not bought again.
  await cardClick('resume', job.id);
  assert.equal(modal, null, 'the card asked nothing');
  assert.equal(job.status, 'review', job.error || '');
  for (const i of [4, 5, 6]) assert.equal(job.book.pages[i].imageMeta?.quality, 'final', `page ${i + 1} drawn`);
  assert.equal(page().imageAssetId, kept, 'the kept picture was not redrawn');
  assert.equal(page().simpleTextEditedAssetId, kept);
  assert.equal(page().imageStale, undefined);
  assert.equal(Object.keys(job.imageUsage).length, usageStart + 3, 'pages 5–7 bought once each, page 2 never');
  // A failed run, resumed from the card: same.
  dropPicture(job, 7);
  job.book.autoGenerationComplete = false;
  job.status = 'pages-ready';
  failWrites = 1;
  await open(job);
  const again = click('draw-all');
  const offered = await answer('simple-choice-missing'); // the kept page is offered again, and kept again
  await again;
  assert.match(offered, /고친 1쪽도 다시 만들기/);
  assert.equal(job.status, 'failed');
  assert.match(job.error || '', /그림을 보관하지 못했어요/);
  const before = Object.keys(job.imageUsage).length;
  await cardClick('resume', job.id);
  assert.equal(modal, null);
  assert.equal(job.status, 'review', job.error || '');
  assert.equal(Object.keys(job.imageUsage).length, before + 1, 'only page 8 was bought');
  assert.equal(page().imageAssetId, kept);
  assert.equal(isPictureKeptAfterEdit(page()), true);
  assert.equal(networkCalls, 0);
});

test('고친 n쪽 그림 다시 만들고 저장 redraws only the chosen pages, and only in that run', async () => {
  reset();
  const job = await finishedJob('우산 속에 들어온 작은 손님');
  const keptA = keptPage(job.book, 2), keptB = keptPage(job.book, 5);
  await open(job, 5);
  // First try: stopped right after the first chosen page was redrawn.
  let pressed = false;
  onSave = () => {
    if (!pressed && job.status === 'running' && job.currentStep === 'page:5') {
      pressed = true;
      click('stop');
    }
  };
  const saving = click('save-book');
  const html = await answer('simple-choice-redraw');
  await saving;
  onSave = null;
  assert.match(html, /3·6쪽은 글을 고친 뒤에도/);
  assert.match(html, /고친 2쪽 그림 다시 만들고 저장/);
  assert.ok(pressed);
  assert.deepEqual(approvals, [], 'a stopped redraw saves nothing');
  assert.notEqual(job.book.pages[2].imageAssetId, keptA, 'page 3 was redrawn as chosen');
  assert.equal(isPictureKeptAfterEdit(job.book.pages[2]), false);
  const pageSix = job.book.pages[5];
  assert.equal(pageSix.imageStale, undefined, 'the unreached chosen page is kept again');
  assert.equal(pageSix.simpleTextEditedAssetId, keptB);
  // A resume from the card does not finish the cut-off redraw without asking.
  const status = job.status;
  if (status !== 'review') await cardClick('resume', job.id);
  assert.equal(pageSix.imageAssetId, keptB, 'page 6 is not bought by a resume');
  // Chosen again: page 6 is redrawn and the book is saved.
  job.book.autoGenerationComplete = true;
  job.status = 'review';
  await open(job, 5);
  const second = click('save-book');
  await answer('simple-choice-redraw');
  await second;
  assert.notEqual(job.book.pages[5].imageAssetId, keptB);
  assert.equal(imageWork(job.book).stale.length, 0);
  assert.deepEqual(approvals, [job.book.id]);
});

test('중지 during the sheet preparation for one page: that page is not drawn, even when the run still reaches the hold', async () => {
  for (const via of ['simple', 'card']) {
    reset();
    const job = await demoJob(via === 'simple' ? '사라진 소풍 도시락' : '고양이가 숨겨 둔 털실 뭉치');
    await open(job);
    editPage = 2;
    let pressed = false, stopping = null;
    onSave = () => {
      if (pressed || job.status !== 'running') return;
      pressed = true;
      // The run is past every abort check it makes for a book whose sheets exist.
      stopping = via === 'simple' ? click('stop') : cardClick('pause', job.id);
    };
    await click('draw-page');
    await stopping;
    assert.ok(pressed, via);
    // full-auto.js now re-checks the abort right before the hold, so the stop usually ends the run 'paused';
    // if it lands after that last check the run still reaches 'pages-ready'. Either way nothing may be drawn.
    assert.ok(['pages-ready', 'paused'].includes(job.status), `${via}: unexpected status ${job.status}`);
    if (job.status === 'pages-ready') assert.ok(job.book.generationSnapshot, via);
    assert.deepEqual(drawn, [], `${via}: nothing was drawn after 중지`);
    assert.equal(job.book.pages[2].imageAssetId, undefined, via);
    assert.ok(toasts.some(t => t.message === STOPPED_PAGE), `${via}: ${toasts.map(t => t.message).join(' / ')}`);
    assert.equal(isSimpleBusy(), false);
    // Without a stop, the next click draws the page.
    onSave = null;
    await click('draw-page');
    assert.deepEqual(drawn, [[job.book.id, 2]], via);
  }
});

test('a finish that buys nothing goes ahead without an image key', async () => {
  reset();
  const job = await finishedJob('밤하늘에 새 별자리 그리기'), world = getActiveWorld(state), engine = world.imageEngine;
  const snapshotEngine = job.book.generationSnapshot.imageEngine, jobEngine = job.imageEngine;
  // Stopped after the last picture: every page and the cover are final, the finish was never recorded.
  job.book.autoGenerationComplete = false;
  job.status = 'paused';
  world.imageEngine = job.imageEngine = job.book.generationSnapshot.imageEngine = 'openai';
  const usage = JSON.stringify(job.imageUsage), completed = JSON.stringify(job.completed);
  try {
    await open(job, 5);
    assert.match(renderSimpleCreate(ctx), /남은 그림이 없어요\. 저장하면 마무리해요/);
    await click('save-book');
    assert.equal(modal, null, 'nothing to confirm');
    assert.ok(!toasts.some(t => /API 키/.test(t.message)), toasts.map(t => t.message).join(' / '));
    assert.deepEqual(approvals, [job.book.id]);
    assert.equal(job.status, 'review');
    assert.equal(job.book.autoGenerationComplete, true);
    assert.equal(job.book.stage, 'illustrated');
    assert.equal(JSON.stringify(job.imageUsage), usage, 'no picture bought');
    assert.equal(JSON.stringify(job.completed), completed, 'no runner step ran');
    // With a page whose text changed: keeping it finishes without a key, redrawing it asks for one.
    reset();
    const kept = keptPage(job.book, 4);
    job.book.autoGenerationComplete = false;
    job.status = 'paused';
    await open(job);
    let pending = click('draw-all');
    let html = await answer('simple-choice-all');
    await pending;
    assert.match(html, /고친 쪽 그림 그대로 두고 마무리/);
    assert.match(toasts.at(-1)?.message || '', /그림 엔진의 API 키/);
    assert.equal(toasts.at(-1).action?.label, '키 입력');
    assert.equal(job.status, 'paused', 'nothing started without the key');
    assert.equal(job.book.pages[4].imageStale, undefined, 'the page is still only kept, not marked for the runner');
    assert.equal(job.book.pages[4].simpleTextEditedAssetId, kept);
    pending = click('draw-all');
    html = await answer('simple-choice-missing');
    await pending;
    assert.equal(job.status, 'review');
    assert.equal(job.book.pages[4].imageAssetId, kept);
    assert.equal(JSON.stringify(job.imageUsage), usage);
    // At ⑤: '고친 1쪽 그림 다시 만들고 저장' needs the key; 그림 그대로 저장 does not.
    reset();
    await open(job, 5);
    pending = click('save-book');
    await answer('simple-choice-redraw');
    await pending;
    assert.match(toasts.at(-1)?.message || '', /그림 엔진의 API 키/);
    assert.deepEqual(approvals, []);
    assert.equal(job.book.pages[4].imageStale, undefined);
    assert.equal(JSON.stringify(job.completed), completed);
    pending = click('save-book');
    await answer('simple-choice-keep');
    await pending;
    assert.deepEqual(approvals, [job.book.id]);
    assert.equal(job.book.pages[4].imageAssetId, kept);
    assert.equal(JSON.stringify(job.imageUsage), usage);
  } finally {
    world.imageEngine = engine;
    job.imageEngine = jobEngine;
    job.book.generationSnapshot.imageEngine = snapshotEngine;
  }
});

test('그림 그대로 저장 names the story-connection check that saving may still buy', async () => {
  reset();
  const job = await finishedJob('텃밭에 처음 심은 방울토마토');
  keptPage(job.book, 1);
  assert.deepEqual(coherenceCheckDue(state, job.book), {due: false, usd: 0}, 'demo text: no check');
  // As a real-engine book whose page check no longer matches the edited text.
  job.book.textDemo = false;
  job.book.outline.plotContract ||= {beats: []};
  job.book.pageCoherence = null;
  const check = coherenceCheckDue(state, job.book);
  assert.equal(check.due, true);
  assert.ok(check.usd >= 0);
  await open(job, 5);
  const pending = click('save-book');
  const html = await answer('simple-confirm-no');
  await pending;
  assert.match(html, /이야기 연결 검사/);
  assert.match(html, /그림을 그대로 두고 저장해도 이 검사는 해요/);
  assert.match(html, /그림 그대로 저장 · 이야기 연결 검사/);
  if (check.usd > 0) assert.ok(html.includes('약 $'), html);
  assert.deepEqual(approvals, []);
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

/* ---------- FIX-UI-3 ---------- */
const NOTE = '주제 칸에 아이디어를 넣었어요. 자유롭게 고쳐 주세요.';
const imageRecords = job => Object.keys(job.imageUsage || {}).length;
const assets = book => ({pages: book.pages.map(p => p.imageAssetId || null), cover: book.cover?.imageAssetId || null});
/** Click a [data-story-action] element (the story draft list); returns the action's promise. */
function storyClick(action, data = {}) {
  lastAction = null;
  const target = {dataset: {storyAction: action, ...data}};
  for (const fn of listeners.click) fn({target: {closest: s => (s.includes('data-story-action') ? target : null)}, preventDefault() {}});
  return lastAction || Promise.resolve();
}
/** Give navigator a Web Locks stand-in for one test (Node has none). */
function withLocks(locks, work) {
  Object.defineProperty(globalThis.navigator, 'locks', {value: locks, configurable: true});
  return Promise.resolve().then(work).finally(() => { delete globalThis.navigator.locks; });
}

test('이어 만들 이야기: a FULL AUTO draft opens its job review and is never rebuilt, so no paid picture is dropped', async () => {
  reset();
  const job = await finishedJob('도서관에서 길을 잃은 그림책'), story = state.storyDrafts[job.storyDraftId];
  assert.equal(story.fullAutoRunId, job.id);
  const book = job.book, before = assets(book), usage = imageRecords(job);
  // The list names it as a review, not a resume of the story workflow.
  const html = renderStoryDrafts(state);
  assert.ok(html.includes(`data-story-action="open-auto-review" data-id="${story.id}" data-job-id="${job.id}"`), html);
  assert.ok(!html.includes(`data-story-action="resume" data-id="${story.id}"`));
  assert.match(html, />검수 열기</);
  const opened = [], rebuilt = [], workflow = [];
  configureStoryUI({
    getState: () => state, save, render() {}, toast: m => toasts.push({message: String(m?.message || m), action: null}),
    showModal: h => workflow.push(h), closeModal() {}, modalHeader: t => t, protectedAction: f => (lastAction = f()), isParent: () => true,
    onReady: async payload => { rebuilt.push(payload.id); },
    // The app's hook: the job's own review (simple ④ here), never the story workflow.
    openAutoReview: async id => { opened.push(id); await openSimpleJob(ctx, id); },
  });
  wizard = null; draft = null;
  // '검수 열기', and an old card's '이어서 만들기' for the same draft, both open the job's review.
  await storyClick('open-auto-review', {id: story.id, jobId: job.id});
  await storyClick('resume', {id: story.id});
  assert.deepEqual(opened, [job.id, job.id]);
  assert.deepEqual(workflow, [], 'the story workflow never opened');
  assert.deepEqual(rebuilt, [], 'nothing was rebuilt');
  assert.equal(job.book, book, 'the job keeps its own book object');
  assert.equal(draft, book, '④ shows the job\'s book');
  assert.equal(wizard.simpleStep, 4);
  assert.deepEqual(assets(job.book), before, 'every paid picture is still on the book');
  assert.equal(imageRecords(job), usage);
  assert.ok(job.book.pages.every(p => p.imageMeta?.quality === 'final'));
  // The pro route goes where the library card goes: the editor for a finished book.
  const reviewed = [];
  configureFullAutoUI({...fullAutoCtx, openReview: async j => { reviewed.push(j.id); }});
  try {
    await openFullAutoReview(job.id);
  } finally {
    configureFullAutoUI(fullAutoCtx);
  }
  assert.deepEqual(reviewed, [job.id]);
  assert.equal(job.book, book);
  assert.equal(networkCalls, 0);
});

test('a text save that fails keeps the picture unless the parent redraws it; a card resume does not buy it', async () => {
  reset();
  const job = await finishedJob('엄마 생일 깜짝 선물 준비');
  for (const i of [5, 6]) dropPicture(job, i);
  job.book.autoGenerationComplete = false;
  job.status = 'paused';
  await open(job);
  editPage = 1;
  const kept = job.book.pages[1].imageAssetId;
  wizard.simpleEditing = true;
  fields = {'#page-ko': job.book.pages[1].ko + ' 촛불이 반짝였어요.', '#page-en': job.book.pages[1].en};
  saveFails = 1; // storage is full for the page tool's save
  const saving = click('save-text');
  const asked = await answer('simple-confirm-no');
  await saving;
  fields = {};
  assert.ok(toasts.some(t => /변경을 저장하지 못했어요/.test(t.message)), toasts.map(t => t.message).join(' / '));
  assert.match(asked, /이 쪽 그림도 다시 만들까요/);
  const page = job.book.pages[1];
  assert.match(page.ko, /촛불이 반짝였어요/, 'the edited text is on the open book');
  assert.equal(page.imageStale, undefined, 'no runner-visible mark is left by the failed save');
  assert.equal(page.simpleTextEditedAssetId, kept);
  assert.equal(wizard.simpleEditing, false);
  // Later, the library card resumes the paused job without asking.
  const usage = imageRecords(job);
  await cardClick('resume', job.id);
  assert.equal(modal, null);
  assert.equal(job.status, 'review', job.error || '');
  assert.equal(page.imageAssetId, kept, 'the kept picture was not bought again');
  assert.equal(imageRecords(job), usage + 2, 'only pages 6 and 7 were bought');
  assert.equal(networkCalls, 0);
});

test('any resume keeps pictures with a leftover runner mark the parent never chose to redraw', async () => {
  reset();
  const job = await finishedJob('숨바꼭질하다 찾은 비밀 장소');
  dropPicture(job, 3);
  job.book.autoGenerationComplete = false;
  job.status = 'paused';
  // Left by an older build on a job never reopened on the simple screen.
  const leftover = job.book.pages[1].imageAssetId;
  markStale(job.book.pages[1]);
  const usage = imageRecords(job);
  await cardClick('resume', job.id);
  assert.equal(modal, null);
  assert.equal(job.status, 'review', job.error || '');
  const page = job.book.pages[1];
  assert.equal(page.imageAssetId, leftover, 'not redrawn');
  assert.equal(page.imageStale, undefined);
  assert.equal(page.simpleTextEditedAssetId, leftover, 'kept, and still shown as a page whose text changed');
  assert.equal(imageRecords(job), usage + 1, 'only the missing page 4 was bought');
  assert.deepEqual(pagesNeedingImages(job.book), []);
  // A run the parent chose still redraws exactly the chosen page.
  job.book.autoGenerationComplete = true;
  await open(job, 5);
  const saving = click('save-book');
  await answer('simple-choice-redraw');
  await saving;
  assert.notEqual(job.book.pages[1].imageAssetId, leftover, 'the chosen page was redrawn');
  assert.deepEqual(approvals, [job.book.id]);
});

test('an interrupted run with nothing left to buy finishes here without an image key, unless another tab holds it', async () => {
  reset();
  const job = await finishedJob('바닷가에서 모래성 쌓기'), world = getActiveWorld(state), engine = world.imageEngine;
  const snapshotEngine = job.book.generationSnapshot.imageEngine, jobEngine = job.imageEngine;
  const interrupt = () => { job.book.autoGenerationComplete = false; job.stopBefore = null; job.status = 'running'; };
  world.imageEngine = job.imageEngine = job.book.generationSnapshot.imageEngine = 'openai';
  const usage = JSON.stringify(job.imageUsage), completed = JSON.stringify(job.completed);
  try {
    // ④ 이어서 만들기
    interrupt();
    await open(job);
    assert.match(renderSimpleCreate(ctx), /data-simple-action="resume-run"/);
    await click('resume-run');
    assert.equal(modal, null, 'nothing to confirm');
    assert.ok(!toasts.some(t => /API 키/.test(t.message)), toasts.map(t => t.message).join(' / '));
    assert.equal(job.status, 'review');
    assert.equal(job.book.autoGenerationComplete, true);
    assert.equal(job.book.stage, 'illustrated');
    assert.equal(JSON.stringify(job.imageUsage), usage, 'no picture bought');
    assert.equal(JSON.stringify(job.completed), completed, 'no runner step ran');
    // The library card's 이어서 만들기: the same free finish.
    reset();
    interrupt();
    await cardClick('resume', job.id);
    assert.ok(!toasts.some(t => /API 키/.test(t.message)), toasts.map(t => t.message).join(' / '));
    assert.equal(job.status, 'review');
    assert.equal(JSON.stringify(job.imageUsage), usage);
    // A held run with its hold already reached goes back to the hold, also without keys.
    reset();
    interrupt();
    job.stopBefore = 'pages';
    await cardClick('resume', job.id);
    assert.equal(job.status, 'pages-ready');
    assert.ok(!toasts.some(t => /API 키/.test(t.message)));
    // Another tab holds the run lock: nothing is recorded here; the runner refuses.
    reset();
    interrupt();
    await open(job);
    await withLocks({request: async (name, options, callback) => callback(null)}, () => click('resume-run'));
    assert.equal(job.status, 'running', 'left to the tab that runs it');
    assert.ok(toasts.some(t => /다른 탭에서 이 자동 작업이 실행 중/.test(t.message)), toasts.map(t => t.message).join(' / '));
    assert.equal(JSON.stringify(job.imageUsage), usage);
    // Free again: the lock is granted and the finish is recorded inside it.
    let held = null;
    await withLocks({request: async (name, options, callback) => { held = name; try { return await callback({name}); } finally { held = `released:${name}`; } }}, () => click('resume-run'));
    assert.equal(held, `released:donghwa-full-auto-${job.id}`);
    assert.equal(job.status, 'review');
    assert.equal(JSON.stringify(job.imageUsage), usage);
  } finally {
    world.imageEngine = engine;
    job.imageEngine = jobEngine;
    job.book.generationSnapshot.imageEngine = snapshotEngine;
  }
});

test('resuming a chosen redraw cut off on a finished book offers keeping the picture as well as redrawing', async () => {
  reset();
  const job = await finishedJob('무지개 끝에서 찾은 것');
  // '고친 1쪽 그림 다시 만들기' was running when the tab closed: the real mark is still on page 3.
  const kept = job.book.pages[2].imageAssetId;
  const cutOff = () => { markStale(job.book.pages[2]); job.status = 'running'; job.stopBefore = null; };
  cutOff();
  assert.equal(job.book.autoGenerationComplete, true);
  const usage = imageRecords(job);
  await open(job);
  let pending = click('resume-run');
  let html = await answer('simple-choice-missing');
  await pending;
  assert.match(html, /멈춘 그림 만들기를 이어 갈까요/);
  assert.match(html, /id="simple-choice-missing">고친 쪽 그림 그대로 두고 마무리</);
  assert.match(html, /id="simple-choice-all">고친 1쪽 그림 다시 만들기/);
  assert.equal(job.status, 'review', job.error || '');
  assert.equal(job.book.pages[2].imageAssetId, kept);
  assert.equal(job.book.pages[2].imageStale, undefined);
  assert.equal(job.book.pages[2].simpleTextEditedAssetId, kept);
  assert.equal(imageRecords(job), usage, 'nothing bought');
  // The redraw is still there for the parent who wants it.
  cutOff();
  await open(job);
  pending = click('resume-run');
  await answer('simple-choice-all');
  await pending;
  assert.equal(job.status, 'review', job.error || '');
  assert.notEqual(job.book.pages[2].imageAssetId, kept);
  assert.equal(imageRecords(job), usage + 1);
  // Cut off after the chosen page was redrawn but before the run recorded its
  // end: nothing is left to ask about, and 이어서 만들기 still ends the run.
  job.status = 'running';
  await open(job);
  await click('resume-run');
  assert.equal(modal, null);
  assert.equal(job.status, 'review', 'not left marked running');
  assert.equal(imageRecords(job), usage + 1, 'nothing more bought');
});

test('③ 다시 시도 names a missing text key with 키 입력 before the run', async () => {
  reset();
  const job = await demoJob('개미 마을의 이사하는 날');
  // A real-engine story stopped before its text was built, on a device without the text key.
  delete job.book;
  job.demo = false;
  job.status = 'paused';
  await openSimpleJob(ctx, job.id);
  assert.equal(wizard.simpleStep, 3);
  const before = JSON.stringify({status: job.status, completed: job.completed, error: job.error});
  await click('retry');
  const toast = toasts.at(-1);
  assert.match(toast?.message || '', /글 엔진의 API 키를 먼저 저장해 주세요/);
  assert.equal(toast.action?.label, '키 입력');
  toast.action.run();
  assert.equal(credentialLinks.at(-1)[0], 'text');
  assert.equal(JSON.stringify({status: job.status, completed: job.completed, error: job.error}), before, 'the runner never ran');
  assert.equal(networkCalls, 0);
});

test('아이디어 뽑기 keeps its status line: no redraw wipes it, and ① renders it from the screen state', async () => {
  reset();
  wizard = {step: 1, simpleStep: 1, topic: IDEA_TOPICS[5], characterIds: ['yuha'], backgroundIds: []};
  draft = null;
  fields = {'#topic': IDEA_TOPICS[5]};
  const render = ctx.render;
  let renders = 0;
  ctx.render = () => { renders++; return render(); };
  try {
    await click('idea');
    assert.equal(renders, 0, 'the click does not redraw the screen');
    assert.equal(wizard.simpleIdeaNote, wizard.topic);
    assert.ok(renderSimpleCreate(ctx).includes(`aria-live="polite">${NOTE}</span>`));
    // Choosing a topic chip clears it.
    await click('topic', {topic: '달에 놀러 간 날'});
    assert.ok(renderSimpleCreate(ctx).includes('aria-live="polite"></span>'));
    // The note is screen state only: it is never frozen into a job's wizard.
    await click('idea');
    assert.equal(jobWizardFrom(wizard).simpleIdeaNote, undefined);
  } finally {
    ctx.render = render;
    fields = {};
  }
});

/* ---------- R11: moving between the five steps ---------- */
const STEP_EDITING = '고치던 글을 저장하거나 취소해 주세요.';
const FORK_BUSY = '만드는 중에는 새 이야기를 시작할 수 없어요. 중지하거나 끝난 뒤에 해 주세요.';
const goto = step => click('goto-step', {step: String(step)});
/** What a navigation must never change on a job. */
const jobSnapshot = job => JSON.stringify({status: job.status, completed: job.completed, usage: job.usage, imageUsage: job.imageUsage, stopBefore: job.stopBefore, book: job.book});
const freshWizard = (extra = {}) => ({step: 1, simpleStep: 1, topic: '', characterIds: ['yuha'], backgroundIds: [], language: 'dual', pageCount: 8, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', allowNew: true, ...extra});

test('R11 ④→①→③→④ through the step bar keeps the same draft, page and job; 이전/다음 walk every step', async () => {
  reset();
  const job = await finishedJob('비 오는 날 열린 장화 행진');
  await open(job);
  await click('page-next');
  await click('page-next');
  const book = draft, page = editPage, jobs = Object.keys(state.fullAutoJobs).length, before = jobSnapshot(job);
  assert.equal(page, 2);
  await goto(1);
  assert.equal(wizard.simpleStep, 1);
  assert.equal(draft, book, 'the draft stays open while the parent browses back');
  assert.match(renderSimpleCreate(ctx), /class="panel simple-panel simple-frozen"/);
  await goto(3);
  assert.equal(wizard.simpleStep, 3);
  const third = renderSimpleCreate(ctx);
  assert.match(third, /data-simple-action="open-review"[^>]*>검수로 가기/);
  assert.doesNotMatch(third, /data-simple-action="start-(text|demo)"/);
  await goto(4);
  assert.equal(wizard.simpleStep, 4);
  assert.equal(draft, book, 'the same draft object');
  assert.equal(editPage, page, 'back on the same page');
  // 이전 walks back to ①, 다음 forward to ⑤, without touching anything.
  for (const step of [3, 2, 1]) { await click('back'); assert.equal(wizard.simpleStep, step); }
  await click('back');
  assert.equal(wizard.simpleStep, 1, 'nothing before ①');
  for (const step of [2, 3, 4, 5]) { await click('next'); assert.equal(wizard.simpleStep, step); }
  await click('back');
  await click('open-review');
  assert.equal(wizard.simpleStep, 4);
  assert.equal(draft, book);
  assert.equal(editPage, page);
  assert.equal(jobSnapshot(job), before, 'status, completed steps, usage and pictures unchanged');
  assert.equal(Object.keys(state.fullAutoJobs).length, jobs, 'no job was created');
  assert.equal(modal, null);
  assert.deepEqual(drawn, []);
  assert.deepEqual(approvals, []);
  assert.equal(networkCalls, 0);
});

test('R11 an open page edit blocks every step change, also from Back and stale buttons', async () => {
  reset();
  const job = await demoJob('달팽이 집에 놀러 간 날');
  await open(job);
  wizard.simpleEditing = true;
  let renders = 0;
  const render = ctx.render;
  ctx.render = () => { renders++; return render(); };
  try {
    for (const press of [() => goto(1), () => click('back'), () => click('to-finish'), () => click('open-review')]) {
      await press();
      assert.equal(wizard.simpleStep, 4);
      assert.equal(toasts.at(-1)?.message, STEP_EDITING);
    }
    onSimplePopState({state: {donghwaSimpleStep: 2}});
    assert.equal(wizard.simpleStep, 4);
    assert.equal(renders, 0, 'no redraw puts the saved text back over the edit');
  } finally {
    ctx.render = render;
  }
  assert.doesNotMatch(renderSimpleCreate(ctx), /data-simple-action="goto-step"/);
  wizard.simpleEditing = false;
  assert.match(renderSimpleCreate(ctx), /data-simple-action="goto-step" data-step="1"/);
});

test('R11 ①→③ before any text checks the topic and the materials and fills the recommended picks', async () => {
  reset();
  wizard = freshWizard();
  draft = null;
  const jobs = Object.keys(state.fullAutoJobs).length;
  fields = {'#topic': '  '};
  try {
    await goto(3);
    assert.equal(wizard.simpleStep, 1);
    assert.match(toasts.at(-1).message, /주제/);
    await goto(4);
    assert.equal(toasts.at(-1).message, '③에서 글을 먼저 만들어 주세요.');
    fields['#topic'] = '비 오는 날 숲 산책';
    await goto(3);
    assert.equal(wizard.simpleStep, 3, toasts.map(t => t.message).join(' / '));
    assert.equal(wizard.topic, '비 오는 날 숲 산책', 'the typed topic is read as 다음 does');
    assert.equal(wizard.simplePickedFor, '비 오는 날 숲 산책');
    assert.deepEqual(wizard.backgroundIds, ['home', 'forest', 'garden'], 'home and the two recommended places');
    assert.match(renderSimpleCreate(ctx), /data-simple-action="start-text"/);
    // With 자동 추가 off, the parent's own picks must hold home and two places.
    fields = {};
    wizard.simpleStep = 2;
    Object.assign(wizard, {allowNew: false, simplePicksTouched: true, backgroundIds: ['home', 'forest']});
    await goto(3);
    assert.equal(wizard.simpleStep, 2);
    assert.match(toasts.at(-1).message, /집 1곳과 다른 장소 2곳/);
    await click('next');
    assert.equal(wizard.simpleStep, 2);
    wizard.backgroundIds.push('beach');
    await click('next');
    assert.equal(wizard.simpleStep, 3);
    assert.equal(Object.keys(state.fullAutoJobs).length, jobs, 'moving never starts a story');
  } finally {
    fields = {};
  }
});

test('R11 동화책 만들기 and the ⑤ step are refused while a page is being made, even from a button drawn before', async () => {
  reset();
  const job = await finishedJob('엄마와 함께 빵 굽는 날');
  await open(job);
  const stale = renderSimpleCreate(ctx);
  assert.doesNotMatch(stale, /data-simple-action="to-finish"[^>]*disabled/, 'drawn while nothing ran');
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const op = generateBookPageImage(state, job.book, 0, {generate: () => blocked, save});
  try {
    await click('to-finish');
    assert.equal(wizard.simpleStep, 4);
    assert.match(toasts.at(-1).message, /만드는 중이에요/);
    await goto(5);
    assert.equal(wizard.simpleStep, 4);
    assert.doesNotMatch(renderSimpleCreate(ctx), /data-simple-action="goto-step" data-step="5"/);
    // ①–④ stay viewable while the page is drawn.
    await goto(1);
    assert.equal(wizard.simpleStep, 1);
    await goto(4);
    assert.equal(wizard.simpleStep, 4);
  } finally {
    release();
    await op;
  }
  await click('to-finish');
  assert.equal(wizard.simpleStep, 5);
});

test('R11 이 주제로 새로 만들기: 취소 changes nothing; OK starts an unbound story and leaves the old job as it was', async () => {
  reset();
  const job = await finishedJob('겨울잠을 자지 않은 다람쥐');
  job.wizard.qualitySeedOffset = 4;
  await open(job, 1);
  const before = JSON.stringify(job), jobs = Object.keys(state.fullAutoJobs).length, w0 = wizard, book = draft;
  let pending = click('fork');
  let html = await answer('simple-confirm-no');
  await pending;
  assert.match(html, /이 주제로 새 이야기를 만들까요/);
  assert.ok(html.includes(job.book.title), 'names the current story');
  assert.match(html, /‘이어서 만들기’에서/);
  assert.match(html, /③에서 ‘글 만들기’를 누를 때/);
  assert.match(html, /그림은 ④에서 따로 물어요/);
  assert.match(html, /id="simple-confirm-yes">새 이야기로 고치기</);
  assert.equal(wizard, w0);
  assert.equal(wizard.simpleJobId, job.id);
  assert.equal(draft, book);
  assert.equal(JSON.stringify(job), before);
  pending = click('fork');
  await answer('simple-confirm-yes');
  await pending;
  assert.notEqual(wizard, w0);
  assert.equal(wizard.simpleJobId, undefined, 'unbound: ① and ② are the parent\'s again');
  assert.equal(wizard.simpleStep, 1);
  assert.equal(wizard.topic, job.wizard.topic);
  assert.equal(wizard.qualitySeedOffset, 5);
  assert.equal(wizard.simpleFlow, undefined);
  assert.equal(draft, null);
  assert.equal(editPage, 0);
  assert.equal(JSON.stringify(job), before, 'the old job is byte-identical');
  assert.ok(simpleJobs(state).some(j => j.id === job.id), 'and still listed to resume');
  assert.equal(Object.keys(state.fullAutoJobs).length, jobs, 'nothing is bought until ③ 글 만들기');
  const first = renderSimpleCreate(ctx);
  assert.match(first, /id="topic"/);
  assert.match(first, /data-simple-action="idea"/);
  await click('topic', {topic: '달에 놀러 간 날'});
  assert.equal(wizard.topic, '달에 놀러 간 날');
  assert.equal(networkCalls, 0);
});

test('R11 이 주제로 새로 만들기 is refused while the story is being made', async () => {
  reset();
  const job = await demoJob('바람에 날아간 연을 찾아서');
  await open(job, 1);
  const w0 = wizard;
  let html = null, tried = false;
  onSave = () => {
    if (tried || job.status !== 'running') return;
    tried = true;
    html = renderSimpleCreate(ctx);
    click('fork');
  };
  // The library card's run (not this screen) draws the whole book.
  await runFullAutoJob(job.id, {stopBefore: null});
  onSave = null;
  assert.ok(tried);
  assert.match(html, /data-simple-action="fork"[^>]*disabled/);
  assert.ok(toasts.some(t => t.message === FORK_BUSY), toasts.map(t => t.message).join(' / '));
  assert.equal(wizard, w0);
  assert.equal(wizard.simpleJobId, job.id);
  assert.equal(modal, null, 'no confirm was offered');
});

test('R11 a text run that finishes while the parent is on ① leaves them there; ④ opens from the step bar', async () => {
  reset();
  wizard = freshWizard({simpleStep: 3, topic: '첫눈이 내린 아침의 눈사람'});
  draft = null;
  let moved = false;
  onSave = () => {
    const job = state.fullAutoJobs[wizard?.simpleJobId];
    if (moved || job?.status !== 'running') return;
    moved = true;
    goto(1);
  };
  await click('start-demo');
  onSave = null;
  assert.ok(moved);
  const job = state.fullAutoJobs[wizard.simpleJobId];
  assert.equal(job.status, 'text-review');
  assert.equal(wizard.simpleStep, 1, 'not pulled to ④');
  assert.equal(draft, null);
  assert.ok(toasts.some(t => t.message === '글이 완성됐어요. 단계 표시의 ④에서 검수해요.'));
  const first = renderSimpleCreate(ctx);
  assert.match(first, /simple-frozen/);
  assert.match(first, /data-simple-action="goto-step" data-step="4"/);
  await goto(4);
  assert.equal(wizard.simpleStep, 4);
  assert.equal(draft, job.book);
  // Waiting on ③, the first arrival still opens ④ by itself.
  reset();
  wizard = freshWizard({simpleStep: 3, topic: '할머니와 만든 송편'});
  draft = null;
  await click('start-demo');
  assert.equal(wizard.simpleStep, 4);
  assert.equal(draft, state.fullAutoJobs[wizard.simpleJobId].book);
});

test('R11 a story with a job ignores topic, idea, format, friend, place and format/allow-new changes', async () => {
  reset();
  const job = await demoJob('달팽이와 느릿느릿 산책');
  await open(job, 1);
  const frozen = JSON.stringify(wizard), jobBefore = JSON.stringify(job);
  fields = {'#topic': '다른 주제'};
  try {
    await click('topic', {topic: '달에 놀러 간 날'});
    await click('idea');
    await click('format');
    wizard.simpleStep = 2;
    await click('friend', {id: 'greenie'});
    await click('place', {id: 'moon'});
    for (const [id, value] of [['language', 'ko'], ['pageCount', '16'], ['koreanLevel', 'K3'], ['englishLevel', 'E2']])
      for (const fn of listeners.change) fn({target: {id, value}});
    for (const fn of listeners.change) fn({target: {id: 'simple-allow-new', checked: false}});
    wizard.simpleStep = 1;
    assert.equal(JSON.stringify(wizard), frozen);
    assert.equal(JSON.stringify(job), jobBefore);
  } finally {
    fields = {};
  }
});

/* ---------- R11 browser history: a tab's session history as a browser keeps it ---------- */
const HREF = 'http://127.0.0.1:4300/#settings=simple';
/**
 * entries[0] is the page before the app (going back there unloads the app:
 * `left`), entries[1] the library's own entry. go() moves later and fires
 * popstate in the same step, as browsers do (history.state changes only
 * then); push drops the forward entries.
 */
function fakeHistory() {
  const h = {
    entries: ['the page before the app', null], index: 1, calls: [], pending: 0, now: false,
    get state() { return h.entries[h.index]; },
    get left() { return h.index < 1; },
    pushState(entry, title, url) { h.calls.push(['push', entry?.donghwaSimpleStep, url]); h.entries.splice(h.index + 1, Infinity, structuredClone(entry)); h.index++; },
    replaceState(entry, title, url) { h.calls.push(['replace', entry?.donghwaSimpleStep, url]); h.entries[h.index] = structuredClone(entry); },
    go(delta) {
      h.calls.push(['go', delta]);
      const traverse = () => {
        const next = h.index + delta;
        if (next < 0 || next >= h.entries.length) return;
        h.index = next;
        if (!h.left) onSimplePopState({state: h.state});
      };
      // `now`: the parent's Back lands while a run is waiting on the network.
      if (h.now) return traverse();
      h.pending++;
      setImmediate(() => { h.pending--; traverse(); });
    },
    back() { h.go(-1); },
    forward() { h.go(1); },
  };
  return h;
}
/**
 * Run with a browser history, the create view shown and the app's guarded way
 * to the library: like discardDraft, the kept dialog while a book is under
 * review (`stay` / `go` answer it), otherwise straight to the library.
 */
async function withHistory(fn) {
  const h = fakeHistory(), saved = {isSimpleView: ctx.isSimpleView, render: ctx.render, setView: ctx.setView};
  let view = 'create';
  const leaves = [];
  globalThis.history = h;
  globalThis.location = {href: HREF};
  ctx.isSimpleView = () => view === 'create';
  ctx.setView = next => { view = next; };
  ctx.render = () => {
    const html = view === 'create' ? renderSimpleCreate(ctx) : '';
    screen.simple = view === 'create';
    return html;
  };
  ctx.leaveToLibrary = onStay => {
    const toLibrary = () => { view = 'library'; screen.simple = false; };
    if (draft && (wizard.simpleStep >= 4 || wizard.simpleJobId)) {
      leaves.push({dialog: true, stay: () => onStay(), go: () => { draft = null; wizard = null; toLibrary(); }});
      return;
    }
    leaves.push({dialog: false});
    toLibrary();
  };
  screen.simple = false;
  screen.focus.length = 0;
  try {
    await fn({h, leaves, view: () => view, settle: () => until(() => h.pending === 0, 'popstate')});
  } finally {
    Object.assign(ctx, saved);
    delete ctx.leaveToLibrary;
    delete globalThis.history;
    delete globalThis.location;
    screen.simple = false;
    screen.focus.length = 0;
  }
}

test('R11 browser Back/Forward: indexed entries of the open story move between steps and never start anything', async () => {
  reset();
  await withHistory(async ({h, settle}) => {
    const job = await finishedJob('꼬마 소방관의 하루');
    const before = jobSnapshot(job), jobs = Object.keys(state.fullAutoJobs).length;
    toasts.length = 0;
    assert.equal(await openSimpleJob(ctx, job.id), true);
    // Opened from the library: an entry of its own on top of the library's.
    assert.deepEqual(h.calls, [['push', 4, HREF]]);
    assert.equal(h.entries[1], null, 'the library keeps its entry');
    const first = h.entries[2];
    assert.equal(first.story, job.id);
    assert.ok(Number.isInteger(first.i));
    h.calls.length = 0;
    await goto(2);
    await click('next');
    assert.deepEqual(h.calls, [['push', 2, HREF], ['push', 3, HREF]], 'one entry per step change, same URL');
    assert.deepEqual(h.entries.slice(2).map(e => [e.donghwaSimpleStep, e.i - first.i, e.story]), [[4, 0, job.id], [2, 1, job.id], [3, 2, job.id]]);
    h.calls.length = 0;
    screen.focus.length = 0;
    h.back(); await settle();
    assert.equal(wizard.simpleStep, 2);
    h.forward(); await settle();
    assert.equal(wizard.simpleStep, 3);
    h.back(); await settle();
    h.back(); await settle();
    assert.equal(wizard.simpleStep, 4);
    assert.equal(draft, job.book);
    assert.deepEqual(h.calls.filter(call => call[0] !== 'go'), [], 'Back/Forward adds or rewrites no entry');
    assert.deepEqual(screen.focus.map(f => f.step), [2, 3, 2, 4], 'focus follows every history move');
    assert.equal(jobSnapshot(job), before);
    assert.equal(Object.keys(state.fullAutoJobs).length, jobs);
    assert.equal(modal, null);
    assert.deepEqual(drawn, []);
    assert.deepEqual(toasts, []);
    assert.equal(networkCalls, 0);
  });
});

test('R11 Back refused while a page edit is open goes back to the same entry: three Backs stay in the app', async () => {
  reset();
  await withHistory(async ({h, settle}) => {
    const job = await finishedJob('우산 속에 들어온 작은 손님');
    assert.equal(await openSimpleJob(ctx, job.id), true);
    await goto(3);
    await goto(4);
    wizard.simpleEditing = true;
    const entries = JSON.stringify(h.entries), at = h.index;
    let renders = 0;
    const render = ctx.render;
    ctx.render = () => { renders++; return render(); };
    try {
      for (let n = 1; n <= 3; n++) {
        toasts.length = 0;
        h.back(); await settle();
        assert.equal(h.left, false, `Back ${n} stays in the app`);
        assert.equal(h.index, at, `Back ${n} returns to the entry the parent was on`);
        assert.equal(wizard.simpleStep, 4);
        assert.equal(wizard.simpleEditing, true, 'the edit is still open');
        assert.deepEqual(toasts.map(t => t.message), [STEP_EDITING]);
      }
    } finally {
      ctx.render = render;
    }
    assert.equal(JSON.stringify(h.entries), entries, 'no entry was rewritten');
    assert.equal(renders, 0, 'the saved text was never drawn over the edit');
    wizard.simpleEditing = false;
    h.back(); await settle();
    assert.equal(wizard.simpleStep, 3, 'with the edit closed, Back moves again');
  });
});

test('R11 Back/Forward while a dialog is open (the one-time recovery code) never acts under it and returns to the entry', async () => {
  reset();
  await withHistory(async ({h, leaves, view, settle}) => {
    const job = await finishedJob('복구 코드를 지키는 뒤로 가기');
    assert.equal(await openSimpleJob(ctx, job.id), true);
    await goto(3);
    await goto(4);
    const entries = JSON.stringify(h.entries), at = h.index;
    let dialog = true;
    ctx.isModalOpen = () => dialog;
    try {
      for (let n = 1; n <= 5; n++) {
        h.back(); await settle();
        assert.equal(h.index, at, `Back ${n} returns to the entry the parent was on`);
        assert.equal(wizard.simpleStep, 4, `Back ${n} changes no step under the dialog`);
        assert.equal(h.left, false);
      }
      assert.deepEqual(leaves, [], 'the leave dialog never replaces the open one');
      assert.equal(JSON.stringify(h.entries), entries, 'no entry was rewritten');
      // The story reopened from the library card, then sign-up from the status
      // chip: Back over the old entries of the same story is refused too.
      ctx.setView('library'); screen.simple = false; wizard = null; draft = null;
      assert.equal(await openSimpleJob(ctx, job.id), true);
      const top = h.index;
      assert.deepEqual([h.entries[top - 1]?.donghwaSimpleStep, h.entries[top - 1]?.story], [4, job.id]);
      h.back(); await settle();
      assert.equal(h.index, top, 'back on the reopened story\'s entry');
      assert.deepEqual(leaves, []);
      assert.equal(view(), 'create');
      assert.equal(wizard.simpleStep, 4);
      assert.equal(modal, null, 'nothing was shown over the dialog');
      dialog = false;
      h.back(); await settle();
      assert.equal(wizard.simpleStep, 3, 'with the dialog closed, Back moves again');
    } finally {
      delete ctx.isModalOpen;
    }
    assert.deepEqual(drawn, []);
    assert.equal(networkCalls, 0);
  });
});

test('R11 Back from a reopened story leaves through the app\'s guarded way to the library; a live text run goes on', async () => {
  reset();
  await withHistory(async ({h, leaves, view, settle}) => {
    // A simple story stopped before its text, reopened from the library card.
    const job = createFullAutoJob(state, {characterIds: ['yuha'], backgroundIds: [], topic: '바람개비가 멈춘 날', pageCount: 8, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'dual', simpleFlow: true}, {demo: true, stopBefore: 'text', planMode: 'selection'});
    job.status = 'paused';
    save();
    assert.equal(await openSimpleJob(ctx, job.id), true);
    assert.equal(wizard.simpleStep, 3);
    assert.equal(h.entries[1], null, 'the library keeps its entry');
    assert.equal(h.state.donghwaSimpleStep, 3);
    // 이어서 만들기 on ③, and Back while the text run is live.
    let backed = false;
    onSave = () => {
      if (backed || job.status !== 'running') return;
      backed = true;
      h.now = true;
      h.back();
      h.now = false;
    };
    await click('retry');
    onSave = null;
    await settle();
    assert.ok(backed);
    assert.equal(h.left, false, 'the app was not unloaded');
    assert.deepEqual(leaves.map(l => l.dialog), [false], 'no book under review: straight to the library');
    assert.equal(view(), 'library');
    assert.equal(job.status, 'text-review', job.error || 'the run went on and finished its text');
    assert.equal(wizard.simpleJobId, job.id, 'the story is kept to come back to');
    // A book under review: the kept dialog. Staying puts this screen's entry back.
    assert.equal(await openSimpleJob(ctx, job.id), true);
    assert.equal(wizard.simpleStep, 4);
    const top = h.index;
    assert.equal(h.entries[top - 1], null);
    h.back(); await settle();
    assert.equal(leaves.length, 2);
    assert.equal(leaves[1].dialog, true);
    leaves[1].stay();
    assert.equal(h.index, top, 'the step entry is back on top');
    assert.deepEqual([h.state.donghwaSimpleStep, h.state.story], [4, job.id]);
    assert.equal(view(), 'create');
    assert.equal(draft, job.book);
    h.back(); await settle();
    assert.equal(leaves.length, 3, 'Back asks again');
    leaves[2].go();
    assert.equal(view(), 'library');
    assert.equal(h.left, false);
    assert.deepEqual(drawn, []);
    assert.equal(networkCalls, 0);
  });
});

test('R11 after 이 주제로 새로 만들기 or a reload, Back passes over another story\'s entries without a word', async () => {
  reset();
  await withHistory(async ({h, leaves, view, settle}) => {
    const job = await finishedJob('숨바꼭질하다 찾은 비밀 장소');
    assert.equal(await openSimpleJob(ctx, job.id), true);
    await goto(1);
    const pending = click('fork');
    await answer('simple-confirm-yes');
    await pending;
    assert.equal(wizard.simpleJobId, undefined);
    assert.equal(h.state.donghwaSimpleStep, 1);
    assert.notEqual(h.state.story, job.id, 'the entry the screen is on names the new story');
    const oldEntry = JSON.stringify(h.entries[h.index - 1]);
    toasts.length = 0;
    h.back(); await settle();
    assert.deepEqual(toasts, [], 'no stray toast');
    assert.equal(JSON.stringify(h.entries[2]), oldEntry, 'the old story\'s entry is not rewritten');
    assert.equal(h.left, false);
    assert.deepEqual(leaves.map(l => l.dialog), [false], 'past the old story, Back reaches the library');
    assert.equal(view(), 'library');
    assert.equal(wizard.topic, job.wizard.topic, 'the new story is kept');
    // A reload: the library stands on an old step entry; a new story is opened.
    wizard = null;
    draft = null;
    h.entries.splice(h.index + 1, Infinity, {donghwaSimpleStep: 2, i: 40, story: 'story-before-reload'}, {donghwaSimpleStep: 3, i: 41, story: 'story-before-reload'});
    h.index += 2;
    wizard = freshWizard({topic: '비 오는 날 열린 장화 행진'});
    ctx.setView('create');
    ctx.render();
    assert.deepEqual([h.state.donghwaSimpleStep, h.state.i], [1, 42], 'its own entry on top of the old one');
    h.back(); await settle();
    assert.deepEqual(toasts, []);
    assert.equal(h.left, false);
    assert.equal(leaves.length, 2);
    assert.equal(view(), 'library');
    // The app's first entry rewritten to a step with no story (an older copy of
    // this screen): passing over it would unload the app, so Back leaves to the library.
    h.entries.splice(1, Infinity, {donghwaSimpleStep: 1});
    h.index = 1;
    wizard = freshWizard({topic: '첫눈이 내린 아침'});
    ctx.setView('create');
    ctx.render();
    h.back(); await settle();
    assert.equal(h.left, false);
    assert.equal(leaves.length, 3);
    assert.equal(view(), 'library');
    assert.deepEqual(toasts, []);
  });
});

test('R11 the first ④ after a text run has its own entry: Back returns to ③, then the frozen ② and ①', async () => {
  reset();
  await withHistory(async ({h, settle}) => {
    wizard = freshWizard({topic: '할머니와 함께 만든 송편'});
    draft = null;
    ctx.render();
    await goto(2);
    await goto(3);
    await click('start-demo');
    const job = state.fullAutoJobs[wizard.simpleJobId];
    assert.equal(job.status, 'text-review');
    assert.equal(wizard.simpleStep, 4);
    assert.deepEqual(h.entries.slice(2).map(e => e.donghwaSimpleStep), [1, 2, 3, 4]);
    assert.equal(h.state.story, job.id);
    for (const step of [3, 2, 1]) {
      h.back(); await settle();
      assert.equal(wizard.simpleStep, step);
    }
    assert.match(renderSimpleCreate(ctx), /simple-frozen/, 'entries from before the run open the story\'s frozen copy');
    for (const step of [2, 3, 4]) {
      h.forward(); await settle();
      assert.equal(wizard.simpleStep, step);
    }
    assert.equal(draft, job.book);
    assert.deepEqual(toasts.filter(t => /먼저|저장하거나/.test(t.message)), []);
    assert.equal(Object.keys(state.fullAutoJobs).filter(id => state.fullAutoJobs[id].wizard?.topic === '할머니와 함께 만든 송편').length, 1);
  });
});

test('R11 after a step change, keyboard focus moves to the new current step', async () => {
  reset();
  const job = await finishedJob('바닷가에서 모래성 쌓기');
  await open(job);
  screen.simple = true;
  screen.focus.length = 0;
  try {
    await goto(1);
    await click('next');
    await click('back');
    await click('open-review');
    await click('to-finish');
    assert.deepEqual(screen.focus.map(f => f.step), [1, 2, 1, 4, 5]);
    assert.ok(screen.focus.every(f => f.options?.preventScroll === true), 'without scrolling the page');
    // A refused move leaves focus where it was.
    await click('back');
    wizard.simpleEditing = true;
    screen.focus.length = 0;
    await goto(1);
    assert.deepEqual(screen.focus, []);
    wizard.simpleEditing = false;
  } finally {
    screen.simple = false;
    screen.focus.length = 0;
  }
  // The focus target: the current step's wrapper, focusable from script only.
  assert.match(renderSimpleCreate(ctx), /<div class="step active" role="listitem" aria-current="step" tabindex="-1">/);
});

test('R11 이 주제로 새로 만들기 names the text price ③ will show for the new story', async () => {
  reset();
  const job = await finishedJob('반짝이는 조약돌 모으기');
  assert.equal(job.planMode, 'selection', 'a demo run plans from the picks');
  assert.equal(job.allowNew, true);
  await open(job, 1);
  const pending = click('fork');
  const html = await answer('simple-confirm-yes');
  await pending;
  const asked = html.match(/글 엔진 요금 약 (\$[\d.]+)/)?.[1];
  await goto(2);
  await goto(3);
  const shown = renderSimpleCreate(ctx).match(/<span>글 만들기<\/span><strong>약 (\$[\d.]+)<\/strong>/)?.[1];
  assert.ok(asked && shown, `${asked} / ${shown}`);
  assert.equal(asked, shown);
  assert.equal(networkCalls, 0);
});

test('R11 a pro run with no book is not opened in ③ by the simple library, and ③ only ever buys text', async () => {
  reset();
  // A pro FULL AUTO run (no simple marker, no text hold) stopped before its text.
  const pro = createFullAutoJob(state, {characterIds: ['yuha'], backgroundIds: [], topic: '프로 모드에서 만든 우주 소풍', pageCount: 8, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'dual'}, {demo: true, stopBefore: null, planMode: 'selection'});
  pro.status = 'paused';
  save();
  assert.doesNotMatch(renderFullAutoJobs(state, {simple: true}), new RegExp(`data-auto-job="${pro.id}"`), 'not on the simple panel');
  assert.match(renderFullAutoJobs(state, {rest: true}), new RegExp(`data-full-auto-action="resume" data-id="${pro.id}"`), 'still on the pro list below the books');
  assert.equal(simpleJobs(state).some(j => j.id === pro.id), false);
  // Opened at ③ anyway (a card drawn before): 이어서 만들기 stops at the text.
  assert.equal(await openSimpleJob(ctx, pro.id), true);
  assert.equal(wizard.simpleStep, 3);
  const third = renderSimpleCreate(ctx);
  assert.match(third, /지금은 글만 만들어요/);
  assert.match(third, /data-simple-action="retry"/);
  await click('retry');
  assert.equal(pro.status, 'text-review', pro.error || '');
  assert.equal(pro.book.pages.filter(p => p.imageAssetId).length, 0, 'no page picture');
  assert.equal(pro.book.cover?.imageAssetId, undefined, 'no cover');
  assert.deepEqual(Object.keys(pro.imageUsage || {}), [], 'nothing drawn or bought');
  assert.equal(wizard.simpleStep, 4, 'pictures go through ④ and its confirm');
  assert.equal(modal, null);
  assert.deepEqual(drawn, []);
  assert.equal(networkCalls, 0);
});

test('R11 a story reopens on the ④ page the parent last looked at, clamped to its pages', async () => {
  reset();
  const job = await finishedJob('처음 두발자전거를 탄 날');
  await open(job);
  assert.equal(editPage, 0);
  for (let i = 0; i < 3; i++) await click('page-next');
  assert.equal(editPage, 3);
  // Left through the kept dialog, then reopened from a card.
  wizard = freshWizard();
  draft = null;
  editPage = 0;
  assert.equal(await openSimpleJob(ctx, job.id), true);
  assert.equal(wizard.simpleStep, 4);
  assert.equal(editPage, 3);
  for (let i = 0; i < 4; i++) await click('page-next');
  assert.equal(editPage, 7);
  job.book.pages.splice(5);
  wizard = freshWizard();
  draft = null;
  await openSimpleJob(ctx, job.id);
  assert.equal(editPage, 4, 'clamped to the last page');
});

test('R11 reopening the story whose picture is being drawn says so (not 다른 이야기); the leave note knows a drawing goes on', async () => {
  reset();
  const a = await finishedJob('해바라기가 쑥쑥 자라는 여름'), b = await finishedJob('캠핑장에서 본 반딧불이');
  await open(a);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const generate = ctx.generateScene;
  ctx.generateScene = async (s, book, index) => { await blocked; return generate(s, book, index); };
  try {
    assert.equal(simpleDrawingInFlight(), false);
    const drawing = click('redraw-page');
    await until(() => simpleDrawingInFlight(), 'the page drawing');
    // The parent left through the kept dialog and started something else.
    wizard = freshWizard();
    draft = null;
    assert.equal(await openSimpleJob(ctx, a.id), false);
    assert.equal(toasts.at(-1).message, '그림을 만드는 중이에요. 끝난 뒤 다시 열어 주세요.');
    assert.equal(await openSimpleJob(ctx, b.id), false);
    assert.match(toasts.at(-1).message, /다른 이야기/);
    release();
    await drawing;
    assert.equal(simpleDrawingInFlight(), false);
    assert.equal(await openSimpleJob(ctx, a.id), true);
    assert.equal(draft, a.book);
  } finally {
    release();
    ctx.generateScene = generate;
  }
});

/* ---------- R11 step navigation: rules the integration review found untested ---------- */
test('R11 the simple library card of a story whose pictures are being made says 그림, not 글 검수 중, before the first page lands', async () => {
  reset();
  const job = await demoJob('구름 위 빵집');
  await open(job);
  let card = null;
  onSave = () => {
    if (card !== null || job.status !== 'running') return;
    if (job.book.pages.some(page => page.imageAssetId)) return;
    const html = renderFullAutoJobs(state, {simple: true}), at = html.indexOf(`data-auto-job="${job.id}"`);
    card = html.slice(at, html.indexOf('</article>', at));
  };
  const pending = click('draw-all');
  await answer('simple-confirm-yes');
  await pending;
  onSave = null;
  assert.ok(card, 'the card was drawn while the run was live and no picture had landed');
  assert.doesNotMatch(card, /글 검수 중/, 'a running picture job is not waiting for text review');
  assert.match(card, /그림 0\/8/);
  assert.match(card, /data-full-auto-action="pause"/, 'its 중지 sits next to the right label');
});

test('R11 ③ of a held story while its pictures are being drawn: the text line and the drawing note, no second progress or 중지', async () => {
  reset();
  const job = await finishedJob('비 오는 날 우산 세 개');
  for (const index of [5, 6, 7]) dropPicture(job, index);
  job.book.autoGenerationComplete = false;
  job.status = 'pages-ready';
  await open(job);
  let third = null;
  onSave = () => {
    if (third !== null || job.status !== 'running') return;
    goto(3);
    third = renderSimpleCreate(ctx);
  };
  const pending = click('draw-all');
  await answer('simple-confirm-yes');
  await pending;
  onSave = null;
  assert.ok(third, 'rendered ③ while the run was live');
  assert.match(third, /글이 완성됐어요 · 쪽 8개/);
  assert.match(third, /지금 그림을 만들고 있어요 · ④에서 볼 수 있어요/);
  assert.doesNotMatch(third, /class="[^"]*simple-progress/);
  assert.doesNotMatch(third, /data-simple-action="stop"/);
  assert.match(third, /data-simple-action="open-review"[^>]*>검수로 가기/);
});

test('R11 이 주제로 새로 만들기 from ② stays on ②, keeps a forced (pro-mode) story on the simple screen and drops the run\'s auto-added friend and place', async () => {
  reset();
  const job = await finishedJob('공룡 친구와 숲 소풍');
  // As an auto-plan run leaves it: the planner's new friend and place are active
  // materials (full-auto.js adds them to state) and in job.wizard's ids.
  const friend = {...structuredClone(state.characters.find(c => c.id === 'greenie')), id: 'auto-friend-r11', name: '포포'};
  const place = {...structuredClone(state.backgrounds.find(b => b.id === 'forest')), id: 'auto-place-r11', name: '버섯 언덕'};
  state.characters.push(friend);
  state.backgrounds.push(place);
  try {
    job.plan = {...(job.plan || {}), newCharacters: [friend], newBackgrounds: [place]};
    // Also a friend deleted since, and more friends than the story can take.
    job.wizard.characterIds = ['yuha', 'greenie', 'gone-friend', 'auto-friend-r11', 'toto', 'mom'];
    job.wizard.backgroundIds = ['home', 'gone-place', 'forest', 'auto-place-r11'];
    await open(job, 2);
    wizard.simpleForced = true;
    const pending = click('fork');
    await answer('simple-confirm-yes');
    await pending;
    assert.equal(wizard.simpleJobId, undefined);
    assert.equal(wizard.simpleStep, 2, 'a fork from ② lands on ②');
    assert.equal(wizard.simpleForced, true, 'a forced story stays on the simple screen');
    assert.deepEqual(wizard.characterIds, ['yuha', 'greenie', 'toto'], 'the run\'s own new friend and a deleted one are not carried over; 1 + 2 friends at most');
    assert.deepEqual(wizard.backgroundIds, ['home', 'forest'], 'the run\'s own new place is not carried over');
  } finally {
    state.characters.splice(state.characters.indexOf(friend), 1);
    state.backgrounds.splice(state.backgrounds.indexOf(place), 1);
  }
});

test('R11 이 주제로 새로 만들기 is drawn disabled and dropped silently while this screen draws a page', async () => {
  reset();
  const job = await finishedJob('해바라기 키 재기');
  await open(job);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const generate = ctx.generateScene;
  ctx.generateScene = async (s, book, index) => { await blocked; return generate(s, book, index); };
  const before = wizard;
  try {
    const drawing = click('redraw-page');
    await until(() => simpleDrawingInFlight(), 'the page drawing');
    await goto(1);
    assert.equal(wizard.simpleStep, 1);
    assert.match(renderSimpleCreate(ctx), /data-simple-action="fork"[^>]*disabled/);
    await click('fork');
    assert.equal(modal, null, 'no confirm while the page is drawn');
    assert.equal(wizard, before);
    release();
    await drawing;
  } finally {
    release();
    ctx.generateScene = generate;
  }
});

test('R11 ③ 이어서 만들기 that finishes while the parent is on ① leaves them on ①', async () => {
  reset();
  const job = await demoJob('개미 마을 이사');
  delete job.book;
  job.status = 'paused';
  for (const key of Object.keys(job.completed)) if (!/^(plan|outline)$/.test(key)) delete job.completed[key];
  await openSimpleJob(ctx, job.id);
  assert.equal(wizard.simpleStep, 3);
  let moved = false;
  onSave = () => {
    if (moved || job.status !== 'running') return;
    moved = true;
    goto(1);
  };
  await click('retry');
  onSave = null;
  assert.ok(moved);
  assert.equal(job.status, 'text-review', job.error || '');
  assert.equal(wizard.simpleStep, 1, 'not pulled to ④');
  assert.ok(toasts.some(t => t.message === '글이 완성됐어요. 단계 표시의 ④에서 검수해요.'));
});

test('R11 ④ bottom-left is 이전, disabled while a page edit is open; ③ gets ✓ only once the text exists', async () => {
  reset();
  const job = await finishedJob('달팽이 경주');
  await open(job);
  const back = /<div class="wizard-actions"><button[^>]*data-simple-action="back"[^>]*>이전<\/button>/;
  const backDisabled = /<div class="wizard-actions"><button[^>]*data-simple-action="back"[^>]*disabled[^>]*>이전<\/button>/;
  assert.match(renderSimpleCreate(ctx), back);
  assert.doesNotMatch(renderSimpleCreate(ctx), backDisabled);
  wizard.simpleEditing = true;
  assert.match(renderSimpleCreate(ctx), backDisabled);
  wizard.simpleEditing = false;
  const paused = await demoJob('개미 마을 이사 2');
  delete paused.book;
  paused.status = 'paused';
  await openSimpleJob(ctx, paused.id);
  wizard.simpleStep = 1;
  assert.match(renderSimpleCreate(ctx), /data-step="3"[^>]*><b>3<\/b>/, 'no ✓ on ③ before the text exists');
});

test('R11 아이디어 뽑기 that resolves after the story got its job leaves the bound wizard\'s topic alone', async () => {
  reset();
  const job = await demoJob('바람개비 언덕');
  const quality = state.settings.storyQuality;
  state.settings.storyQuality = {...(quality || {}), worldId: 'forest-village'};
  wizard = {step: 1, simpleStep: 1, topic: '바람개비 언덕', characterIds: ['yuha'], backgroundIds: []};
  draft = null;
  try {
    const pending = click('idea');
    // Before the world idea comes back the story was started (③ 데모로 체험)
    // and the parent went back to ① through the step bar: the wizard is bound.
    wizard.simpleJobId = job.id;
    await pending;
    assert.equal(wizard.topic, '바람개비 언덕', 'the bound story keeps its topic');
  } finally {
    state.settings.storyQuality = quality;
  }
});

test('줄거리 새로 만들기 on a story stopped by a failed check confirms, then starts a new job with a new seed and keeps the old one', async () => {
  reset();
  const createdBefore = Object.keys(state.fullAutoJobs || {}).length;
  const old = await startFullAutoJob({characterIds: ['yuha'], backgroundIds: [], topic: '공룡 친구와 소풍', pageCount: 8, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'dual', simpleFlow: true}, {demo: true, stopBefore: 'text', planMode: 'selection'});
  // The outline check failed on a paid result: the job holds no book and the check's error.
  Object.assign(old, {status: 'failed', error: '이야기 outline 결과를 확인해 주세요: plan.planted가 비어 있음', phase: '이야기 outline 결과를 확인해 주세요: plan.planted가 비어 있음'});
  delete old.book;
  const oldJson = JSON.stringify({...old, simpleReplacedBy: undefined, updatedAt: undefined});
  assert.equal(await openSimpleJob(ctx, old.id), true);
  assert.equal(wizard.simpleStep, 3);
  assert.match(renderSimpleCreate(ctx), /data-simple-action="restart"[^>]*>줄거리 새로 만들기</);
  const run = click('restart');
  const asked = await answer('simple-confirm-yes');
  assert.match(asked, /줄거리부터 새로 써요/);
  await run;
  await until(() => wizard?.simpleJobId && wizard.simpleJobId !== old.id && state.fullAutoJobs[wizard.simpleJobId]?.status !== 'running', 'the new text run');
  const fresh = state.fullAutoJobs[wizard.simpleJobId];
  assert.equal(fresh.wizard.qualitySeedOffset, (Number(old.wizard.qualitySeedOffset) || 0) + 1, 'a new seed, so cached responses are not replayed');
  assert.equal(old.simpleReplacedBy, fresh.id);
  assert.equal(JSON.stringify({...old, simpleReplacedBy: undefined, updatedAt: undefined}), oldJson, 'the old job is otherwise untouched');
  assert.ok(Object.keys(state.fullAutoJobs).length >= createdBefore + 2);
});
