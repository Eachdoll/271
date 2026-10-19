import { buildBanList, renderBanListForPrompt } from './banList.js';
import { composeSeed, preferObstaclesForTopic } from './composeSeed.js';
import { buildOutlinePrompt, roughTokenCount } from './outlinePrompt.js';
import { plotCheck, renderFixInstructions, containsPlanted } from './plotCheck.js';
import { generateBeatsWithBeam } from './beamSearch.js';
import { writeRichThenSimplify, RICH_LEVEL_OF } from './richThenSimplify.js';
import { curiosityCheck, retellCheck } from './childSimulator.js';
import { extractJson, hashString } from './util.js';
import { catchphraseClauses, isCatchphraseFix } from './catchphrase.js';
export async function runOutlineStage(input) {
    const ban = buildBanList(input.approvedBooks, {
        recentBooks: Math.min(50, Math.max(1, Math.round(input.banWindow ?? 10))),
        recentBooksForPattern: Math.min(20, Math.max(1, Math.round(input.patternBanWindow ?? 3))),
    });
    const seed = composeSeed({
        pattern: input.pattern,
        inventories: input.inventories,
        backgroundType: input.backgroundType,
        rngSeed: hashString(input.bookId),
        ban,
        preferObstacleIds: preferObstaclesForTopic(input.topic),
        world: input.world,
        variantChance: input.variantChance,
    });
    const cast = [input.protagonist, ...input.supporting];
    const clauses = input.legacyCatchphrasePrompt ? cast.map((c) => (c.catchphrase ? ` "${c.catchphrase}"` : '')) : catchphraseClauses(cast);
    const charactersCompact = cast.map((c, i) => `${c.name}: ${c.traits.slice(0, 2).join('·')}${clauses[i]}`).join(' / ');
    let calls = 0;
    let cost = 0;
    let outline;
    if (input.useBeamSearch) {
        // 비트는 빔 서치로, 나머지 필드(제목·후렴·새 단어)는 한 번의 짧은 호출로 채운다
        const beam = await generateBeatsWithBeam({
            engine: input.engines.outline,
            judgeEngine: input.engines.cheap,
            pattern: input.pattern,
            seed,
            inventories: input.inventories,
            topic: input.topic,
            charactersCompact,
            banListText: renderBanListForPrompt(ban, input.inventories),
        });
        calls += beam.calls;
        cost += beam.costUsd;
        const wrapUser = [
            `아래 비트로 된 그림책 줄거리의 나머지 필드를 JSON으로만 채운다.`,
            `주인공: ${input.protagonist.name}. 주제: ${input.topic}. 심은 물건: ${seed.planted.ko}. 반전: ${seed.twist.ko}.`,
            beam.beats.map((b) => `${b.index} [${b.type}] ${b.summary}`).join('\n'),
            `APPROVED_BEAM_BEATS_JSON: ${JSON.stringify(beam.beats)}`,
            `{"titleCandidates": ["...","...","..."], "logline": "...", "want": "...", "problem": "...", "twistReveal": "...", "funnyMoment": "...", "refrain": {"text": "...", "usedAtBeats": [2,4], "variation": "..."}, "newWordsKo": ["...","...","..."], "newWordsEn": ["...","...","..."]}`,
        ].join('\n\n');
        const wrap = await input.engines.cheap.complete({ system: '너는 그림책 편집자다. JSON으로만 답한다.', user: wrapUser, temperature: 0.5, maxTokens: 600 });
        calls++;
        cost += wrap.costUsd ?? 0;
        const extra = wrap.json ?? extractJson(wrap.text) ?? {};
        outline = {
            ...extra,
            plan: {
                pattern: input.pattern.id,
                planted: seed.planted.ko,
                twistReveal: String(extra.twistReveal ?? extra.plan?.twistReveal ?? ''),
                funnyMoment: String(extra.funnyMoment ?? extra.plan?.funnyMoment ?? seed.humor.ko),
                failureReasons: seed.failureReasons,
            },
            titleCandidates: extra.titleCandidates ?? [],
            logline: String(extra.logline ?? ''),
            want: String(extra.want ?? ''),
            problem: String(extra.problem ?? ''),
            beats: extra.beats ?? beam.beats,
            refrain: extra.refrain,
            newWordsKo: extra.newWordsKo ?? [],
            newWordsEn: extra.newWordsEn ?? [],
            endingType: input.endingType,
        };
    }
    else {
        const makePrompt = (exampleCount, legacyCatchphrasePrompt = input.legacyCatchphrasePrompt) => buildOutlinePrompt({
            protagonist: input.protagonist,
            supporting: input.supporting,
            worldCore: input.worldCore,
            topic: input.topic,
            value: input.value,
            levelKo: input.levelKo,
            levelEn: input.levelEn,
            pages: input.pages,
            pattern: input.pattern,
            seed,
            inventories: input.inventories,
            ban,
            approvedBooks: [...input.approvedBooks, ...(input.referenceBooks ?? [])],
            endingType: input.endingType,
            rules: input.rules,
            banExamples: input.banExamples,
            exampleCount,
            excludeBookIds: input.excludeBookIds,
            legacyCatchphrasePrompt,
        });
        // R9: 말버릇 사용 한도 문구는 참고 예시 예산(1,800)에 세지 않는다. r8 문안 길이로 재므로 한도 문구 때문에
        // 예시가 빠지지 않고, 예시 수는 r8과 같다(r8 문안이면 실제 프롬프트와 같은 길이).
        const overBudget = (exampleCount) => {
            const measured = makePrompt(exampleCount, true);
            return roughTokenCount(measured.system + measured.user) > 1800;
        };
        let exampleCount = 2;
        while (exampleCount > 0 && overBudget(exampleCount))
            exampleCount--;
        const prompt = makePrompt(exampleCount);
        const r = await input.engines.outline.complete(prompt);
        calls++;
        cost += r.costUsd ?? 0;
        const parsed = r.json ?? extractJson(r.text);
        if (!parsed)
            throw new Error('줄거리 JSON 파싱 실패');
        outline = parsed;
    }
    // 코드 검사 → 지적된 비트만 고치는 수정 호출 1회
    const catchphrases = input.legacyCatchphrasePrompt ? [] : input.catchphrases ?? cast.map((c) => c.catchphrase ?? '');
    outline = plantedFromSeed(outline, seed);
    let check = plotCheck({ outline, topic: input.topic, protagonistName: input.protagonist.name, seed, ban, inventories: input.inventories, catchphrases });
    const onlyAdvisory = input.advisoryCatchphrases === true && check.fix.every((message) => isCatchphraseFix(message));
    if (check.fix.length > 0 && check.regenerate.length === 0 && !onlyAdvisory) {
        const fixUser = [`아래 줄거리 JSON에서 지적된 항목만 고쳐 전체 JSON을 다시 출력한다. 나머지 비트는 글자 하나 바꾸지 않는다.`, renderFixInstructions(check), JSON.stringify(outline)].join('\n\n');
        const fr = await input.engines.cheap.complete({ system: '너는 그림책 편집자다. JSON으로만 답한다.', user: fixUser, temperature: 0.3, maxTokens: 4000 });
        calls++;
        cost += fr.costUsd ?? 0;
        const fixed = fr.json ?? extractJson(fr.text);
        if (fixed) {
            outline = plantedFromSeed(fixed, seed);
            check = plotCheck({ outline, topic: input.topic, protagonistName: input.protagonist.name, seed, ban, inventories: input.inventories, catchphrases });
        }
    }
    return { outline, check, seedSummary: `${seed.planted.ko} · ${seed.twist.ko} · ${seed.creature.ko}`, seed, calls, costUsd: cost };
}
/**
 * 모델이 plan.planted를 시드 재료가 든 설명 문장으로 쓰면("엄마의 커다란 무늬 모자는 안쪽 띠가 좁다. …")
 * 시드 재료 이름으로 되돌린다. 시드 재료가 들어 있지 않은 다른 물건이면 그대로 두어 검사가 잡게 한다.
 */
export function plantedFromSeed(outline, seed) {
    const want = seed?.planted?.ko;
    const got = outline?.plan?.planted;
    if (!want || typeof got !== 'string' || got === want)
        return outline;
    if (!got.includes(want) && !containsPlanted(got, want))
        return outline;
    return { ...outline, plan: { ...outline.plan, planted: want } };
}
export async function runProseStage(input) {
    const target = input.levels[input.targetLevelId];
    const rich = input.twoPass === false ? target : input.levels[RICH_LEVEL_OF[input.targetLevelId] ?? input.targetLevelId] ?? target;
    return writeRichThenSimplify({
        engine: input.engines.prose,
        simplifyEngine: input.engines.cheap,
        lang: input.lang,
        charactersCompact: input.charactersCompact,
        beatsCompact: input.outline.beats.map((b) => `${b.index} [${b.type}] ${b.summary}`).join('\n'),
        briefsCompact: input.briefsCompact,
        emotions: input.emotions,
        gestureDict: input.gestureDict,
        targetLevel: target,
        richLevel: rich,
        refrainText: input.outline.refrain?.text,
        refrainBeats: input.outline.refrain?.usedAtBeats,
        styleSamples: input.styleSamples,
        vocabLabel: input.vocabLabel,
        twoPass: input.twoPass,
        decodable: input.targetLevelId === 'E1',
        presentTenseOnly: input.lang === 'en' && input.targetLevelId === 'E0',
        pageCount: input.pageCount,
        condenseOverBudget: input.condenseOverBudget,
        legacyCatchphrasePrompt: input.legacyCatchphrasePrompt,
    });
}
/** 쪽 나누기 뒤 게이트: 호기심 + 되말하기. 둘 다 보급형(하) 엔진. */
export async function runChildGate(engines, pages, prose, outline) {
    const [cur, ret] = await Promise.all([curiosityCheck(engines.cheap, pages), retellCheck(engines.cheap, prose, outline.beats)]);
    return {
        curiosity: cur,
        retell: ret,
        pass: cur.pass && ret.pass,
        rewritePages: cur.dropPages,
        rewriteTurnParagraph: ret.recommendTurnRewrite,
        costUsd: cur.costUsd + ret.costUsd,
    };
}
