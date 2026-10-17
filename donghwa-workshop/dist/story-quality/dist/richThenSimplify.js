import { PROSE_RICH_SYSTEM, PROSE_RICH_USER_EN, PROSE_RICH_USER_KO, PROSE_SIMPLIFY_SYSTEM, PROSE_SIMPLIFY_USER_EN, PROSE_SIMPLIFY_USER_KO, fill } from './prompts.js';
import { findEmotionTells, renderGestureHintForPrompt, renderTellFixInstructions } from './gestures.js';
/** 한 단계 위 수준 라벨: K1→K2, K2→K3, K3→K4 / E0→E2, E1→E2, E2→E3, E3→E4 */
export const RICH_LEVEL_OF = { K1: 'K2', K2: 'K3', K3: 'K4', K4: 'K4', E0: 'E2', E1: 'E2', E2: 'E3', E3: 'E4', E4: 'E4' };
export async function writeRichThenSimplify(input) {
    const simplifier = input.simplifyEngine ?? input.engine;
    let calls = 0;
    let cost = 0;
    const isKo = input.lang === 'ko';
    const refrainText = input.refrainText ? `"${input.refrainText}"` : isKo ? '(없음)' : '(none)';
    const refrainBeats = (input.refrainBeats ?? []).join(', ') || (isKo ? '없음' : 'none');
    const styleLabel = isKo
        ? '[문체 예시 — 리듬·종결어미·구체성만 참고. 내용·인물·사건·소품 재사용 금지]'
        : '[Style samples — borrow only rhythm, sentence endings and concreteness. Do not reuse content, characters, events or props]';
    const styleSamples = input.styleSamples?.length ? [styleLabel, ...input.styleSamples.slice(0, 3).map((s) => `- ${s}`)].join('\n') : '';
    const gestureHints = renderGestureHintForPrompt(input.gestureDict, input.emotions, input.lang);
    // 1패스: 풍부하게
    const richUser = fill(isKo ? PROSE_RICH_USER_KO : PROSE_RICH_USER_EN, {
        characters: input.charactersCompact,
        beats: input.beatsCompact,
        briefs: input.briefsCompact,
        richLevelLabel: input.richLevel.label,
        richEojeolRange: rangeOf(input.richLevel, 'ko'),
        richWordsRange: rangeOf(input.richLevel, 'en'),
        richSentencesRange: `${input.richLevel.sentencesPerPage[0] + 1}~${input.richLevel.sentencesPerPage[1] + 2}`,
        gestureHints,
        styleSamples,
        refrainText,
        refrainBeats,
    });
    const r1 = await input.engine.complete({ system: PROSE_RICH_SYSTEM, user: richUser, temperature: 0.8, maxTokens: 2000 });
    calls++;
    cost += r1.costUsd ?? 0;
    const rich = r1.text.trim();
    input.onPass?.('rich', rich);
    if (input.twoPass === false)
        return { rich, simplified: rich, tellHitsAfter: isKo ? findEmotionTells(rich, input.gestureDict).length : 0, calls, costUsd: cost };
    // 2패스: 목표 수준으로
    const budget = sentenceBudget(input.targetLevel, input.pageCount);
    const richDialogue = countDialogue(rich);
    // 예산이 있으면 대화 하한도 분량에 맞춘다(전체 문장의 1/4 이하, 최소 3).
    const dialogueCount = budget ? Math.max(Math.min(3, Math.max(2, richDialogue)), Math.min(richDialogue, Math.floor(budget.max / 4))) : Math.max(2, richDialogue);
    const lengthBudget = renderLengthBudget(budget, input.pageCount, isKo);
    const onoCount = Math.max(2, Math.min(4, Math.round(dialogueCount * 0.8)));
    const simpUser = fill(isKo ? PROSE_SIMPLIFY_USER_KO : PROSE_SIMPLIFY_USER_EN, {
        targetLevelLabel: input.targetLevel.label,
        targetEojeolRange: rangeOf(input.targetLevel, 'ko'),
        targetWordsRange: rangeOf(input.targetLevel, 'en'),
        targetSentencesRange: `${input.targetLevel.sentencesPerPage[0]}~${input.targetLevel.sentencesPerPage[1] + 1}`,
        vocabLabel: input.vocabLabel ?? (isKo ? '기초 어휘' : 'basic word list'),
        dialogueCount,
        onomatopoeiaCount: onoCount,
        refrainText,
        refrainBeats,
        decodableRule: input.decodable ? '- Prefer CVC words (cat, sun, big) and the sight-word list.' : '',
        extraFixes: '',
        lengthBudget,
        richText: rich,
    });
    const r2 = await simplifier.complete({ system: PROSE_SIMPLIFY_SYSTEM, user: simpUser, temperature: 0.4, maxTokens: 4000 });
    calls++;
    cost += r2.costUsd ?? 0;
    let simplified = r2.text.trim();
    input.onPass?.('simplify', simplified);
    // 직설어가 남았으면 그 문장만 고치는 1회 재실행 (한글만 — 영어는 라벨 검사 생략)
    let hits = isKo ? findEmotionTells(simplified, input.gestureDict) : [];
    if (hits.length > 0) {
        const fixUser = fill(isKo ? PROSE_SIMPLIFY_USER_KO : PROSE_SIMPLIFY_USER_EN, {
            targetLevelLabel: input.targetLevel.label,
            targetEojeolRange: rangeOf(input.targetLevel, 'ko'),
            targetWordsRange: rangeOf(input.targetLevel, 'en'),
            targetSentencesRange: `${input.targetLevel.sentencesPerPage[0]}~${input.targetLevel.sentencesPerPage[1] + 1}`,
            vocabLabel: input.vocabLabel ?? '기초 어휘',
            dialogueCount,
            onomatopoeiaCount: onoCount,
            refrainText,
            refrainBeats,
            decodableRule: '',
            extraFixes: renderTellFixInstructions(hits, input.gestureDict),
            lengthBudget,
            richText: simplified,
        });
        const r3 = await simplifier.complete({ system: PROSE_SIMPLIFY_SYSTEM, user: fixUser, temperature: 0.3, maxTokens: 4000 });
        calls++;
        cost += r3.costUsd ?? 0;
        simplified = r3.text.trim();
        input.onPass?.('fix', simplified);
        hits = findEmotionTells(simplified, input.gestureDict);
    }
    return { rich, simplified, tellHitsAfter: hits.length, calls, costUsd: cost };
}
/** 전체 문장 예산: 쪽 수 × 쪽당 문장 범위. 쪽 수가 없으면 null(기존 동작). */
export function sentenceBudget(level, pageCount) {
    const pages = Number(pageCount);
    if (!Number.isInteger(pages) || pages < 1)
        return null;
    const [lo, hi] = level.sentencesPerPage;
    return { min: lo * pages, max: hi * pages };
}
function renderLengthBudget(budget, pageCount, isKo) {
    if (!budget)
        return '';
    return isKo
        ? `[전체 분량] ${pageCount}쪽 그림책 → 전체 ${budget.min}~${budget.max}문장(대화 문장 포함). 이 범위를 반드시 지킨다. 비트마다 문장 수를 나눠 맞춘다.`
        : `[Total length] ${pageCount}-page picture book → ${budget.min}-${budget.max} sentences in total, dialogue included. Stay inside this range; spread it across the beats.`;
}
function rangeOf(level, lang) {
    const r = lang === 'ko' ? level.eojeolPerSentence : level.wordsPerSentence;
    return r ? `${r[0]}~${r[1]}` : '';
}
export function countDialogue(text) {
    const m = text.match(/[“"][^”"]{1,60}[”"]/g);
    return m ? m.length : 0;
}
