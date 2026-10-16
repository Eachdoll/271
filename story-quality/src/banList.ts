/**
 * 책 간 금지 목록 — "같은 말 반복"은 한 권 안에서만이 아니라 권과 권 사이에서도 생긴다.
 * 최근 N권에서 쓴 심은 물건·생물·반전 유형·패턴·장소를 모아 다음 생성에서 피하게 한다.
 */
import type { BookRecord, Inventories } from './types.js';
import { unique } from './util.js';

export interface BanList {
  plantedObjects: string[];
  creatures: string[];
  twistTypes: string[];
  patterns: string[];
  places: string[];
}

export interface BanListOptions {
  /** 최근 몇 권을 볼지. 기본 10. */
  recentBooks?: number;
  /** 패턴은 더 짧은 창으로 본다(6개뿐이라 10권 금지면 남는 게 없다). 기본 3. */
  recentBooksForPattern?: number;
  /** 같은 시리즈 책만 볼지(기본 false = 전체). */
  sameSeriesOnly?: string;
}

export function buildBanList(records: BookRecord[], opts: BanListOptions = {}): BanList {
  const n = opts.recentBooks ?? 10;
  const np = opts.recentBooksForPattern ?? 3;
  let list = records.filter((r) => r.approved);
  if (opts.sameSeriesOnly) list = list.filter((r) => r.seriesId === opts.sameSeriesOnly);
  list = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const recent = list.slice(0, n);
  const recentP = list.slice(0, np);
  return {
    plantedObjects: unique(recent.map((r) => r.usedElements.planted).filter(Boolean)),
    creatures: unique(recent.flatMap((r) => r.usedElements.creatures ?? [])),
    twistTypes: unique(recent.map((r) => r.usedElements.twistTypeId ?? '').filter(Boolean)),
    patterns: unique(recentP.map((r) => r.usedElements.patternId ?? r.patternId).filter(Boolean)),
    places: unique(recent.flatMap((r) => r.usedElements.places ?? [])),
  };
}

/** 프롬프트의 [이번에 쓰지 않는 것] 한 줄. 비어 있으면 빈 문자열(코드가 줄을 지운다). */
export function renderBanListForPrompt(ban: BanList, inventories?: Inventories): string {
  const parts: string[] = [];
  if (ban.plantedObjects.length) parts.push(`물건: ${ban.plantedObjects.join(', ')}`);
  if (ban.creatures.length) parts.push(`생물: ${ban.creatures.join(', ')}`);
  if (ban.twistTypes.length && inventories) {
    const names = ban.twistTypes.map((id) => inventories.twistTypes.find((t) => t.id === id)?.ko ?? id);
    parts.push(`반전 유형: ${names.join(', ')}`);
  }
  if (ban.places.length) parts.push(`장소: ${ban.places.join(', ')}`);
  return parts.join(' / ');
}

/** 인벤토리에서 금지 항목을 뺀다. 다 빠지면(금지가 전부면) 원본을 돌려줘 생성이 멈추지 않게 한다. */
export function filterBanned<T extends { ko: string }>(items: readonly T[], banned: readonly string[]): T[] {
  const set = new Set(banned);
  const out = items.filter((it) => !set.has(it.ko));
  return out.length > 0 ? out : [...items];
}

export function filterBannedById<T extends { id: string }>(items: readonly T[], bannedIds: readonly string[]): T[] {
  const set = new Set(bannedIds);
  const out = items.filter((it) => !set.has(it.id));
  return out.length > 0 ? out : [...items];
}

/** 생성 결과가 금지 목록을 어겼는지 (사후 검사). */
export function violatesBanList(outline: { plan: { planted: string }; beats: { summary: string }[] }, ban: BanList): string[] {
  const hits: string[] = [];
  if (ban.plantedObjects.some((p) => outline.plan.planted.includes(p))) hits.push(`심은 물건 반복: ${outline.plan.planted}`);
  const all = outline.beats.map((b) => b.summary).join(' ');
  for (const c of ban.creatures) if (all.includes(c)) hits.push(`생물 반복: ${c}`);
  return hits;
}
