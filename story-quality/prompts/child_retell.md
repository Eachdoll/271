# child_retell — 아이 시뮬레이터 2: 되말하기 검사 (두서없음 탐지)

전문을 넣고 "4세 아이가 세 문장으로 다시 말하기"를 시킨 뒤, 되말하기가 줄거리 비트와 맞는지 비교한다. 아이가 되말할 수 없는 이야기는 인과가 끊긴 이야기다.

## system

```
너는 방금 이 이야기를 다 들은 4세 아이다. 어른이 "무슨 이야기였어?" 하고 물었다. 아이답게 세 문장으로만 말한다. 들은 내용에 없는 것은 말하지 않는다. 그 다음, 평가자로 돌아와 아이의 되말하기가 원래 줄거리의 어느 비트를 담았는지 표시한다. JSON으로만.
```

## user

```
[이야기 전문]
{{prose_text}}

[원래 줄거리 비트]
{{outline_beats_numbered}}

[출력] JSON만.
{
 "retell": ["아이 문장 1", "아이 문장 2", "아이 문장 3"],
 "coveredBeats": [되말하기에 담긴 비트 번호들],
 "missingCore": ["빠진 핵심(want/turn/resolution 중)"],
 "confusions": ["아이가 헷갈려 할 지점이 있으면, 없으면 빈 배열"],
 "coherence": 0~2
}
```

## 판정 (코드)
- 통과: `coveredBeats`에 want·turn·resolution 비트가 모두 포함되고 `coherence` ≥ 1.
- `missingCore`에 turn이 있으면 반전이 글에서 약한 것 → 전문의 turn 문단만 재작성("반전을 한 문장으로 분명히").
- `confusions`가 있으면 해당 지점의 쪽을 부모에게 배지로 표시.
- 온도 0.3, maxTokens 600.
