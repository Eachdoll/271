/**
 * 인과 검사기 — 모델 호출 없이 줄거리 JSON을 검사한다 (지시서 4의 3절 + 금지 목록 + 조합 재료 준수).
 */
import type { Inventories, StoryOutline } from './types.js';
import type { StorySeed } from './composeSeed.js';
import type { BanList } from './banList.js';
import { containsMaterial, violatesBanList } from './banList.js';
import { splitSentences } from './util.js';

export interface PlotCheckResult {
  ok: boolean;
  /** 수정 패스로 넘길 항목 */
  fix: string[];
  /** 재생성이 필요한 항목 */
  regenerate: string[];
}

export interface PlotCheckInput {
  outline: StoryOutline;
  topic: string;
  protagonistName: string;
  seed?: StorySeed;
  ban?: BanList;
  inventories?: Inventories;
}

const MORAL_TAIL = /(좋은 거예요|소중해요|마음이 참|따뜻해요|행복했어요|고마운 일이에요|함께라서 좋아요)[.!]?\s*$/;

/** 한국어 조사·어미를 떼고 내용어만 남긴다. "사바나에서" → "사바나", "누가 더 멋진지" → ["멋진지"]. */
const PARTICLES = /(에서는|에서|으로|에게|한테|까지|부터|처럼|보다|이랑|랑|와|과|의|을|를|이|가|은|는|도|에|로)$/;
const STOPWORDS = new Set(['누가', '더', '어디', '것', '날', '때', '어떤', '무슨', '우리', '오늘', '내', '나', '그', '이', '저', '함께', '같이']);

export function topicKeywords(topic: string): string[] {
  return topic
    .split(/[\s,·/()]+/)
    .map((w) => w.replace(PARTICLES, ''))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/** 키워드가 글에 있는지. 3자 이상 키워드는 앞 2자 접두 일치도 인정한다("멋진지" → "멋진"). */
export function topicMentioned(text: string, topic: string): boolean {
  const kws = topicKeywords(topic);
  if (kws.length === 0) return true;
  return kws.some((k) => text.includes(k) || (k.length >= 3 && text.includes(k.slice(0, 2))));
}

/** 전체 표기나 머리 명사를 조사 단위로 비교한다. 긴 이름의 일부는 재료로 보지 않는다. */
export function containsPlanted(text: string, planted: string): boolean {
  return containsMaterial(text, planted);
}

export function plotCheck(input: PlotCheckInput): PlotCheckResult {
  const { outline: o, topic, protagonistName } = input;
  const fix: string[] = [];
  const regenerate: string[] = [];
  const beats = o.beats ?? [];
  const summaries = beats.map((b) => b.summary ?? '');

  // 1 심기-회수
  const planted = o.plan?.planted?.trim();
  const turn = beats.find((b) => b.type === 'turn');
  if (!planted) fix.push('plan.planted가 비어 있음');
  else {
    const early = summaries.slice(0, 2).some((s) => containsPlanted(s, planted));
    const recovered = !!turn && containsPlanted(turn.summary, planted);
    if (!early) fix.push(`심은 물건 "${planted}"이(가) 비트 1~2에 없음`);
    if (!recovered) fix.push(`심은 물건 "${planted}"이(가) 반전 비트에서 회수되지 않음`);
  }

  // 2 실패 이유 서로 다름 (+ 조합 재료 순서 준수)
  const attempts = beats.filter((b) => b.type === 'attempt');
  const reasons = attempts.map((b) => b.failureReason ?? null);
  if (reasons.some((r) => !r)) fix.push('attempt 비트에 failureReason이 비어 있음');
  if (new Set(reasons.filter(Boolean)).size < Math.min(3, reasons.length)) fix.push('attempt 비트의 실패 이유가 겹침');
  if (input.seed) {
    const want = input.seed.failureReasons.slice(0, attempts.length);
    if (want.some((r, i) => reasons[i] && reasons[i] !== r)) fix.push(`실패 이유 순서가 [정해진 재료]와 다름: ${want.join(',')} 기대`);
  }

  // 3 새 요소
  const newEls = beats.map((b) => (b.newElement ?? '').trim());
  if (newEls.some((e) => !e)) fix.push('newElement가 비어 있는 비트가 있음');
  if (new Set(newEls.filter(Boolean)).size < newEls.filter(Boolean).length) fix.push('newElement가 겹치는 비트가 있음');

  // 4 주제·이름 → 재생성
  const all = summaries.join(' ');
  if (!topicMentioned(all, topic)) regenerate.push(`주제 키워드(${topicKeywords(topic).join('/')})가 비트에 없음`);
  const nameCount = summaries.filter((s) => s.includes(protagonistName)).length;
  if (nameCount < 3) regenerate.push(`주인공 이름 "${protagonistName}"이(가) ${nameCount}개 비트에만 등장(3개 이상 필요)`);

  // 5 후렴
  if (o.refrain) {
    if ((o.refrain.usedAtBeats ?? []).length > 3) fix.push('후렴이 3회를 넘음');
    if (!o.refrain.variation?.trim()) fix.push('refrain.variation이 비어 있음');
  }

  // 6 교훈 서술 꼬리말
  summaries.forEach((s, i) => {
    for (const sent of splitSentences(s)) if (MORAL_TAIL.test(sent)) fix.push(`비트 ${i + 1} 교훈 꼬리말: "${sent}"`);
  });

  // 7 문형 반복 (연속 3문장 첫 두 어절 동일)
  const sents = splitSentences(all);
  for (let i = 0; i + 2 < sents.length; i++) {
    const heads = [sents[i], sents[i + 1], sents[i + 2]].map((s) => s.split(/\s+/).slice(0, 2).join(' '));
    if (heads[0] && heads[0] === heads[1] && heads[1] === heads[2]) {
      fix.push(`같은 문형 3연속: "${heads[0]} …"`);
      break;
    }
  }

  // 8 금지 소재 → 재생성
  const forbidden = input.inventories?.forbiddenKeywords ?? ['괴물', '귀신', '때리', '놀리'];
  for (const k of forbidden) if (k.trim().length >= 2 && all.includes(k)) regenerate.push(`금지 소재: ${k}`);

  // 9 장소 규칙: 시작·끝은 집, 중간 2곳 이상
  const keys = beats.map((b) => (b.settingKey ?? '').toLowerCase());
  const mid = new Set(keys.slice(1, -1).filter(Boolean));
  if (mid.size < 2 && beats.length >= 5) fix.push('중간 비트의 장소가 2곳 미만');

  // 10 금지 목록 — 주제가 직접 언급한 물건·생물은 부모가 요청한 것이므로 반복으로 치지 않는다
  if (input.ban) {
    const effBan = {
      ...input.ban,
      plantedObjects: input.ban.plantedObjects.filter((p) => !containsMaterial(topic, p)),
      creatures: input.ban.creatures.filter((c) => !containsMaterial(topic, c)),
    };
    for (const v of violatesBanList(o, effBan)) fix.push(v);
  }

  // 11 조합 재료 준수(생물·반전)
  if (input.seed) {
    if (!all.includes(input.seed.creature.ko)) fix.push(`배경 생물 "${input.seed.creature.ko}"이(가) 등장하지 않음`);
    if (o.plan?.pattern && o.plan.pattern !== input.seed.patternId) fix.push('plan.pattern이 선택한 패턴과 다름');
  }

  return { ok: fix.length === 0 && regenerate.length === 0, fix, regenerate };
}

/** 수정 패스에 넣을 지시문. 지적된 항목만 고치게 한다. */
export function renderFixInstructions(result: PlotCheckResult): string {
  if (result.fix.length === 0) return '';
  return ['[고칠 것 — 해당 비트만 고치고 나머지는 그대로 둔다]', ...result.fix.map((f) => `- ${f}`)].join('\n');
}
