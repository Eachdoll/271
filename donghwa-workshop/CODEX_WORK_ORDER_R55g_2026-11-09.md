# Codex 지시서 r55g · 그림이 이야기를 배반하지 않게 — 그림 읽기에 '주인공이 못 보는 것'·'다음 쪽까지 감출 것' · 2026-11-09

`CODEX_R55E_PAID_2026-11-09.md`의 책('쉿, 콩이는 지금 없어')을 읽고 부모님이 "이런 문제가 또 뭐가 생길지 추론하고, 제약을 너무 거는 건 아닌지 다시 추론해서 진행"하라고 하셨습니다. 추론과 결정은 `STORY_PICTURE_RISKS_2026-11-09.md`에 있습니다. 유료 호출은 늘지 않습니다. 이미 산 그림·원고는 다시 만들지 않습니다.

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | 이 지시서와 같은 커밋 (캐시 `donghwa-shell-v122`) |
| 반입 범위 | r55f 지시서 커밋 `b52511b` 이후: `b52511b..HEAD` |
| 바뀐 파일 | `dist/story-generation/writers-room.js`, `dist/story-generation/picture-plan.js`, `dist/full-auto.js`, `dist/sw.js`, `scripts/r54-room-ab.mjs`, `tests/writers-room-r55g.test.mjs`(새), r53·r55c 테스트(required 목록), `CLAUDE.md`, `STORY_PICTURE_RISKS_2026-11-09.md`(새) |

## 무엇이 문제였나
글은 "콩이는 늘 유하 등 뒤에 있고 독자만 안다"였는데, 그림은 5·6·8쪽에서 콩이를 나무 뒤·옆에, 9·10·11쪽에서 둘을 나란히 그렸습니다. 글은 알았고 그림 요청은 몰랐습니다(요청에는 사건 한 문장과 구도만).

## 왜 작가 쪽 규칙이 아니라 그림 쪽인가
작가에게 가는 지시는 이야기의 가능 공간을 좁히므로 최소로 둡니다(부모님 원칙). 일러스트레이터에게 가는 지시는 **이미 쓰인 글을 그림으로 옮기는 정확도**입니다 — 사람 일러스트레이터도 "이 쪽에서 콩이는 유하 등 뒤, 유하는 반대쪽을 본다"는 아트 디렉션을 받습니다. 그래서 규칙을 새로 쓰지 않고 완성된 글에서 읽어 낸 것만 그림 요청에 전달합니다.

## 바뀐 것
1. **그림 읽기 두 칸**(그림책 결 초안만, `extractRequest` → `readingPlanFields`): 쪽마다 `hidden`(≤160자 영어: 글이 누가 무엇을 못 본다·못 알아챈다고 말할 때만 — 무엇, 그 인물 기준으로 프레임의 어디, 그 인물이 보는 방향; 아니면 "")과 `holdBack`(≤120자: 다음 쪽이 드러내는 것이라 이 쪽 그림에 나오면 안 되는 것; 아니면 ""). required 목록에 들어가므로 모델은 늘 답하되 대부분 빈 문자열입니다.
2. **쪽 계획에 실림**(`pagePlanFromReading`): 비어 있지 않을 때만 `page.picturePlan.hidden/holdBack`.
3. **그림 요청**(`picturePlanPictureLine`, COMPOSITION FIRST 줄의 PICTURE PLAN 부분): "HIDDEN FROM THE HERO — the reader sees it, the hero does not: <hidden>; keep it that way (the hero looks away from it, no eye contact with it)" · "NOT YET: <holdBack> is revealed on the next page — keep it out of this picture". 둘 다 비면 요청은 한 글자도 달라지지 않습니다. 모델이 쓴 글이므로 금칙어 검사는 관대 범위(`picturePlanText`).
4. **과잉 적용 감시**: `runRoomPages` → `meta.reading {hidden, holdBack}`(붙은 쪽 수) → FULL AUTO `job.pictureReading` → 러너(`scripts/r54-room-ab.mjs`) compare 행 "그림 읽기 · 주인공이 못 보는 것 / 다음 쪽까지 감출 것". 15쪽 중 열 쪽에 붙으면 질문 문구를 다시 봅니다.

## 넣지 않은 것(추론 문서 4절)
누적 수 세기·되풀이 크기(그림 모델이 못 하는 일을 글로 강제하면 그림이 경직), 소품 시트(비용·설계 — 다음 후보), 작가 쪽 지시(첫 두 쪽의 설정 부족은 독자단 '모른 쪽'이 잡을 자리).

## 바뀌지 않은 것
옛 길·데모·글이 많은 책·표식 없는 책은 바이트 단위로 그대로(R12 핀 12그룹 그대로). 유료 호출 0, 그림 읽기 요청 +약 400자(싼 모델).

## 검증 (이 커밋 기준)
`npm test` 1149/1149 · 품질 85/85 · 미러 동일 · R12 핀 12그룹 그대로 · 읽기 DOM `0e5035cf…` · 센서스 7표 동일·ERRORS []·PAID 0 · 스모크 PASS×2. `tests/writers-room-r55g.test.mjs`(2: 스키마는 그림책 결만·글이 많은 책 없음, 쪽 계획·그림 요청의 두 줄·없는 쪽은 변화 없음).

## Codex가 할 일
1. `b52511b..HEAD` 반입·배포. 캐시 `donghwa-shell-v122` 확인.
2. 다음 그림 포함 실측은 **부모님이 다시 승인하신 뒤에만**(그림 약 $3.6 + 글 약 $0.6). 그때 잴 것: (a) `hidden`이 붙은 쪽 수(`job.pictureReading`, 러너 행)와 그 쪽 그림에서 주인공이 숨은 것을 보지 못하는 구도인지(육안), (b) `holdBack` 쪽 그림에 다음 쪽의 반전이 보이는지, (c) 비밀이 없는 이야기에서 `hidden`이 지어낸 쪽이 있는지, (d) R55f의 넷(동물 얼굴, 명단 밖 인물 쪽 수, 카메라 종류 수, 숲 쪽의 숲 참조).
3. 키·초대 코드는 어디에도 적지 않습니다.
