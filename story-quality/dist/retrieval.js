import { jaccard, tokenize } from './util.js';
export function scoreRecord(record, q) {
    const qt = tokenize(q.topic);
    const rt = tokenize(`${record.topic} ${record.outline.logline} ${record.outline.want}`);
    let s = jaccard(qt, rt); // 0~1
    if (q.patternId && record.patternId === q.patternId)
        s += 0.3;
    if (q.levelKo && record.levelKo === q.levelKo)
        s += 0.1;
    const rubric = record.feedback?.rubricTotal;
    if (typeof rubric === 'number')
        s += Math.max(0, rubric - 7) * 0.05; // 8점 이상이면 가산
    if (record.feedback?.difficulty === 'hard')
        s -= 0.1;
    if (record.feedback?.regenerated)
        s -= 0.1;
    return s;
}
export function retrieveExamples(records, q, k = 2) {
    const ex = new Set(q.excludeBookIds ?? []);
    return records
        .filter((r) => r.approved && !ex.has(r.bookId))
        .map((record) => ({ record, score: scoreRecord(record, q) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}
/**
 * 프롬프트용 렌더. 비트는 한 줄 요약(첫 문장)만 넣어 길이를 줄인다.
 * 라벨은 고정: 구조·리듬만 참고, 재사용 금지.
 */
export function renderExamplesForPrompt(examples, maxCharsEach = 420) {
    if (examples.length === 0)
        return '';
    const lines = ['[참고 예시 — 구조·리듬만 참고. 인물·물건·사건·장소 재사용 금지]'];
    examples.forEach(({ record }, i) => {
        const o = record.outline;
        const beats = o.beats
            .map((b) => `${b.index} ${firstSentence(b.summary)}`)
            .join(' · ');
        let block = `예시 ${i + 1} (주제: ${record.topic}, 패턴: ${record.patternId})\n plan: 심은 물건 ${o.plan.planted} / 반전 ${o.plan.twistReveal}\n 비트: ${beats}`;
        if (block.length > maxCharsEach)
            block = block.slice(0, maxCharsEach - 1) + '…';
        lines.push(block);
    });
    return lines.join('\n');
}
function firstSentence(s) {
    const m = s.match(/^[^.!?。]*[.!?。]?/);
    return (m ? m[0] : s).trim();
}
