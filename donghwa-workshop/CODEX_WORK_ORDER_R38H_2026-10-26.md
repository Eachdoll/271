# Codex 지시서 r38h · R38 핫픽스(말 없는 쪽 연결) · 2026-10-26

## 배경

Codex R38 검증 보고(`CODEX_R38_COMPLETION_2026-10-26.md`)가 찾은 결함을 고쳤습니다. 보고가 맞습니다: `dist/story-generation/pipeline.js`의 `inspectStory`가 `checkStory`에 `storyInput`을 넘기지 않아, 검사기가 R38 표식과 책 결을 볼 수 없었고 허용된 빈 중간 쪽이 실제 에코·FULL AUTO 경로에서 "문장 수 0"으로 거절됐습니다. R38 테스트는 `checkStory`에 직접 넘겨 이 연결 누락을 잡지 못했습니다. 정확한 재현과 수정 제안에 감사드립니다.

**Claude가 고쳐 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 필수 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`236c494`** (캐시 `donghwa-shell-v86`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v48 / v83 (지금) | **`34264d5..236c494`** (R37 + R38 + 핫픽스) | v49 |
| 로컬에 R37·R38(`700123b`)을 이미 반입해 두셨다면 | `700123b..236c494` | v49 |

| 구분 | 파일 |
| --- | --- |
| 바뀐 코드 | `dist/story-generation/pipeline.js`(`inspectStory`에 `storyInput: input`), `dist/story-generation/ui.js`(프로 마법사의 두 `checkStory` 호출에 `storyInput: d.input`), `dist/sw.js`(v86) |
| 바뀐 테스트 | `tests/story-change-r38.test.mjs`(같은 책을 `inspectStory`·`ecoAcceptPages`로도 검사; 연결을 빼면 실패) |
| 문서 | `CLAUDE.md`(R38 핫픽스 항목) |

패키지·DB·서버·비밀값·화풍 프리셋은 바뀌지 않았습니다. R12 고정값은 그대로입니다.

## 1. 핫픽스 내용

- `inspectStory(outline, pagination, input)`는 이제 `checkStory`에 `storyInput: input`을 함께 넘깁니다. FULL AUTO 쪽 나누기·수정 루프, 에코의 `ecoAcceptPages`·`ecoMergeFix`가 모두 이 래퍼를 씁니다.
- 프로 마법사의 검사와 손으로 다시 나누기(`ui.js`)도 같은 옵션을 넘깁니다. `page-tools`와 `app.js`는 이미 넘기고 있었습니다.
- R38 표식이 없는 입력에서는 결과가 같습니다(`wordlessPageIndexes`가 빈 집합을 돌려주고, `lean`·`catchphrases`는 예전처럼 명시 값).

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1084/1084** |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |
| 보고의 재현 스크립트 `node /workspace/artifacts/r38/reproduce-wordless.mjs` | `inspectStory` 경로도 `passed true` |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r37~r38 + r38 핫픽스 반입 · 캐시 v86"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v86`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인 (무료 · 운영 URL)

- R38 지시서 4절의 무료 확인 전부.
- 보고에서 실패했던 흐름을 그대로: K1/E0 또는 K2 에코 작업에서 그림이 말하는 비트의 중간 쪽 하나만 양쪽 언어를 비운 쪽 답이 ③에서 **통과**해 ④로 가는지. 둘째 빈 쪽을 더하면 예전처럼 '걸린 쪽만 고치기'에 머무는지.
- 기존 책 하나의 ④ 배지가 예전과 같은지.

## 5. 완료 보고

`CODEX_R38H_COMPLETION_2026-10-26.md`: 반입 범위와 커밋, 2절 결과표(재현 스크립트 포함), 배포 URL·운영 버전(v49)·캐시(v86), 4절 확인 결과.

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
