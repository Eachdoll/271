# K1 · r31b 프롬프트 다이어트 · 유하랑 해니랑 까꿍 버스

- 요청: "4살 유하가 스쿨버스를 타고 해니를 만나 장난치며 유치원에 가는 이야기" · 12쪽 · K1/E0 · 재료 계획 auto
- 정책: promptDiet, k1Policy, orchestrationPolicy, topicEndingPolicy
- 상태: text-review · 205초
- 실제 글 요금(토큰 실측 × 단가표): $0.135 · 요청 9회 · 입력 18,738 / 출력 10,498 토큰 · 추정 $0.646
- 모델: gpt-6.1-sol

| 단계 | 요청 | 입력 | 출력 | 요금 |
| --- | --- | --- | --- | --- |
| materials | 1 | 2,721 | 839 | $0.014 |
| outline | 2 | 6,103 | 3,193 | $0.044 |
| sceneBriefs | 1 | 3,345 | 2,592 | $0.033 |
| prose | 2 | 4,421 | 3,454 | $0.043 |
| pagination | 3 | 2,148 | 420 | $0.002 |

## 줄거리

- 로그라인: 4살 유하가 스쿨버스에서 해니를 만나, 수줍은 인사 대신 까꿍 장난을 나누며 함께 유치원에 들어간다.
- 바람: 유하는 해니와 함께 장난치며 유치원에 가고 싶다.
- 걸림돌: 해니를 만나니 조금 수줍어서 인사 소리가 작아진다.
- 전환: 해니가 먼저 까꿍을 하자 유하도 웃으며 장난을 시작한다.
1. (setup, home) 4살 유하가 집에서 가방을 멘다. 엄마가 가방끈을 펴 주고, 유하는 노란 대문으로 걸어간다.
2. (want, background-fdd132ae-78b3-4bd6-99b0-114bc3c86f52) 유하가 노란 스쿨버스에 올라 해니를 만나 눈을 반짝인다. 버스 기사님이 반갑게 손을 들고, 유하는 해니 옆자리를 가리킨다.
3. (attempt, background-fdd132ae-78b3-4bd6-99b0-114bc3c86f52) 유하와 해니가 나란히 앉고, 버스 기사님이 안전띠를 확인한다. 유하는 해니에게 인사하려고 입을 열지만 작은 소리만 나온다.
4. (attempt, background-fdd132ae-78b3-4bd6-99b0-114bc3c86f52) 버스가 출발하고, 유하는 무릎 위에서 손을 작게 흔든다. 해니가 몸을 살짝 돌려 눈을 맞추자 유하는 웃으며 두 손을 볼에 댄다.
5. (turn, background-fdd132ae-78b3-4bd6-99b0-114bc3c86f52) 해니가 손으로 얼굴을 가렸다가 활짝 펼친다. 유하도 얼굴을 가렸다 보이며 까꿍 장난을 시작한다.
6. (resolution, background-2aea6383-5625-47b3-bafd-3938917ffa9f) 유하와 해니가 안전띠를 맨 채 번갈아 얼굴을 내밀고 웃는다. 버스가 유치원 앞마당에 멈추고, 기사님이 문을 열어 두 친구를 배웅한다.
7. (close, background-2aea6383-5625-47b3-bafd-3938917ffa9f) 버스에서 내린 유하와 해니가 작은 꽃밭 옆을 나란히 걷는다. 두 친구가 매트에 신발을 톡톡 털고 함께 유치원 문 안으로 들어간다.

## 원고

| 쪽 | 한글 | 영어 |
| --- | --- | --- |
| 1 | 오늘도 가방을 메요. 해니에게 무슨 말을 할까요? | Yuha is all set to go. What can he say to Haeni? |
| 2 | 유하가 작게 말해요. “해니야, 같이 가자!” | Yuha says, “Come on, Haeni!” Here we go together. |
| 3 | 버스에 해니가 있어요. 연습한 말이 쏙 들어가요. | Yuha sees Haeni on the bus. His hello is very small. |
| 4 | 유하가 옆자리를 콕 가리켜요. “나도 여기 앉을래.” | Yuha says, “Can I sit here?” Haeni pats the seat for him. |
| 5 | 딸깍! 기사님이 안전띠를 살펴봐요. 이제 나란히 갈 수 있어요. | The driver checks both seat belts. The two sit side by side. |
| 6 | 유하가 입을 조금 열어요. “안녕.” 인사가 아주 작게 나와요. | Yuha says a little hello. Can Haeni hear his little hello? |
| 7 | 부릉부릉! 해니가 유하의 눈을 봐요. 유하의 작은 인사가 닿아요. | Haeni sees his little wave. Here we go together. |
| 8 | 해니가 얼굴을 꼭 가려요. 해니는 어디 갔을까요? | Haeni puts her hands up. Where is her little face? |
| 9 | 해니가 두 손을 펼쳐요. “까꿍!” 유하도 해 보고 싶어요. | Haeni says, “Peekaboo, here I am!” Yuha can do it too. |
| 10 | 이번에는 유하가 얼굴을 내밀어요. “까꿍!” 까르륵, 웃음이 함께 나와요. | Yuha says, “Peekaboo, here I am!” Haeni has a big laugh. |
| 11 | 버스가 유치원에 멈춰요. 기사님이 문을 활짝 열어요. 까꿍 놀이는 벌써 끝일까요? | The driver opens the bus door. Is it time for one more? |
| 12 | 톡톡, 신발을 털어요. 유하가 한 손으로 눈을 가려요. “해니야, 까꿍!” | Yuha says, “Peekaboo, here I am!” Here we go together. |

## 실측 (검사기)

| 쪽 | 문장 | 리듬 | 어절 | 평균 어절 | 최장 | 대사 문장 | ! | 소리말 | 한글 검사 | 영어 검사 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | 0 | 7 | 3.5 | 4 | 0 | 0 | - | 통과 | 통과 |
| 2 | 2 | 0 | 6 | 3 | 3 | 1 | 1 | - | 통과 | 통과 |
| 3 | 2 | 0 | 7 | 3.5 | 4 | 0 | 0 | - | 통과 | 통과 |
| 4 | 2 | 0 | 7 | 3.5 | 4 | 1 | 0 | - | 통과 | 통과 |
| 5 | 3 | 1 | 9 | 4 | 5 | 0 | 1 | - | 통과 | 통과 |
| 6 | 3 | 1 | 9 | 4 | 4 | 1 | 0 | - | 통과 | 통과 |
| 7 | 3 | 1 | 9 | 4 | 4 | 0 | 1 | 부릉부릉 | 통과 | 통과 |
| 8 | 2 | 0 | 7 | 3.5 | 4 | 0 | 0 | - | 통과 | 통과 |
| 9 | 3 | 1 | 9 | 4 | 4 | 1 | 1 | - | 통과 | 통과 |
| 10 | 3 | 1 | 9 | 4 | 4 | 1 | 1 | - | 통과 | 통과 |
| 11 | 3 | 0 | 11 | 3.7 | 4 | 0 | 0 | - | 통과 | 통과 |
| 12 | 3 | 1 | 10 | 4 | 5 | 1 | 1 | - | 통과 | 통과 |

책 전체: 12쪽 · 문장 31(리듬 6) · 어절 100 · 보통 문장 평균 3.7어절 · 최장 5 · 대사 문장 6 · 느낌표 6 · 반복형 소리말 1종/1쪽 (부릉부릉) · 영어 130단어 · 검사 걸린 쪽 한글 0 / 영어 0

## 작가 원문 (수정 전 · 바뀐 쪽 없음)

| 쪽 | 한글 | 영어 |
| --- | --- | --- |
| 1 | 오늘도 가방을 메요. 해니에게 무슨 말을 할까요? | Yuha is all set to go. What can he say to Haeni? |
| 2 | 유하가 작게 말해요. “해니야, 같이 가자!” | Yuha says, “Come on, Haeni!” Here we go together. |
| 3 | 버스에 해니가 있어요. 연습한 말이 쏙 들어가요. | Yuha sees Haeni on the bus. His hello is very small. |
| 4 | 유하가 옆자리를 콕 가리켜요. “나도 여기 앉을래.” | Yuha says, “Can I sit here?” Haeni pats the seat for him. |
| 5 | 딸깍! 기사님이 안전띠를 살펴봐요. 이제 나란히 갈 수 있어요. | The driver checks both seat belts. The two sit side by side. |
| 6 | 유하가 입을 조금 열어요. “안녕.” 인사가 아주 작게 나와요. | Yuha says a little hello. Can Haeni hear his little hello? |
| 7 | 부릉부릉! 해니가 유하의 눈을 봐요. 유하의 작은 인사가 닿아요. | Haeni sees his little wave. Here we go together. |
| 8 | 해니가 얼굴을 꼭 가려요. 해니는 어디 갔을까요? | Haeni puts her hands up. Where is her little face? |
| 9 | 해니가 두 손을 펼쳐요. “까꿍!” 유하도 해 보고 싶어요. | Haeni says, “Peekaboo, here I am!” Yuha can do it too. |
| 10 | 이번에는 유하가 얼굴을 내밀어요. “까꿍!” 까르륵, 웃음이 함께 나와요. | Yuha says, “Peekaboo, here I am!” Haeni has a big laugh. |
| 11 | 버스가 유치원에 멈춰요. 기사님이 문을 활짝 열어요. 까꿍 놀이는 벌써 끝일까요? | The driver opens the bus door. Is it time for one more? |
| 12 | 톡톡, 신발을 털어요. 유하가 한 손으로 눈을 가려요. “해니야, 까꿍!” | Yuha says, “Peekaboo, here I am!” Here we go together. |

## 수정 기록 (쪽 나누기 단계의 검사 결과마다)

- 요청 0회까지 · 걸린 쪽 [] · 위반 없음 · 참고 8

## 진행

- 주제에 맞는 등장인물·배경 고르기
- 이야기 글을 생성하고 있어요.
- 이야기 생성 응답을 받았어요.
- 줄거리 만들기
- 이야기 글을 생성하고 있어요.
- 이야기 생성 응답을 받았어요.
- 주제·등장인물·장소를 맞춰 줄거리를 다시 만들고 있어요 (1/2).
- 이야기 글을 생성하고 있어요.
- 이야기 생성 응답을 받았어요.
- 장면 디테일 만들기
- 이야기 글을 생성하고 있어요.
- 이야기 생성 응답을 받았어요.
- 한글·영어 전문 쓰기
- 그림책 작가가 쪽마다 글과 그림을 한 번에 쓰고 있어요.
- 쪽 나누기와 본문 검사
- 쪽별 호기심과 조용한 마무리를 살펴보고 있어요.
- 아이의 세 문장 되말하기로 이야기 연결을 살펴보고 있어요.
- 글 완성 · 쪽 검수
