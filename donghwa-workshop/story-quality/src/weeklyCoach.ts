/**
 * 주간 코치 패스 — 상위 모델을 매 책이 아니라 주 1회 '규칙 갱신'에만 쓴다.
 * 결과는 제안일 뿐이며, 부모가 승인한 것만 mergeRules로 프롬프트에 반영한다. 규칙 7개·금지 예시 4개 상한은 코드가 강제한다.
 */
import type { BookRecord, TextEngine } from './types.js';
import { WEEKLY_COACH_SYSTEM, WEEKLY_COACH_USER, fill, renderNumbered } from './prompts.js';
import { extractJson } from './util.js';

export interface CoachProposal {
  recurringWeaknesses: { pattern: string; seenIn: string[]; evidence: string }[];
  proposedBanExamples: { text: string; replaces: number | null }[];
  proposedRules: { text: string; replaces: number | null; why: string }[];
  patternNotes: { patternId: string; note: string }[];
  keep: string;
  costUsd: number;
  skipped?: string;
}

export interface CoachInput {
  engine: TextEngine; // 상위 모델
  recentBooks: BookRecord[]; // 최근 7일
  currentRules: string[];
  currentBanExamples: string[];
  minBooks?: number; // 기본 3
}

export async function runWeeklyCoach(input: CoachInput): Promise<CoachProposal> {
  const min = input.minBooks ?? 3;
  const empty: CoachProposal = { recurringWeaknesses: [], proposedBanExamples: [], proposedRules: [], patternNotes: [], keep: '', costUsd: 0 };
  if (input.recentBooks.length < min) return { ...empty, skipped: `최근 줄거리 ${input.recentBooks.length}개 (${min}개 미만) — 건너뜀` };

  const outlines = input.recentBooks
    .map((b) => {
      const beats = b.outline.beats.map((x) => `${x.index} ${x.summary}`).join(' · ');
      return `[${b.bookId}] 주제 "${b.topic}" / 패턴 ${b.patternId} / 루브릭 ${b.feedback?.rubricTotal ?? '-'}\n ${beats}`;
    })
    .join('\n');
  const feedback = input.recentBooks
    .filter((b) => b.feedback?.difficulty === 'hard' || b.feedback?.regenerated)
    .map((b) => `[${b.bookId}] ${b.feedback?.difficulty === 'hard' ? '어려움' : ''} ${b.feedback?.regenerated ? '다시 만들기' : ''}`.trim())
    .join('\n');

  const user = fill(WEEKLY_COACH_USER, {
    rules: renderNumbered(input.currentRules),
    banExamples: renderNumbered(input.currentBanExamples),
    n: input.recentBooks.length,
    outlines,
    feedback: feedback || '없음',
  });
  const r = await input.engine.complete({ system: WEEKLY_COACH_SYSTEM, user, temperature: 0.4, maxTokens: 1200 });
  const j = (r.json as Partial<CoachProposal> | undefined) ?? extractJson<Partial<CoachProposal>>(r.text) ?? {};
  return {
    recurringWeaknesses: j.recurringWeaknesses ?? [],
    proposedBanExamples: j.proposedBanExamples ?? [],
    proposedRules: j.proposedRules ?? [],
    patternNotes: j.patternNotes ?? [],
    keep: j.keep ?? '',
    costUsd: r.costUsd ?? 0,
  };
}

/**
 * 부모가 승인한 제안을 현재 목록에 반영한다. 상한을 넘기지 않는다.
 * replaces가 있으면 그 번호(1-based)를 교체, 없으면 끝에 추가하되 상한을 넘으면 가장 오래된(첫) 항목을 민다.
 */
export function mergeRules(current: string[], approved: { text: string; replaces: number | null }[], max: number): string[] {
  let out = [...current];
  for (const p of approved) {
    const text = p.text.trim();
    if (!text || out.includes(text)) continue;
    if (p.replaces && p.replaces >= 1 && p.replaces <= out.length) {
      out[p.replaces - 1] = text;
    } else if (out.length < max) {
      out.push(text);
    } else {
      out = [...out.slice(1), text];
    }
  }
  return out.slice(0, max);
}

/** 규칙 버전 기록 — 되돌리기용. 앱의 저장소에 그대로 넣으면 된다. */
export interface RuleVersion {
  version: number;
  appliedAt: string;
  rules: string[];
  banExamples: string[];
  rubricAvgBefore?: number;
  rubricAvgAfter?: number;
}

export function shouldSuggestRollback(prev: RuleVersion | undefined, current: RuleVersion): boolean {
  if (!prev || typeof current.rubricAvgAfter !== 'number' || typeof prev.rubricAvgAfter !== 'number') return false;
  return current.rubricAvgAfter + 0.5 < prev.rubricAvgAfter;
}
