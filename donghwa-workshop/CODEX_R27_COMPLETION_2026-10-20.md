# Codex r27 완료 보고 · 2026-10-20

압축 후에도 localStorage 한도를 넘으면 IndexedDB에 먼저 저장한 뒤 작은 포인터를 남깁니다. 읽지 못한 포인터는 보호하고, 완성된 FULL AUTO 작업의 재개용 유료 호출 기록 다섯 종을 정리합니다.

## 반입 방법

- 원본: `Eachdoll/271`, `claude/cross-owner-repo-constraint-j20lhz`, 범위 **`2b94f8b..5daac59`**.
- 코드 커밋 `5daac59` → 운영 저장소 `771264a`. 다음 지시서 커밋도 각각 반입했습니다.
- 운영 v36을 기준으로 **r23 → r26 → r24 → r25 → r27**의 코드·문서 10개 커밋을 순서대로 반입했습니다. 전체 마지막 원본은 `09bb65efef28811f17c87d8560699168b26a4386`입니다.
- `git format-patch` / `git am -p2`로 `donghwa-workshop/` 접두사만 제거했습니다. Claude 구현 코드는 추가 수정하지 않았습니다. 별도의 핀 재고정도 하지 않았습니다.

## 검증 결과

각 라운드를 차례로 반입한 **최종 통합본**에서 실행했습니다. 중간 커밋별 테스트 개수를 별도로 재측정하지 않았습니다.

| 검사 | 결과 |
| --- | --- |
| `npm test` | **953/953** |
| `npm run test:quality` | **85/85** |
| `npm run build` | PASS, 추적 파일 변경 없음 |
| `diff -rq story-quality/dist dist/story-quality/dist` | 동일 |
| UX 센서스 | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| 읽기 DOM·배치 | `0e5035cff5dcd72be00b346b4cb67aa455c1eab8c848b3fcc3a4e6e4b81f6c16`, 기존과 동일 |
| 쉬운 만들기 스모크 | 1280px·390px PASS |
| 소스 대조 | GitHub `09bb65e`의 코드·테스트·스크립트·개발 규칙 등 490개 파일의 blob SHA 동일 |

테스트는 모의 공급자를 사용했습니다. 유료 API 호출·실제 동화 품질 평가는 실행하지 않았습니다. 자세한 기록은 [검증 JSON](QA/r27-import-validation.json)에 있습니다.

## 운영 배포

- URL: https://donghwa-workshop.seoulsemitec-3654.chatgpt.site
- **버전 37**, 서비스 워커 **v66**.
- 배포 소스: `5ccaa7ad988acc65316b9fa76e723abdcb12d7fe`. 상태 `succeeded`.
- DB 마이그레이션·서버 비밀값 변경 없음. 기존 D1·R2와 공개 범위를 유지했습니다.
- 운영 원본 SHA는 GitHub [`codex/production-r27-source`](https://github.com/Eachdoll/271/tree/codex/production-r27-source)에 보존했습니다. 앱이 루트에 있는 원본 브랜치입니다. 다음 개발은 기존 `claude/cross-owner-repo-constraint-j20lhz`의 `donghwa-workshop/` 구조를 계속 사용하면 됩니다.


## 실제 사이트의 무료 확인

운영 사이트에서도 PC 1280px·모바일 너비 390px의 새 브라우저 저장소로 확인했습니다. 실제 가족 자료를 건드리지 않도록 클라우드 API를 격리했습니다.

- 책장 키의 localStorage 한도를 **300자**로 낮추고 저장했습니다. **61자 포인터**와 IndexedDB 저장을 확인했고 새로고침 뒤 즐겨찾기를 그대로 읽었습니다. 보관 공간 패널에 ‘큰 보관함(IndexedDB) 사용 중’이 표시됐습니다.
- IndexedDB에 해당 책장이 없는 포인터로 시작하면 ‘자료 보호 중’이 표시되고 원본 포인터는 유지됐습니다.
- 회의 대기 작업에서 ③ 접힌 요금의 ‘남은 예상’과 회의 패널 ‘이 안으로 글 끝까지’가 같은 값으로 나옵니다. 테스트용 작업의 값은 두 곳 모두 **약 $1.76**입니다. 실제 사용자의 청구액이 아닙니다.
- 모바일 설정 저장 막대가 한 줄이며, 선택·메모 유지·계속 버튼·가로 넘침 없음도 확인했습니다.
- 운영 파일에서 v66, `transient-retry.js`, `prompt-policy.js` 제공을 확인했습니다. 브라우저 오류 0, 유료 공급자 요청 0입니다.

## 핀과 확인 범위

R12의 `inputs`·`fullAutoDemo`는 새 `promptPolicy`·빈 `councilRecent` 필드, `review`는 스위치·버튼·새 작업 요금 표시, `estimates`와 R13 앱 핀은 r26의 새 작업 판정 요금 변경 때문에 갱신된 원본 그대로입니다. 기존 초안의 요청·모델·읽기·인쇄·그림 지문은 회귀 테스트로 유지했습니다.

큰 책장의 저장은 기기 안 IndexedDB이며 가족 클라우드 용량을 늘리는 변경은 아닙니다. 포인터를 읽는 동안 시작 화면이 늦어질 수 있습니다. 실제 iPhone Safari·기기 디스크 전체가 찬 상태는 여기서 확인하지 않았습니다. 해당 기기에서는 새로고침을 한 번 더 한 뒤 보관 공간 표시와 저장 여부를 확인해 주세요. ‘오래된 작업 기록 정리’는 백그라운드 검사에서 실제 가족의 기록을 지우는 방식으로 실행하지 않았습니다.
