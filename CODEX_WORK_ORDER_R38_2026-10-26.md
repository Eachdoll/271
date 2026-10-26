# Codex 지시서 r38 · 달라지는 것 · 구도 · 장소 · 말 없는 쪽 · 2026-10-26

## 배경

부모님이 완성된 그림책 결 책 한 권(영어 한 줄 12쪽, 그림 12장이 같은 거실 전경)을 보고 지적했습니다(원문): "이야기의 결말이 단순해서 이해가 안 되고, 교훈이 없는 거 같아. 그리고 구도가 크게 변하지 않는 거 같아. 이야기의 시작이 왜 또 집일까?" → 제안 1~4번 "다 구현해".

원인은 세 곳이었습니다. 줄거리 요청이 '끝에서 달라지는 것'을 요구하지 않았고, R36의 그림 계획 shot이 스테이징 회전을 덮어써 "wide" 열두 번이 열두 장 같은 그림을 만들었으며(장소 참조 그림이 카메라를 고정), 장소 없는 주제의 기본값이 세 겹으로 집이었습니다. R38은 네 묶음을 한 번에 고칩니다.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 필수 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`32bcdba`** (캐시 `donghwa-shell-v85`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v48 / v83 (r35h까지) | **`34264d5..32bcdba`** (R37 + R38, Codex R35H 보고 병합 포함) | v49 |
| v49 / v84 (r37까지 반입했다면) | `643a331..32bcdba` | v50 |

| 구분 | 파일 |
| --- | --- |
| 새 파일 | `dist/story-generation/story-change.js`, `tests/story-change-r38.test.mjs` |
| 바뀐 코드 | `dist/sw.js`(v85 · 새 모듈 1개), `dist/book-format.js`, `dist/eco-mode.js`, `dist/full-auto.js`, `dist/reading-checker.js`, `dist/reading-ui.js`, `dist/simple-create.js`, `dist/image-generation/{scene-prompt,world}.js`, `dist/story-generation/{beat-writer,checker,demo,k1-book,outline-normalize,picture-plan,pipeline,prompt-diet,schemas,topic-ending,ui}.js` |
| 바뀐 테스트 | `tests/{expression-deck-r37,k1-book-r31a,lean-checks-r31c,openings-legacy-r12,openings-policy-r12,picture-led-r35,picture-plan-r36,prompt-diet-r31b,simple-create,topic-places-r33}.test.mjs` |
| 문서 | `CLAUDE.md`(R38 항목), `PICTURE_LED_DIRECTION_2026-10-24.md`(9절) |

패키지·DB·서버·비밀값·화풍 프리셋은 바뀌지 않았습니다. R12 고정값은 `inputs`·`fullAutoDemo` 두 개만 새 키(`storyChange`와 데모 줄거리의 세 필드) 때문에 다시 고정했습니다(`6d1d5c9` 덤프와 비교, 그 밖의 차이 없음).

## 1. 무엇이 달라졌나

모든 R38 동작은 새 다이어트 초안에 고정되는 표식 `input.storyChange {version: 1}`로만 켜집니다. 표식이 없는 초안·작업·책(R37까지)은 요청·검사가 바이트 단위로 같습니다.

### (1) 줄거리 계약 — 끝에서 하나가 달라지게

| 항목 | 내용 |
| --- | --- |
| 줄거리 응답 | `change`(끝에서 달라지는 것 한 문장), `expectation`(바람 비트에서 아이가 기대하는 것), `ending`(`echo` 첫 장면을 되비추되 하나만 다르게 / `open` 작은 물음·'어어?'로 열어 두기)이 **필수**. `change`가 없으면 구조 오류로 다시 받습니다(참고가 아님). |
| 줄거리 규칙 | WHAT CHANGES 한 문단: 전환 비트가 기대를 그림에서 뒤집고, 마지막 비트는 달라진 것을 행동 하나로 보여 주되 말하지 않음. |
| 작가 | 비트별 작가: 바람 비트 `[기대]`, 전환 비트 `[뒤집기]`, 마지막 비트 `[이 책이 끝에서 보여 줄 것]`(영어도). K1 작가: `[달라지는 것]` 블록. |
| 화면 | 프로 줄거리 카드·③·에코 ③에 "달라지는 것 · … (되비추는 끝/열린 끝)". |
| 쉬운 끝맺음 | 장소 없는 주제: "이야기가 시작한 곳에서 끝내되 처음과 하나가 달라진 채로 끝내요. 집으로 돌아가거나 잠드는 장면을 덧붙이지 않아요."(예전: 집에서 편안히). 기존 작업의 끝맺음은 고정돼 그대로입니다. |

### (2) 그림 — 참조보다 계획이 이기게

- **shot 단조로움 가드**: 한 shot이 비트의 절반을 넘으면 같은 shot이 이어지는 비트는 첫 비트만 남기고 지워 스테이징 회전(wide→medium→closeup→…)이 맡습니다. 같은 shot 3연속은 셋째를 지웁니다.
- **가까운 장면엔 장소 참조 없음**: 유효 shot이 close-up·over-shoulder인 쪽은 장소 참조 그림을 보내지 않고(보내는 쪽과 기록하는 쪽이 같음) "This is a close view: no place reference image is attached; keep the place's colours, materials and light from these facts"로 바뀝니다.
- **구도 문장이 맨 앞**: 그림 요청이 "COMPOSITION FIRST (… it takes precedence over the viewpoint of every reference image): <shot>. PICTURE PLAN … Draw this page from this camera, not from the angle the place reference was painted at."로 시작합니다(표지 제외).

### (3) 장소·가치

- 아이디어 뽑기 48개가 장소와 바람을 품은 한 줄이 됐습니다(예: "놀이터에서 자꾸 도망가는 그림자 잡기"). 24자 이내, 느낌표 없음.
- 쉬운 ① '바꾸기' 패널에 **어디서?**(주제대로(자동) + 서랍 장소)와 **함께 생각할 가치**(없음·용기·나눔·친절·끈기·호기심·기다리기·배려)가 생겼습니다. 형식 줄에 "<장소>에서 · 가치 · <값>"이 보입니다.
- 고른 장소는 ② 미리 고르기와 재료 계획에서 맨 앞에 오고, 줄거리 요청의 Places 줄에도 맨 앞입니다. 장소 없는 주제는 "집 아닌 고른 장소"에서 엽니다(집은 주제가 집을 부르거나 집만 골랐을 때).

### (4) 글 — 말 없는 쪽

- 그림책 결 작가·K1 작가·에코 쪽 요청에 한 줄: "쪽마다 아이가 외치는 말만 두지 않아요: 이야기꾼의 한 줄, 소리말 하나, 올 때마다 한 낱말만 바뀌는 되풀이 줄이 몇 쪽을 맡아요."
- 쪽 나누기(쪽·펼침·에코)에 WORDLESS 줄: 그림이 말하는 비트의 중간 쪽 하나는 글을 비워도 됩니다(책에 한 쪽, 첫·마지막 쪽 제외). 검사기·④·K1 작가 검사가 그 쪽만 통과시키고, 둘째 빈 쪽이나 첫/마지막 쪽은 예전처럼 "글이 모두 필요해요"입니다.

비용: 유료 호출 추가 0회. 줄거리 규칙 약 +750자(4,120→4,875), 비트 작가 규칙 한글 +75·영어 +130, 쪽 나누기 +약 230자, K1 줄 +약 310자.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1084/1084**. 새 테스트 9개: `story-change-r38` |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0`, 쉬운 단계 모두 12버튼 이내 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r37~r38 반입 · 캐시 v85"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v85`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인 (무료 · 운영 URL)

- 쉬운 ① '바꾸기'를 열어 **어디서?**와 **함께 생각할 가치**가 보이고, 장소·가치를 고르면 형식 줄에 "…에서 · 가치 · …"가 붙는지.
- 아이디어 뽑기를 몇 번 눌러 장소가 든 한 줄이 나오는지(예전 "그림자와 술래잡기"가 아님).
- 그림책 결로 에코 작업을 만들어 복사한 줄거리 프롬프트에 `WHAT CHANGES`·`"change"`·`"ending"`이 있는지, 쪽 글 프롬프트에 `WORDLESS`와 "외치는 말만 두지 않아요"가 있는지.
- ③에 "달라지는 것 · …" 줄이 보이는지(에코 ③의 '받은 줄거리'에도).
- 그림책 결 데모 책을 만들어 ④ 배지가 '읽기 쉬움'인지, 기존 책 하나의 ④ 배지가 예전과 같은지.
- R37 지시서 4절의 확인도 함께(R37을 아직 반입하지 않았다면).

유료 확인은 선택입니다. 부모님이 따로 승인한 경우에만 합니다. **같은 주제("놀이터에서 자꾸 도망가는 그림자 잡기") K1/E0 12쪽을 전후 한 편씩** — 앞 편은 `BOOK_FORMAT` 그대로 두고 R38 표식만 뺀 입력(러너에서 `storyChange` 삭제), 뒤 편은 그대로. 볼 것:

- 줄거리의 `change`가 있고 마지막 쪽이 그것을 행동으로 보이는지(말로 하지 않는지).
- 그림 계획의 shot이 열두 쪽 모두 같지 않은지, 가까운 쪽 그림이 전경을 베끼지 않는지(그림은 보고에 넣지 않고 shot 목록만).
- 첫 쪽이 집이 아닌지.
- 열두 줄이 전부 감탄문이 아닌지(화자 한 줄·소리말·되풀이가 있는지), 말 없는 쪽이 있다면 검사가 통과하는지.

숫자는 러너 md의 검사기 실측만 믿습니다. 모델이 스스로 낸 점수는 쓰지 않습니다.

## 5. 완료 보고

`CODEX_R38_COMPLETION_2026-10-26.md`에 다음을 적습니다:

- 반입 범위와 커밋
- 2절 결과표
- 배포 URL, 운영 버전, 캐시(v85)
- 4절 확인 결과(유료를 돌렸다면 전후 비교표)

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 프롬프트에 실제 작가·책·스튜디오 이름을 넣지 않습니다.
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
