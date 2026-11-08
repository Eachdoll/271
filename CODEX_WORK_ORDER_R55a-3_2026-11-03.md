# Codex 지시서 r55a-3 · 핫픽스 · 줄거리 단계 등장인물 상한 7명 · 2026-11-03

부모님 멈춤 리포트: 「숲속에서 자꾸 숨는 아기 사슴」 16쪽 두 권, 재료 고르기·시트 준비까지 끝난 뒤 **줄거리**에서 `이야기에 등장할 친구를 1~5명 골라 주세요.`로 멈춤(유료 요청 1건, 재료 계획).

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | **`f3c1304`** (캐시 `donghwa-shell-v108`) |
| 반입 범위 | r55a-2 `b7068e9` 이후: `b7068e9..f3c1304` (r55a-2 미배포면 `ef89487..f3c1304` 한 번에) |
| 바뀐 파일 | `dist/story-generation/pipeline.js`, `dist/full-auto.js`, `dist/sw.js`, `tests/material-variety.test.mjs`, `tests/openings-legacy-r12.test.mjs`, `CLAUDE.md` |

## 원인
- 2026-10-20 재료 다양성 때 재료 계획 검사(`MAX_CAST = 7`)와 쉬운 ②(친구 6명)는 7명까지 허용했는데, 줄거리 입력 검사 `normalizeStoryInput`과 `createFullAutoJob`은 5명 상한이 그대로였습니다.
- 부모가 4명을 고르고 계획 모델이 조연 2명을 더하면(허용 범위) 시트까지 만든 뒤 줄거리에서 멈췄습니다. 작가실 켬·끔과 무관합니다.

## 고친 것
- 두 상한을 `MAX_CAST`로 통일(문구 `1~7명`). 회귀 테스트 추가. R12 inputs 핀 재고정(차이는 그 오류 문구 하나).

## 검증·배포
`npm test` 1145/1145 · 품질 85/85 · 미러 없음 · DOM `0e5035cf…` · 센서스 `PRO SAME AS TABLE true`·`ERRORS []`·`PAID 0` · 스모크 PASS. 캐시 v108. 유료 호출 없음.
배포 뒤 부모님이 같은 작업 카드에서 **'이어서 만들기'**(재료·시트는 그대로, 줄거리부터)를 누르면 됩니다. `CODEX_R53_COMPLETION_2026-11-03.md`에 한 줄 덧붙여 주세요.
