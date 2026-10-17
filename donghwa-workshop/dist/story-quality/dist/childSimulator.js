import { CHILD_CURIOSITY_SYSTEM, CHILD_CURIOSITY_USER, CHILD_RETELL_SYSTEM, CHILD_RETELL_USER, fill } from './prompts.js';
import { extractJson } from './util.js';
export async function curiosityCheck(engine, pages) {
    const user = fill(CHILD_CURIOSITY_USER, { pages: pages.map((p) => `${p.pageNo}. ${p.text}`).join('\n') });
    const r = await engine.complete({ system: CHILD_CURIOSITY_SYSTEM, user, temperature: 0.3, maxTokens: 900 });
    const j = r.json ?? extractJson(r.text) ?? {};
    const scored = (j.pages ?? []).map((p) => ({
        pageNo: Number(p.pageNo),
        score: clamp(Number(p.score), 0, 2),
        childQuestion: p.childQuestion ?? null,
        why: p.why ?? '',
    }));
    const drop = scored.filter((p) => p.score === 0).map((p) => p.pageNo);
    const overall = typeof j.overall === 'number' ? j.overall : Math.round((scored.reduce((a, p) => a + p.score, 0) / Math.max(1, scored.length)) * 5);
    return { pages: scored, dropPages: drop.length ? drop : j.dropPages ?? [], overall, pass: drop.length === 0 && overall >= 6, costUsd: r.costUsd ?? 0 };
}
export async function retellCheck(engine, prose, beats) {
    const user = fill(CHILD_RETELL_USER, {
        prose,
        beats: beats.map((b) => `${b.index} [${b.type}] ${b.summary}`).join('\n'),
    });
    const r = await engine.complete({ system: CHILD_RETELL_SYSTEM, user, temperature: 0.3, maxTokens: 600 });
    const j = r.json ?? extractJson(r.text) ?? {};
    const covered = (j.coveredBeats ?? []).map(Number);
    const coreTypes = ['want', 'turn', 'resolution'];
    const coreIdx = beats.filter((b) => coreTypes.includes(b.type)).map((b) => b.index);
    const missingFromCovered = coreIdx.filter((i) => !covered.includes(i)).map((i) => beats.find((b) => b.index === i)?.type ?? String(i));
    const missingCore = [...new Set([...(j.missingCore ?? []), ...missingFromCovered])];
    const coherence = clamp(Number(j.coherence ?? 0), 0, 2);
    return {
        retell: j.retell ?? [],
        coveredBeats: covered,
        missingCore,
        confusions: j.confusions ?? [],
        coherence,
        pass: missingCore.length === 0 && coherence >= 1,
        recommendTurnRewrite: missingCore.includes('turn'),
        costUsd: r.costUsd ?? 0,
    };
}
function clamp(n, lo, hi) {
    if (Number.isNaN(n))
        return lo;
    return Math.max(lo, Math.min(hi, n));
}
