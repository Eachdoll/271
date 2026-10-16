import { BEAT_CANDIDATES_SYSTEM, BEAT_CANDIDATES_USER, BEAT_JUDGE_SYSTEM, BEAT_JUDGE_USER, fill } from './prompts.js';
import { extractJson } from './util.js';
export async function generateBeatsWithBeam(input) {
    const judge = input.judgeEngine ?? input.engine;
    const chosen = [];
    let calls = 0;
    let cost = 0;
    let attemptIdx = 0;
    for (let i = 0; i < input.pattern.beats.length; i++) {
        const slot = input.pattern.beats[i];
        const failureReason = slot.type === 'attempt' ? input.seed.failureReasons[attemptIdx] ?? null : null;
        if (slot.type === 'attempt')
            attemptIdx++;
        const genUser = fill(BEAT_CANDIDATES_USER, {
            characters: input.charactersCompact,
            topic: input.topic,
            patternName: input.pattern.name,
            planted: input.seed.planted.ko,
            twist: input.seed.twist.ko,
            creature: input.seed.creature.ko,
            humor: input.seed.humor.ko,
            banList: input.banListText || '없음',
            chosenBeats: renderBeats(chosen) || '(아직 없음)',
            beatIndex: i + 1,
            beatType: slot.type,
            beatSlot: slot.slot,
            extraRule: extraRuleFor(slot.type, input.seed, failureReason, input.inventories, i + 1 === input.pattern.beats.length),
            failureReason: failureReason ? `"${failureReason}"` : 'null',
        });
        const gen = await input.engine.complete({ system: BEAT_CANDIDATES_SYSTEM, user: genUser, temperature: 0.9, maxTokens: 600 });
        calls++;
        cost += gen.costUsd ?? 0;
        const parsed = gen.json ?? extractJson(gen.text);
        let cands = (parsed?.candidates ?? []).filter((c) => c && c.summary).slice(0, 3);
        if (cands.length === 0) {
            // 파싱 실패: 1회 재시도
            const retry = await input.engine.complete({ system: BEAT_CANDIDATES_SYSTEM, user: genUser + '\n\nJSON만 다시 출력한다.', temperature: 0.7, maxTokens: 600 });
            calls++;
            cost += retry.costUsd ?? 0;
            const p2 = retry.json ?? extractJson(retry.text);
            cands = (p2?.candidates ?? []).filter((c) => c && c.summary).slice(0, 3);
            if (cands.length === 0)
                throw new Error(`beat ${i + 1}: 후보 생성 실패`);
        }
        while (cands.length < 3)
            cands.push(cands[cands.length - 1]);
        const judgeUser = fill(BEAT_JUDGE_USER, {
            chosenBeats: renderBeats(chosen) || '(아직 없음)',
            beatType: slot.type,
            beatSlot: slot.slot,
            candA: cands[0].summary,
            candB: cands[1].summary,
            candC: cands[2].summary,
        });
        const jr = await judge.complete({ system: BEAT_JUDGE_SYSTEM, user: judgeUser, temperature: 0.2, maxTokens: 200 });
        calls++;
        cost += jr.costUsd ?? 0;
        const verdict = jr.json ?? extractJson(jr.text);
        const bestKey = (verdict?.best ?? 'A').toUpperCase();
        const idx = { A: 0, B: 1, C: 2 }[bestKey] ?? 0;
        const pickC = cands[idx];
        const beat = {
            index: i + 1,
            type: slot.type,
            summary: pickC.summary,
            characters: [],
            settingKey: guessSetting(pickC.summary, input.seed),
            newElement: pickC.newElement ?? '',
            failureReason: slot.type === 'attempt' ? (pickC.failureReason ?? failureReason) : null,
        };
        chosen.push(beat);
        input.onProgress?.(i + 1, beat, verdict?.scores ?? {});
    }
    return { beats: chosen, calls, costUsd: cost };
}
function renderBeats(beats) {
    return beats.map((b) => `${b.index} [${b.type}] ${b.summary}`).join('\n');
}
function extraRuleFor(type, seed, reason, inv, isLast) {
    switch (type) {
        case 'setup':
            return `심을 물건 ${seed.planted.ko}이(가) 자연스럽게 등장한다. 집에서 시작한다.`;
        case 'want':
            return '주인공이 원하는 것을 한 문장으로 분명히 한다.';
        case 'attempt': {
            const r = inv.failureReasons.find((x) => x.id === reason);
            return `실패 이유는 반드시 '${r?.ko ?? reason}' (${r?.hint ?? ''}). 작고 우스운 실패.`;
        }
        case 'turn':
            return `반전 유형 '${seed.twist.ko}'대로, 심은 물건 ${seed.planted.ko}이(가) 다시 쓰인다. 배경 생물 ${seed.creature.ko}이(가) 아직 안 나왔다면 여기서 등장.`;
        case 'resolution':
            return '반전으로 알게 된 것으로 문제를 푼다. 웃음 포인트를 넣을 자리.';
        case 'close':
            return `집 또는 잠. 심은 물건을 침대 옆에 둔다. 교훈을 말하지 않는다.${isLast ? '' : ' (마지막 비트가 아니면 다음 편 예고 한 줄)'}`;
    }
}
function guessSetting(summary, seed) {
    if (/집|거실|침대|이불|부엌/.test(summary))
        return 'home';
    const loc = seed.subLocations.find((l) => summary.includes(l.ko));
    if (loc)
        return loc.ko;
    const obs = seed.obstacles.find((o) => summary.includes(o.ko));
    return obs ? obs.id : '';
}
