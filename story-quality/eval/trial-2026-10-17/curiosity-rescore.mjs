/**
 * 호기심 검사 재채점: 전문 실측 결과의 12쪽 글을 그대로 써서 패키지 프롬프트로 다시 판정하고,
 * 모델이 쓴 overall(척도 미지정) 대신 쪽 점수 평균×5(0~10, 패키지의 대체 계산식)로 통과를 계산한다.
 * 사용: node eval/trial-2026-10-17/curiosity-rescore.mjs <proseRunId>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createAnthropicEngine } from '../../dist/engines/anthropic.js';
import { curiosityCheck } from '../../dist/childSimulator.js';
const id = process.argv[2], here = new URL('./', import.meta.url);
const rows = readFileSync(new URL(`${id}.jsonl`, here), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => !r.error);
const haiku = createAnthropicEngine({ model: 'claude-haiku-5-5' });
const engine = { id: haiku.id, complete: (req) => haiku.complete({ ...req, maxTokens: Math.max(req.maxTokens, 4000) }) };
const out = [];
for (const r of rows) {
  const pages = r.ko.pageTexts.map((text, i) => ({ pageNo: i + 1, text }));
  const c = await curiosityCheck(engine, pages);
  const scores = c.pages.map((p) => p.score), derived = +(scores.reduce((s, v) => s + v, 0) / Math.max(1, scores.length) * 5).toFixed(2);
  const zero = c.pages.filter((p) => p.score === 0).map((p) => p.pageNo);
  out.push({ topicId: r.topicId, modelOverall: c.overall, scores, derivedOverall: derived, zeroPages: zero, pass: zero.length === 0 && derived >= 6, pageCountScored: scores.length, costUsd: c.costUsd, notes: c.pages.map((p) => p.why) });
  console.log(r.topicId, scores.join(''), 'model', c.overall, 'derived', derived, zero.length ? 'zero ' + zero.join(',') : '');
}
writeFileSync(new URL(`${id}.curiosity.json`, here), JSON.stringify(out, null, 1));
