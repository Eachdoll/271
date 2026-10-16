/**
 * 파인튜닝 데이터 변환기 — 증류 JSONL(승인 샘플) + 골드 → 학습 포맷.
 *  - mlx:  {"messages":[{role:"system"},{role:"user"},{role:"assistant"}]}  (mlx_lm.lora 채팅 포맷; 마지막 메시지가 정답)
 *  - completions: {"prompt": "...", "completion": "..."}  (mlx_lm.lora completions 포맷 / 범용)
 *  - openai: mlx와 같은 messages 포맷 (OpenAI 파인튜닝은 신규 사용자 종료 중이라 참고용)
 * 핵심 원칙: 학습 프롬프트 = 앱의 실제 프롬프트(outline.v3 그대로). 그래야 추론 때 분포가 같다.
 * 분할은 '주제' 단위로 한다(같은 주제의 변형이 train/valid에 갈리지 않게).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { BookRecord, Inventories, PlotPatternCard, StoryOutline } from '../types.js';
import type { WorldLibrary } from '../worlds.js';
import type { DistillSample } from '../distill/generate.js';
import { findWorld, worldCoreLines } from '../worlds.js';
import { buildOutlinePrompt, type Character } from '../outlinePrompt.js';
import { composeSeed, preferObstaclesForTopic } from '../composeSeed.js';
import { makeRng, hashString } from '../util.js';

export type FtFormat = 'mlx' | 'completions' | 'openai';

export interface FtExample {
  system: string;
  user: string;
  assistant: string; // JSON 문자열(정답 줄거리)
  meta: { id: string; topicId: string; patternId: string; worldId: string; levelKo: string; source: 'distill' | 'gold' };
}

export interface ConvertOptions {
  samples: DistillSample[]; // approved만 쓴다
  gold?: BookRecord[]; // 골드는 프롬프트를 재구성해 학습 예시로 쓴다
  patterns: PlotPatternCard[];
  worlds: WorldLibrary;
  inventories: Inventories;
  protagonist: Character;
  supporting: Character[];
  pages?: number;
  validRatio?: number; // 기본 0.1 (주제 단위)
  seed?: number;
  /** 정답 JSON을 예쁘게(indent) 저장할지. 모델이 생성할 때도 같은 형태가 나온다. 기본 false(한 줄) */
  prettyJson?: boolean;
}

export interface ConvertResult {
  train: FtExample[];
  valid: FtExample[];
  stats: { total: number; fromDistill: number; fromGold: number; byPattern: Record<string, number>; byEra: Record<string, number>; avgAssistantChars: number };
}

export function buildExamples(opts: ConvertOptions): ConvertResult {
  const ex: FtExample[] = [];
  const stringify = (o: StoryOutline) => (opts.prettyJson ? JSON.stringify(o, null, 1) : JSON.stringify(o));

  for (const s of opts.samples) {
    if (!s.approved || !s.outline) continue;
    ex.push({ system: s.prompt.system, user: s.prompt.user, assistant: stringify(cleanOutline(s.outline)), meta: { id: s.sampleId, topicId: s.topicId, patternId: s.patternId, worldId: s.worldId, levelKo: s.levelKo, source: 'distill' } });
  }

  for (const g of opts.gold ?? []) {
    const pattern = opts.patterns.find((p) => p.id === g.patternId);
    if (!pattern) continue;
    const worldId = (g as BookRecord & { worldId?: string }).worldId ?? 'home';
    const world = findWorld(opts.worlds, worldId);
    // 골드의 심은 물건·생물을 재료로 삼아 프롬프트를 재구성한다(정답과 재료가 일치하도록).
    const base = composeSeed({ pattern, inventories: opts.inventories, backgroundType: worldId, rngSeed: hashString(g.bookId), preferObstacleIds: preferObstaclesForTopic(g.topic), world });
    const seed = { ...base, planted: { ko: g.outline.plan.planted, en: base.planted.en }, creature: g.usedElements.creatures[0] ? { ko: g.usedElements.creatures[0], en: base.creature.en } : base.creature, failureReasons: g.outline.plan.failureReasons?.length ? g.outline.plan.failureReasons : base.failureReasons };
    const prompt = buildOutlinePrompt({ protagonist: opts.protagonist, supporting: opts.supporting, worldCore: world ? worldCoreLines(opts.worlds, world) : ['유하네 집과 동네'], topic: g.topic, levelKo: g.levelKo, levelEn: g.levelEn, pages: opts.pages ?? 12, pattern, seed, inventories: opts.inventories, ban: { plantedObjects: [], creatures: [], twistTypes: [], patterns: [], places: [] }, approvedBooks: [], endingType: g.outline.endingType, exampleCount: 0 });
    ex.push({ system: prompt.system, user: prompt.user, assistant: stringify(cleanOutline(g.outline)), meta: { id: g.bookId, topicId: g.bookId, patternId: g.patternId, worldId, levelKo: g.levelKo, source: 'gold' } });
  }

  // 주제 단위 분할
  const topics = [...new Set(ex.map((e) => e.meta.topicId))];
  const rng = makeRng(opts.seed ?? 7);
  const shuffled = topics.map((t) => ({ t, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.t);
  const nValid = Math.max(1, Math.round(shuffled.length * (opts.validRatio ?? 0.1)));
  const validTopics = new Set(shuffled.slice(0, nValid));
  const train = ex.filter((e) => !validTopics.has(e.meta.topicId));
  const valid = ex.filter((e) => validTopics.has(e.meta.topicId));

  const byPattern: Record<string, number> = {};
  const byEra: Record<string, number> = {};
  for (const e of ex) {
    byPattern[e.meta.patternId] = (byPattern[e.meta.patternId] ?? 0) + 1;
    const era = findWorld(opts.worlds, e.meta.worldId)?.era ?? 'unknown';
    byEra[era] = (byEra[era] ?? 0) + 1;
  }
  return {
    train,
    valid,
    stats: { total: ex.length, fromDistill: ex.filter((e) => e.meta.source === 'distill').length, fromGold: ex.filter((e) => e.meta.source === 'gold').length, byPattern, byEra, avgAssistantChars: Math.round(ex.reduce((a, e) => a + e.assistant.length, 0) / Math.max(1, ex.length)) },
  };
}

/** 학습 정답에서 모델이 만들 필요 없는 필드를 뺀다(없으면 그대로). */
function cleanOutline(o: StoryOutline): StoryOutline {
  const c = JSON.parse(JSON.stringify(o)) as StoryOutline & Record<string, unknown>;
  delete (c as Record<string, unknown>).settings;
  delete (c as Record<string, unknown>).emotionArc;
  return c;
}

export function toLine(e: FtExample, format: FtFormat): string {
  if (format === 'completions') return JSON.stringify({ prompt: `${e.system}\n\n${e.user}`, completion: e.assistant });
  return JSON.stringify({ messages: [{ role: 'system', content: e.system }, { role: 'user', content: e.user }, { role: 'assistant', content: e.assistant }] });
}

export function writeDataset(outDir: string, result: ConvertResult, format: FtFormat): { trainPath: string; validPath: string; testPath: string } {
  mkdirSync(outDir, { recursive: true });
  const trainPath = `${outDir}/train.jsonl`;
  const validPath = `${outDir}/valid.jsonl`;
  const testPath = `${outDir}/test.jsonl`;
  writeFileSync(trainPath, result.train.map((e) => toLine(e, format)).join('\n') + '\n');
  writeFileSync(validPath, result.valid.map((e) => toLine(e, format)).join('\n') + '\n');
  // mlx_lm.lora --test 는 test.jsonl을 요구한다. valid를 복사해 둔다.
  writeFileSync(testPath, result.valid.map((e) => toLine(e, format)).join('\n') + '\n');
  writeFileSync(`${outDir}/stats.json`, JSON.stringify({ ...result.stats, train: result.train.length, valid: result.valid.length, format }, null, 2));
  return { trainPath, validPath, testPath };
}
