/**
 * 증류 주제 재생성 CLI.
 *   npm run topics:gen -- [--per-world 12] [--seed 1]
 * distill/topics.json 의 손으로 쓴 주제(source: hand)는 그대로 두고, 그 뒤에
 * 세계 카드 × 활동 틀로 자동 생성한 주제를 세계별 라운드로빈 순서로 붙인다.
 * 평가 세트(eval/testset.json)·골드(gold/*.json)·손 주제와 같은 문장은 제외한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateTopics, TOPIC_TEMPLATES } from '../expand.js';
import type { WorldLibrary } from '../worlds.js';
import type { BookRecord } from '../types.js';

interface TopicRow {
  id: string;
  topic: string;
  worldId: string;
  patternId: string;
  keywords?: string[];
  value?: string | null;
  source?: 'hand' | 'generated';
  templateId?: string;
}
interface TopicsFile {
  version: string;
  description: string;
  topics: TopicRow[];
  levels: { levelKo: string; levelEn: string }[];
  pages: number;
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main(): void {
  const perWorld = Number(arg('--per-world', '12'));
  const seed = Number(arg('--seed', '1'));
  const lib = JSON.parse(readFileSync('data/worlds.json', 'utf8')) as WorldLibrary;
  const cur = JSON.parse(readFileSync('distill/topics.json', 'utf8')) as TopicsFile;
  const test = JSON.parse(readFileSync('eval/testset.json', 'utf8')) as { topics: { topic: string }[] };
  const gold: BookRecord[] = [
    ...(JSON.parse(readFileSync('gold/gold_outlines_part1.json', 'utf8')) as BookRecord[]),
    ...(JSON.parse(readFileSync('gold/gold_outlines_part2.json', 'utf8')) as BookRecord[]),
  ];
  const hand = cur.topics.filter((t) => !t.source || t.source === 'hand').map((t) => ({ ...t, source: 'hand' as const }));
  const exclude = [...test.topics.map((t) => t.topic), ...gold.map((g) => g.topic), ...hand.map((t) => t.topic)];
  const gen = generateTopics(lib, { perWorld, exclude, seed });

  // 세계별 라운드로빈: --limit N 으로 앞에서 잘라도 여러 세계에 고루 걸리게
  const byWorld = new Map<string, typeof gen>();
  for (const t of gen) {
    if (!byWorld.has(t.worldId)) byWorld.set(t.worldId, []);
    byWorld.get(t.worldId)!.push(t);
  }
  const interleaved: typeof gen = [];
  for (let i = 0, any = true; any; i++) {
    any = false;
    for (const arr of byWorld.values()) if (arr[i]) { interleaved.push(arr[i]); any = true; }
  }
  const generated: TopicRow[] = interleaved.map((t) => ({
    id: t.id, topic: t.topic, worldId: t.worldId, patternId: t.patternId, keywords: t.keywords, value: t.value, source: 'generated', templateId: t.templateId,
  }));
  const topics = [...hand, ...generated];
  const out: TopicsFile = {
    version: new Date().toISOString().slice(0, 10) + '-gen',
    description: `증류 생성용 주제 ${topics.length}개 = 손으로 쓴 ${hand.length}개 + 세계 카드 ${lib.worlds.length}곳 × 활동 틀 ${TOPIC_TEMPLATES.length}개로 자동 생성한 ${generated.length}개(source: generated, 세계별 라운드로빈 순서라 --limit N 으로 잘라도 여러 세계에 고루 걸린다). 평가용 testset.json 20주제·골드 24주제와 겹치지 않는다. 재생성: npm run topics:gen`,
    topics,
    levels: cur.levels,
    pages: cur.pages,
  };
  const lines = out.topics.map((t) => '    ' + JSON.stringify(t));
  const json = `{\n  "version": ${JSON.stringify(out.version)},\n  "description": ${JSON.stringify(out.description)},\n  "topics": [\n${lines.join(',\n')}\n  ],\n  "levels": ${JSON.stringify(out.levels)},\n  "pages": ${out.pages}\n}\n`;
  writeFileSync('distill/topics.json', json);
  const byP: Record<string, number> = {};
  for (const t of topics) byP[t.patternId] = (byP[t.patternId] ?? 0) + 1;
  console.log(`topics: hand ${hand.length} + generated ${generated.length} = ${topics.length} (worlds ${new Set(topics.map((t) => t.worldId)).size})`);
  console.log('by pattern:', byP);
}

main();
