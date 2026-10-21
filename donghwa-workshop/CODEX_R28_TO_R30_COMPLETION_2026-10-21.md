# Codex r28~r30 완료 보고 · 2026-10-21

r28·r29·r29.1·S1·r30을 원본 그대로 반입해 **운영 v38 / 캐시 v71**로 배포했습니다. 통합 지시서 3절의 검증을 모두 통과한 뒤 커밋·푸시했으며, 운영 URL에서 무료 확인 5항목도 통과했습니다. 유료 API 호출은 **0회**입니다.

## 반입 방법과 커밋

- 방법 **B(diff 적용)**: `git diff --binary 09bb65e f15a97f -- donghwa-workshop` 결과를 운영 저장소에 `git apply --index -p2`로 적용했습니다.
- 원본 범위: `09bb65e..f15a97f`, 코드 끝 `f15a97f86f370be948d41952f1e83699f9c8f6cc`. 통합 지시서는 `3004d13`을 읽었습니다. 마지막 문서 커밋의 추가 변경까지 운영 소스에 넣지는 않았습니다.
- 운영 기준: v37 / v66, 소스 `5ccaa7ad988acc65316b9fa76e723abdcb12d7fe`. GitHub 기준 `09bb65e`의 코드 등 490개 파일과 일치함을 반입 전에 확인했습니다.
- 실제 반입 커밋: **`2b49a3cefe5c679781f4ded0a2348123247e37e5`**.
- 차이: **33개 파일, +2,075 / −93**으로 지시서와 같습니다. 반입 후 원본 코드·테스트·스크립트 등 **495개 파일**을 대조해 차이가 없었습니다.
- 원본 구현·핀·요금 코드를 추가 수정하지 않았습니다. `story-quality/` 두 사본·DB·서버 API·서버 비밀값·호스팅 설정은 유지했습니다.
- 운영 원본과 이력은 GitHub [`codex/production-r30-source`](https://github.com/Eachdoll/271/tree/codex/production-r30-source)에 푸시했습니다. 앱이 루트인 원본 브랜치입니다. 기존 `claude/cross-owner-repo-constraint-j20lhz`와 `donghwa-workshop/` 구조는 보존했습니다.

## 필수 검증 결과

아래 검증을 모두 끝낸 뒤 반입 커밋을 만들었습니다.

| 명령 | 실제 결과 |
| --- | --- |
| `npm test` | **tests 969 · pass 969 · fail 0** |
| `npm run test:quality` | **tests 85 · pass 85 · fail 0** |
| `diff -rq story-quality/dist dist/story-quality/dist` | 출력 없음, exit 0 |
| `npm run build` | Build complete, exit 0. 빌드 후 원본 추적 파일 변경 없음 |
| `node scripts/r12-legacy-dom.mjs --check` | readerSha256 = expected = `0e5035cff5dcd72be00b346b4cb67aa455c1eab8c848b3fcc3a4e6e4b81f6c16` |
| `node scripts/ux-census.mjs` | **PRO SAME AS TABLE true**, `02-settings-text` 입력 102, `07-outline` 버튼 121, **ERRORS [] · PAID 0** |
| `node scripts/r9-simple-smoke.mjs` | **1280px PASS · 390px PASS**, exit 0 |
| `git diff --cached --check` | 출력 없음, exit 0 |

브라우저 도구는 설치된 Chromium을 사용했습니다. 레거시 검사에는 기존 기준 JSON 사본을 넘겼고 원본 핀을 다시 고정하지 않았습니다. 명령의 실제 결과·소스 대조·화면 확인 기록은 [검증 JSON](QA/r28-r30-import-validation.json)에 있습니다.

## 운영 배포

- URL: **https://donghwa-workshop.seoulsemitec-3654.chatgpt.site**
- 운영 버전: **v37 → v38**.
- 캐시: **`donghwa-shell-v66` → `donghwa-shell-v71`**.
- 배포 상태: **succeeded**. 배포 소스는 위 실제 반입 커밋과 같습니다.
- 기존 공개 범위와 DB·R2·서버 환경 revision 1을 유지했습니다. DB 마이그레이션이나 비밀값 변경은 하지 않았습니다.
- 운영 브라우저에서 서비스 워커 **activated**, 캐시 `donghwa-shell-v71`을 확인했습니다. 새 모듈 `orchestration.js`(12,216바이트)와 `beat-writer.js`(21,534바이트)가 캐시에 있습니다.

## 운영 URL의 무료 확인 5항목

PC **1280px**와 모바일 너비 **390px**의 독립 브라우저 저장소에서 확인했습니다. 실제 가족 자료를 수정하지 않도록 클라우드 API는 격리했습니다.

| 항목 | 실제 결과 |
| --- | --- |
| 1. 안내가 기기마다 한 번 | 첫 화면 1회, 새로고침 후 0회. `donghwa-notice-r30` = `1`. 문구에는 정성 모드 변경과 12쪽 글 요금 약 $2.11이 표시됨 |
| 2. 설정의 스위치·요금 설명 | ‘정성 모드(기본 켜짐)’ 켜짐, ‘정성 모드 작가는 최고 모델로’ 꺼짐. ‘비트별 작가 약 20회·중간 모델’ 표시 |
| 3. 쉬운 ③ | 접힌 ‘엔진·예상 요금’에 두 스위치가 있고 OpenAI·12쪽에서 **약 $2.18** 표시 |
| 4. 데모 비트 장소 | 비트 1의 ‘다른 장소’에서 숲 선택 → 비트 1만 `home → forest`, 뒤 여섯 비트는 그대로 |
| 5. 기존 책 | 기존 샘플 책 `seed-dinosaur` 12쪽을 열고 다음 쪽을 읽었으며 책의 쪽 데이터는 변경되지 않음. 생성된 기존 책의 읽기 화면·배치는 별도 레거시 해시 검사로 동일함을 확인 |

브라우저 페이지 오류와 유료 공급자 요청은 모두 0입니다.

## 견적표와 실측 구분

통합 지시서 2절 예시는 새 작업 $1.937·37요청입니다. 이번 새 브라우저의 실제 설정 요약은 **$2.110·39요청**, 1회 안내는 **약 $2.11**, 쉬운 ③은 지시서대로 **약 $2.18**이었습니다. 예시 표의 $1.937·37요청과 일치한다고 보고하지 않습니다. 원본 견적 코드를 바꾸거나 화면 값을 강제로 맞추지는 않았습니다. 모든 수치는 공급자 실제 청구액이 아닌 앱의 추정입니다.

## 유료 확인과 남은 범위

유료 1권 생성은 실행하지 않았습니다. 실제 모델의 성장 설계·세 각도 후보·비트별 글 품질·되풀이 말 반영·실제 요청 수와 청구액은 확인하지 않았습니다. 모의 엔진 테스트와 무료 화면 검증을 실제 유료 품질 평가와 구분합니다.

모바일 확인은 Chromium의 화면 너비 검사이며 실제 iPhone Safari 검증은 아닙니다. 배포 뒤 사용 중인 기기에서 한 번 더 새로고침해 새 서비스 워커를 적용하면 됩니다.
