# R61b 반입 검증 · 2026-11-12

R61 + R61a + R61b (`24aa60b`)를 R60 운영 소스에 반입했습니다. 실제 경로 검사에서 영어 누락 쪽이 옆 쪽과 합쳐져 안내가 지워지는 결함을 추가로 찾아 고쳤습니다. `FINDING_BEFORE_FIX.md`는 변경 전 진단입니다.

- `validation.json`: 최종 1211 + 85, 핀·빌드·브라우저 결과.
- `upstream-recheck-before-codex-fix.json`: upstream이 기존 느슨한 조건 5개를 통과하던 결과. `english`의 원고 빈칸과 최종 옆 쪽 영어를 비교하십시오.
- `recheck.json`: 강화한 조건과 고정 시드 호환 비교, R60 실패 체크포인트를 새 코드가 새 호출 없이 재생한 결과.
- `local.json`: 새 독립 브라우저 PC·모바일에서 ④ 안내, 읽기·영어판 인쇄 빈칸 확인.
- `census.json`, `smoke.json`: 최종 코드의 7표 및 전체 무료 데모 흐름.
- `source-comparison.json`: upstream과의 의도적 런타임 차이는 book-layout.js와 writers-room.js뿐. 빌드 사본 불일치 없음.
- `tools/extended-recheck.mjs`: `DONGHWA_APP_ROOT`, `DONGHWA_R60_ROOT`, `DONGHWA_AUDIT_OUT` 지정 후 node로 실행. fetch 차단. 만들어지는 임시 fixture는 커밋하지 않습니다.
- `tools/browser.mjs`: node <script> <baseURL> <output.json> <generated-fixture.json>. 새 브라우저에서 공급자 요청과 가족 cloud API를 차단합니다. PIN은 테스트용 고정값입니다.

유료 호출 0, 실제 가족 자료 접근/수정 0. 그림·전체 책장·실제 키/PIN은 기록하지 않았습니다. 이전 책과 요청 호환성은 고정 입력·시드와 회귀 핀으로 검증했으며, 실제 모델의 그림 품질은 이번 무료 검사 범위 밖입니다.
