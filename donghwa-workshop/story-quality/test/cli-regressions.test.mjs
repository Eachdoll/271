import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadExisting, runDistillation } from '../dist/distill/generate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const topics = read('distill/topics.json').topics;
const fixture = {
  topics: topics.slice(0, 1),
  levels: [{ levelKo: 'K1', levelEn: 'E0' }, { levelKo: 'K1', levelEn: 'E1' }],
  pages: 12,
  patterns: read('data/plot_patterns.json'),
  worlds: read('data/worlds.json'),
  inventories: read('data/inventories.json'),
  protagonist: { name: '유하', traits: ['호기심 많음'] },
  supporting: [],
  concurrency: 1,
};

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'story-quality-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeEngine() {
  let calls = 0;
  return {
    id: 'fake-regression',
    get calls() { return calls; },
    async complete() {
      calls++;
      // Resume identities must be distinct even when a response is rejected.
      return { text: 'not JSON', usage: { input: 0, output: 0 }, costUsd: 0 };
    },
  };
}

test('distill resume IDs distinguish English levels sharing one Korean level', async (t) => {
  const outPath = join(scratch(t), 'outlines.jsonl');
  const engine = fakeEngine();
  const cfg = { ...fixture, outPath, generator: engine, judge: engine };
  const initial = await runDistillation(cfg);
  assert.equal(initial.total, 2);
  assert.equal(engine.calls, 2);
  assert.deepEqual([...loadExisting(outPath).keys()], [
    `${topics[0].id}-K1-E0-v0`, `${topics[0].id}-K1-E1-v0`,
  ]);
  const resumed = await runDistillation(cfg);
  assert.equal(resumed.skipped, 2);
  assert.equal(resumed.total, 0);
  assert.equal(engine.calls, 2);
});

test('dry-run rows do not suppress later real generation in the same output', async (t) => {
  const outPath = join(scratch(t), 'outlines.jsonl');
  const engine = fakeEngine();
  const cfg = { ...fixture, outPath, generator: engine, judge: engine };
  await runDistillation({ ...cfg, dryRun: true });
  assert.equal(engine.calls, 0);
  assert.ok([...loadExisting(outPath).values()].every((s) => s.dryRun));
  const real = await runDistillation(cfg);
  assert.equal(real.skipped, 0);
  assert.equal(real.total, 2);
  assert.equal(engine.calls, 2);
  assert.ok([...loadExisting(outPath).values()].every((s) => !s.dryRun));
});

test('estimate CLI labels unknown prices unavailable without creating samples or calling engines', (t) => {
  const out = join(scratch(t), 'estimate.jsonl');
  for (const spec of ['openai:unknown-model', 'anthropic:unknown-model', 'local:http://127.0.0.1:1#test-model']) {
    const run = spawnSync(process.execPath, [join(root, 'dist/cli/distill.js'), '--estimate', '--limit', '1', '--gen', spec, '--out', out], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /est\. cost unavailable \(unpriced:/);
    assert.ok(run.stdout.includes(spec));
    assert.doesNotMatch(run.stdout, /est\. cost ≈|\$0\.00/);
    assert.ok(!existsSync(out));
  }
});

test('estimate CLI retains numeric costs for registered Anthropic models without API keys', (t) => {
  const out = join(scratch(t), 'estimate.jsonl');
  const run = spawnSync(process.execPath, [join(root, 'dist/cli/distill.js'), '--estimate', '--limit', '1', '--out', out], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /est\. cost ≈ \$\d+\.\d{2}/);
  assert.doesNotMatch(run.stdout, /unavailable|unpriced/);
  assert.ok(!existsSync(out));
});

test('R6-3 distill estimates default to Sonnet and warn when Opus is selected without API calls',()=>{
 const defaults=spawnSync(process.execPath,['dist/cli/distill.js','--estimate','--limit','1'],{cwd:root,encoding:'utf8',env:{...process.env,ANTHROPIC_API_KEY:''}});assert.equal(defaults.status,0,defaults.stderr);assert.match(defaults.stdout,/generator=anthropic:claude-sonnet-5-5/);
 const opus=spawnSync(process.execPath,['dist/cli/distill.js','--estimate','--limit','1','--gen','anthropic:claude-opus-5-5'],{cwd:root,encoding:'utf8',env:{...process.env,ANTHROPIC_API_KEY:''}});assert.equal(opus.status,0,opus.stderr);assert.match(opus.stderr,/Opus 5.5.*추정.*Sonnet/);
});
test('R6-6 prose CLI reuses one retained outline end-to-end with a mock engine and resumes without duplicates',t=>{
 const dir=scratch(t),args=['dist/cli/eval.js','run','--stage','prose','--from','sonnet55-trial','--run-id','mock-prose','--mock','--budget','--limit','1','--out',dir];
 const run=()=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...process.env,ANTHROPIC_API_KEY:'',OPENAI_API_KEY:''}});
 const first=run();assert.equal(first.status,0,first.stderr);const rows=readFileSync(join(dir,'mock-prose.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.length,1);assert.equal(rows[0].error,undefined);assert.equal(rows[0].stage,'prose');assert.equal(rows[0].budget,true);assert.equal(rows[0].condense,false);assert.equal(rows[0].costUsd,0);assert.equal(rows[0].ko.pages,12);assert.equal(rows[0].en.pages,12);assert.equal(rows[0].child.pass,true);assert.equal(rows[0].pagination.approximate,true);assert.match(rows[0].pagination.note,/근사/);
 const again=run();assert.equal(again.status,0,again.stderr);assert.equal(readFileSync(join(dir,'mock-prose.jsonl'),'utf8').trim().split('\n').length,1);assert.equal(read('eval/testset.json').pages,12);
 const dryArgs=args.map(a=>a==='--mock'?'--dry-run':a==='mock-prose'?'mock-prose-dry':a);const dry=spawnSync(process.execPath,dryArgs,{cwd:root,encoding:'utf8',env:{...process.env,ANTHROPIC_API_KEY:'',OPENAI_API_KEY:''}});assert.equal(dry.status,0,dry.stderr);const dryRow=JSON.parse(readFileSync(join(dir,'mock-prose-dry.jsonl'),'utf8').trim());assert.equal(dryRow.mock,true);assert.equal(dryRow.costUsd,0);
});
