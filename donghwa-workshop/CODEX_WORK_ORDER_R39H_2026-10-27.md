# Codex 지시서 r39h · 글만 있는 쪽을 그림 수에서 빼기 (표시 핫픽스) · 2026-10-27

## 배경

R39 완료 보고(`CODEX_R39_COMPLETION_2026-10-27.md`)가 남긴 표시 결함을 고쳤습니다. 보고가 맞습니다: 글만 있는 쪽이 하나 있어 실제 생성·업로드 대상은 7장인데 펼침 요약 두 곳(`openingsSummary`·`openingsMix` — 인쇄 창 머리글·④·⑤ 요약)이 '그림 8장 + 표지'로 셌습니다. 같은 셈을 쓰는 FULL AUTO 상태 창(`jobPictureTotal`)과 프로 쪽 나누기 모달도 함께 고쳤습니다. 정확한 지적과 R39·R39-F 배포(v50/v88)에 감사드립니다.

**Claude가 고쳐 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`f8913b8`** (캐시 `donghwa-shell-v89`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v50 / v88 (지금) | **`99b2320..f8913b8`** (보고 커밋 `a12ea5d` 병합 포함, 앱 코드는 이 핫픽스만) | v51 |

| 구분 | 파일 |
| --- | --- |
| 바뀐 코드 | `dist/book-layout.js`(`openingsSummary`·`openingsMix`), `dist/full-auto.js`(`jobPictureTotal`), `dist/story-generation/ui.js`(쪽 나누기 모달 머리글), `dist/sw.js`(v89) |
| 바뀐 테스트 | `tests/openings-ui-r12.test.mjs`, `tests/openings-pictures-r12.test.mjs`, `tests/print-feedback-r39.test.mjs`(캐시 버전 범위) |
| 문서 | `CLAUDE.md`(R39H 항목) |

패키지·DB·서버·비밀값·화풍 프리셋은 바뀌지 않았습니다. R12 고정값은 그대로입니다.

## 1. 내용

- `openingsSummary`: "16쪽 · 펼침 8개 · 그림 7장"처럼 글만 있는 쪽(`backdrop: "none"`)을 뺀 수. `openingsMix`: "… → 그림 7장 + 표지 (글만 있는 쪽 1)". 글만 쪽이 없는 책은 문구가 예전과 같습니다.
- FULL AUTO 상태 창의 "그림 n / 총" 총수와 프로 쪽 나누기 모달의 "그림 n장(펼침면 · 낱쪽 · 글만 n)"도 같은 셈입니다.
- 카운터·빠진 그림 목록·생성 대상·요금 추정은 R39부터 이미 빼고 있었습니다(바뀌지 않음).

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1094/1094** |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r39h 반입 · 캐시 v89"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v89`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인 (무료 · 운영 URL)

- R39 보고 2번 흐름 그대로(4번 비트 글만 쪽): ④·⑤ 요약과 인쇄 창 머리글이 '그림 7장'(또는 '+ 표지 (글만 있는 쪽 1)')인지, 카운터 '그림 0 / 7'과 같은 수인지.
- 글만 쪽이 없는 기존 책의 요약 문구가 예전과 같은지.

## 5. 완료 보고

`CODEX_R39H_COMPLETION_2026-10-27.md`: 반입 범위와 커밋, 2절 결과표, 배포 URL·운영 버전(v51)·캐시(v89), 4절 확인 결과.

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
