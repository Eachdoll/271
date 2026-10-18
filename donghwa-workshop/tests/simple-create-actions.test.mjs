// R9 FIX-UI: simple create actions driven through the real click handler and the
// real FULL AUTO runner (demo text, free sample engine). A stub document stands
// in for the DOM; confirm dialogs are answered through their buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState, safeTopic} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {configureFullAutoUI, startFullAutoJob, runFullAutoJob, getFullAutoJob} from '../dist/full-auto-ui.js';
import {generateBookPageImage, isPageImageStale, pagesNeedingImages} from '../dist/story-generation/page-tools.js';
import {
  configureSimpleCreate, openSimpleJob, renderSimpleCreate, simpleJobs, imageWork, imageCountLabel,
  IDEA_TOPICS, pickIdeaTopic, isSimpleBusy, isPictureKeptAfterEdit, keepEditedPictures, coherenceCheckDue,
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
function reset() { toasts.length = 0; approvals.length = 0; drawn.length = 0; credentialLinks.length = 0; onSave = null; modal = null; failWrites = 0; fields = {}; }
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
