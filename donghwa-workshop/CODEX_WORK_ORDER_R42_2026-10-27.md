# Codex 지시서 r42 · 영어는 한글을 따라 + 말 없는 쪽 기본 끔 · 2026-10-27

## 배경

부모님 보고(원문): "스토리가 많이 이상해, 빈페이지도 있고" — 첨부: 완성된 K2 16쪽 초안(털실 숨바꼭질)의 ③ 화면 11장.

원인 둘. (1) 비트별 작가가 한 비트의 한글과 영어를 **서로 보지 않고 동시에** 썼습니다(영어 시스템 문장에 "never a translation of Korean"). 그래서 같은 쪽에서 한글은 "둥근 것이 쏙 보이네요"인데 영어는 "saw a round back paw"로 두 쪽 뒤 반전을 먼저 말했고, 3–4쪽은 한글 6문장·영어 2문장이 다른 장면을 가리켰습니다. (2) R38의 '말 없는 쪽' 허용이 전환 펼침(11–12쪽)에 걸려 ③에 "문장 0 · 권장 1~7"인 빈 글이 보였습니다.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 필수 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`502e3c6`** (캐시 `donghwa-shell-v92`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v52 / v90 (R40까지 배포됨) | **`e92e8ca..502e3c6`** (R41 + R42) | v53 |
| v53 / v91 (R41을 이미 배포했다면) | **`a204d49..502e3c6`** (R42만) | v54 |

R41 완료 보고가 아직 없으니 둘 중 지금 운영 상태에 맞는 줄을 고릅니다. 두 라운드를 함께 반입해도 됩니다(R42는 R41 위에 있음).

| 구분 | 파일 |
| --- | --- |
| 새 파일 | `dist/story-generation/english-mirror.js`, `tests/english-mirror-r42.test.mjs` |
| 바뀐 코드 | `dist/sw.js`(v92 · 새 모듈 1개), `dist/style.css`, `dist/full-auto.js`, `dist/simple-create.js`, `dist/story-generation/{beat-writer,k1-book,pipeline,prompt-diet,story-change,ui}.js` |
| 바뀐 테스트 | `tests/{openings-legacy-r12,openings-policy-r12,picture-led-r35,picture-plan-r36,story-change-r38,voice-deck-r34}.test.mjs` |
| 문서 | `CLAUDE.md`(R42 항목), `PICTURE_LED_DIRECTION_2026-10-24.md` §12 |

패키지·DB·서버·비밀값·화풍 프리셋·그림 요청은 바뀌지 않았습니다. R12 고정값은 `inputs`·`fullAutoDemo` 두 개만 새 키(`englishMirror`, `storyChange.wordless`) 때문에 다시 고정했습니다(`a60f8e9` 덤프와 비교, 그 밖의 차이 없음).

## 1. 무엇이 달라졌나

### (1) 영어는 한글을 따라 (새 다이어트 초안만, 표식 `input.englishMirror`)

- 비트별 작가(K2 이상 정성 모드)는 한 비트의 **한글을 먼저** 쓰고 영어를 그다음에 씁니다. 영어 호출은 그 비트의 완성 한글을 `[이 비트의 한글 — 영어는 이 글을 따라요 …]`로 받고, 시스템 문장이 "the short English telling of the Korean text you are given — the same events in the same order, the same spoken lines in plain English, and nothing the Korean has not yet revealed"로 바뀝니다. 호출 수·요금은 같고 순서만 바뀝니다.
- K1 작가(책 전체 한 번)는 "영어(en)는 같은 쪽 한글의 짧은 영어 판이에요 …" 줄을, 쪽 나누기(쪽·펼침·에코)는 `ENGLISH FOLLOWS KOREAN: …` 한 줄을 받습니다.
- 표식이 없는 기존 초안·작업·책은 바이트 단위로 그대로입니다(두 언어 병렬, 예전 문장).

### (2) 말 없는 쪽 기본 끔

- 새 초안의 `storyChange`는 `{version: 1, wordless: false}`입니다. 쪽 나누기에 WORDLESS 줄이 없고, 빈 글은 검사에서 "글이 모두 필요해요"로 거절됩니다. R42 이전 초안(`{version: 1}`)은 R38 그대로 한 쪽을 비워 둘 수 있습니다.
- 쉬운 ③·④ 카드는 그런 예전 초안의 빈 항목에 "문장 0 · 권장 …" 대신 "말 없는 쪽 · 그림이 말해요 (글을 넣으려면 ‘글 고치기’)"를 보입니다.

### (3) 바뀌지 않은 것

그림 요청·화풍·줄거리 계약(R38~R41)·요금 추정은 그대로입니다. 영어 이름 "You ha"/"Hae ni"는 서랍 캐릭터의 영어 이름 그대로라 코드가 바꾸지 않습니다(4절 참고).

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1103/1103**. 새 테스트 3개: `english-mirror-r42` |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0`, 쉬운 단계 모두 12버튼 이내 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r42 반입 · 캐시 v92"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v92`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인 (무료 · 운영 URL)

- 부모님의 털실 숨바꼭질 초안을 ③에서 열어 11–12쪽(펼침 6)으로 가면 "말 없는 쪽 · 그림이 말해요 (글을 넣으려면 ‘글 고치기’)"가 보이는지. 이 초안은 R42 이전 초안이라 영어는 바뀌지 않습니다 — 부모님이 쪽마다 '글 고치기'로 한글을 손본 뒤 "영어도 이 한글에 맞출까요?"(R30.1, 유료·쪽당 약 $0.01)를 쓰거나, 같은 주제로 새로 만들면 새 규칙이 적용됩니다.
- 그림책 결 에코 작업의 쪽 글 프롬프트에 `ENGLISH FOLLOWS KOREAN:` 줄이 있고 `WORDLESS:` 줄이 없는지. 쪽 하나의 `textKo`·`textEn`을 비워 붙여 넣으면 거절되는지.
- 기존 책 하나의 ④·읽기·인쇄가 예전과 같은지.
- 서랍에서 주인공 '유하'의 영어 이름이 "You ha"로 되어 있는지 확인합니다(기본값은 "Yuha"). 그렇다면 부모님께 "Yuha"로 바꾸는 것을 권합니다(이름만 바꾸면 그림 시트는 그대로 — 2026-10-20 재료 이름 바꾸기). 코드는 서랍의 영어 이름을 그대로 씁니다.

유료 확인은 선택입니다. 부모님이 따로 승인한 경우에만 합니다. 같은 주제 K2 16쪽 한 편: 쪽마다 영어가 그 쪽 한글과 같은 사건·같은 대사이고 뒤 쪽의 반전을 먼저 말하지 않는지, 빈 쪽이 없는지(러너 md의 쪽 글만, 그림은 넣지 않음).

## 5. 완료 보고

`CODEX_R42_COMPLETION_2026-10-27.md`: 반입 범위와 커밋, 2절 결과표, 배포 URL·운영 버전·캐시(v92), 4절 확인 결과.

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 프롬프트에 실제 작가·책·스튜디오 이름을 넣지 않습니다(테스트가 확인합니다).
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
