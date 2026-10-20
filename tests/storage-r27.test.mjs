import test from 'node:test';
import assert from 'node:assert/strict';
import {readStoredLibrary, writeStoredLibrary, spillStoredLibrary, readSpilledLibrary, libraryTextOf, isSpilledLibrary, decodeStoredLibrary, SPILL_MARK, COMPRESSED_MARK} from '../dist/library-storage.js';
import {estimateLibraryStorage} from '../dist/finalize-cleanup.js';

/** R27 큰 보관함: a library that does not fit localStorage even compressed lives in IndexedDB behind a pointer. */
const key = 'library', seed = () => ({books: [], characters: [{id: 'sample'}]});
const validate = (raw) => { const next = JSON.parse(raw); if (!Array.isArray(next.books)) throw new Error('invalid books'); return next; };
function quotaStorage(limit) {
  let raw = null;
  return {
    getItem: () => raw,
    setItem: (_key, value) => { if (value.length > limit) throw Object.assign(new Error('The quota has been exceeded.'), {name: 'QuotaExceededError'}); raw = value; },
    raw: () => raw,
  };
}
const memoryStore = () => { let text = null; return {async get() { return text; }, async put(value) { text = value; }, text: () => text}; };
const big = () => ({books: Array.from({length: 40}, (_, i) => ({id: `b${i}`, title: `책 ${i}`, note: `${Math.random()}`.repeat(30)})), characters: []});

test('R27 a library too big even compressed is spilled: the big store first, then a small pointer', async () => {
  const s = quotaStorage(200), store = memoryStore(), state = big();
  assert.throws(() => writeStoredLibrary(s, key, state), (e) => e.code === 'QUOTA');
  assert.equal(s.raw(), null, 'nothing half-written');
  await spillStoredLibrary(s, key, state, {store});
  assert.ok(isSpilledLibrary(s.raw()));
  assert.ok(s.raw().length < 200);
  assert.ok(store.text().startsWith(COMPRESSED_MARK));
  // Boot: the pointer resolves to the stored library, which reads as before.
  const boot = await readSpilledLibrary(s, key, {store});
  assert.equal(boot.spilled, true);
  const read = readStoredLibrary(boot.storage, key, {validate, seed});
  assert.equal(read.kind, 'ready');
  assert.deepEqual(read.state, state);
  assert.equal(await libraryTextOf(s.raw(), {store}), store.text());
  assert.ok(estimateLibraryStorage(s, key, state) > 1000, 'the panel sizes the library, not the pointer');
});

test('R27 a failed big-store write leaves the old library; an unreadable pointer blocks instead of seeding', async () => {
  const s = quotaStorage(1e9), store = {async get() { return null; }, async put() { throw new Error('disk full'); }};
  writeStoredLibrary(s, key, {books: [{id: 'old'}], characters: []});
  const before = s.raw();
  await assert.rejects(spillStoredLibrary(s, key, big(), {store}), /disk full/);
  assert.equal(s.raw(), before);
  s.setItem(key, SPILL_MARK + '{}');
  const boot = await readSpilledLibrary(s, key, {store});
  assert.ok(boot.error);
  const read = readStoredLibrary(boot.storage, key, {validate, seed});
  assert.equal(read.kind, 'blocked', 'never a sample library over a pointer');
  assert.throws(() => decodeStoredLibrary(s.raw()), /큰 보관함/);
  assert.throws(() => writeStoredLibrary(s, key, seed(), {blocked: true}), /원본을 보호/);
});

test('R27 once space is back, a save writes localStorage again (compressed) and the pointer is gone', async () => {
  let limit = 200;
  const store = memoryStore(), s = {raw: null, getItem() { return this.raw; }, setItem(_k, v) { if (v.length > limit) throw Object.assign(new Error('quota'), {name: 'QuotaExceededError'}); this.raw = v; }};
  await spillStoredLibrary(s, key, big(), {store});
  assert.ok(isSpilledLibrary(s.raw));
  limit = 1e9;
  const small = {books: [{id: 'b'}], characters: []};
  writeStoredLibrary(s, key, small);
  assert.ok(s.raw.startsWith(COMPRESSED_MARK), 'a spilled library is tried compressed, never plain again');
  assert.deepEqual(JSON.parse(decodeStoredLibrary(s.raw)), small);
  const boot = await readSpilledLibrary(s, key, {store});
  assert.equal(boot.spilled, false);
});

test('R27 a FULL AUTO job drops its paid-call journals once its book is built; unfinished work keeps them', async () => {
  const {pruneTextJournals, cleanupOldWorkRecords, TEXT_JOURNALS} = await import('../dist/finalize-cleanup.js');
  const journals = () => Object.fromEntries(TEXT_JOURNALS.map((k) => [k, {calls: [{response: 'x'.repeat(100)}]}]));
  const built = {status: 'review', book: {id: 'b'}, completed: {pagination: 't'}, outline: {council: {phase: 'done'}}, ...journals()};
  assert.equal(pruneTextJournals(built), TEXT_JOURNALS.length);
  for (const k of TEXT_JOURNALS) assert.ok(!(k in built));
  assert.deepEqual(built.outline, {council: {phase: 'done'}}, 'the council record on the outline stays');
  assert.equal(pruneTextJournals(built), 0);
  // No book yet, or the text not finished: everything stays for a resume.
  for (const job of [{status: 'paused', completed: {outline: 't'}, ...journals()}, {status: 'council-review', completed: {}, ...journals()}, {status: 'review', book: {}, completed: {}, ...journals()}]) {
    const before = structuredClone(job);
    assert.equal(pruneTextJournals(job), 0); assert.deepEqual(job, before);
  }
  // The library button also prunes built jobs that are not running.
  const running = {status: 'running', book: {id: 'r'}, completed: {pagination: 't'}, ...journals()};
  const state = {books: [], storyDrafts: {}, fullAutoJobs: {a: {status: 'review', book: {id: 'a'}, completed: {pagination: 't'}, ...journals()}, r: running}};
  assert.equal(cleanupOldWorkRecords(state), 1);
  assert.ok(!('qualityCheckpoint' in state.fullAutoJobs.a));
  assert.ok('qualityCheckpoint' in state.fullAutoJobs.r, 'a running job is never touched');
});
