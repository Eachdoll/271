# Codex 지시서 r54d · 핫픽스 · 작가실 초고 단계가 멈추던 문제 + A/B 리포트 · 2026-11-04

유료 A/B(같은 주제·두 엔진)를 돌리다 **운영에서도 재현될 버그**를 찾아 고쳤습니다. 작가실을 켠 책은 전제·줄거리 뒤 "작가실 · 초고 쓰기"에서 `services.engineFor is not a function`으로 멈춥니다(v60~61).

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | **`1be4bff`** (캐시 `donghwa-shell-v113`) — 이 지시서 커밋까지 포함하면 `1be4bff` 이후 |
| 반입 범위 | r54c·r55b 지시서 `81310b2` 이후: `81310b2..HEAD` (앞 라운드 미배포면 `ef89487..HEAD` 한 번에) |
| 바뀐 파일 | `dist/story-generation/pipeline.js`(`roomServices` export), `dist/story-generation/writers-room.js`(`withEngines`), `dist/sw.js`, `tests/writers-room-r54b.test.mjs`, `scripts/r54-room-ab.mjs`(새 러너), `QA/r54-room-ab/`(리포트·원본), `CLAUDE.md` |

## 원인·고침
- FULL AUTO는 `ops.roomDrafts(input, outline, opts)`·`ops.roomPages(...)`를 단계 옵션만으로 부르는데 두 함수는 `services.engineFor`를 요구했습니다(테스트는 모두 services를 직접 넘겨 잡지 못함). 이제 없으면 파이프라인의 엔진 해결기로 채웁니다. 회귀 테스트 추가.

## 검증
`npm test` 1120/1120 · 품질·미러·DOM·센서스·스모크는 r55b-2 그대로(이 커밋은 두 함수의 기본값만). 유료 실행은 제가 부모님 키로 한 번 했고(총 약 .6) 키는 어디에도 없습니다. 배포 뒤 작가실로 한 권 만들어 "초고 쓰기"를 지나가는지 확인하고 `CODEX_R53_COMPLETION_2026-11-03.md`에 한 줄 덧붙여 주세요.

## 리포트
`QA/r54-room-ab/REPORT_2026-11-04.md` — 개선점 여덟 가지(독자단 고르기 형식, 브리프 밀도 목표, 제본 all-pairs 규칙, 영어판 성별·분량, 교훈 꼬리말, 작가 상위 모델 통일, 추정 보정, 새 인물 카드). 구현은 부모님 결정 뒤 다음 라운드(R54e)입니다.
