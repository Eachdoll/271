import { renderBanListForPrompt } from './banList.js';
import { renderSeedForPrompt } from './composeSeed.js';
import { renderExamplesForPrompt, retrieveExamples } from './retrieval.js';
import { DEFAULT_BAN_EXAMPLES, DEFAULT_RULES, OUTLINE_SYSTEM, OUTLINE_USER, fill, renderNumbered } from './prompts.js';
import { catchphraseClauses } from './catchphrase.js';
/** r8 줄거리 프롬프트의 말버릇 구절(주인공, 조연). R9 이전과 글자 하나 다르지 않아야 한다. */
const legacyProtagonistClause = (c) => `, 말버릇 "${c.catchphrase ?? ''}"`;
const legacySupportingClause = (c) => (c.catchphrase ? `, 말버릇 "${c.catchphrase}"` : '');
export const BEATS_FOR_PAGES = { 8: 6, 12: 7, 16: 8, 24: 8 };
export function beatCountForPages(pages) {
    return BEATS_FOR_PAGES[pages] ?? (pages <= 8 ? 6 : pages <= 12 ? 7 : 8);
}
export function buildOutlinePrompt(input) {
    const p = input.pattern;
    const slots = p.beats.map((b, i) => `${i + 1} ${b.type} — ${b.slot}`).join('\n');
    // R9: 사용 한도 긴 문장은 말버릇이 있는 첫 인물에게만, 나머지는 "(최대 1번)"만(프롬프트 길이 → 참고 예시 수 유지).
    const clauses = input.legacyCatchphrasePrompt
        ? [legacyProtagonistClause(input.protagonist), ...input.supporting.map(legacySupportingClause)]
        : catchphraseClauses([input.protagonist, ...input.supporting]);
    const supporting = input.supporting
        .map((c, i) => `${c.name}${c.role ? `(${c.role})` : ''}: ${c.traits.slice(0, 2).join(', ')}${clauses[i + 1]}`)
        .join(' / ');
    const examples = renderExamplesForPrompt(retrieveExamples(input.approvedBooks, { topic: input.topic, patternId: p.id, levelKo: input.levelKo, excludeBookIds: input.excludeBookIds }, input.exampleCount ?? 2));
    const rules = (input.rules ?? DEFAULT_RULES).slice(0, 7);
    const banExamples = (input.banExamples ?? DEFAULT_BAN_EXAMPLES).slice(0, 4);
    const user = fill(OUTLINE_USER, {
        protagonistName: input.protagonist.name,
        protagonistTraits: input.protagonist.traits.slice(0, 3).join(', '),
        protagonistCatchphraseClause: clauses[0],
        supportingCharacters: supporting ? `[조연] ${supporting}` : '',
        worldCore: input.worldCore.slice(0, 3).join(' / '),
        topic: input.topic,
        value: input.value ?? '없음',
        levelKo: input.levelKo,
        levelEn: input.levelEn,
        pages: input.pages,
        // 패턴을 쓰면 비트 수는 패턴 슬롯 수를 따른다(쪽 배분은 쪽 나누기 단계가 맡는다). 패턴이 없을 때만 쪽 수 기준.
        beatCount: input.pattern.beats.length || beatCountForPages(input.pages),
        patternId: p.id,
        patternName: p.name,
        patternSlots: slots,
        patternRefrainHint: p.refrain.hint,
        patternPageTurn: p.pageTurn,
        patternAvoid: p.avoid,
        seedBlock: renderSeedForPrompt(input.seed, input.inventories, p),
        banList: renderBanListForPrompt(input.ban, input.inventories),
        examples,
        rules: renderNumbered(rules.map((r) => r.replace('주제의 핵심 요소와 주인공 이름', `주제 "${input.topic}"의 핵심 요소와 "${input.protagonist.name}" 이름`))),
        banExamples: banExamples.join('\n').replaceAll('유하', input.protagonist.name),
        endingType: input.endingType,
    });
    return { system: OUTLINE_SYSTEM, user, temperature: 0.85, maxTokens: 4000 };
}
/** 대략적인 토큰 수(한글 1자≈1토큰, 영어 4자≈1토큰). 1,800 넘으면 예시를 줄이라는 경고용. */
export function roughTokenCount(text) {
    let n = 0;
    for (const ch of text)
        n += /[가-힣ㄱ-ㆎ]/.test(ch) ? 1 : 0.3;
    return Math.round(n);
}
