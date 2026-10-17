/**
 * CLI: 파인튜닝 데이터셋 만들기
 *   node dist/cli/finetune.js [--in distill/out/outlines.jsonl] [--out finetune/data] [--format mlx|completions|openai] [--valid 0.1] [--no-gold]
 * 승인된 증류 샘플 + 골드 24편 → train.jsonl / valid.jsonl / test.jsonl + stats.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildExamples, writeDataset } from '../finetune/convert.js';
import { loadExisting } from '../distill/generate.js';
function arg(name, def) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1)
        return def;
    const v = process.argv[i + 1];
    return v && !v.startsWith('--') ? v : 'true';
}
const readJson = (p) => JSON.parse(readFileSync(resolve(p), 'utf8'));
const inPath = resolve(arg('in', 'distill/out/outlines.jsonl'));
const outDir = resolve(arg('out', 'finetune/data'));
const format = arg('format', 'mlx') ?? 'mlx';
const samples = existsSync(inPath) ? [...loadExisting(inPath).values()] : [];
const gold = arg('no-gold') === 'true' ? [] : [...readJson('gold/gold_outlines_part1.json'), ...readJson('gold/gold_outlines_part2.json')];
const result = buildExamples({
    samples,
    gold,
    patterns: readJson('data/plot_patterns.json'),
    worlds: readJson('data/worlds.json'),
    inventories: readJson('data/inventories.json'),
    protagonist: { name: '유하', traits: ['호기심 많음', '씩씩함', '장난꾸러기'], catchphrase: '같이 가자!' },
    supporting: [{ name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구' }],
    validRatio: Number(arg('valid', '0.1')),
});
const paths = writeDataset(outDir, result, format);
console.log(JSON.stringify({ ...result.stats, train: result.train.length, valid: result.valid.length, format, ...paths }, null, 2));
if (result.stats.total < 50)
    console.log('\n주의: 예시가 50개 미만입니다. 골드 24편만으로는 LoRA가 과적합됩니다. 증류를 먼저 돌리세요 (npm run distill).');
