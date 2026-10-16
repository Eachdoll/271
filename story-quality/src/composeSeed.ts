/**
 * 조합형 생성 — 창의성을 모델이 아니라 코드의 무작위 조합이 맡는다.
 * 인벤토리에서 심을 물건·장애물(또는 장소)·반전·생물·웃음·실패 이유를 뽑아 비트 슬롯을 채운다.
 * 모델은 그 재료로 문장만 쓴다. 같은 시드면 같은 재료가 나와 재현·디버깅이 쉽다.
 */
import type { Bi, FailureReason, Inventories, PlotPatternCard } from './types.js';
import type { BanList } from './banList.js';
import { filterBanned, filterBannedById } from './banList.js';
import { makeRng, pick, pickDistinct, shuffle } from './util.js';

export type BackgroundType = 'home' | 'kindergarten' | 'forest' | 'sea' | 'dino_land' | 'sky' | (string & {});

export interface StorySeed {
  patternId: string;
  planted: Bi;
  /** 여정형·찾기형에서 attempt 비트 수만큼. 다른 패턴에선 장소 후보로만 쓰인다. */
  obstacles: { id: string; ko: string; en: string; sense: string; sound: string }[];
  twist: { id: string; ko: string; en: string; hint: string };
  creature: Bi;
  humor: Bi;
  subLocations: Bi[];
  failureReasons: FailureReason[];
  rngSeed: number;
}

export interface ComposeOptions {
  pattern: PlotPatternCard;
  inventories: Inventories;
  backgroundType: BackgroundType;
  rngSeed: number;
  ban?: BanList;
  /** 주제에 어울리는 장애물/장소를 우선하고 싶을 때 (예: 비 → puddle, mud). */
  preferObstacleIds?: string[];
}

export function composeSeed(opts: ComposeOptions): StorySeed {
  const { pattern, inventories: inv, rngSeed } = opts;
  const ban: BanList = opts.ban ?? { plantedObjects: [], creatures: [], twistTypes: [], patterns: [], places: [] };
  const rng = makeRng(rngSeed);

  const attemptCount = Math.max(1, pattern.beats.filter((b) => b.type === 'attempt').length);

  const planted = pick(rng, filterBanned(inv.plantedObjects, ban.plantedObjects));
  const creature = pick(rng, filterBanned(inv.creatures, ban.creatures));
  const twist = pick(rng, filterBannedById(inv.twistTypes, ban.twistTypes));
  const humor = pick(rng, inv.humorBeats);

  // 장애물: 감각(sense)이 서로 다르게. 선호 id가 있으면 먼저 넣는다.
  const preferred = inv.obstacleTypes.filter((o) => opts.preferObstacleIds?.includes(o.id));
  const rest = inv.obstacleTypes.filter((o) => !opts.preferObstacleIds?.includes(o.id));
  const chosen: StorySeed['obstacles'] = [];
  const senses = new Set<string>();
  for (const o of [...shuffle(rng, preferred), ...shuffle(rng, rest)]) {
    if (chosen.length >= attemptCount) break;
    if (senses.has(o.sense) && chosen.length < inv.obstacleTypes.length - 1) continue;
    chosen.push(o);
    senses.add(o.sense);
  }
  // 감각 제약 때문에 모자라면 채운다
  for (const o of shuffle(rng, inv.obstacleTypes)) {
    if (chosen.length >= attemptCount) break;
    if (!chosen.includes(o)) chosen.push(o);
  }

  const locPool = inv.subLocations[opts.backgroundType] ?? inv.subLocations['forest'] ?? [];
  const subLocations = pickDistinct(rng, filterBanned(locPool, ban.places), Math.min(3, locPool.length), (b) => b.ko);

  const reasons = shuffle(rng, inv.failureReasons.map((r) => r.id)).slice(0, attemptCount);
  // attempt가 3개 넘으면 이유를 순환시킨다
  while (reasons.length < attemptCount) reasons.push(reasons[reasons.length % 3]);

  return { patternId: pattern.id, planted, obstacles: chosen, twist, creature, humor, subLocations, failureReasons: reasons, rngSeed };
}

/** 프롬프트의 [정해진 재료] 블록. outline.v3.md의 {{seed.*}} 자리에 그대로 들어간다. */
export function renderSeedForPrompt(seed: StorySeed, inv: Inventories, pattern: PlotPatternCard): string {
  const isJourney = pattern.id === 'journey_repeat';
  const isSearch = pattern.id === 'search_wrong_answers';
  const steps = seed.obstacles.map((o, i) => `${i + 1}) ${o.ko}(${o.sound})`).join(' ');
  const stepLabel = isJourney ? '장애물 순서' : isSearch ? '찾아볼 장소 순서' : '장소·장애물 후보';
  const reasons = seed.failureReasons
    .map((id, i) => {
      const r = inv.failureReasons.find((x) => x.id === id);
      return `${i + 1}차 ${r?.ko ?? id}`;
    })
    .join(', ');
  return [
    `- 심을 물건: ${seed.planted.ko} — 비트 1~2에 자연스럽게 등장시키고 반전에서 회수한다`,
    `- 반전 유형: ${seed.twist.ko} (${seed.twist.hint})`,
    `- ${stepLabel}: ${steps}`,
    `- 시도별 실패 이유: ${reasons}`,
    `- 배경 생물: ${seed.creature.ko} (한 번 이상 등장)`,
    `- 웃음 포인트: ${seed.humor.ko}`,
    `- 세부 장소 후보: ${seed.subLocations.map((l) => l.ko).join(', ')}`,
  ].join('\n');
}

/** 주제 키워드 → 어울리는 장애물 id (비·물·바람·밤 등). 없으면 빈 배열. */
export function preferObstaclesForTopic(topic: string): string[] {
  const t = topic.toLowerCase();
  const rules: [RegExp, string[]][] = [
    [/비|빗|우산|장화|rain/, ['puddle', 'mud', 'stream']],
    [/바람|wind/, ['windy_hill', 'tall_grass']],
    [/밤|별|달|night|moon/, ['bright_tunnel', 'fog']],
    [/숲|나무|forest/, ['log_bridge', 'tall_grass', 'big_rock']],
    [/바다|모래|sea|beach/, ['stream', 'big_rock']],
    [/꽃|봄|flower/, ['bees', 'tall_grass']],
    [/산|언덕|hill|mountain/, ['steep_steps', 'windy_hill', 'big_rock']],
  ];
  const out: string[] = [];
  for (const [re, ids] of rules) if (re.test(t)) out.push(...ids);
  return [...new Set(out)];
}
