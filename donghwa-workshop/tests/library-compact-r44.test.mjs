import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compactUsageRow, compactStageMeta, compactLibrary, librarySizeParts, USAGE_OBJECT_MAX} from '../dist/library-compact.js';
import {cleanupOldWorkRecords} from '../dist/finalize-cleanup.js';
import {jobTextBudget} from '../dist/text-generation/models.js';
import {createCloudSync, CLOUD_STATE_BYTES} from '../dist/cloud-sync.js';
import {CLOUD_LIMITS} from '../server/cloud-api.js';

/**
 * 2026-10-29 R44 클라우드 저장 크기. The parent: "cloud save does not work" —
 * the confirm dialog showed "클라우드 책장 내용은 8MB까지 보관할 수 있어요"
 * in its error line. Measured on the paid runs Codex committed: every text
 * stage's usage row carried the stage's paid-response journals, the approved
 * prose and the richness report (95–297KB a story), copied into the book and
 * the pro draft too. The rows now keep tokens, requests, cost and model; a
 * boot pass, the cleanup button and the cloud snapshot compact old libraries;
 * the cloud limit is 16MB (an R2 object) and its error names the size and
 * the biggest parts.
 */
const sz = (v) => Buffer.byteLength(JSON.stringify(v ?? null));
const paid = (file) => JSON.parse(readFileSync(new URL(`../QA/${file}`, import.meta.url), 'utf8'));
const RUNS = ['r31b-ab/K2-r31a.json', 'r33-beach/K2-diet.json', 'r31c-ab/K1-diet.json'];

test('R44 usage rows: the paid journals and big reports go, tokens, requests, cost, model and stage stay; idempotent', () => {
  for (const file of RUNS) {
    const calls = paid(file).usage.calls;
    const before = sz(calls), rows = calls.map(compactUsageRow), after = sz(rows);
    assert.ok(after < before / 20, `${file}: ${before} -> ${after}`);
    rows.forEach((row, i) => {
      for (const key of ['input', 'output', 'requests', 'stage', 'model', 'engineId', 'costUsdEstimated', 'costUsd', 'callId', 'at', 'failed', 'pricingUnknown'])
        if (key in calls[i]) assert.deepEqual(row[key], calls[i][key], `${file} row ${i} keeps ${key}`);
      assert.ok(!Object.keys(row).some((key) => /Checkpoint$/.test(key)), 'no journal');
      for (const [key, value] of Object.entries(row)) if (value && typeof value === 'object' && key !== 'usage') assert.ok(sz(value) <= USAGE_OBJECT_MAX, key);
      assert.deepEqual(compactUsageRow(row), row, 'a second pass changes nothing');
    });
  }
  assert.deepEqual(compactUsageRow({input: 1, usage: {costUsd: 0.5, big: 'x'.repeat(5000)}}), {input: 1, usage: {costUsd: 0.5, big: 'x'.repeat(5000)}}, 'the nested usage object (app.js reads c.usage.costUsd) stays whole');
  assert.equal(compactUsageRow(null), null);
  assert.deepEqual(compactStageMeta({coherence: {passed: true}, checks: {a: 1}, manualRedistribution: true, childGateCheckpoint: {x: 1}, revisionCheckpoint: {y: 2}, approvedProse: {ko: '…'}}), {coherence: {passed: true}, checks: {a: 1}, manualRedistribution: true});
});

/** A library like the parent's: each finished story has its job, its book and a pro draft, each with the same usage copy. */
function libraryOf(count = 6) {
  const run = paid('r33-beach/K2-diet.json');
  const state = {version: 1, books: [], characters: [{id: 'yuha', name: '유하'}], backgrounds: [{id: 'home', name: '집'}], worlds: [], settings: {}, storyDrafts: {}, fullAutoJobs: {}};
  for (let i = 0; i < count; i++) {
    const usage = structuredClone(run.usage);
    state.books.push({id: `book-${i}`, title: `책 ${i}`, fullAutoRunId: `job-${i}`, storyDraftId: `draft-${i}`, pages: structuredClone(run.pagination.pages), outline: structuredClone(run.outline), textUsage: structuredClone(usage), approved: false});
    state.storyDrafts[`draft-${i}`] = {id: `draft-${i}`, usage: structuredClone(usage), paginationMeta: {coherence: {passed: true}, checks: {ok: 1}, childGateCheckpoint: structuredClone(usage.calls[0].council || {}), approvedProse: structuredClone(run.prose)}};
    state.fullAutoJobs[`job-${i}`] = {id: `job-${i}`, status: 'review', usage: structuredClone(usage), book: {id: `book-${i}`}, completed: {pagination: true}, councilCheckpoint: {version: 1, completed: {a: 'x'.repeat(20000)}}, outline: structuredClone(run.outline)};
  }
  state.fullAutoJobs.running = {id: 'running', status: 'running', usage: {calls: []}, book: {id: 'b'}, completed: {pagination: true}, writerCheckpoint: {version: 1, completed: {b: 1}}};
  state.fullAutoJobs.unfinished = {id: 'unfinished', status: 'paused', usage: {calls: []}, writerCheckpoint: {version: 1, completed: {c: 1}}};
  return state;
}

test('R44 the library pass: every usage copy, stored stage meta and finished job is compacted in place; running and unfinished jobs keep their journals; the spend shown for a job is the same; a second pass changes nothing; the cleanup button runs it', () => {
  const state = libraryOf(6), before = sz(state);
  const budgetBefore = jobTextBudget(structuredClone(state.fullAutoJobs['job-0']));
  const count = compactLibrary(state), after = sz(state);
  assert.ok(after < before * 0.7, `${before} -> ${after}`);
  assert.equal(count.journals, 6, 'the six finished jobs lose their own journals (the R27 rule)');
  assert.ok(count.rows >= 18 && count.metas === 6, JSON.stringify(count));
  assert.deepEqual(state.fullAutoJobs.running.writerCheckpoint, {version: 1, completed: {b: 1}}, 'a running job keeps its journal');
  assert.deepEqual(state.fullAutoJobs.unfinished.writerCheckpoint, {version: 1, completed: {c: 1}}, 'a job without a book keeps its journal');
  assert.deepEqual(state.storyDrafts['draft-0'].paginationMeta, {coherence: {passed: true}, checks: {ok: 1}});
  const budgetAfter = jobTextBudget(state.fullAutoJobs['job-0']);
  assert.equal(budgetAfter.usedUsd, budgetBefore.usedUsd, 'the spend shown in ③ is unchanged');
  assert.equal(budgetAfter.usedUnknown, budgetBefore.usedUnknown);
  assert.deepEqual(compactLibrary(state), {rows: 0, metas: 0, journals: 0}, 'idempotent');
  // The cleanup button counts the compacted rows too (and stays as before without the hook).
  const fresh = libraryOf(2);
  assert.ok(cleanupOldWorkRecords(structuredClone(fresh)) >= 2);
  const counted = cleanupOldWorkRecords(fresh, {compact: compactLibrary});
  assert.ok(counted >= 2 + 6, `cleaned ${counted}`);
  assert.equal(sz(fresh.books[0].textUsage) < 10000, true);
  // The parts line names the biggest parts.
  const parts = librarySizeParts(libraryOf(3));
  assert.match(parts.line, /^(책|만들던 이야기|글 초안) \d+\.\dMB · /);
  assert.equal(parts.parts[0].bytes >= parts.parts[1].bytes, true);
});

test('R44 the cloud: the snapshot sent is compacted; an over-limit library is refused with its size and biggest parts; the client and server limits match at 16MB; writers no longer copy journals', async () => {
  assert.equal(CLOUD_STATE_BYTES, 16 * 1024 * 1024);
  assert.equal(CLOUD_LIMITS.stateBytes, CLOUD_STATE_BYTES);
  assert.equal(CLOUD_LIMITS.requestBytes, 18 * 1024 * 1024);
  const puts = [];
  const fetchImpl = async (url, options = {}) => {
    const path = String(url).replace('/api/cloud', ''), method = options.method || 'GET';
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    if (path === '/session') return json({authenticated: true, user: {id: 'owner-A'}});
    if (path === '/library?meta=1') return json({exists: false, revision: 0, updatedAt: null, summary: {bookCount: 0, characterCount: 0, backgroundCount: 0}});
    if (path === '/library' && method === 'GET') return json({exists: false, revision: 0, state: null, manifest: []});
    if (path === '/library' && method === 'PUT') { puts.push(JSON.parse(options.body)); return json({revision: 1, updatedAt: '2026-10-29T00:00:00Z'}); }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const make = (state) => createCloudSync({getState: () => state, hasLocalData: () => true, isParent: () => true, canApplyRemote: () => true, applyRemote: async () => {}, fetchImpl, pollInterval: 0, eventTarget: null, document: null, debounceMs: 100000,
    storage: {getItem: () => null, setItem() {}, removeItem() {}},
    createLibraryBackup: async (s) => ({snapshot: JSON.parse(JSON.stringify(s)), assets: new Map()})});
  const local = libraryOf(4), localBefore = JSON.stringify(local);
  const sync = make(local);
  try {
    await sync.start();
    await sync.push({force: true});
  } finally { sync.stop(); }
  assert.equal(puts.length, 1);
  const sent = puts[0].state;
  assert.ok(sz(sent) < sz(JSON.parse(localBefore)) * 0.7, 'the cloud copy is the compact one');
  assert.ok(!JSON.stringify(sent).includes('councilCheckpoint'), 'no journal reaches the cloud');
  assert.equal(JSON.stringify(local), localBefore, 'the push does not touch the device library (the boot pass does that)');
  // Over the limit: refused before any request, with the size and the parts.
  const huge = libraryOf(1);
  huge.books[0].notes = 'ㄱ'.repeat(6 * 1024 * 1024);
  puts.length = 0;
  const big = make(huge);
  try {
    await big.start();
    await assert.rejects(big.push({force: true}), (error) => {
      assert.equal(error.code, 'LIBRARY_TOO_LARGE');
      assert.match(error.message, /^클라우드에 저장하지 못했어요\. 책장 글 자료가 \d+\.\dMB로 저장 한도 16\.0MB를 넘었어요 \(큰 곳: 책 \d+\.\dMB/);
      assert.match(error.message, /'오래된 작업 기록 정리'/);
      return true;
    });
  } finally { big.stop(); }
  assert.equal(puts.length, 0);
  // The writers: no journal copies in new usage rows or stored metas.
  const fullAuto = readFileSync(new URL('../dist/full-auto.js', import.meta.url), 'utf8');
  assert.match(fullAuto, /const row = compactUsageRow\(\{\n\s+\.\.\.clone\(result\.usage\),\n\s+\.\.\.clone\(result\.meta \|\| \{\}\),/);
  const ui = readFileSync(new URL('../dist/story-generation/ui.js', import.meta.url), 'utf8');
  assert.equal((ui.match(/d\.(?:pagination|sceneBriefs)Meta = r\.meta;/g) || []).length, 0);
  assert.match(ui, /row = compactUsageRow\(\{\n\s+at: new Date\(\)\.toISOString\(\),/);
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /const bootCompaction = storageBlocked \? null : compactLibrary\(state\);/);
  assert.match(app, /if \(bootCompaction && bootCompaction\.rows \+ bootCompaction\.metas \+ bootCompaction\.journals > 0\) save\(\);/);
  assert.match(app, /cleanupOldWorkRecords\(state, \{ compact: compactLibrary \}\)/);
});
