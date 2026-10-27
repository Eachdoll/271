# Codex 지시서 r39 · 이야기의 드라마 (시도 종류 · 비밀 · 조연의 몫 · 단색/글만 쪽 · 표지 인물) · 2026-10-27

## 배경

부모님이 R38로 만든 그림책 결 K2 16쪽 책(우산)을 보고(원문): "전반적으로 좋아졌는데 스토리가 너무 단조로워 더 창의적이고 스토리가 있는 크리스호튼스타일이 되는 개선안 제안해줘 주인공 누끼로 독백을 한다던지 빈화면에 생각이 나온다던가 그림이랑 스토리랑 전반적인 강화안, 그리고 표지엔 왜 공룡이 나오지?" → "1·2차 다 구현해".

원인은 네 곳이었습니다. 줄거리 계약(R38)이 세 시도가 같은 방법의 되풀이인지 묻지 않았고, 아이가 주인공보다 먼저 보는 것(비밀)과 조연의 바람을 요구하지 않았으며, 쪽의 종류가 '장면 + 한 줄' 하나뿐이었고, 표지 `sceneAction`은 쪽 나누기 모델이 미리 고른 인물 전부(쓰이지 않은 초록이 포함)로 쓰는데 표지 그림 요청은 주인공 시트만 보내 공룡이 글만 보고 그려졌습니다. 레퍼런스 작가의 이름·책은 어디에도 넣지 않았고(테스트가 확인), 원리로만 옮겼습니다.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 필수 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`cc5d469`** (캐시 `donghwa-shell-v87`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v48 / v83 (지금) | **`34264d5..cc5d469`** (R37 + R38 + R38 핫픽스 + R39) | v49 |
| R38H(`236c494`)까지 로컬에 반입해 두셨다면 | `236c494..cc5d469` | v49 |

R38 핫픽스(`236c494`, 말 없는 쪽 연결)는 아직 배포 확인을 받지 못했습니다. 이번 반입에 함께 들어갑니다.

| 구분 | 파일 |
| --- | --- |
| 새 파일 | `dist/story-generation/story-drama.js`, `tests/story-drama-r39.test.mjs` |
| 바뀐 코드 | `dist/sw.js`(v87 · 새 모듈 1개), `dist/app.js`, `dist/book-layout.js`, `dist/eco-mode.js`, `dist/full-auto.js`, `dist/output.js`, `dist/simple-create.js`, `dist/style.css`, `dist/image-generation/{scene-prompt,world}.js`, `dist/story-generation/{beat-writer,council,demo,expression-deck,k1-book,outline-normalize,page-tools,picture-plan,pipeline,prompt-diet,ui}.js` |
| 바뀐 테스트 | `tests/{eco-mode,expression-deck-r37,lean-checks-r31c,openings-legacy-r12,openings-policy-r12,picture-led-r35,picture-plan-r36,prompt-diet-r31b,story-change-r38}.test.mjs` |
| 문서 | `CLAUDE.md`(R39 항목), `PICTURE_LED_DIRECTION_2026-10-24.md`(10절) |

패키지·DB·서버·비밀값·화풍 프리셋은 바뀌지 않았습니다. R12 고정값은 `inputs`·`fullAutoDemo` 두 개만 새 키(`storyDrama`, 데모 줄거리의 드라마 필드, 새 표현 카드 때문에 바뀐 두 고정 초안의 카드 패) 때문에 다시 고정했습니다(`e7acbbf` 덤프와 비교, 그 밖의 차이 없음).

## 1. 무엇이 달라졌나

모든 R39 동작은 새 다이어트 초안에 고정되는 표식 `input.storyDrama {version: 1}`로만 켜집니다(R38 계약 위에서만 읽힘). 표식이 없는 초안·작업·책(R38까지)은 요청·검사·화면이 바이트 단위로 같습니다.

### (1) 줄거리 — 시도는 서로 다른 방법으로, 아이가 먼저 보는 비밀, 조연의 바람

| 항목 | 내용 |
| --- | --- |
| 줄거리 응답 | 비트마다 `tryKind`(`force` 힘으로 · `trick` 꾀로 · `ask` 부탁으로 · `wait` 기다리며 · `giveup` 포기하듯; 시도 아닌 비트는 `none`)와 `consequence`(그 시도가 세상에 바꾼 것 — 다음 비트가 거기서 시작). 줄거리에 `secret`(아이가 그림에서 일찍부터 보지만 주인공은 모르는 것 — 전환은 주인공이 드디어 보는 순간; K1은 묻지 않음), `companion`(조연이 제 스스로 바라는 것 — 돕는 역할이 아니라 방해하거나 우연히 돕기), `refrain.flip`(되풀이 줄이 끝에서 바뀐 모양). |
| 검사 | 시도 비트에 종류가 없거나 **두 시도가 같은 종류**면, 또는 비밀이 없으면(K2 이상) 구조 오류로 다시 받습니다(참고가 아님). |
| 작가 | 비트별 작가: 시도 비트 `[시도 종류] 이번 시도는 …로 해 보는 거예요 — 앞 시도와 다른 방법이에요. 결과: …`, 전환 앞 `[비밀] 아이는 그림에서 이미 봐요: … 글은 이것을 가리키지 않아요`, 전환 `[비밀] 주인공이 드디어 봐요`, 조연이 있는 비트 `[조연의 몫]`, 마지막 `[되풀이 뒤집기]`(영어도). K1 작가 `[시도·비밀·조연]` 블록. |
| 기획 회의 | 피치에 `tryKinds`·`secret`·`companion`(같은 종류 두 번 쓰지 않는다), 같은 시도를 되풀이하는 피치는 의장이 ladder 0점, 독자 봇에 `secretSeen`(표시용), 바이블 블록에 세 줄. |
| 화면 | 프로 줄거리 카드·③·에코 ③에 "시도 · 부탁·힘·기다리 / 비밀 · … / 조연 · …". |

### (2) 그림 계획 — 시선 · 비밀의 자리 · 바탕

- `picturePlan`에 `focus`(눈이 가는 한 곳), `secret`(이 그림에서 비밀이 놓이는 자리 — 작게, 매번 같은 구석, 가리키지 않음), `backdrop`(`scene` 그대로 / `plain` 주인공 혼자 단색 바탕 — 생각·독백, 책에 두 비트까지 / `none` 그림 없이 글만 — 한 비트까지, 첫·마지막 아님, 글이 맡는 비트만).
- 그림 요청의 PICTURE PLAN 줄에 "the eye lands on …; what the child can see and the hero has not noticed: … — small, in the same corner as before, never pointed at".
- **단색 바탕 쪽**: 장소 참조 그림을 보내지 않고(보내는 쪽·기록하는 쪽 같음) 장소 블록이 "Location: none. This page has no place: <주인공> alone on a flat, single-colour background … a thought, a line spoken to the reader"로 바뀝니다. 에코 그림 프롬프트도 같은 한 줄.

### (3) 글만 있는 쪽 (backdrop `none`)

- 쪽 나누기(쪽·펼침·에코)에 BACKDROP 규칙과 엔트리 `backdrop` 칸. 응답은 그 비트의 계획이 같은 값을 말할 때만 남깁니다(글만 쪽 1개, 글 있음, 첫/마지막 아님; 단색 2개). 쪽 다시 쓰기·일관성 수정이 값을 유지합니다.
- 글만 있는 쪽은 **그림을 만들지도 세지도 사지도 않습니다**: ④ '그림 n / total'의 분모, 이 쪽/모든 그림 만들기, FULL AUTO 그림 루프·진행률, 에코의 빠진 그림 목록·프롬프트 모두 보기, 승인 전 확인에서 빠집니다.
- ④ 카드·읽기 화면은 그 쪽 글을 단색 위에 큰 글씨로 보여 주고(그리기·올리기·프롬프트 버튼 없음), 인쇄·PDF는 단색 바탕 위에 글을 조판합니다.

### (4) 표지

- 쪽 나누기 규칙에 COVER: `cover.sceneAction`은 주인공 혼자, 비트에서 움직인 조연만 함께, 비트에 없는 인물은 나오지 않음.
- 표지 그림 요청의 사건 줄 뒤에 "Draw only <주인공> on this cover; if that sentence names anyone else, leave them out."

### (5) 표현 카드

- 표현 칸에 **한 발 물러선 화자**(`aside`: 이야기꾼이 읽는 아이에게 말을 걸거나 주인공이 혼자 속마음을 한 줄로)가 더해져 21 → 22장입니다.

비용: 유료 호출 추가 0회. 줄거리 규칙 K2 약 +2,000자(4,787 → 6,803), 쪽 나누기 약 +730자, 비트 작가 시도 비트 한글 +260·영어 +410, K1 블록 +약 260.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1092/1092**. 새 테스트 8개: `story-drama-r39` |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0`, 쉬운 단계 모두 12버튼 이내 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |
| R38 보고의 재현 스크립트 `node /workspace/artifacts/r38/reproduce-wordless.mjs` | `inspectStory` 경로도 `passed true` (R38H가 함께 들어가므로) |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r37~r39 반입 (r38 핫픽스 포함) · 캐시 v87"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v87`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인 (무료 · 운영 URL)

- 그림책 결로 에코 작업을 만들어 복사한 줄거리 프롬프트에 `DRAMA:`·`"tryKind"`·`"secret"`·`"companion"`·`PICTURE PLAN, three more fields`가 있는지, 쪽 글 프롬프트에 `BACKDROP:`·`COVER:`가 있는지.
- 받은 줄거리의 두 시도를 같은 `tryKind`로 붙여 넣으면 ③이 "시도 비트의 종류가 서로 달라야 해요"로 거절하는지.
- ③에 "시도 · … / 비밀 · … / 조연 · …" 줄이 보이는지(에코 ③의 '받은 줄거리'에도).
- 쪽 답에서 글이 맡는 비트의 중간 쪽 하나에 `"backdrop":"none"`(그 비트의 그림 계획도 `"backdrop":"none"`)을 넣어 ④로 가면 그 쪽이 단색 위의 글로 보이고 '그림 프롬프트'·'그림 올리기' 버튼이 없는지, 위의 '그림 n / total'에서 total이 하나 줄었는지, ⑤ 저장 안내의 빠진 쪽 목록에 그 쪽이 없는지.
- 그림책 결 데모 책을 만들어 ④ 배지가 '읽기 쉬움'인지, 기존 책 하나의 ④ 배지와 표지가 예전과 같은지.
- R38 지시서 4절·R38H 지시서 4절의 확인도 함께(아직 반입하지 않았다면).

유료 확인은 선택입니다. 부모님이 따로 승인한 경우에만 합니다. **같은 주제("놀이터에서 자꾸 도망가는 그림자 잡기") K2/E2 16쪽을 전후 한 편씩** — 앞 편은 R39 표식만 뺀 입력(러너에서 `storyDrama` 삭제), 뒤 편은 그대로. 볼 것:

- 줄거리의 세 `tryKind`가 서로 다른지, `secret`이 있고 전환 비트가 그것을 보는 순간인지, `companion`이 돕기가 아닌 제 바람인지.
- 그림 계획에 `backdrop` plain/none이 있는지, 단색 바탕 쪽의 그림 요청에 장소 참조가 빠졌는지(그림은 보고에 넣지 않고 shot·backdrop 목록만).
- 표지 `sceneAction`에 비트에 없는 인물이 없는지, 표지 그림에 주인공만 있는지(그림은 넣지 않고 한 줄로).
- 글만 있는 쪽이 있다면 그림 요청 수가 쪽 수보다 하나 적은지.

숫자는 러너 md의 검사기 실측만 믿습니다. 모델이 스스로 낸 점수는 쓰지 않습니다.

## 5. 완료 보고

`CODEX_R39_COMPLETION_2026-10-27.md`에 다음을 적습니다:

- 반입 범위와 커밋
- 2절 결과표
- 배포 URL, 운영 버전(v49), 캐시(v87)
- 4절 확인 결과(유료를 돌렸다면 전후 비교표)

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 프롬프트에 실제 작가·책·스튜디오 이름을 넣지 않습니다(테스트가 확인합니다).
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
