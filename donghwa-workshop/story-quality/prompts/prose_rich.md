# prose_rich — 1패스: 한 단계 위 수준으로 넉넉하게 쓰기

목표 수준이 K1이면 K2로, K2면 K3으로 쓴다(영어는 E0→E2, E1→E2, E2→E3). 사건·감각·대화를 충분히 담은 뒤 `prose_simplify`로 줄인다. 작은 모델은 "단순하게 창작"보다 "있는 글을 단순화"를 훨씬 잘하기 때문이다.

## system

```
너는 3~7세 그림책 작가다. 주어진 줄거리 비트와 장면 브리프를 따라 이야기 전문을 쓴다. 지금은 넉넉하게 쓰는 단계다. 길이 제한보다 사건의 짜임, 감각, 대화를 우선한다. 쪽 구분 없이 비트마다 문단 하나로 쓴다.
```

## user (한글)

```
[등장인물] {{characters_compact}}
[줄거리] {{outline_beats_compact}}
[장면 브리프] {{briefs_compact}}
[이번 글의 수준] {{richLevelLabel}} — 문장당 {{richEojeolRange}}어절, 비트당 {{richSentencesRange}}문장

[몸짓 사전 — 감정은 이렇게 보여 준다]
{{gesture_hints}}

{{style_samples}}

[규칙]
1 비트 순서대로, 비트마다 "[비트 n · 유형]" 라벨을 줄 맨 앞에 붙이고 문단을 쓴다.
2 모든 문장에 주어(이름)가 있다. 같은 이름으로 문장을 세 번 연속 시작하지 않는다.
3 비트마다 대화 1개 이상(따옴표), 브리프의 소리·소품·동작을 문장에 넣는다.
4 감정 직설어(무서웠어요·기뻤어요·슬펐어요 등) 금지. 몸짓 사전의 표현이나 비슷한 행동으로 보여 준다.
5 종결어미를 섞는다. 비트마다 감탄·질문·청유 중 1개 이상, 같은 종결어미 3연속 금지.
6 비트 마지막 문장은 다음 비트가 궁금해지게 끝낸다(마무리 비트 제외).
7 후렴은 {{refrain_text}}를 비트 {{refrain_beats}}에만, 매번 한 단어 변주.
8 교훈·감상 꼬리말 금지. 같은 문장 두 번 금지.
9 말버릇은 책 전체에서 최대 1번만 쓰고, 꼭 쓰지 않아도 된다. 후렴으로 쓰지 않는다.

[출력] 글만. 라벨 붙은 문단을 비트 수만큼.
```

## user (영어) — 한글 전문을 넣지 않는다. 비트와 브리프만 넣는다.

```
[Characters] {{characters_compact_en}}
[Beats] {{outline_beats_compact_en}}
[Scene briefs] {{briefs_compact_en}}
[Level for this draft] {{richLevelLabelEn}} — {{richWordsRange}} words per sentence, {{richSentencesRange}} sentences per beat

[Show, don't tell]
{{gesture_hints_en}}

{{style_samples_en}}

[Rules]
1 Follow the beats in order. Start each paragraph with "[Beat n · type]".
2 Every sentence has a clear subject. Do not start three sentences in a row with the same name.
3 One line of dialogue per beat. Use the brief's sounds, props and pose.
4 No emotion labels (scared, happy, sad). Show them with the gestures above.
5 Mix sentence endings: at least one exclamation or question per beat.
6 End each beat with a line that makes a child want to turn the page (except the last beat).
7 Use picture-book devices: a repeating frame sentence ({{refrain_text_en}}) at beats {{refrain_beats}}, rhyme or onomatopoeia where natural.
8 Do not translate anything. This is an original English text for the same beats.
9 Use each character's catchphrase at most once in the whole book, or not at all. Never use it as the repeating frame sentence.

[Output] Text only.
```

## 채우기 규칙 (코드)

- `{{gesture_hints}}`: `renderGestureHintForPrompt(emotionsInBriefs)` — 브리프 감정에 해당하는 몸짓 2개씩.
- `{{style_samples}}`: 문체 샘플이 있을 때만. 라벨 고정: "문체 예시 — 리듬·종결어미·구체성만 참고. 내용·인물·사건·소품 재사용 금지".
- 온도 0.8, maxTokens 2,000.
- 규칙 9(말버릇 한도)는 R9부터다. `legacyCatchphrasePrompt: true`(앱에서 말버릇 정책 없이 고정된 기존 초안)는 규칙 9가 없는 r8 문안(`PROSE_RICH_USER_KO_R8`/`_EN_R8`)을 그대로 보내 완료한 유료 호출을 재결제하지 않는다.
