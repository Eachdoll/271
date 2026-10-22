import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preloadQualityDataForNode} from '../scripts/r31b-node-data.mjs';
import {loadStoryQualityData} from '../dist/story-generation/quality-adapter.js';

test('R31b Node runner loads baseline quality assets without an HTTP or file fetch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Unexpected network fetch'); };
  try {
    const loaded = await preloadQualityDataForNode();
    const cached = await loadStoryQualityData(globalThis.fetch, {includeDistilled: true});
    assert.ok(loaded.goldBooks.length > 0);
    assert.ok(loaded.worldLibrary.worlds.length > 0);
    assert.deepEqual(cached, loaded);
    await assert.rejects(fetch(new URL('file:///unrelated-private-file')), /only reads local quality assets/u);
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * 2026-10-21 R31b A/B runner (scripts/r31b-ab.mjs): the same request written
 * twice through FULL AUTO's text stages — the diet draft and the same draft
 * without promptDiet — then measured by the checker. This test runs it on the
 * free demo engine only (no key, no request); the paid run happens where the
 * parent's key is. It refuses a real run without --paid.
 */
const script = fileURLToPath(new URL('../scripts/r31b-ab.mjs', import.meta.url));
const run = (args) => spawnSync(process.execPath, [script, ...args], {encoding: 'utf8', timeout: 120000});

test('R31b A/B the demo run writes both arms, the compare table and the golden column; the arms differ only by promptDiet; no key-like field is written', () => {
  const out = mkdtempSync(join(tmpdir(), 'r31b-ab-'));
  const result = run(['K1', 'both', out, '--demo']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (const file of ['K1-r31a.md', 'K1-r31a.json', 'K1-diet.md', 'K1-diet.json', 'K1-compare.md']) assert.ok(existsSync(join(out, file)), file);
  const diet = JSON.parse(readFileSync(join(out, 'K1-diet.json'), 'utf8')), old = JSON.parse(readFileSync(join(out, 'K1-r31a.json'), 'utf8'));
  assert.deepEqual(diet.input.promptDiet, {version: 1});
  assert.equal('promptDiet' in old.input, false);
  assert.deepEqual(diet.input.k1Policy, old.input.k1Policy);
  assert.equal(diet.status, 'text-review'); assert.equal(old.status, 'text-review');
  assert.equal(diet.measured.totals.pages, 12);
  assert.equal(diet.usageSummary.costUsd, 0, 'the demo buys nothing');
  const compare = readFileSync(join(out, 'K1-compare.md'), 'utf8');
  assert.match(compare, /\| 항목 \| r31a \| 다이어트 · 현재 코드 \| Dola 골든\(K1\) \|/u);
  assert.match(compare, /두리번두리번 부릉부릉 콩닥콩닥/u, 'the golden manuscript measured the same way');
  assert.doesNotMatch(readFileSync(join(out, 'K1-diet.json'), 'utf8'), /apiKey|api_key|secret|password|authorization/iu);
  assert.doesNotMatch(result.stdout, /sk-|key=/iu);
});

test('R31b A/B a real run without --paid is refused before anything is created', () => {
  const out = mkdtempSync(join(tmpdir(), 'r31b-ab-refuse-'));
  const result = run(['K2', 'diet', out]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--paid/u);
  assert.equal(existsSync(join(out, 'K2-diet.json')), false);
});
