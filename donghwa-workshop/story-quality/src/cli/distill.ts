/**
 * CLI: 증류 데이터셋 생성
 *   ANTHROPIC_API_KEY=... node dist/cli/distill.js [--out distill/out/outlines.jsonl] [--gen claude-opus-5-5] [--judge claude-haiku-5-5] [--variants 1] [--limit 0] [--concurrency 2] [--dry-run] [--estimate]
 * 재실행하면 이미 만든 sampleId는 건너뛴다(재개).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createAnthropicEngine, ANTHROPIC_MODELS } from '../engines/anthropic.js';
import { createOpenAICompatEngine } from '../engines/openaiCompat.js';
import { runDistillation, estimateDistillCost, type DistillTopic } from '../distill/generate.js';
import { roughTokenCount } from '../outlinePrompt.js';
import type { BookRecord, Inventories, PlotPatternCard, TextEngine } from '../types.js';
import type { WorldLibrary } from '../worlds.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(resolve(p), 'utf8')) as T;
}

export function makeEngine(spec: string): TextEngine {
  // 형식: anthropic:<model> | openai:<model> | local:<baseUrl>#<model>
  if (spec.startsWith('local:')) {
    const [baseUrl, model] = spec.slice(6).split('#');
    return createOpenAICompatEngine({ baseUrl, model: model ?? 'default', price: { input: 0, output: 0 } });
  }
  if (spec.startsWith('openai:')) {
    const model = spec.slice(7);
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 없습니다.');
    return createOpenAICompatEngine({ baseUrl: 'https://api.openai.com/v1', model, apiKey: process.env.OPENAI_API_KEY, supportsJsonMode: true });
  }
  const model = spec.startsWith('anthropic:') ? spec.slice(10) : spec;
  return createAnthropicEngine({ model, effort: 'medium' });
}

async function main() {
  const root = resolve(process.cwd());
  const out = resolve(root, arg('out', 'distill/out/outlines.jsonl')!);
  mkdirSync(dirname(out), { recursive: true });
  const genSpec = arg('gen', 'anthropic:claude-opus-5-5')!;
  const judgeSpec = arg('judge', 'anthropic:claude-haiku-5-5')!;
  const variants = Number(arg('variants', '1'));
  const limit = Number(arg('limit', '0'));
  const concurrency = Math.min(8, Math.max(1, Number(arg('concurrency', '2')) || 2));
  const dryRun = arg('dry-run') === 'true';
  const estimate = arg('estimate') === 'true';

  const topicsFile = readJson<{ topics: DistillTopic[]; levels: { levelKo: string; levelEn: string }[]; pages: number }>('distill/topics.json');
  const patterns = readJson<PlotPatternCard[]>('data/plot_patterns.json');
  const worlds = readJson<WorldLibrary>('data/worlds.json');
  const inventories = readJson<Inventories>('data/inventories.json');
  const gold = [...readJson<BookRecord[]>('gold/gold_outlines_part1.json'), ...readJson<BookRecord[]>('gold/gold_outlines_part2.json')];
  const topics = limit > 0 ? topicsFile.topics.slice(0, limit) : topicsFile.topics;
  const cells = topics.length * topicsFile.levels.length * variants;

  if (estimate || dryRun) {
    const knownPrice = (spec: string) => {
      const model = spec.replace(/^anthropic:/, '');
      return Object.prototype.hasOwnProperty.call(ANTHROPIC_MODELS, model)
        ? ANTHROPIC_MODELS[model as keyof typeof ANTHROPIC_MODELS]
        : undefined;
    };
    const gp = knownPrice(genSpec);
    const jp = knownPrice(judgeSpec);
    // 토큰 수는 가격과 무관하다. 미등록 단가를 무료로 표시하지 않는다.
    const est = estimateDistillCost(cells, 1400, gp ?? { input: 0, output: 0 }, jp ?? { input: 0, output: 0 });
    console.log(`cells=${cells} (topics ${topics.length} × levels ${topicsFile.levels.length} × variants ${variants})`);
    console.log(`tokens in≈${Math.round(est.tokensIn / 1000)}k out≈${Math.round(est.tokensOut / 1000)}k`);
    if (gp && jp) {
      console.log(`est. cost ≈ $${est.usd.toFixed(2)} (gen $${est.breakdown.gen.toFixed(2)} + fix $${est.breakdown.fix.toFixed(2)} + judge $${est.breakdown.judge.toFixed(2)}); batch API면 약 절반`);
    } else {
      const unpriced = [!gp ? `gen=${genSpec}` : '', !jp ? `judge=${judgeSpec}` : ''].filter(Boolean).join(', ');
      console.log(`est. cost unavailable (unpriced: ${unpriced}). 가격 정보가 없어 비용을 추정할 수 없습니다.`);
    }
    if (estimate) return;
  }

  const generator = dryRun ? dummyEngine() : makeEngine(genSpec);
  const judge = dryRun ? dummyEngine() : makeEngine(judgeSpec);
  let n = 0;
  const res = await runDistillation({
    generator,
    judge,
    topics,
    levels: topicsFile.levels,
    pages: topicsFile.pages,
    patterns,
    worlds,
    inventories,
    protagonist: { name: '유하', traits: ['호기심 많음', '씩씩함', '장난꾸러기'], catchphrase: '같이 가자!' },
    supporting: [{ name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구' }],
    outPath: out,
    variantsPerCell: variants,
    seedBooks: gold,
    concurrency,
    dryRun,
    onSample: (s) => {
      n++;
      const tag = s.error ? `ERR ${s.error}` : s.approved ? `OK ${s.rubric?.total}/10` : `reject ${s.rubric?.total ?? '-'} ${s.plotCheck.fix.length + s.plotCheck.regenerate.length}issues`;
      console.log(`[${n}/${cells}] ${s.sampleId} ${s.worldId} ${s.patternId} → ${tag} $${s.costUsd.toFixed(3)}`);
      if (dryRun && n === 1) console.log(`prompt tokens≈${roughTokenCount(s.prompt.system + s.prompt.user)}`);
    },
  });
  console.log(`done: generated ${res.total}, approved ${res.approved}, skipped(existing) ${res.skipped}, cost $${res.costUsd.toFixed(2)} → ${out}`);
}

function dummyEngine(): TextEngine {
  return { id: 'dummy', async complete() { return { text: '{}', usage: { input: 0, output: 0 }, costUsd: 0 }; } };
}

if (process.argv[1] && process.argv[1].endsWith('distill.js')) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
