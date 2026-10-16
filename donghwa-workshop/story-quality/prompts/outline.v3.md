# outline.v3 — 줄거리 생성 (보급형 모델용, 조합형 재료 + 승인 예시 + 금지 목록)

`{{...}}` 자리는 코드가 채운다. 시스템+사용자 합계 1,800토큰 이내를 목표로 하고, 예시(`{{examples}}`)가 길면 예시를 먼저 줄인다.

## system

```
너는 3~7세 그림책 작가다. 아래 [정해진 재료]는 이미 결정된 것이므로 바꾸지 말고, 그 재료로 사건이 이어지는 이야기 설계를 JSON으로만 쓴다.
[참고 예시]는 구조·리듬만 참고한다. 예시의 인물·물건·사건·장소를 가져오면 실패다.
```

## user

```
[등장인물] {{protagonist.name}}: {{protagonist.traits}}, 말버릇 "{{protagonist.catchphrase}}"
{{supporting_characters}}
[세계관 핵심] {{world_core_3_lines}}
[주제] {{topic}}   [가치] {{value_or_none}}   [수준] 한글 {{levelKo}}, 영어 {{levelEn}}   [쪽 수] {{pages}} → 비트 {{beatCount}}개

[플롯 패턴] {{pattern.name}}
{{pattern.slots}}
후렴 장치: {{pattern.refrainHint}} / 쪽 넘김: {{pattern.pageTurn}} / 주의: {{pattern.avoid}}

[정해진 재료] (반드시 이대로 쓴다)
- 심을 물건: {{seed.planted.ko}} — 비트 1~2에 자연스럽게 등장시키고 반전에서 회수한다
- 반전 유형: {{seed.twist.ko}} ({{seed.twist.hint}})
- 장애물·장소 순서: {{seed.obstaclesOrPlaces}}
- 시도별 실패 이유: {{seed.failureReasons}}
- 배경 생물: {{seed.creature.ko}} (한 번 이상 등장)
- 웃음 포인트: {{seed.humor.ko}}
- 세부 장소 후보: {{seed.subLocations}}

[이번에 쓰지 않는 것] 최근 책에서 썼으므로 금지: {{banList}}

{{examples}}

[규칙]
1 심을 물건은 비트 1~2에 나오고 반전(turn)에서 반드시 다시 쓰인다.
2 시도(attempt) 비트의 실패 이유는 [정해진 재료]의 순서대로 서로 다르다.
3 비트마다 새 구체 요소 1개(newElement). 추상어 금지.
4 후렴은 1개, 최대 3회, 매번 한 단어만 바꾼다(variation에 무엇이 바뀌는지 적는다).
5 교훈은 말로 하지 않는다. 행동으로만 보여 준다.
6 주제 "{{topic}}"의 핵심 요소와 "{{protagonist.name}}" 이름이 비트 summary에 직접 나온다.
7 무서운 장면·벌주기·비교·놀림 금지. 시작과 마무리는 집, 중간은 장소 2곳 이상.

[이렇게 쓰지 않는다]
✗ 매 비트 같은 꼬리말: "서로 도우며 함께 있으니 마음이 참 따뜻해요."
✗ 사건 없는 비트: "둘이 숲길을 걸어요."
✗ 교훈 서술: "나눔은 좋은 거예요."
✗ 같은 문형 반복: "{{protagonist.name}}가 ~해요. {{protagonist.name}}가 ~해요."

[출력] JSON만.
{
 "plan": {"pattern": "{{pattern.id}}", "planted": "...", "twistReveal": "...", "funnyMoment": "...", "failureReasons": [...]},
 "titleCandidates": ["...", "...", "..."],
 "logline": "...",
 "want": "...",
 "problem": "...",
 "beats": [{"index": 1, "type": "setup", "summary": "2~3문장", "characters": ["..."], "settingKey": "...", "newElement": "...", "failureReason": null}, ...],
 "refrain": {"text": "...", "usedAtBeats": [n, n], "variation": "..."},
 "newWordsKo": ["...", "...", "..."],
 "newWordsEn": ["...", "...", "..."],
 "endingType": "{{endingType}}"
}
```

## 채우기 규칙 (코드)

- `{{pattern.slots}}`: 패턴 카드의 beats를 `1 setup — 슬롯 문장` 형식으로 한 줄씩.
- `{{seed.*}}`: `composeSeed()` 결과. `obstaclesOrPlaces`는 패턴에 따라 장애물(여정형) 또는 장소(찾기형) 목록을 `1) … 2) … 3) …`로.
- `{{banList}}`: `renderBanListForPrompt()`. 비어 있으면 줄 전체를 지운다.
- `{{examples}}`: `renderExamplesForPrompt()`. 승인 줄거리가 없으면 빈 문자열. 있으면 아래 형식.

```
[참고 예시 — 구조·리듬만 참고. 인물·물건·사건·장소 재사용 금지]
예시 1 (주제: …, 패턴: …)
 plan: 심은 물건 … / 반전 …
 비트: 1 … · 2 … · 3 … (각 비트 한 줄 요약)
예시 2 …
```

- 온도 0.85, maxTokens 1,800. JSON 파싱 실패 시 "JSON만 다시 출력" 1회 재시도.
