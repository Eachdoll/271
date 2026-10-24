# Codex 지시서 r35h · R35 핫픽스(④ 읽기 검사) + R36 통합 반입 · 2026-10-24

## 배경

Codex R35 검증 보고(`CODEX_R35_COMPLETION_2026-10-24.md`)가 찾은 결함을 고쳤습니다: 그림책 결 데모가 생성 검사는 통과하는데 ④ 읽기 배지는 '확인할 곳'(27개 지적, 13엔트리 중 12)을 보였습니다. 원인은 보고서 그대로입니다 — 생성의 `checkStory`는 다이어트 책의 영어를 `pageReadingSpec(..., {lean: true})`로 재는데, ④의 `checkBookAtLevel` → `validateAndRewriteBook` → `analyzeBook`은 고정 규격의 `unitSpec`만 썼습니다. 정확한 재현과 수정 제안에 감사드립니다. 제안대로 공유 함수를 연결했고, 기존 책의 규칙은 풀지 않았으며 배지를 숨기지도 않았습니다.

그 사이 R36(글·그림 분담, `CODEX_WORK_ORDER_R36_2026-10-24.md`)도 커밋돼 있어, 이번에 한 번에 반입합니다.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 필수 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`5969de4`** (캐시 `donghwa-shell-v83`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v47 / v79 (지금, r33까지) | **`49ec210..5969de4`** (R34·R35·R36·핫픽스, 지시서 문서 포함) | v48 |

로컬에 R34+R35를 이미 반입해 두셨다면 그 위에 `dcba2a5..5969de4`를 더하면 같은 결과입니다.

| 커밋 | 내용 | 자세한 지시서 |
| --- | --- | --- |
| `e698666` | R34 목소리 카드·문체 실측 | `CODEX_WORK_ORDER_R34_2026-10-23.md` |
| `5f1e1e8` | R35 책 결(그림책 결 기본) | `CODEX_WORK_ORDER_R35_2026-10-24.md` |
| `bf7522a` | R36 글·그림 분담(그림 계획) | `CODEX_WORK_ORDER_R36_2026-10-24.md` |
| **`5969de4`** | **R35 핫픽스(④ 읽기 검사)** | 이 문서 |

핫픽스가 바꾼 파일: `dist/reading-ui.js`, `dist/reading-checker.js`, `dist/sw.js`(v83), 새 테스트 `tests/reading-paths-r35-hotfix.test.mjs`, 테스트 `tests/picture-plan-r36.test.mjs`(캐시 번호 허용), `CLAUDE.md`(핫픽스 항목).

## 1. 핫픽스 내용

| 항목 | 내용 |
| --- | --- |
| 대상 | 다이어트 책(`book.storyInput.promptDiet`가 있는 책, `leanBook`). 그림책 결·글이 많은 책 모두 |
| ④ 쪽 규격 | 생성 검사와 같은 `pageReadingSpec(..., {lean: true})`(E2+ 영어 단위 허용 범위, 활용형, 화자 표시 합치기, 등급 외 비율은 참고) — `bookReadingOptions`가 `analyzeBook`에 `pageSpec`으로 넘김 |
| 이야기 단어 | 생성 검사와 같은 `buildStoryWords(..., {briefs: book.sceneBriefs, lean: true})` |
| 책 전체 | `lean`이면 `book-sentence-total`·`new-word-budget`은 참고(warnings, advisory) — 생성 검사의 참고 처리와 같음 |
| 기존 책 | 다이어트 정책이 없는 책은 옵션을 받지 않아 예전과 바이트 단위로 같음(R12 핀 그대로) |

보고서가 지적한 그림책 결 책의 책 참고(긴 문장 비율·소리 한 단어 쪽 수)는 ④에 아직 보이지 않습니다. 생성 검사에서만 참고로 남습니다(차단이 아니라 결과에는 영향이 없음).

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1068/1068**. R36 8개, 핫픽스 2개 포함 |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |
| **보고서의 재현** `reproduce-reading-paths.mjs` | raw `unitSpec` 경로는 예전처럼 `sentence-length`, 생성 경로는 없음(두 경로의 정의는 그대로이고, ④가 이제 생성 경로를 씀) |
| **보고서의 브라우저 재검사**(`local-recheck.json`과 같은 방법) | 그림책 결 데모 ④ 배지 **읽기 쉬움**, 지적 0 |
| 글이 많은 책 데모 ④ | 읽기 쉬움 그대로 |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r34~r36 + r35 핫픽스 반입 · 캐시 v83"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v83`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인 (무료 · 운영 URL)

- R35 지시서 4절 무료 확인 전부(① 책 결, 그림책 결 데모 펼침 문장 수, 에코 두 요청, 프로 메모, 기존 책).
- R36 지시서 4절 무료 확인 전부(에코 그림 계획 문단·③ 줄거리의 그림 계획 줄·④ 그림 프롬프트, 데모 프로 비트 카드).
- **그림책 결 데모 ④ 배지가 '읽기 쉬움'**, 글이 많은 책 데모도 그대로.
- 기존 책 하나를 열어 ④ 배지가 예전과 같은지.

유료 확인은 R35·R36 지시서의 선택 항목 그대로이며, 부모님이 따로 승인한 뒤에만 합니다.

## 5. 완료 보고

`CODEX_R35H_COMPLETION_2026-10-24.md`: 반입 범위와 커밋, 2절 결과표(재현 스크립트·브라우저 재검사 포함), 배포 URL·운영 버전(v48)·캐시(v83), 4절 확인 결과.

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
