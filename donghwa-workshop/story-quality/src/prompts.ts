/**
 * 프롬프트 템플릿을 코드에서 바로 쓰기 위한 상수 + 채우기 함수.
 * 원문과 설명은 prompts/*.md에 있다. 두 곳이 어긋나면 md가 기준이니 여기를 고친다.
 */

export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  const PH = /\{\{\s*([\w.]+)\s*\}\}/g;
  const lines = template.split('\n').flatMap((line) => {
    if (!PH.test(line)) return [line];
    PH.lastIndex = 0;
    let allEmpty = true;
    const filled = line.replace(PH, (_, key: string) => {
      const v = vars[key];
      const s = v === undefined || v === null ? '' : String(v);
      if (s !== '') allEmpty = false;
      return s;
    });
    // 이 줄의 자리표시자가 전부 비었고 라벨만 남았으면('[라벨] ', '- 라벨: ', 빈 줄) 줄을 지운다.
    if (allEmpty && (/^\s*\[[^\]]+\]\s*$/.test(filled) || /^-\s*[^:]+:\s*$/.test(filled) || filled.trim() === '')) return [];
    return [filled];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const OUTLINE_SYSTEM = `너는 3~7세 그림책 작가다. 아래 [정해진 재료]는 이미 결정된 것이므로 바꾸지 말고, 그 재료로 사건이 이어지는 이야기 설계를 JSON으로만 쓴다.
[참고 예시]는 구조·리듬만 참고한다. 예시의 인물·물건·사건·장소를 가져오면 실패다.`;

export const OUTLINE_USER = `[등장인물] {{protagonistName}}: {{protagonistTraits}}, 말버릇 "{{protagonistCatchphrase}}"
{{supportingCharacters}}
[세계관 핵심] {{worldCore}}
[주제] {{topic}}   [가치] {{value}}   [수준] 한글 {{levelKo}}, 영어 {{levelEn}}   [쪽 수] {{pages}} → 비트 {{beatCount}}개

[플롯 패턴] {{patternName}}
{{patternSlots}}
후렴 장치: {{patternRefrainHint}} / 쪽 넘김: {{patternPageTurn}} / 주의: {{patternAvoid}}

[정해진 재료] (반드시 이대로 쓴다)
{{seedBlock}}

[이번에 쓰지 않는 것] 최근 책에서 썼으므로 금지: {{banList}}

{{examples}}

[규칙]
{{rules}}

[이렇게 쓰지 않는다]
{{banExamples}}

[출력] JSON만.
attempt 비트의 failureReason은 설명이 아니라 ID 하나만 적는다: "wrong_place" | "wrong_method" | "interrupted". 그 외 비트는 null.
{
 "plan": {"pattern": "{{patternId}}", "planted": "...", "twistReveal": "...", "funnyMoment": "...", "failureReasons": [...]},
 "titleCandidates": ["...", "...", "..."],
 "logline": "...",
 "want": "...",
 "problem": "...",
 "beats": [{"index": 1, "type": "setup", "summary": "2~3문장", "characters": ["..."], "settingKey": "...", "newElement": "...", "failureReason": null}],
 "refrain": {"text": "...", "usedAtBeats": [2, 4], "variation": "..."},
 "newWordsKo": ["...", "...", "..."],
 "newWordsEn": ["...", "...", "..."],
 "endingType": "{{endingType}}"
}`;

export const DEFAULT_RULES: string[] = [
  '심을 물건은 비트 1~2에 나오고 반전(turn)에서 반드시 다시 쓰인다.',
  '시도(attempt) 비트의 실패 이유는 [정해진 재료]의 순서대로 서로 다르다.',
  '비트마다 새 구체 요소 1개(newElement). 추상어 금지.',
  '후렴은 1개, 최대 3회, 매번 한 단어만 바꾼다(variation에 무엇이 바뀌는지 적는다).',
  '교훈은 말로 하지 않는다. 행동으로만 보여 준다.',
  '주제의 핵심 요소와 주인공 이름이 비트 summary에 직접 나온다.',
  '무서운 장면·벌주기·비교·놀림 금지. 시작과 마무리는 집, 중간은 장소 2곳 이상.',
];

export const DEFAULT_BAN_EXAMPLES: string[] = [
  '✗ 매 비트 같은 꼬리말: "서로 도우며 함께 있으니 마음이 참 따뜻해요."',
  '✗ 사건 없는 비트: "둘이 숲길을 걸어요."',
  '✗ 교훈 서술: "나눔은 좋은 거예요."',
  '✗ 같은 문형 반복: "유하가 ~해요. 유하가 ~해요. 유하가 ~해요."',
];

export function renderNumbered(items: string[]): string {
  return items.map((r, i) => `${i + 1} ${r}`).join('\n');
}

export const BEAT_CANDIDATES_SYSTEM = `너는 3~7세 그림책 작가다. 지금까지 정해진 비트에 이어서, 다음 비트 하나의 후보를 3개 쓴다. 세 후보는 서로 다른 사건이어야 한다. [정해진 재료]는 바꾸지 않는다. JSON으로만.`;

export const BEAT_CANDIDATES_USER = `[등장인물] {{characters}}
[주제] {{topic}}   [패턴] {{patternName}}
[정해진 재료] 심을 물건 {{planted}} / 반전 유형 {{twist}} / 생물 {{creature}} / 웃음 포인트 {{humor}}
[금지] {{banList}}

[지금까지의 비트]
{{chosenBeats}}

[이번에 쓸 비트] {{beatIndex}} · {{beatType}} — {{beatSlot}}
{{extraRule}}

[출력] JSON만.
attempt 비트의 failureReason은 설명이 아니라 ID 하나만 적는다: "wrong_place" | "wrong_method" | "interrupted". 그 외 비트는 null.
{"candidates": [
 {"summary": "2~3문장", "newElement": "...", "failureReason": {{failureReason}}},
 {"summary": "...", "newElement": "...", "failureReason": {{failureReason}}},
 {"summary": "...", "newElement": "...", "failureReason": {{failureReason}}}
]}`;

export const BEAT_JUDGE_SYSTEM = `너는 그림책 편집자다. 다음 비트 후보 3개 중 이야기를 가장 잘 잇는 하나를 고른다. 기준은 아래 순서다. JSON으로만.`;

export const BEAT_JUDGE_USER = `[지금까지의 비트]
{{chosenBeats}}

[이번 비트의 역할] {{beatType}} — {{beatSlot}}

[후보]
A: {{candA}}
B: {{candB}}
C: {{candC}}

[기준, 중요한 순서]
1 앞 비트의 결과가 이 비트의 원인이 되는가(인과)
2 상황이 실제로 바뀌는가(사건성)
3 구체적인가(물건·장소·생물이 보이는가)
4 4세가 웃거나 궁금해할 요소가 있는가
5 앞 비트와 같은 말·같은 장소를 반복하지 않는가

[출력] JSON만. {"best": "A", "scores": {"A": 0, "B": 0, "C": 0}, "why": "15자 이내"}`;

export const PROSE_RICH_SYSTEM = `너는 3~7세 그림책 작가다. 주어진 줄거리 비트와 장면 브리프를 따라 이야기 전문을 쓴다. 지금은 넉넉하게 쓰는 단계다. 길이 제한보다 사건의 짜임, 감각, 대화를 우선한다. 쪽 구분 없이 비트마다 문단 하나로 쓴다.`;

export const PROSE_RICH_USER_KO = `[등장인물] {{characters}}
[줄거리] {{beats}}
[장면 브리프] {{briefs}}
[이번 글의 수준] {{richLevelLabel}} — 문장당 {{richEojeolRange}}어절, 비트당 {{richSentencesRange}}문장

[몸짓 사전 — 감정은 이렇게 보여 준다]
{{gestureHints}}

{{styleSamples}}

[규칙]
1 비트 순서대로, 비트마다 "[비트 n · 유형]" 라벨을 줄 맨 앞에 붙이고 문단을 쓴다.
2 모든 문장에 주어(이름)가 있다. 같은 이름으로 문장을 세 번 연속 시작하지 않는다.
3 비트마다 대화 1개 이상(따옴표), 브리프의 소리·소품·동작을 문장에 넣는다.
4 감정 직설어(무서웠어요·기뻤어요·슬펐어요 등) 금지. 몸짓 사전의 표현이나 비슷한 행동으로 보여 준다.
5 종결어미를 섞는다. 비트마다 감탄·질문·청유 중 1개 이상, 같은 종결어미 3연속 금지.
6 비트 마지막 문장은 다음 비트가 궁금해지게 끝낸다(마무리 비트 제외). 방법을 섞는다: 소리·실패·새로 나타난 것·질문. 질문으로 끝나는 비트는 책 전체에서 2개까지.
7 후렴은 {{refrainText}}를 비트 {{refrainBeats}}에만, 매번 한 단어 변주.
8 교훈·감상 꼬리말 금지. 같은 문장 두 번 금지.

[출력] 글만. 라벨 붙은 문단을 비트 수만큼.`;

export const PROSE_RICH_USER_EN = `[Characters] {{characters}}
[Beats] {{beats}}
[Scene briefs] {{briefs}}
[Level for this draft] {{richLevelLabel}} — {{richWordsRange}} words per sentence, {{richSentencesRange}} sentences per beat

[Show, don't tell]
{{gestureHints}}

{{styleSamples}}

[Rules]
1 Follow the beats in order. Start each paragraph with "[Beat n · type]".
2 Every sentence has a clear subject. Do not start three sentences in a row with the same name.
3 One line of dialogue per beat. Use the brief's sounds, props and pose.
4 No emotion labels (scared, happy, sad). Show them with the gestures above.
5 Mix sentence endings: at least one exclamation or question per beat.
6 End each beat with a line that makes a child want to turn the page (except the last beat). Vary the hook: a sound, a failure, something newly seen, or a question. At most TWO beats in the whole story may end with a question.
7 Use picture-book devices: a repeating frame sentence ({{refrainText}}) at beats {{refrainBeats}}, rhyme or onomatopoeia where natural.
8 Do not translate anything. This is an original English text for the same beats.

[Output] Text only.`;

export const PROSE_SIMPLIFY_SYSTEM = `너는 그림책 편집자다. 아래 글의 사건·반전·후렴은 하나도 빼지 말고, 문장을 어린아이 수준으로 짧게 다시 쓴다. [전체 분량]이 주어지면 그 문장 수를 반드시 지킨다. 넘칠 때는 곁가지 묘사·같은 동작의 반복·덧붙인 대화를 줄이고 비트의 사건은 남긴다.`;

export const PROSE_SIMPLIFY_USER_KO = `[목표 수준] {{targetLevelLabel}} — 문장당 {{targetEojeolRange}}어절, 비트당 {{targetSentencesRange}}문장, 허용 어휘 {{vocabLabel}}
{{lengthBudget}}

[반드시 지킬 것]
- 모든 사건과 반전, 대화 {{dialogueCount}}개 이상, 의성어 {{onomatopoeiaCount}}개 이상을 남긴다.
- 긴 문장은 둘로 자른다. 어려운 말은 쉬운 말로 바꾼다(예: "주변을 살펴보았어요" → "둘러봤어요").
- 모든 문장에 주어(이름). 감정 직설어 금지는 그대로.
- 종결어미 섞기(감탄·질문·청유 비트당 1개)와 비트 끝 궁금증은 유지하되, 질문으로 끝나는 비트는 책 전체에서 2개까지. 나머지는 소리·실패·새로 보인 것으로 끝낸다.
- 비트 라벨 "[비트 n · 유형]"은 그대로 둔다.
- 후렴 {{refrainText}}는 비트 {{refrainBeats}}에만 그대로 둔다.
{{extraFixes}}

[원문]
{{richText}}

[출력] 글만. 라벨 붙은 문단을 같은 수만큼.`;

export const PROSE_SIMPLIFY_USER_EN = `[Target level] {{targetLevelLabel}} — {{targetWordsRange}} words per sentence, {{targetSentencesRange}} sentences per beat, vocabulary: {{vocabLabel}}
{{lengthBudget}}

[Keep]
- Every event, the twist, the repeating frame, at least {{dialogueCount}} dialogue lines, and the onomatopoeia.
- Cut long sentences into two. Replace hard words with simple ones from the vocabulary list.
- Keep the "[Beat n · type]" labels and the repeating frame sentence at beats {{refrainBeats}}.
- Keep one exclamation or question per beat and the page-turn ending lines, but at most TWO beats may end with a question. End the others with a sound, a failure, or something newly seen.
{{decodableRule}}
{{extraFixes}}

[Source]
{{richText}}

[Output] Text only.`;

export const CHILD_CURIOSITY_SYSTEM = `너는 그림책을 읽어 주는 어른이고, 동시에 듣고 있는 4세 아이의 반응을 예측한다. 아이는 글자를 못 읽고 소리로만 듣는다. 아이가 "다음엔?" 하고 묻고 싶어지는지, 아니면 딴 데를 보는지 판단한다. 평가는 짧고 솔직하게, JSON으로만.`;

export const CHILD_CURIOSITY_USER = `[이야기 쪽별 글]
{{pages}}

[판단 기준]
- 2점: 이 쪽을 다 들으면 아이가 바로 다음 쪽을 궁금해한다(소리가 났다, 뭔가 보였다, 질문으로 끝났다, 시도가 실패했다).
- 1점: 넘어가긴 하지만 특별히 궁금하지는 않다.
- 0점: 아이가 딴 데를 본다(설명만 있다, 아무 일도 안 일어난다, 교훈을 말한다, 앞 쪽과 똑같다).
- 마지막 쪽은 '편안하게 끝나는가'로 판단한다(2점 = 조용하고 안전한 마무리).

[출력] JSON만.
overall은 0~10점이다(쪽 점수 평균 × 5).
{"pages": [{"pageNo": 1, "score": 2, "childQuestion": "한마디 또는 null", "why": "10자 이내"}], "dropPages": [], "overall": 0}`;

export const CHILD_RETELL_SYSTEM = `너는 방금 이 이야기를 다 들은 4세 아이다. 어른이 "무슨 이야기였어?" 하고 물었다. 아이답게 세 문장으로만 말한다. 들은 내용에 없는 것은 말하지 않는다. 그 다음, 평가자로 돌아와 아이의 되말하기가 원래 줄거리의 어느 비트를 담았는지 표시한다. JSON으로만.`;

export const CHILD_RETELL_USER = `[이야기 전문]
{{prose}}

[원래 줄거리 비트]
{{beats}}

[출력] JSON만.
{"retell": ["...", "...", "..."], "coveredBeats": [1], "missingCore": [], "confusions": [], "coherence": 0}`;

export const WEEKLY_COACH_SYSTEM = `너는 어린이책 편집장이다. 아래는 보급형 모델이 지난주에 만든 그림책 줄거리들과, 그 모델에게 주고 있는 규칙·금지 예시다. 반복되는 약점을 찾아 (1) 그 약점을 보여 주는 실제 실패 예시 문장, (2) 그것을 막는 규칙 한 줄을 제안한다. 규칙은 7개를 넘길 수 없으므로 새 규칙을 넣으려면 어떤 기존 규칙과 바꿀지 말한다. 추상적 조언은 금지, 모델에게 그대로 붙여 넣을 수 있는 문장만. JSON으로만.`;

export const WEEKLY_COACH_USER = `[현재 규칙 7개]
{{rules}}

[현재 금지 예시 4개]
{{banExamples}}

[지난주 줄거리 {{n}}개 — 각각 비트 요약과 루브릭 점수]
{{outlines}}

[부모가 '어려움'·'다시 만들기'를 누른 책]
{{feedback}}

[출력] JSON만.
{"recurringWeaknesses": [{"pattern": "...", "seenIn": ["bookId"], "evidence": "..."}],
 "proposedBanExamples": [{"text": "✗ ...", "replaces": null}],
 "proposedRules": [{"text": "...", "replaces": null, "why": "..."}],
 "patternNotes": [{"patternId": "...", "note": "..."}],
 "keep": "..."}`;
