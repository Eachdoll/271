import { adaptPatternForBook } from '../patterns.js';
/**
 * 평가 하네스 — 고정 20주제를 '구성(엔진 + 프롬프트 버전 + 옵션)'마다 돌려 루브릭 평균·plotCheck 통과율·비용·지연을 기록한다.
 * "강화됐다"를 감이 아니라 숫자로 안다. 결과는 eval/results/<runId>.jsonl + summary.json.
 *
 * 판정기 캘리브레이션(calibrateJudge): 골드 24편은 ≥8점, 나쁜 예시 3편은 ≤ expectedRubricMax이어야 판정기를 신뢰한다.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { findWorld, worldCoreLines } from '../worlds.js';
import { buildBanList } from '../banList.js';
import { composeSeed, preferObstaclesForTopic } from '../composeSeed.js';
import { buildOutlinePrompt } from '../outlinePrompt.js';
import { plotCheck, renderFixInstructions } from '../plotCheck.js';
import { generateBeatsWithBeam } from '../beamSearch.js';
import { renderBanListForPrompt } from '../banList.js';
import { judgeOutline } from './rubricJudge.js';
import { extractJson, hashString } from '../util.js';
export async function runEval(cfg) {
    mkdirSync(cfg.outDir, { recursive: true });
    const rowsPath = `${cfg.outDir}/${cfg.runId}.jsonl`;
    const done = new Set();
    if (existsSync(rowsPath))
        for (const l of readFileSync(rowsPath, 'utf8').split('\n'))
            if (l.trim())
                done.add(JSON.parse(l).topicId);
    const rows = existsSync(rowsPath) ? readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    for (const t of cfg.topics) {
        if (done.has(t.id))
            continue;
        const row = await evalOne(cfg, t);
        appendFileSync(rowsPath, JSON.stringify(row) + '\n');
        rows.push(row);
        cfg.onResult?.(row);
    }
    const summary = summarize(cfg, rows);
    writeFileSync(`${cfg.outDir}/${cfg.runId}.summary.json`, JSON.stringify(summary, null, 2));
    return summary;
}
async function evalOne(cfg, t) {
    const t0 = Date.now();
    const pattern = adaptPatternForBook(cfg.patterns.find((p) => p.id === t.patternId) ?? cfg.patterns[0], cfg.pages, t.levelKo);
    const world = findWorld(cfg.worlds, t.worldId);
    const ban = buildBanList(cfg.approvedBooks, { recentBooks: 8, recentBooksForPattern: 0 });
    const seed = composeSeed({ pattern, inventories: cfg.inventories, backgroundType: t.worldId, rngSeed: hashString(`eval-${t.id}`), ban, preferObstacleIds: preferObstaclesForTopic(t.topic), world });
    const row = { runId: cfg.runId, topicId: t.id, topic: t.topic, worldId: t.worldId, patternId: pattern.id, outline: null, plotOk: false, plotIssues: 0, rubric: null, rubricTotal: 0, rubricPass: false, fixed: false, latencyMs: 0, costUsd: 0 };
    try {
        let outline = null;
        const charactersCompact = [cfg.protagonist, ...cfg.supporting].map((c) => `${c.name}: ${c.traits.slice(0, 2).join('·')}`).join(' / ');
        if (cfg.options?.useBeamSearch) {
            const beam = await generateBeatsWithBeam({ engine: cfg.generator, judgeEngine: cfg.judge, pattern, seed, inventories: cfg.inventories, topic: t.topic, charactersCompact, banListText: renderBanListForPrompt(ban, cfg.inventories) });
            row.costUsd += beam.costUsd;
            outline = { plan: { pattern: pattern.id, planted: seed.planted.ko, twistReveal: '', funnyMoment: seed.humor.ko, failureReasons: seed.failureReasons }, titleCandidates: [], logline: '', want: '', problem: '', beats: beam.beats, newWordsKo: [], newWordsEn: [], endingType: 'home_sleep' };
        }
        else {
            const prompt = buildOutlinePrompt({
                protagonist: cfg.protagonist, supporting: cfg.supporting, worldCore: world ? worldCoreLines(cfg.worlds, world) : ['유하네 집과 동네'], topic: t.topic, levelKo: t.levelKo, levelEn: t.levelEn, pages: cfg.pages, pattern, seed, inventories: cfg.inventories, ban, approvedBooks: cfg.approvedBooks, endingType: 'home_sleep', rules: cfg.options?.rules, banExamples: cfg.options?.banExamples, exampleCount: cfg.options?.exampleCount ?? 2,
            });
            const r = await cfg.generator.complete(prompt);
            row.costUsd += r.costUsd ?? 0;
            outline = r.json ?? extractJson(r.text);
        }
        if (!outline)
            throw new Error('JSON 파싱 실패');
        let check = plotCheck({ outline, topic: t.topic, protagonistName: cfg.protagonist.name, seed, ban, inventories: cfg.inventories, catchphrases: [cfg.protagonist, ...cfg.supporting].map((c) => c.catchphrase ?? '') });
        if ((cfg.options?.useFixPass ?? true) && !check.ok && check.regenerate.length === 0 && check.fix.length) {
            const fixer = cfg.fixer ?? cfg.judge;
            const fr = await fixer.complete({ system: '너는 그림책 편집자다. JSON으로만 답한다.', user: [`아래 줄거리 JSON에서 지적된 항목만 고쳐 전체 JSON을 다시 출력한다.`, renderFixInstructions(check), JSON.stringify(outline)].join('\n\n'), temperature: 0.3, maxTokens: 4000 });
            row.costUsd += fr.costUsd ?? 0;
            const fixed = fr.json ?? extractJson(fr.text);
            if (fixed) {
                outline = fixed;
                row.fixed = true;
                check = plotCheck({ outline, topic: t.topic, protagonistName: cfg.protagonist.name, seed, ban, inventories: cfg.inventories, catchphrases: [cfg.protagonist, ...cfg.supporting].map((c) => c.catchphrase ?? '') });
            }
        }
        row.outline = outline;
        row.plotOk = check.ok;
        row.plotIssues = check.fix.length + check.regenerate.length;
        const rubric = await judgeOutline(cfg.judge, outline);
        row.costUsd += rubric.costUsd;
        row.rubric = rubric.scores;
        row.rubricTotal = rubric.total;
        row.rubricPass = rubric.pass;
    }
    catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
    }
    row.latencyMs = Date.now() - t0;
    return row;
}
export function summarize(cfg, rows) {
    const ok = rows.filter((r) => !r.error);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const items = ['event', 'causality', 'repetition', 'twist', 'concreteness'];
    const byItem = {};
    for (const it of items)
        byItem[it] = +mean(ok.map((r) => r.rubric?.[it] ?? 0)).toFixed(2);
    const byPattern = {};
    for (const r of ok) {
        const b = (byPattern[r.patternId] ??= { n: 0, rubricMean: 0, plotPassRate: 0 });
        b.n++;
        b.rubricMean += r.rubricTotal;
        b.plotPassRate += r.plotOk ? 1 : 0;
    }
    for (const b of Object.values(byPattern)) {
        b.rubricMean = +(b.rubricMean / b.n).toFixed(2);
        b.plotPassRate = +(b.plotPassRate / b.n).toFixed(2);
    }
    const byEra = {};
    for (const r of ok) {
        const era = findWorld(cfg.worlds, r.worldId)?.era ?? 'unknown';
        const b = (byEra[era] ??= { n: 0, rubricMean: 0 });
        b.n++;
        b.rubricMean += r.rubricTotal;
    }
    for (const b of Object.values(byEra))
        b.rubricMean = +(b.rubricMean / b.n).toFixed(2);
    const lat = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
    const cost = rows.reduce((a, r) => a + r.costUsd, 0);
    return {
        runId: cfg.runId,
        generatorId: cfg.generator.id,
        judgeId: cfg.judge.id,
        n: rows.length,
        errors: rows.length - ok.length,
        plotPassRate: +mean(ok.map((r) => (r.plotOk ? 1 : 0))).toFixed(2),
        rubricPassRate: +mean(ok.map((r) => (r.rubricPass ? 1 : 0))).toFixed(2),
        rubricMean: +mean(ok.map((r) => r.rubricTotal)).toFixed(2),
        rubricByItem: byItem,
        byPattern,
        byEra,
        costUsd: +cost.toFixed(4),
        costPerBook: +(rows.length ? cost / rows.length : 0).toFixed(4),
        latencyMsMedian: lat.length ? lat[Math.floor(lat.length / 2)] : 0,
        options: cfg.options,
        createdAt: new Date().toISOString(),
    };
}
/** 여러 run의 summary를 한 표로. 기준 run 대비 차이를 함께 낸다. */
export function compareSummaries(summaries, baselineRunId) {
    const base = summaries.find((s) => s.runId === baselineRunId) ?? summaries[0];
    const head = ['run', 'generator', 'rubric', 'Δ', 'pass', 'plotOk', '$/book', 'ms', 'event', 'caus', 'rep', 'twist', 'concr'];
    const lines = [head.join('\t')];
    for (const s of summaries) {
        const d = base ? (s.rubricMean - base.rubricMean).toFixed(2) : '';
        lines.push([s.runId, s.generatorId, s.rubricMean.toFixed(2), (Number(d) >= 0 ? '+' : '') + d, s.rubricPassRate, s.plotPassRate, s.costPerBook.toFixed(3), s.latencyMsMedian, s.rubricByItem.event, s.rubricByItem.causality, s.rubricByItem.repetition, s.rubricByItem.twist, s.rubricByItem.concreteness].join('\t'));
    }
    return lines.join('\n');
}
/** 판정기 캘리브레이션: 골드는 ≥8, 나쁜 예시는 ≤ expectedRubricMax. 통과 못 하면 판정기 모델/프롬프트를 믿지 않는다. */
export async function calibrateJudge(judge, gold, bad) {
    const goldRes = await Promise.all(gold.map(async (g) => ({ id: g.bookId, r: await judgeOutline(judge, g.outline) })));
    const badRes = await Promise.all(bad.map(async (b) => ({ id: b.bookId, max: b.expectedRubricMax, r: await judgeOutline(judge, b.outline) })));
    const goldFail = goldRes.filter((x) => x.r.total < 8).map((x) => `${x.id}=${x.r.total}`);
    const badFail = badRes.filter((x) => x.r.total > x.max).map((x) => `${x.id}=${x.r.total}>${x.max}`);
    const goldMean = goldRes.reduce((a, x) => a + x.r.total, 0) / Math.max(1, goldRes.length);
    const badMean = badRes.reduce((a, x) => a + x.r.total, 0) / Math.max(1, badRes.length);
    return {
        ok: goldFail.length <= Math.floor(gold.length * 0.1) && badFail.length === 0,
        goldMean: +goldMean.toFixed(2),
        badMean: +badMean.toFixed(2),
        separation: +(goldMean - badMean).toFixed(2), // 5 이상이면 판정기가 쓸 만하다
        goldFail,
        badFail,
        costUsd: +[...goldRes, ...badRes].reduce((a, x) => a + x.r.costUsd, 0).toFixed(4),
    };
}
