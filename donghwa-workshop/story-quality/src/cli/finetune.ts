/**
 * CLI: 파인튜닝 데이터셋 만들기
 *   node dist/cli/finetune.js [--in distill/out/outlines.jsonl] [--out finetune/data] [--format mlx|completions|openai] [--valid 0.1] [--no-gold] [--catchphrase "…"]
 * 승인된 증류 샘플 + 골드 24편 → train.jsonl / valid.jsonl / test.jsonl + stats.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildExamples, writeDataset, type FtFormat } from '../finetune/convert.js';
import { loadExisting } from '../distill/generate.js';
import type { BookRecord, Inventories, PlotPatternCard } from '../types.js';
import type { WorldLibrary } from '../worlds.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(resolve(p), 'utf8')) as T;

/** --catchphrase "…" 로만 말버릇을 넣는다. 기본은 빈 값이며 그때는 프롬프트에 말버릇 구절이 아예 없다. */
function catchphraseOption(): { catchphrase?: string } {
  const value = arg('catchphrase', '')?.trim();
  return value && value !== 'true' ? { catchphrase: value } : {};
}

const inPath = resolve(arg('in', 'distill/out/outlines.jsonl')!);
const outDir = resolve(arg('out', 'finetune/data')!);
const format = (arg('format', 'mlx') as FtFormat) ?? 'mlx';
const samples = existsSync(inPath) ? [...loadExisting(inPath).values()] : [];
const gold = arg('no-gold') === 'true' ? [] : [...readJson<BookRecord[]>('gold/gold_outlines_part1.json'), ...readJson<BookRecord[]>('gold/gold_outlines_part2.json')];

const result = buildExamples({
  samples,
  gold,
  patterns: readJson<PlotPatternCard[]>('data/plot_patterns.json'),
  worlds: readJson<WorldLibrary>('data/worlds.json'),
  inventories: readJson<Inventories>('data/inventories.json'),
  protagonist: { name: '유하', traits: ['호기심 많음', '씩씩함', '장난꾸러기'], ...catchphraseOption() },
  supporting: [{ name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구' }],
  validRatio: Number(arg('valid', '0.1')),
});
const paths = writeDataset(outDir, result, format);
console.log(JSON.stringify({ ...result.stats, train: result.train.length, valid: result.valid.length, format, ...paths }, null, 2));
if (result.stats.total < 50) console.log('\n주의: 예시가 50개 미만입니다. 골드 24편만으로는 LoRA가 과적합됩니다. 증류를 먼저 돌리세요 (npm run distill).');
