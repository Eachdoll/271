# Codex r5 완료 보고 · 2026-10-17

기준: r4 `bb8f0742c8e7feb920e33a4c67647b7e155876b2`. `CODEX_WORK_ORDER_R5_2026-10-17.md`의 R5-1·R5-2 두 항목만 수정했습니다.

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `story-quality/src/prompts.ts` | CHILD_CURIOSITY_USER·CHILD_RETELL_USER·WEEKLY_COACH_USER의 failureReason ID 지시문 3줄 삭제. OUTLINE_USER·BEAT_CANDIDATES_USER는 그대로 유지. |
| `story-quality/dist/prompts.js`, `dist/story-quality/dist/prompts.js` | 루트 빌드로 재생성. 두 사본 바이트 일치. |
| 두 경로의 `prompts.d.ts` | TypeScript 빌드가 내보낸 문자열 리터럴 선언 자동 동기화. |
| `dist/sw.js` | 캐시 이름만 `donghwa-shell-v23`으로 변경. 프리캐시 목록 유지. |
| `story-quality/eval/testset.json` | description을 현재 9·과거 6·미래 3·상상 2로 정정. 고정 주제·pages 등 나머지 필드 유지. |
| `story-quality/prompts/outline.v3.md` | maxTokens 4,000, 온도 전송 대상 및 JSON 1회 재시도 설명을 지정 문구로 정정. |
| `story-quality/test/evaluated-regressions.test.mjs` | 관련 프롬프트에만 failureReason 지시문이 남는지 검사하는 테스트와 description의 시대별 수치를 실제 주제에서 집계해 비교하는 테스트 2개 추가. |

## 검증 결과

- `npm run build`: 성공. TypeScript·브라우저 사본·Sites Worker 빌드 완료.
- `npm test`: **428개 통과**.
- `npm run test:quality`: **45개 통과**(기존 43 + 새 회귀 2). 합계 **473개 통과**.
- 지시문 `failureReason은 설명이 아니라`의 소스 내 개수: **2**.
- `story-quality/dist/prompts.js`와 `dist/story-quality/dist/prompts.js`: 바이트 일치.
- 변경 전후 런타임 export 문자열 비교: 변경된 프롬프트는 지정한 3개뿐. 줄거리·비트 후보 문자열은 바이트 일치.
- 고정 평가 세트의 description 외 필드는 기준 커밋과 동일.
- 원본 `.jsonl`·`.summary.json`·`verified-offline.json`: 기준 커밋과 바이트 일치.
- `verify-offline.mjs`: 네트워크 차단 상태로 재집계. 시대별 수치 9/6/3/2 일치, 규칙 통과 11/20·13/20 유지. 출력은 QA에 별도 보존.
- 서비스 워커는 캐시 이름 외에 변경 없음. `git diff --check` 통과.

새 모델 생성·판정·증류·주간 코치 등 유료 API 호출은 하지 않았습니다. 이번 변경의 검증 범위는 프롬프트 문자열·문서·빌드·자동 테스트이며, 전문·쪽 나누기 실평가는 실행하지 않았습니다. DB·엔진 설정·기타 앱 코드는 변경하지 않았습니다.

## 전달

전체 코드 ZIP에 `SOURCE_COMMIT.txt`, `SOURCE_MANIFEST.sha256`, 이 완료 보고, 테스트·빌드 로그, 오프라인 재집계 및 `QA/deployment.json`을 포함합니다. 정확한 소스 커밋과 운영 배포 성공 여부는 해당 파일에서 확인할 수 있습니다. 키·사용자 DB·`.git`·`node_modules`는 포함하지 않습니다.

운영 주소: https://donghwa-workshop.seoulsemitec-3654.chatgpt.site
