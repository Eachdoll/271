/**
 * 몸짓 사전(show-don't-tell) — 감정 직설어를 찾아내고, 치환 후보를 고르고, 프롬프트 힌트를 만든다.
 * 모델이 지어내지 않고 사전에서 고르게 하면 작은 모델도 품질이 안정된다.
 */
import type { GestureDictionary, GestureEntry } from './types.js';
import { makeRng, pickDistinct, splitSentences } from './util.js';

export interface TellHit {
  emotionId: string;
  emotionKo: string;
  match: string;
  sentence: string;
}

/** 글에서 감정 직설어를 찾는다. 금지 꼬리말(moral_tails_ko)도 함께 잡는다. */
export function findEmotionTells(text: string, dict: GestureDictionary): TellHit[] {
  const hits: TellHit[] = [];
  const sentences = splitSentences(text);
  for (const s of sentences) {
    for (const e of dict.emotions) {
      for (const t of e.tells) {
        if (s.includes(t)) hits.push({ emotionId: e.id, emotionKo: e.ko, match: t, sentence: s });
      }
    }
    for (const tail of dict.moral_tails_ko) {
      if (s.includes(tail)) hits.push({ emotionId: 'moral_tail', emotionKo: '교훈 꼬리말', match: tail, sentence: s });
    }
  }
  return hits;
}

export function findEntry(dict: GestureDictionary, emotionIdOrKo: string): GestureEntry | undefined {
  return dict.emotions.find((e) => e.id === emotionIdOrKo || e.ko === emotionIdOrKo);
}

/** 감정 하나에 대한 몸짓 후보 n개 (시드 고정 가능). */
export function suggestGestures(dict: GestureDictionary, emotionIdOrKo: string, lang: 'ko' | 'en' = 'ko', n = 2, seed = 1): string[] {
  const e = findEntry(dict, emotionIdOrKo);
  if (!e) return [];
  const pool = lang === 'ko' ? e.gestures_ko : e.gestures_en;
  return pickDistinct(makeRng(seed), pool, Math.min(n, pool.length), (x) => x);
}

/**
 * 프롬프트의 [몸짓 사전] 블록. 브리프에 나온 감정들만 넣어 길이를 줄인다.
 * 주인공 이름을 넘기면 "초록이 꼬리" 같은 고정 표현을 그대로 두고, 이름 치환은 모델에게 맡긴다.
 */
export function renderGestureHintForPrompt(dict: GestureDictionary, emotions: string[], lang: 'ko' | 'en' = 'ko', perEmotion = 2, seed = 1): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const em of emotions) {
    const e = findEntry(dict, em) ?? dict.emotions.find((x) => em.includes(x.ko) || x.ko.includes(em));
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    const g = suggestGestures(dict, e.id, lang, perEmotion, seed + lines.length);
    lines.push(lang === 'ko' ? `- ${e.ko} → ${g.join(' / ')}` : `- ${e.id} → ${g.join(' / ')}`);
  }
  return lines.join('\n');
}

/** 직설어가 들어간 문장을 재작성 지시문으로 바꾼다 (풍부화 재실행에 넣을 문구). */
export function renderTellFixInstructions(hits: TellHit[], dict: GestureDictionary, seed = 1): string {
  if (hits.length === 0) return '';
  const lines = ['[고칠 문장 — 감정을 말하지 말고 몸짓으로]'];
  hits.forEach((h, i) => {
    const g = h.emotionId === 'moral_tail' ? ['이 꼬리말을 지우고 사건으로 끝낸다'] : suggestGestures(dict, h.emotionId, 'ko', 2, seed + i);
    lines.push(`- "${h.sentence}" → ${g.join(' 또는 ')}`);
  });
  return lines.join('\n');
}
