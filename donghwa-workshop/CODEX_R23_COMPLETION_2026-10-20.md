# Codex r23 완료 보고 · 2026-10-20

새 초안의 기본 규칙 복원·설계서 우선 시드·줄거리와 그림 지시 축소를 반영했습니다. 기존 정책 없는 초안의 요청은 그대로 유지합니다.

## 반입 방법

- 원본: `Eachdoll/271`, `claude/cross-owner-repo-constraint-j20lhz`, 범위 **`9b7bd4b..6b6db72`**.
- 코드 커밋 `6b6db72` → 운영 저장소 `4002904`. 다음 지시서 커밋도 각각 반입했습니다.
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
