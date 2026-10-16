/**
 * 책 간 금지 목록 — "같은 말 반복"은 한 권 안에서만이 아니라 권과 권 사이에서도 생긴다.
 * 최근 N권에서 쓴 심은 물건·생물·반전 유형·패턴·장소를 모아 다음 생성에서 피하게 한다.
 */
import type { BookRecord, Inventories } from './types.js';
import { cleanKoLabel, unique } from './util.js';

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

/**
 * 프롬프트의 [이번에 쓰지 않는 것] 한 줄. 비어 있으면 빈 문자열(코드가 줄을 지운다).
 * 조합 재료(seed)가 이미 금지 항목을 피해 뽑히므로, 프롬프트에는 짧은 상기용으로만 넣는다(기본 물건 6·생물 5·반전 3, 장소는 생략).
 */
export function renderBanListForPrompt(ban: BanList, inventories?: Inventories, max = { planted: 6, creatures: 5, twists: 3, places: 0 }): string {
  const parts: string[] = [];
  if (ban.plantedObjects.length && max.planted) parts.push(`물건: ${ban.plantedObjects.slice(0, max.planted).join(', ')}`);
  if (ban.creatures.length && max.creatures) parts.push(`생물: ${ban.creatures.slice(0, max.creatures).join(', ')}`);
  if (ban.twistTypes.length && inventories && max.twists) {
    const names = ban.twistTypes.slice(0, max.twists).map((id) => inventories.twistTypes.find((t) => t.id === id)?.ko ?? id);
    parts.push(`반전 유형: ${names.join(', ')}`);
  }
  if (ban.places.length && max.places) parts.push(`장소: ${ban.places.slice(0, max.places).join(', ')}`);
  return parts.join(' / ');
}

/** 인벤토리에서 금지 항목을 뺀다. 다 빠지면(금지가 전부면) 원본을 돌려줘 생성이 멈추지 않게 한다. */
/** 머리 명사: "빨간 우산" → "우산", "나무 방패(장난감)" → "방패". 두 글자 미만이면 전체. */
const COUNTERS = new Set(['짝', '개', '통', '장', '마리', '하나', '한', '두', '세', '권', '병', '송이', '조각', '켤레']);
export function headNoun(ko: string): string {
  const clean = cleanKoLabel(ko);
  const toks = clean.split(/\s+/).filter((t) => !COUNTERS.has(t));
  const last = toks.length ? toks[toks.length - 1] : clean;
  return last.length >= 2 ? last : clean;
}

/** 두 글자 이상 머리 명사를 조사와 함께 찾되 긴 고유명사의 일부는 잡지 않는다. */
export function containsMaterial(text: string, material: string): boolean {
  const noun = headNoun(material);
  if (!noun) return false;
  const escaped = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const particles = '(?:(?:에게|한테|께서|에서|부터|까지|처럼|보다|이랑|하고|으로|랑|와|과|의|을|를|이|가|은|는|도|만|에|로){1,3})?';
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}${particles}(?=$|[^\\p{L}\\p{N}])`, 'u').test(cleanKoLabel(text));
}

/** 금지 목록과 같은 항목 또는 같은 머리 명사("빨간 우산"이 금지면 "우산"·"파란 우산"도)를 뺀다. 전부 빠지면 원본을 돌려준다. */
export function filterBanned<T extends { ko: string }>(items: readonly T[], banned: readonly string[]): T[] {
  const set = new Set(banned);
  const heads = new Set(banned.map(headNoun));
  const out = items.filter((it) => !set.has(it.ko) && !heads.has(headNoun(it.ko)));
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
  if (ban.plantedObjects.some((p) => headNoun(p) === headNoun(outline.plan.planted))) hits.push(`심은 물건 반복: ${outline.plan.planted}`);
  const all = outline.beats.map((b) => b.summary).join(' ');
  for (const c of ban.creatures) if (containsMaterial(all, c)) hits.push(`생물 반복: ${c}`);
  return hits;
}
