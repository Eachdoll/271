# Codex 지시서 r58 · 물건에 적힌 글자 — 로켓의 "APOLLO 13"은 되고, 자막·귀퉁이 숫자는 안 되게 · 2026-11-10

부모님: "이 제한 때문에 아폴로 13호 로켓에 글자를 못 적는 거 아냐?" → 맞았습니다. 그림 요청은 처음부터 그림 속 낱말을 금지했고 R56a는 그것을 작가에게 알렸을 뿐입니다. 설명 글자와 물건에 원래 적힌 글자가 한데 묶여 있던 것을 나눴습니다. 부모님 결정: **숫자와 영문만**.

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | 이 지시서와 같은 커밋 (캐시 `donghwa-shell-v127`) |
| 반입 범위 | r57 지시서 커밋 `8447160` 이후: `8447160..HEAD` (r55h~r57을 아직 반입하지 않았다면 `2307268..HEAD`로 한 번에) |
| 바뀐 파일 | `dist/story-generation/picture-plan.js`, `dist/story-generation/writers-room.js`, `dist/image-generation/scene-prompt.js`, `dist/sw.js`, `scripts/r54-room-ab.mjs`, `tests/picture-lettering-r58.test.mjs`(새), r53·r55c·r55h·r56 테스트, `CLAUDE.md` |

## 바뀐 것
1. **작가 안내**(흐름·초고·고쳐쓰기): 설명하는 글자나 숫자(자막, 귀퉁이의 표시)는 넣을 수 없고, 물건에 원래 적힌 짧은 글자(로켓의 이름, 버스 번호, 간판)는 한 그림에 하나까지 — 숫자와 영문 대문자만, 그림 메모에 따옴표로.
2. **그림 읽기**: 쪽마다 `lettering`(정확한 글자, 12자까지)과 `letteringOn`(어느 물건의 어디). 한국어 이름은 번호나 영문 대문자로 적게 합니다(아폴로 13호 → APOLLO 13).
3. **앱의 거름**: 대문자·숫자·공백·하이픈만 남기고, 12자를 넘으면 자르지 않고 버립니다. 한글만이면 글자 없음. 글자와 물건이 둘 다 있을 때만 쪽 계획에 실립니다.
4. **그림 요청**: 그 쪽에만 `LETTERING — the only writing in this picture: "APOLLO 13" on the side of the rocket, in plain block capitals, spelled exactly as given; no other letters or numbers anywhere`가 붙고, 금지 문장이 "… other than the one piece of lettering named in the picture plan."이 됩니다. 글자가 없는 쪽·표지·예전 책의 요청은 한 글자도 바뀌지 않습니다.

## 검증 (이 커밋 기준)
`npm test` 1175/1175 · 품질 85/85 · 미러 동일 · R12 핀 12그룹 그대로 · 읽기 DOM `0e5035cf…` · 센서스 7표 동일·ERRORS []·PAID 0 · 스모크 PASS×2.

## Codex가 할 일
1. 반입·배포. 캐시 `donghwa-shell-v127` 확인.
2. 다음 그림 포함 실측은 **부모님이 다시 승인하신 뒤에만**. 그때 잴 것: 글자가 붙은 쪽 수(러너 "그림 읽기" 행의 셋째 값), 그 쪽 그림의 글자가 철자대로인지와 다른 글자가 끼어들었는지, 같은 물건이 여러 쪽에 나올 때 글자가 같은지, 글자가 없는 쪽에 글자가 생기지 않았는지.
3. 키·초대 코드는 어디에도 적지 않습니다.
