# Codex 지시서 r40 · 글 자리 (글이 그림에 앉는 단색 면 · 재생성 없음) · 2026-10-27

## 배경

부모님 고민(원문): "이제 글이 그림과 함께 자연스럽게 녹아들어서 나오게 하고 싶어, 크리스 호튼 책처럼. 글 > 그림 > 융합(그림 재생성)을 거쳐야 할까? 비용은?" → 설명 뒤 "구현해".

결정: **그림을 다시 사지 않습니다.** 레퍼런스의 글은 그림에 그려진 게 아니라 그림이 비워 둔 단색 면 위에 조판된 활자입니다. 그래서 (1) 그림 계획이 글 자리를 정하고, (2) 그림 요청이 그 자리를 팔레트의 한 색으로 평평하게 비우게 하며, (3) 읽기·④·인쇄·피드백판이 그 자리에 글을 앉히고 완성 그림의 색을 재서 바탕색을 맞춥니다(평평하지 않으면 반투명 카드). 유료 호출 추가 0회. 융합 재생성(장당 0.17달러·한글 깨짐·글 고칠 때마다 재구매)은 하지 않았고, 소리말 한 장을 그림에 그려 넣는 선택도 보류했습니다.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 필수 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`e92e8ca`** (캐시 `donghwa-shell-v90`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v50 / v88 (지금) | **`99b2320..e92e8ca`** (R39H 핫픽스 `f8913b8` + R40) | v51 |
| R39H(`f8913b8`)를 이미 반입했다면 | `f8913b8..e92e8ca` | v52 |

| 구분 | 파일 |
| --- | --- |
| 새 파일 | `dist/text-pocket.js`, `tests/text-pocket-r40.test.mjs` |
| 바뀐 코드 | `dist/sw.js`(v90 · 새 모듈 1개), `dist/app.js`, `dist/eco-mode.js`, `dist/full-auto.js`, `dist/output.js`, `dist/simple-create.js`, `dist/style.css`, `dist/image-generation/scene-prompt.js`, `dist/story-generation/{outline-normalize,picture-plan,pipeline,prompt-diet,ui}.js` |
| 바뀐 테스트 | `tests/{openings-legacy-r12,openings-policy-r12,picture-led-r35,picture-plan-r36,story-change-r38,story-drama-r39}.test.mjs` |
| 문서 | `CLAUDE.md`(R40 항목), `PICTURE_LED_DIRECTION_2026-10-24.md`(11절) |

패키지·DB·서버·비밀값·화풍 프리셋은 바뀌지 않았습니다. R12 고정값은 `inputs`·`fullAutoDemo` 두 개만 새 키(`textPocket`) 때문에 다시 고정했습니다(`d32637a` 덤프와 비교, 그 밖의 차이 없음).

## 1. 무엇이 달라졌나

모든 R40 동작은 새 다이어트 초안에 고정되는 표식 `input.textPocket {version: 1}`로만 켜집니다(R39 계획 위에서만 읽힘). 표식이 없는 초안·작업·책(R39까지)은 요청·검사·화면·인쇄 HTML이 바이트 단위로 같습니다.

| 단계 | 내용 |
| --- | --- |
| 줄거리 | 그림책 결 초안의 `picturePlan.pocket`(`left`·`right`·`top`·`bottom`·`none`)이 필수. 규칙: 그 부분은 한 색으로 평평하게 비워 두고 글은 거기에 인쇄된다(그림 속에 글자를 그리지 않음), 행동이 없는 쪽에, 글이 맡는 비트는 더 크게. 글만 있는 쪽은 자리 없음. 프로 비트 카드·에코 ③에 "글 자리 · 왼쪽". |
| 그림 요청 | 표지를 뺀 쪽·펼침·에코 요청에 "TEXT FIELD: leave the left 34% of the picture's width as one flat, even field of a single quiet colour from the style palette with nothing drawn in it … the words of this page will be printed there." (좌우 34%, 글이 맡는 비트 45%; 상하 30%/40%). 쪽 책의 '장면별 글 위치' 문장을 대신합니다. |
| 화면 | 읽기 화면·④는 그 쪽 글을 그림 위 자리에 두고(읽어주기 낱말 강조 그대로) 아래 본문은 비웁니다. 한두 낱말 소리 쪽은 큰 글씨. |
| 인쇄·PDF·피드백판 | 쪽 책 리프는 스토리 카드 대신 자리 패널, 펼침 리프는 그림 안 패널(좌우 자리면 펼침면 글 전부가 그 반쪽에, 상하 자리는 양쪽). 글 자리가 있는 책에만 스타일·샘플러를 인라인합니다. |
| 색 | 완성 그림의 자리 영역을 48×48 축소본으로 재서 밝기 편차가 작으면 그 평균색 바탕(밝기 따라 어두운/밝은 글자), 아니면 예전처럼 반투명 카드. 그림은 바뀌지 않습니다. |

실측(Chromium, 합성 그림): 왼쪽 1/3이 단색인 그림 → `rgb(66,116,143)` 바탕에 밝은 글자; 어지러운 그림 → 반투명 카드로 물러남.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1097/1097**. 새 테스트 3개: `text-pocket-r40` |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r39h + r40 반입 · 캐시 v90"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v90`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인 (무료 · 운영 URL)

- 그림책 결 에코 작업의 복사한 줄거리 프롬프트에 `"pocket"`과 "where the words sit"이 있는지; 받은 줄거리의 계획에 pocket을 넣으면 ③의 계획 줄에 "글 자리 · …"가 보이는지.
- 같은 작업의 ④ 그림 프롬프트에 "TEXT FIELD: leave the …"가 있고 표지 프롬프트에는 없는지.
- 글 자리가 있는 쪽에 그림을 올리면(에코) ④ 카드와 읽기 화면에서 글이 그림 위 그 자리에 보이고 아래 본문이 비는지; 소리말 한 단어 쪽은 큰 글씨인지.
- '인쇄 · PDF로 저장' 미리보기에서 그 쪽의 글이 그림 안 자리에 있고 스토리 카드가 없는지; 저용량 피드백판에서도 같은지.
- 기존 책(R39 이하)의 읽기 화면·인쇄 미리보기가 예전과 같은지.
- R39H 지시서 4절(글만 있는 쪽의 그림 수 표시)도 함께.

유료 확인은 선택입니다. 부모님이 따로 승인한 경우에만 합니다. **같은 주제 K2 16쪽 한 편**을 그대로 돌려(그림 포함) 볼 것: 그림 요청마다 TEXT FIELD가 들어갔는지, 완성 그림에서 그 자리가 실제로 비었는지(샘플러가 `pocket-flat`로 판정한 쪽 수 / 전체 — 그림은 보고에 넣지 않고 수만), 읽기 화면에서 글이 그림 색 위에 읽히는지.

숫자는 앱의 결정론 판정(샘플러의 flat/busy)만 믿습니다.

## 5. 완료 보고

`CODEX_R40_COMPLETION_2026-10-27.md`: 반입 범위와 커밋, 2절 결과표, 배포 URL·운영 버전·캐시(v90), 4절 확인 결과(유료를 돌렸다면 flat/busy 쪽 수).

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 프롬프트에 실제 작가·책·스튜디오 이름을 넣지 않습니다(테스트가 확인합니다).
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
