/**
 * CLI: 평가 하네스
 *   node dist/cli/eval.js run --run-id sonnet55-v3 --gen anthropic:claude-sonnet-5-5 --judge anthropic:claude-haiku-5-5 [--beam] [--no-fix] [--examples 2] [--limit 0]
 *   node dist/cli/eval.js compare [--baseline <runId>]
 *   node dist/cli/eval.js calibrate --judge anthropic:claude-haiku-5-5
 *   node dist/cli/eval.js run --dry-run    (API 없이 흐름만)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeEngine } from './distill.js';
import { runProseEvaluation } from '../eval/prose.js';
import { calibrateJudge, compareSummaries, runEval, type EvalSummary, type EvalTopic } from '../eval/harness.js';
import type { BookRecord, Inventories, PlotPatternCard, StoryOutline, TextEngine } from '../types.js';
import type { WorldLibrary } from '../worlds.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(resolve(p), 'utf8')) as T;

async function main() {
  const cmd = process.argv[2] ?? 'run';
  const outDir = resolve(arg('out', 'eval/results')!);
  mkdirSync(outDir, { recursive: true });
  const gold = [...readJson<BookRecord[]>('gold/gold_outlines_part1.json'), ...readJson<BookRecord[]>('gold/gold_outlines_part2.json')];

  if (cmd === 'compare') {
    const baseline = arg('baseline');
    const sums = readdirSync(outDir).filter((f) => f.endsWith('.summary.json')).map((f) => readJson<EvalSummary>(`${outDir}/${f}`)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (!sums.length) return console.log('결과 없음');
    console.log(compareSummaries(sums, baseline));
    return;
  }

  if (arg('stage') === 'prose') {
    const from = arg('from');
    if (!from || from === 'true') throw new Error('--from <outlineRunId or JSONL path> is required.');
    const candidates = from.endsWith('.jsonl') ? [resolve(from)] : [resolve(outDir, from + '.jsonl'), resolve('eval/trial-2026-10-17', from + '.jsonl')];
    const input = candidates.find(path => existsSync(path));
    if (!input) throw new Error('Existing outline results not found. No outline generation was started.');
    const mock = arg('mock') === 'true' || arg('dry-run') === 'true';
    if (mock) globalThis.fetch = async () => {throw new Error('Mock evaluation prohibits network access.');};
    const runId = arg('run-id', `${from.split(/[\\/]/).at(-1)!.replace(/\.jsonl$/, '')}-prose${arg('budget') === 'true' ? '-budget' : ''}${arg('condense') === 'true' ? '-condense' : ''}${mock ? '-mock' : ''}`)!;
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error('Invalid --run-id.');
    const summary = await runProseEvaluation({from:input,out:resolve(outDir,runId+'.jsonl'),runId,pageCount:readJson<{pages:number}>('eval/testset.json').pages,mock,budget:arg('budget')==='true'||arg('condense')==='true',condense:arg('condense')==='true',limit:Number(arg('limit','0')),gestureDict:readJson('data/gesture_dictionary.json'),...(mock ? {} : {generator:makeEngine(arg('gen','anthropic:claude-sonnet-5-5')!),cheap:makeEngine(arg('judge','anthropic:claude-haiku-5-5')!)})});
    console.log(JSON.stringify(summary,null,2));return;
  }
  const dryRun = arg('dry-run') === 'true';
  const judge = dryRun ? dummy() : makeEngine(arg('judge', 'anthropic:claude-haiku-5-5')!);

  if (cmd === 'calibrate') {
    const bad = readJson<{ bookId: string; expectedRubricMax: number; outline: StoryOutline }[]>('gold/bad_examples.json');
    const r = await calibrateJudge(judge, gold, bad);
    console.log(JSON.stringify(r, null, 2));
    console.log(r.ok ? '판정기 OK' : '판정기 신뢰 불가 — 모델을 올리거나 루브릭 프롬프트를 조정');
    return;
  }

  const ts = readJson<{ topics: EvalTopic[]; pages: number }>('eval/testset.json');
  const limit = Number(arg('limit', '0'));
  const topics = limit > 0 ? ts.topics.slice(0, limit) : ts.topics;
  const generator = dryRun ? dummy() : makeEngine(arg('gen', 'anthropic:claude-sonnet-5-5')!);
  const runId = arg('run-id', `${(generator.id || 'gen').replace(/[^\w-]/g, '_')}-${new Date().toISOString().slice(0, 10)}`)!;
  const summary = await runEval({
    runId,
    generator,
    judge,
    topics,
    pages: ts.pages,
    patterns: readJson<PlotPatternCard[]>('data/plot_patterns.json'),
    worlds: readJson<WorldLibrary>('data/worlds.json'),
    inventories: readJson<Inventories>('data/inventories.json'),
    protagonist: { name: '유하', traits: ['호기심 많음', '씩씩함', '장난꾸러기'], catchphrase: '같이 가자!' },
    supporting: [{ name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구' }],
    approvedBooks: gold,
    outDir,
    options: { useBeamSearch: arg('beam') === 'true', useFixPass: arg('no-fix') !== 'true', exampleCount: Number(arg('examples', '2')), notes: arg('notes') },
    onResult: (r) => console.log(`${r.topicId} ${r.worldId} ${r.patternId} → ${r.error ? 'ERR ' + r.error : `rubric ${r.rubricTotal}/10 plot ${r.plotOk ? 'ok' : r.plotIssues + ' issues'}`} ${r.latencyMs}ms $${r.costUsd.toFixed(3)}`),
  });
  console.log(JSON.stringify(summary, null, 2));
  if (existsSync(outDir)) console.log(`\n비교: node dist/cli/eval.js compare --baseline ${runId}`);
}

function dummy(): TextEngine {
  return { id: 'dummy', async complete() { return { text: '{}', usage: { input: 0, output: 0 }, costUsd: 0 }; } };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
