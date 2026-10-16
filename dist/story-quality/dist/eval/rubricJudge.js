import { extractJson } from '../util.js';
export const RUBRIC_SYSTEM = `너는 그림책 편집자다. 3~7세 그림책 줄거리를 아래 5항목으로 0~2점 채점한다. 관대하지 말고, 근거를 비트 번호로 댄다. JSON으로만 답한다.`;
export const RUBRIC_USER = `[줄거리 JSON]
{{outline}}

[채점 기준]
- event(사건성): 0 = 상황이 바뀌지 않는 비트가 2개 이상 / 1 = 1개 / 2 = 모든 비트에서 상황이 바뀐다
- causality(인과): 0 = 비트 순서를 바꿔도 말이 된다 / 1 = 일부만 이어진다 / 2 = 앞 비트의 결과가 다음 비트의 원인이다
- repetition(반복): 0 = 의도하지 않은 반복 문장·꼬리말이 있다 / 1 = 같은 문형이 눈에 띈다 / 2 = 후렴 외 반복이 없다
- twist(반전): 0 = 반전이 없거나 앞과 무관 / 1 = 반전은 있으나 심은 것과 약하게 연결 / 2 = 앞에 심은 것이 재해석된다
- concreteness(구체성): 0 = 추상어·일반 명사 위주 / 1 = 절반쯤 구체적 / 2 = 물건·장소·생물이 구체적이다

[출력] JSON만.
{"scores": {"event": 0, "causality": 0, "repetition": 0, "twist": 0, "concreteness": 0},
 "worst2": ["가장 낮은 항목 2개 이름"],
 "fixes": ["비트 n: 고칠 내용 한 줄", "..."]}`;
export async function judgeOutline(engine, outline) {
    const user = RUBRIC_USER.replace('{{outline}}', JSON.stringify(compact(outline)));
    const r = await engine.complete({ system: RUBRIC_SYSTEM, user, temperature: 0.1, maxTokens: 500 });
    const j = r.json ?? extractJson(r.text) ?? {};
    const s = j.scores ?? {};
    const scores = {
        event: clamp(s.event),
        causality: clamp(s.causality),
        repetition: clamp(s.repetition),
        twist: clamp(s.twist),
        concreteness: clamp(s.concreteness),
    };
    const total = scores.event + scores.causality + scores.repetition + scores.twist + scores.concreteness;
    const hasZero = Object.values(scores).some((v) => v === 0);
    return { scores, total, pass: total >= 8 && !hasZero, worst2: j.worst2 ?? [], fixes: j.fixes ?? [], raw: j, costUsd: r.costUsd ?? 0 };
}
/** 판정에 필요한 필드만 넘겨 토큰을 아낀다. */
function compact(o) {
    return {
        plan: o.plan,
        logline: o.logline,
        want: o.want,
        problem: o.problem,
        beats: o.beats.map((b) => ({ i: b.index, type: b.type, summary: b.summary, newElement: b.newElement, failureReason: b.failureReason ?? undefined })),
        refrain: o.refrain,
    };
}
function clamp(v) {
    const n = Number(v);
    if (Number.isNaN(n))
        return 0;
    return Math.max(0, Math.min(2, Math.round(n)));
}
