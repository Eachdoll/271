# Codex 지시서 r56a · R56 실측 후속 둘 — 그림 메모에 '그림은 글자를 못 담는다', 숨김 지시를 이어지는 비밀까지 · 2026-11-09

R56 글만 실측(`QA/r56-room-ab/REPORT_2026-11-09.md`, Anthropic 1회 $1.10)에서 나온 문제 가운데 부모님이 "두 가지는 진행"하라고 하신 것입니다. 유료 호출은 늘지 않습니다.

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | 이 지시서와 같은 커밋 (캐시 `donghwa-shell-v125`) |
| 반입 범위 | r56 지시서 커밋 `69cec2a` 이후: `69cec2a..HEAD` (r55h·r56을 아직 반입하지 않았다면 `2307268..HEAD`로 한 번에) |
| 바뀐 파일 | `dist/story-generation/writers-room.js`, `dist/story-generation/picture-plan.js`, `dist/sw.js`, `scripts/r54-room-ab.mjs`(저장 JSON에 실측 세 항목), r55g·r55h·r56 테스트, `QA/r56-room-ab/*`(실측 원문·보고서), `CLAUDE.md` |

## 바뀐 것
1. **그림은 글자를 못 담는다**: 실측 초고가 숨 참기 세기를 7쪽의 그림 귀퉁이에 숫자 글자로 실었습니다(그림 요청은 글자 금지). 작가에게 그림 메모를 안내하는 세 곳(초고·흐름·고쳐쓰기)에 "그림에는 글자와 숫자를 넣을 수 없어요 — 세는 것은 물건의 개수나 몸짓으로 보여요."를, 그림 읽기에는 "A picture cannot hold letters or numerals: … give countable things or a gesture instead and never write "labeled"."를 넣었습니다.
2. **이어지는 비밀**: 실측에서 콩콩이가 유하 등 뒤에 있는 여덟 쪽 중 숨김 지시가 2쪽뿐이었습니다. 읽기 질문이 "앞 쪽에서 숨겨졌고 아직 드러나지 않은 것도, 이 쪽 글이 다시 말하지 않아도" 포함하도록 넓혔고, 누가 못 보는지를 적게 했습니다. 그림 요청의 고정 문구 "HIDDEN FROM THE HERO … the hero"는 "UNSEEN IN THE STORY … the character named here"로 바꿨습니다(R55g 검토 2·3번).

## 바꾸지 않은 것
`holdBack`의 "다음 쪽" 한정(R55g 검토 4번), 독자단 되돌아옴 가산, 복선 점검, 펼침 표시 — 책을 더 본 뒤 판단. 등장인물·배경의 수는 부모님과 방향을 논의 중입니다.

## 검증 (이 커밋 기준)
`npm test` 1163/1163 · 품질 85/85 · 미러 동일 · R12 핀 12그룹 그대로 · 읽기 DOM `0e5035cf…` · 센서스 7표 동일·ERRORS []·PAID 0 · 스모크 PASS×2.

## Codex가 할 일
1. 반입·배포. 캐시 `donghwa-shell-v125` 확인.
2. 다음 유료 실측은 **부모님이 다시 승인하신 뒤에만**. 그때 잴 것: 그림 메모·그림 설명에 글자·숫자를 그려 넣으라는 말이 남았는지(`scene.action`에서 "label"·따옴표 숫자 검색), 숨김이 이어지는 쪽마다 `picturePlan.hidden`이 붙었는지와 비밀이 없는 책에서 지어내지 않는지, 그림까지 만들면 그 쪽 그림의 구도.
3. 키·초대 코드는 어디에도 적지 않습니다.
