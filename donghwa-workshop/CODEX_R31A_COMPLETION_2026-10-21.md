# Codex r31a 완료 보고 · 2026-10-21

## 반입 범위와 커밋

기존 운영 **v39 / 캐시 v72(r30.1 적용)**를 확인하고 지정 범위 **`354eda7..327dede`**만 반입했습니다.

- 원본: https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` · `donghwa-workshop/`.
- 코드 끝: `327dede96db7459894c249d873c70304a3b470b1`. 지시서 기준은 `a3f361e282151016e2b695e79ea1b415d530f692`입니다.
- 반입: 원본 범위 binary diff를 Sites 앱 루트에 `git apply --index -p2`로 적용했습니다. 중간 문서 커밋 `653b704`도 범위대로 포함했습니다.
- 결과: **28파일 +1011/−52**, 앱·테스트·패키지·서버·빌드 스크립트 등 **498파일 원본과 동일**. 별도 기능 구현이나 임의 핀 재생성은 하지 않았습니다. 원본의 K1 핀 변경은 그대로 포함했습니다.
- 운영 소스: **`c040638375c0f8d038e4b9433313207ef6448d75`** — `donghwa-workshop: r31a K1 그림책 반입 · 캐시 v73`.

새 K1 초안의 짧은 문장 규격, 작은 바람·걸림돌 중심의 이야기 뼈대, 책 전체를 쪽별로 한 번에 쓰고 걸린 쪽만 한 번 고치는 경로, 추가 모델 요청 없는 쪽 나누기와 새 쉬운 이야기의 주제 끝맺음을 반입했습니다. 기존 저장 초안에는 새 정책을 소급하지 않습니다.

## 지시서 2절 검증

모든 필수 검사를 통과한 뒤 커밋·푸시·배포했습니다.

| 검사 | 결과 |
| --- | --- |
| `npm test` | **982/982 PASS** |
| `npm run test:quality` | **85/85 PASS** |
| `diff -rq story-quality/dist dist/story-quality/dist` | 출력 없음, 두 사본 동일 |
| `npm run build` | PASS, 새 모듈과 서비스 워커가 배포 산출물에 반영됨 |
| `scripts/r12-legacy-dom.mjs --check` · 포트 4960 | PASS, `0e5035cff5dcd72be00b346b4cb67aa455c1eab8c848b3fcc3a4e6e4b81f6c16` 유지 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, 쉬운 단계 버튼 한도 통과, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | **1280·390 PASS**. 페이지 오류·유료 요청·가로 넘침 없음 |
| K1 안내·③ 요금·데모 수정·샘플 그림 | 로컬·운영 모두 **1280·390 PASS** |

새 테스트 10개를 포함합니다. 골든 원고 12쪽은 새 K1 문장 규격에서 통과했고, 예전 규격에서 3·5·6·10쪽이 걸리는 결과도 유지했습니다. 모의 엔진으로 책 전체 1회 작성·지적된 쪽만 1회 보완·쪽 나누기 요청 0회·유료 사용량 보존을 확인했습니다. 이 검사는 실제 생성 모델의 원고 품질 평가를 대신하지 않습니다.

## 배포

- URL: https://donghwa-workshop.seoulsemitec-3654.chatgpt.site
- 운영 버전: **v40**
- 서비스 워커: **`donghwa-shell-v73`**
- 저장 버전 ID: `appgprj_6acf7d49d818819196c04d5ff8fa10cd~appgver_d858e6fee4f48191b6061102c53af447`
- 배포 ID: `appgdep_6ad8931ea51c8191a48814af4f8df03e`
- 결과: **`succeeded`** · `2026-10-21T10:25:55.605056+00:00`
- DB·서버·마이그레이션·비밀값 변경 없음. 공개 범위와 프로젝트 ID를 유지했고 환경 리비전은 `1` 그대로입니다.

## 지시서 4절 운영 확인

실제 운영 URL의 새 PC(1280)·모바일(390) 프로필에서 무료 검사를 수행했습니다. 클라우드 요청을 격리해 기존 가족 책장에 쓰지 않았고 유료 공급자 요청을 차단·계수했습니다.

| 확인 항목 | 결과 |
| --- | --- |
| K1 첫 안내 | 첫 접속 1회, 새로고침 후 0회. ‘K1 그림책이 새로워졌어요…’ 문구와 안내 추정 **$0.92** 표시 |
| 쉬운 ③ K1 12쪽 | **‘GPT · OpenAI · 글 약 $0.99’** 표시 |
| 데모 12쪽 제작 | ④ 진입, 고친 한글 저장, 기존 영어 보존, 데모 영어 맞추기 제안 없음 |
| 데모 그림 | 두 번째 쪽 샘플 그림 저장, 앞서 수정한 한글·영어 보존 |
| 정책 고정 | 새 작업의 `k1Policy`·`topicEndingPolicy` 및 `endingType: custom` 확인 |
| 서비스 워커 | `activated`, 캐시 **v73**, 새 모듈 3개가 모두 사전 캐시에 있음 |
| 오류·비용 | 두 너비 모두 페이지 오류 **0**, 유료 API 요청 **0** |

유료 K1 한 권 생성과 유치원 결말·소리말·쪽 넘김·실제 요청 수·골든 원고 비교는 **실행하지 않았습니다**. 부모님이 승인한 글 약 $1의 실제 엔진 시험으로 남겨 둡니다. 이번 검증으로 실제 모델 출력의 품질 점수를 주장하지 않습니다.

## GitHub 전달

- 운영 소스 전체(Sites의 루트 앱 형식): [`codex/production-r31a-source`](https://github.com/Eachdoll/271/tree/codex/production-r31a-source), HEAD `c040638375c0f8d038e4b9433313207ef6448d75`.
- 원본 `donghwa-workshop/` 폴더 형식의 보고 브랜치: [`codex/r31a-verified`](https://github.com/Eachdoll/271/tree/codex/r31a-verified). 지시서 `a3f361e` 위에 이 보고서와 `QA/r31a-import-validation.json`을 추가했습니다.
- 공유 Claude 브랜치는 덮어쓰지 않았으며 `327dede` 뒤의 코드 변경을 반입하지 않았습니다.
- 검증 JSON에는 배포 정보·필수 검사·무료 운영 확인 결과를 담았습니다. API 키·배포 인증 토큰·가족 초대 코드는 포함하지 않았습니다.
