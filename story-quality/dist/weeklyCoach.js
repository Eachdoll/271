import { WEEKLY_COACH_SYSTEM, WEEKLY_COACH_USER, fill, renderNumbered } from './prompts.js';
import { extractJson } from './util.js';
export async function runWeeklyCoach(input) {
    const min = input.minBooks ?? 3;
    const empty = { recurringWeaknesses: [], proposedBanExamples: [], proposedRules: [], patternNotes: [], keep: '', costUsd: 0 };
    if (input.recentBooks.length < min)
        return { ...empty, skipped: `최근 줄거리 ${input.recentBooks.length}개 (${min}개 미만) — 건너뜀` };
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
    const j = r.json ?? extractJson(r.text) ?? {};
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
export function mergeRules(current, approved, max) {
    let out = [...current];
    for (const p of approved) {
        const text = p.text.trim();
        if (!text || out.includes(text))
            continue;
        if (p.replaces && p.replaces >= 1 && p.replaces <= out.length) {
            out[p.replaces - 1] = text;
        }
        else if (out.length < max) {
            out.push(text);
        }
        else {
            out = [...out.slice(1), text];
        }
    }
    return out.slice(0, max);
}
export function shouldSuggestRollback(prev, current) {
    if (!prev || typeof current.rubricAvgAfter !== 'number' || typeof prev.rubricAvgAfter !== 'number')
        return false;
    return current.rubricAvgAfter + 0.5 < prev.rubricAvgAfter;
}
