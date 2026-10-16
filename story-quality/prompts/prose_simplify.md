# prose_simplify — 2패스: 목표 수준으로 줄이기 (사건은 지키고 문장만 짧게)

입력은 `prose_rich` 결과. 출력은 목표 수준(K1/E0 등)의 전문. 비트 라벨은 유지한다.

## system

```
너는 그림책 편집자다. 아래 글의 사건·대화·감각·반전은 하나도 빼지 말고, 문장만 어린아이 수준으로 짧게 다시 쓴다. 문장을 자르고 쉬운 말로 바꾸는 것이지 내용을 줄이는 것이 아니다.
```

## user (한글)

```
[목표 수준] {{targetLevelLabel}} — 문장당 {{targetEojeolRange}}어절, 비트당 {{targetSentencesRange}}문장, 허용 어휘 {{vocabGradeLabel}}

[반드시 지킬 것]
- 모든 사건과 반전, 대화 {{dialogueCount}}개 이상, 의성어 {{onomatopoeiaCount}}개 이상을 남긴다.
- 긴 문장은 둘로 자른다. 어려운 말은 쉬운 말로 바꾼다(예: "주변을 살펴보았어요" → "둘러봤어요").
- 모든 문장에 주어(이름). 감정 직설어 금지는 그대로.
- 종결어미 섞기(감탄·질문·청유 비트당 1개)와 비트 끝 궁금증은 유지한다.
- 비트 라벨 "[비트 n · 유형]"은 그대로 둔다.
- 후렴 {{refrain_text}}는 비트 {{refrain_beats}}에만 그대로 둔다.

[원문]
{{rich_text}}

[출력] 글만. 라벨 붙은 문단을 같은 수만큼.
```

## user (영어)

```
[Target level] {{targetLevelLabelEn}} — {{targetWordsRange}} words per sentence, {{targetSentencesRange}} sentences per beat, vocabulary: {{vocabListLabel}}

[Keep]
- Every event, the twist, all dialogue lines, and the onomatopoeia.
- Cut long sentences into two. Replace hard words with simple ones from the vocabulary list.
- Keep the "[Beat n · type]" labels and the repeating frame sentence at beats {{refrain_beats}}.
- Keep one exclamation or question per beat and the page-turn ending lines.
{{decodable_rule}}

[Source]
{{rich_text_en}}

[Output] Text only.
```

## 채우기 규칙 (코드)

- `{{decodable_rule}}`: E1일 때만 "- Prefer CVC words (cat, sun, big) and the sight-word list." 추가. 그 외 빈 줄.
- `dialogueCount`, `onomatopoeiaCount`는 rich 텍스트에서 세어 넣는다(따옴표 쌍 수, 의성어 사전 매칭 수). 최소 2.
- 온도 0.4, maxTokens 1,800.
- 결과는 지시서 1의 `levelCheck`와 지시서 3의 `richnessCheck`를 통과해야 한다. 실패 시 실패 항목만 지시문에 추가해 1회 재실행.
