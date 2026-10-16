/**
 * 세계 카드 — data/worlds.json. 조합형 생성(composeSeed)과 줄거리 프롬프트([세계관 핵심])에 재료를 준다.
 * 세계는 현재 여러 나라·과거·미래·상상이 섞여 있고, 거실 소파 뒤 모험터널이 공통 출입구다.
 */
import type { Bi } from './types.js';
import { topicKeywords } from './plotCheck.js';
import { josa } from './util.js';

export type Era = 'present' | 'past' | 'future' | 'fantasy';

export interface WorldCard {
  id: string;
  name: Bi;
  era: Era;
  region: string;
  needsPortal: boolean;
  arrival: string;
  landmarks: Bi[];
  subLocations: Bi[];
  creatures: Bi[];
  props: Bi[];
  sounds: Bi[];
  palette: string[];
  styleHint: string;
  rules: string[];
  avoid: string[];
  returnCue: string;
}

export interface WorldLibrary {
  version: string;
  portal: Bi;
  worlds: WorldCard[];
}

export function findWorld(lib: WorldLibrary, id: string): WorldCard | undefined {
  return lib.worlds.find((w) => w.id === id);
}

/** 프롬프트의 [세계관 핵심] 3줄 — 세계 카드에서 자동으로 만든다. */
export function worldCoreLines(lib: WorldLibrary, world: WorldCard & { stateLabel?: { ko: string }; weather?: { ko: string } | null; light?: { ko: string } }): string[] {
  // expand.applyOverlay 로 계절·시간을 얹은 WorldState 면 첫 줄에 "때: 가을 밤, 날씨, 빛"을 덧붙인다.
  const state = world.stateLabel
    ? ` 때: ${world.stateLabel.ko}${world.weather ? `, ${world.weather.ko}` : ''}${world.light ? `, ${world.light.ko}` : ''}.`
    : '';
  const portal = (world.needsPortal ? `소파 뒤 모험터널이 ${world.name.ko}${josa(world.name.ko, '로')} 열린다. 도착하면 ${world.arrival}.` : `${world.name.ko}. ${world.arrival}.`) + state;
  const marks = `랜드마크: ${world.landmarks.map((l) => l.ko).join(', ')}. 규칙: ${world.rules.join(' / ') || '없음'}.`;
  const back = `돌아오는 신호: ${world.returnCue}.${world.avoid.length ? ` 금지: ${world.avoid.join(', ')}.` : ''}`;
  return [portal, marks, back];
}

/** 그림 프롬프트용 세계 묘사 한 줄(영어). 지시서 3의 ImagePromptBuilder 6번 자리에 넣는다. */
export function worldStyleLine(world: WorldCard): string {
  return `${world.styleHint}, landmarks: ${world.landmarks.map((l) => l.en).join(', ')}`;
}

/** 시리즈 다양성: 최근 쓴 세계를 피해 시대별로 고르게. 주제 키워드로 어울리는 세계를 우선한다. */
export function suggestWorlds(lib: WorldLibrary, opts: { topic?: string; recentWorldIds?: string[]; era?: Era; k?: number } = {}): WorldCard[] {
  const recent = new Set(opts.recentWorldIds ?? []);
  const t = (opts.topic ?? '').toLowerCase();
  const scored = lib.worlds
    .filter((w) => !opts.era || w.era === opts.era)
    .map((w) => {
      let s = 0;
      if (recent.has(w.id)) s -= 2;
      const hay = `${w.name.ko} ${w.region} ${w.landmarks.map((l) => l.ko).join(' ')} ${w.creatures.map((c) => c.ko).join(' ')} ${w.props.map((p) => p.ko).join(' ')}`;
      for (const kw of topicKeywords(t)) if (hay.includes(kw) || (kw.length >= 3 && hay.includes(kw.slice(0, 2)))) s += 1;
      return { w, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, opts.k ?? 3).map((x) => x.w);
}

/** 증류·평가용: 시대별로 번갈아 세계를 돌린다(round-robin). */
export function cycleWorldsByEra(lib: WorldLibrary, n: number, startSeed = 0): WorldCard[] {
  const byEra: Record<Era, WorldCard[]> = { present: [], past: [], future: [], fantasy: [] };
  for (const w of lib.worlds) byEra[w.era].push(w);
  const order: Era[] = ['present', 'past', 'future', 'fantasy'];
  const out: WorldCard[] = [];
  const idx: Record<Era, number> = { present: startSeed, past: startSeed, future: startSeed, fantasy: startSeed };
  let i = 0;
  while (out.length < n) {
    const era = order[i % order.length];
    const pool = byEra[era];
    if (pool.length) {
      out.push(pool[idx[era] % pool.length]);
      idx[era]++;
    }
    i++;
  }
  return out;
}
