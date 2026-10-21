# Codex r30.1 완료 보고 · 2026-10-21

## 반입

- **경우 B**: 기존 운영 v38 / `donghwa-shell-v71`에 후속 반입했습니다.
- 지정 범위: `f15a97f..354eda7` (코드 끝 `354eda7ad9525314869f97581813779dfa1d40af`). `d2e98cf`·`3004d13`의 문서도 이 범위 그대로 포함했습니다.
- 지시서 기준: `653b704`의 `CODEX_WORK_ORDER_R30_1_2026-10-21.md`.
- 반입 방법: 원본 저장소 `donghwa-workshop/`의 binary diff를 Sites 저장소 루트에 `git apply --index -p2`로 적용했습니다. 추가 기능 구현이나 핀 재생성은 하지 않았습니다.
- 반입 결과: 12파일 +842/−10 (코드 커밋 자체는 9파일 +612/−10). 지정 원본과 앱·테스트·패키지·서버·빌드 스크립트 등 492파일이 동일합니다.
- 운영 소스 커밋: `bc4364723eb51ca06072b137b8d18456fb2839d6` (`donghwa-workshop: r30.1 영어 맞추기 반입 · 캐시 v72`).

## 검증 결과

모든 필수 검사를 통과한 뒤 커밋·배포했습니다.

| 검사 | 결과 |
| --- | --- |
| `npm test` | **972/972 PASS** |
| `npm run test:quality` | **85/85 PASS** |
| `diff -rq story-quality/dist dist/story-quality/dist` | 출력 없음, 두 사본 동일 |
| `npm run build` | PASS, 변경된 프런트엔드와 배포 산출물 동일 |
| `scripts/r12-legacy-dom.mjs --check` · 포트 4960 | PASS, `0e5035cff5dcd72be00b346b4cb67aa455c1eab8c848b3fcc3a4e6e4b81f6c16` 유지 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, 쉬운 단계 버튼 한도 통과, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | **1280·390 PASS**, 페이지 오류·유료 요청·가로 넘침 없음 |
| r30.1 무료 데모 수정 검사 | 로컬·운영 모두 **1280·390 PASS** |

새 단위 테스트 3개는 영어만 변경·한글 보존, 앞뒤 영어/이름/비트/읽기 규격 전달, 최대 한 번의 추가 시도와 참고 처리, 실패 사용량 기록, 그림 stale 표시, 다른 비트 영어 보존을 모의 엔진으로 검사합니다. R12·R13 핀은 변경하지 않았습니다.

## 배포

- URL: https://donghwa-workshop.seoulsemitec-3654.chatgpt.site
- 운영 버전: **v39**
- 서비스 워커: **`donghwa-shell-v72`**
- 저장 버전 ID: `appgprj_6acf7d49d818819196c04d5ff8fa10cd~appgver_4f744b41a2e8819186b149b55682effd`
- 배포 ID: `appgdep_6ad8777f3fd48191b8df9052be5f08f8`
- 배포 결과: `succeeded` · `2026-10-21T08:28:04.141011+00:00`
- DB·서버·마이그레이션·비밀값 변경 없음. 기존 공개 범위와 프로젝트 ID를 유지했고 환경 리비전은 `1` 그대로입니다.

## 배포 후 확인

무료 검사는 실제 운영 사이트의 새 PC·모바일 프로필에서 수행했습니다. 클라우드 요청을 격리해 기존 가족 책장에는 쓰지 않았고 유료 공급자 요청은 차단·계수했습니다.

- 쉬운 ④에서 데모 책의 **한글만 수정 → 저장**: 고친 한글 저장, 영어 원문 유지, ‘영어도 이 한글에 맞출까요?’ 창 **0회**.
- 두 너비 모두 페이지 오류 **0**, 유료 API 요청 **0**.
- 새 서비스 워커 `activated`, 캐시 목록 `donghwa-shell-v72`, 캐시에 영어 맞추기 파이프라인 포함을 확인했습니다.
- 실제 엔진 책의 제안 창 → 영어 재작성 → 사건 일치 → 그림 별도 확인은 **유료이므로 실행하지 않았습니다**. 이 확인은 부모님이 별도로 승인한 1회 약 $0.02의 실제 엔진 시험으로 남습니다. 모의 테스트 통과가 실제 영어 품질 측정을 뜻하지 않습니다.

## GitHub 전달

- 운영 소스 전체(앱이 루트에 있는 Sites 형식): [`codex/production-r30-1-source`](https://github.com/Eachdoll/271/tree/codex/production-r30-1-source), HEAD `bc4364723eb51ca06072b137b8d18456fb2839d6`.
- 원본 `donghwa-workshop/` 폴더 형식의 검증 보고 브랜치: [`codex/r30-1-verified`](https://github.com/Eachdoll/271/tree/codex/r30-1-verified). 원본 지시서 `653b704` 위에 이 보고서와 `QA/r30-1-import-validation.json`만 추가했습니다.
- Claude 공유 브랜치는 덮어쓰지 않았습니다. 코드 변경은 지정된 `354eda7`까지이며 이후 라운드는 반입하지 않았습니다.
- 테스트·브라우저 기록: `QA/r30-1-import-validation.json`. 보고서와 검증 JSON에는 인증 토큰·API 키·가족 초대 코드가 없습니다.
