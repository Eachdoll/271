# Codex 지시서 r55a-2 · 핫픽스 · 작가실 스위치를 부모 설정에도 · 2026-11-03

v60 배포 감사합니다. 부모님이 "작가실 스위치가 없어"라고 했습니다. 스위치가 ③ 안에만 있고 열린 작업이 있으면 숨겨졌습니다.

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | **`9f28ac7`** (캐시 `donghwa-shell-v106`) |
| 반입 범위 | 운영에 반입된 마지막 커밋 `..9f28ac7` (R55a 지시서 `84f1eb6` 이후면 `84f1eb6..9f28ac7`) |
| 바뀐 파일 | `dist/story-generation/quality-settings.js`, `dist/simple-create.js`, `dist/sw.js`, `scripts/ux-census.mjs`, `tests/story-quality-settings.test.mjs`, `CLAUDE.md` |

## 달라진 것
- **부모 설정 → 더 보기 → 글 모델** 맨 위에 **'작가실로 만들기'** 스위치. '모델 저장'을 누르면 저장됩니다(③의 스위치와 같은 값).
- ③의 작가실 스위치는 이미 만든 이야기가 열려 있어도 보입니다(잠긴 채 그 이야기의 상태).

## 검증·배포
`npm test` 1141/1141 · 품질 85/85 · 미러 없음 · DOM `0e5035cf…` · 센서스 `PRO SAME AS TABLE true`·`ERRORS []`·`PAID 0` · 스모크 PASS. 캐시 v106. 유료 호출 없음. 배포 뒤 부모 설정 '더 보기 → 글 모델'에 스위치가 보이는지 확인하고 `CODEX_R53_COMPLETION_2026-11-03.md`에 한 줄 덧붙입니다.
