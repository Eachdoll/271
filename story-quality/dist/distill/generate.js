/**
 * 증류 데이터셋 생성기 — 상위 모델로 주제 × 패턴 × 수준 교차 줄거리를 만들어 JSONL로 저장한다.
 * - 각 샘플은 앱이 실제로 쓰는 outline.v3 프롬프트 그대로 생성한다(학습 시 분포 차이 없음).
 * - plotCheck(코드) 통과 + 루브릭(보급형 판정기) ≥ 8점만 승인(approved=true). 나머지도 저장하되 approved=false.
 * - 재개 가능: 출력 파일에 이미 있는 sampleId는 건너뛴다.
 * - 금지 목록은 '지금까지 승인된 샘플'에서 굴려 데이터셋 안에서도 재료가 겹치지 않게 한다.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { findWorld, worldCoreLines } from '../worlds.js';
import { applyOverlay } from '../expand.js';
import { buildBanList } from '../banList.js';
import { composeSeed, preferObstaclesForTopic } from '../composeSeed.js';
import { buildOutlinePrompt } from '../outlinePrompt.js';
import { plotCheck, renderFixInstructions } from '../plotCheck.js';
import { judgeOutline } from '../eval/rubricJudge.js';
import { extractJson, hashString } from '../util.js';
export function loadExisting(outPath) {
    const m = new Map();
    if (!existsSync(outPath))
        return m;
    for (const line of readFileSync(outPath, 'utf8').split('\n')) {
        if (!line.trim())
            continue;
        try {
            const s = JSON.parse(line);
            m.set(s.sampleId, s);
        }
        catch {
            /* skip */
        }
    }
    return m;
}
export function sampleToBookRecord(s) {
    if (!s.outline)
        return null;
    const o = s.outline;
    return {
        bookId: s.sampleId,
        seriesId: 'distill',
        topic: s.topic,
        patternId: s.patternId,
        levelKo: s.levelKo,
        levelEn: s.levelEn,
        outline: o,
        approved: s.approved,
        createdAt: s.createdAt,
        usedElements: {
            planted: o.plan?.planted ?? '',
            creatures: [],
            twistTypeId: undefined,
            patternId: s.patternId,
            places: o.beats.map((b) => b.settingKey).filter(Boolean),
        },
        feedback: { rubricTotal: s.rubric?.total },
    };
}
export async function runDistillation(cfg) {
    const existing = loadExisting(cfg.outPath);
    const variants = cfg.variantsPerCell ?? 1;
    const approvedBooks = [...(cfg.seedBooks ?? [])];
    for (const s of existing.values()) {
        const r = sampleToBookRecord(s);
        if (r && s.approved)
            approvedBooks.push(r);
    }
    // 셀 목록: 주제 × 수준 × 변형
    const cells = [];
    for (const t of cfg.topics)
        for (const lv of cfg.levels)
            for (let v = 0; v < variants; v++)
                cells.push({ t, lv, v });
    let total = 0, approved = 0, cost = 0, skipped = 0;
    const conc = Math.max(1, cfg.concurrency ?? 2);
    let cursor = 0;
    async function worker() {
        while (cursor < cells.length) {
            const cell = cells[cursor++];
            const sampleId = `${cell.t.id}-${cell.lv.levelKo}-${cell.lv.levelEn}-v${cell.v}`;
            if (existing.has(sampleId) && !existing.get(sampleId)?.dryRun) {
                skipped++;
                continue;
            }
            const s = await generateOne(cfg, cell.t, cell.lv, cell.v, sampleId, approvedBooks);
            appendFileSync(cfg.outPath, JSON.stringify(s) + '\n');
            total++;
            cost += s.costUsd;
            if (s.approved) {
                approved++;
                const r = sampleToBookRecord(s);
                if (r)
                    approvedBooks.push(r);
            }
            cfg.onSample?.(s);
        }
    }
    await Promise.all(Array.from({ length: conc }, () => worker()));
    return { total, approved, costUsd: cost, skipped };
}
async function generateOne(cfg, t, lv, variant, sampleId, approvedBooks) {
    const pattern = cfg.patterns.find((p) => p.id === t.patternId) ?? cfg.patterns[0];
    const baseWorld = findWorld(cfg.worlds, t.worldId);
    // 계절·시간 오버레이: 셀마다 결정적으로 고른다(변형 0 = 낮, 1 = 밤, 계절은 해시로). 같은 주제의 변형이 다른 모습이 되게.
    const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
    const season = SEASONS[hashString(sampleId + ':season') % SEASONS.length];
    const timeOfDay = variant % 2 === 0 ? 'day' : 'night';
    const world = baseWorld ? applyOverlay(cfg.worlds, baseWorld, season, timeOfDay) : undefined;
    const ban = buildBanList(approvedBooks, { recentBooks: 8, recentBooksForPattern: 0 });
    const seed = composeSeed({
        pattern,
        inventories: cfg.inventories,
        backgroundType: t.worldId,
        rngSeed: hashString(sampleId),
        ban,
        preferObstacleIds: preferObstaclesForTopic(t.topic),
        world,
    });
    const worldCore = world ? worldCoreLines(cfg.worlds, world) : ['유하네 집과 동네'];
    const prompt = buildOutlinePrompt({
        protagonist: cfg.protagonist,
        supporting: cfg.supporting,
        worldCore,
        topic: t.topic,
        value: t.value ?? undefined,
        levelKo: lv.levelKo,
        levelEn: lv.levelEn,
        pages: cfg.pages,
        pattern,
        seed,
        inventories: cfg.inventories,
        ban,
        approvedBooks,
        endingType: 'home_sleep',
        exampleCount: 2,
    });
    const base = {
        sampleId,
        topicId: t.id,
        topic: t.topic,
        worldId: t.worldId,
        patternId: pattern.id,
        levelKo: lv.levelKo,
        levelEn: lv.levelEn,
        variant,
        worldState: world ? { season: world.season, timeOfDay: world.timeOfDay, label: world.stateLabel.ko } : undefined,
        prompt: { system: prompt.system, user: prompt.user },
        outline: null,
        plotCheck: { ok: false, fix: [], regenerate: [] },
        rubric: null,
        approved: false,
        fixed: false,
        usage: { input: 0, output: 0 },
        costUsd: 0,
        generatorId: cfg.generator.id,
        createdAt: new Date().toISOString(),
    };
    if (cfg.dryRun)
        return { ...base, dryRun: true };
    try {
        const r = await cfg.generator.complete({ ...prompt, temperature: 0.85 + variant * 0.03 });
        base.usage = r.usage;
        base.costUsd += r.costUsd ?? 0;
        let outline = r.json ?? extractJson(r.text);
        if (!outline) {
            base.error = 'JSON 파싱 실패';
            return base;
        }
        let check = plotCheck({ outline, topic: t.topic, protagonistName: cfg.protagonist.name, seed, ban, inventories: cfg.inventories });
        if (!check.ok && check.regenerate.length === 0 && check.fix.length > 0) {
            const fixer = cfg.fixer ?? cfg.judge;
            const fixUser = [`아래 줄거리 JSON에서 지적된 항목만 고쳐 전체 JSON을 다시 출력한다. 나머지 비트는 글자 하나 바꾸지 않는다.`, renderFixInstructions(check), JSON.stringify(outline)].join('\n\n');
            const fr = await fixer.complete({ system: '너는 그림책 편집자다. JSON으로만 답한다.', user: fixUser, temperature: 0.3, maxTokens: 4000 });
            base.costUsd += fr.costUsd ?? 0;
            const fixed = fr.json ?? extractJson(fr.text);
            if (fixed) {
                outline = fixed;
                base.fixed = true;
                check = plotCheck({ outline, topic: t.topic, protagonistName: cfg.protagonist.name, seed, ban, inventories: cfg.inventories });
            }
        }
        base.outline = outline;
        base.plotCheck = { ok: check.ok, fix: check.fix, regenerate: check.regenerate };
        const rubric = await judgeOutline(cfg.judge, outline);
        base.costUsd += rubric.costUsd;
        base.rubric = { total: rubric.total, pass: rubric.pass, scores: rubric.scores };
        base.approved = check.ok && rubric.pass;
    }
    catch (e) {
        base.error = e instanceof Error ? e.message : String(e);
    }
    return base;
}
/** 비용·토큰 추정 (호출 전 표시용). 샘플당 입력≈프롬프트, 출력≈1,200토큰, 수정 30%, 판정 1회. */
export function estimateDistillCost(cells, promptTokens, price, judgePrice) {
    const genIn = cells * promptTokens;
    const genOut = cells * 1200;
    const fixIn = cells * 0.3 * 2500;
    const fixOut = cells * 0.3 * 1200;
    const judgeIn = cells * 1800;
    const judgeOut = cells * 150;
    const gen = (genIn * price.input + genOut * price.output) / 1e6;
    const fix = (fixIn * judgePrice.input + fixOut * judgePrice.output) / 1e6;
    const judge = (judgeIn * judgePrice.input + judgeOut * judgePrice.output) / 1e6;
    return { tokensIn: genIn + fixIn + judgeIn, tokensOut: genOut + fixOut + judgeOut, usd: gen + fix + judge, breakdown: { gen, fix, judge } };
}
