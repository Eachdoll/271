# beat_judge — 비트 단위 탐색(빔 서치)용 후보 생성·심사 프롬프트

줄거리를 한 번에 뽑지 않고, 비트마다 후보 3개를 만들고 하나를 고르며 나아간다. 작은 모델은 "7비트 전체를 일관되게"보다 "지금 비트 하나를 앞 비트에 이어서"를 훨씬 잘한다.

## 1) 후보 생성 — system

```
너는 3~7세 그림책 작가다. 지금까지 정해진 비트에 이어서, 다음 비트 하나의 후보를 3개 쓴다. 세 후보는 서로 다른 사건이어야 한다. [정해진 재료]는 바꾸지 않는다. JSON으로만.
```

## 1) 후보 생성 — user

```
[등장인물] {{characters_compact}}
[주제] {{topic}}   [패턴] {{pattern.name}}
[정해진 재료] 심을 물건 {{seed.planted.ko}} / 반전 유형 {{seed.twist.ko}} / 생물 {{seed.creature.ko}} / 웃음 포인트 {{seed.humor.ko}}
[금지] {{banList}}

[지금까지의 비트]
{{chosen_beats_numbered}}

[이번에 쓸 비트] {{nextBeat.index}} · {{nextBeat.type}} — {{nextBeat.slot}}
{{nextBeat.extraRule}}

[출력] JSON만.
{"candidates": [
 {"summary": "2~3문장", "newElement": "...", "failureReason": {{failureReasonOrNull}}},
 {"summary": "...", "newElement": "...", "failureReason": ...},
 {"summary": "...", "newElement": "...", "failureReason": ...}
]}
```

`{{nextBeat.extraRule}}` (코드가 유형별로 넣는다)
- setup: "심을 물건 {{seed.planted.ko}}이(가) 자연스럽게 등장한다."
- attempt: "실패 이유는 반드시 '{{thisFailureReason.ko}}'. 작고 우스운 실패."
- turn: "반전 유형 '{{seed.twist.ko}}'대로, 심은 물건 {{seed.planted.ko}}이(가) 다시 쓰인다."
- close: "집 또는 잠. 심은 물건을 침대 옆에 둔다. 교훈을 말하지 않는다."

## 2) 심사 — system

```
너는 그림책 편집자다. 다음 비트 후보 3개 중 이야기를 가장 잘 잇는 하나를 고른다. 기준은 아래 순서다. JSON으로만.
```

## 2) 심사 — user

```
[지금까지의 비트]
{{chosen_beats_numbered}}

[이번 비트의 역할] {{nextBeat.type}} — {{nextBeat.slot}}

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

[출력] JSON만. {"best": "A"|"B"|"C", "scores": {"A": 0~10, "B": 0~10, "C": 0~10}, "why": "15자 이내"}
```

## 설정
- 후보 생성 온도 0.9, maxTokens 600. 심사 온도 0.2, maxTokens 200.
- 비트 7개 × (생성 1 + 심사 1) = 14회 호출. 모두 짧아서 전문 1회보다 싸다. 부모 설정 `비트 탐색` 토글(기본 OFF, 보급형 모델로 줄거리를 만들 때 ON 권장).
