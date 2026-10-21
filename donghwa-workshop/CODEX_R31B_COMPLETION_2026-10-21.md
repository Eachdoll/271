# Codex r31b 최종 반입 완료 보고 · 2026-10-21

**앱 코드 92dce12에 이어 A/B 러너 aa28d88와 갱신 지시서 23ad38d까지 모두 반입·검증·푸시했습니다.** 운영 v42 / 캐시 v74로 소스 이력을 동기화했습니다. 이번 추가 반입은 CLI·테스트·문서뿐이며 앱 런타임은 직전 v41과 같습니다.

## 반입

- 직전 완료: `327dede..92dce12` → 운영 소스 `eaaaa57631963771d48ee87ca2ff0e3008ab79cd` (v41).
- 이번 추가: **`92dce12..23ad38d`**, 4파일 +520/−1.
- 러너 코드: **`aa28d88dd996afd37a8bf2546a6828ed57c4e028`**.
- 갱신 지시서: **`23ad38dfaf07330e37cdbd4cb719952b1b93867b`**.
- 운영 소스 커밋: **`665ab3d46df540e1d857a38e348a7241e4255800`** — `donghwa-workshop: r31b A/B 러너 aa28d88 및 지시서 23ad38d 반입`.
- `CLAUDE.md`, `scripts/r31b-ab.mjs`, `tests/r31b-ab-script.test.mjs`, 최종 지시서를 원본 그대로 반입했습니다. 첨부한 러너와 지시서도 반입 파일과 바이트 단위로 같습니다.

## 검증

| 검사 | 결과 |
| --- | --- |
| `npm test` | **990/990 PASS** |
| `npm run test:quality` | **85/85 PASS** |
| `node --check scripts/r31b-ab.mjs` | PASS |
| K1 양쪽 `--demo` | r31a·diet 모두 `text-review`, 비용 $0 |
| K2 양쪽 `--demo` | r31a·diet 모두 `text-review`, 비용 $0 |
| 비교표·원고·JSON | K1·K2 각각 5개 파일 생성, K1에는 Dola 골든 열 포함 |
| 정책 | 두 실행의 다른 정책 값은 같고 `promptDiet` 유무만 다름 |
| 실행 가드 | `--paid` 없는 실제 실행 거절 테스트 통과 |
| 결과물 검사 | 키 관련 필드·키 문자열이 결과 파일에 없음 |

데모 기록의 요청 수는 편당 3으로 표시되며 데모 단계 기록입니다. 유료 API 호출 수는 0이고 편당 기록 비용도 $0입니다. 데모 비교표는 배선 점검이며 실제 모델의 원고 품질 차이 평가가 아닙니다.

K1은 12개 검사 항목입니다. K2는 펼침면과 낱쪽을 합쳐 9개 검사 항목이며, 펼침면을 2쪽으로 세면 **인쇄 쪽 수는 12쪽**입니다. 러너의 표에 보이는 ‘쪽’ 수는 이 검사 항목 수이므로 인쇄 쪽 수와 구별해야 합니다.

## 기존 앱 검사 유지

추가 커밋에서 `dist/`, 서버, Cloudflare 런타임, 품질 패키지, 빌드 스크립트, 패키지 설정, 호스팅 설정의 Git 객체가 직전 소스와 모두 같은 것을 확인했습니다. 따라서 입력이 바뀌지 않은 기존 빌드와 브라우저 검사 결과를 재사용했습니다.

- 읽기 화면 해시: `0e5035cff5dcd72be00b346b4cb67aa455c1eab8c848b3fcc3a4e6e4b81f6c16`.
- UX 기준표 일치, 쉬운 단계 버튼 한도 통과, 오류·유료 요청 0.
- 전체 제작 스모크 1280·390 PASS.
- K1 12쪽 약 $0.99 유지. K2·E0 16쪽, 재료 자동 계획 포함 약 $1.72이며 문서 예시 $1.66과의 차이는 직전 보고의 계산 근거 그대로입니다.
- DB·서버·마이그레이션·비밀값 변경 없음. 환경 리비전 1 유지.

## 배포

- URL: https://donghwa-workshop.seoulsemitec-3654.chatgpt.site
- 운영 버전: **v42**.
- 캐시: **`donghwa-shell-v74`** (앱 런타임 변경 없음).
- 저장 버전: `appgprj_6acf7d49d818819196c04d5ff8fa10cd~appgver_0d07cadcded08191af6ba1611b5248c2`.
- 배포 ID: `appgdep_6ad92fdeda048191ba9bba4a2be04332`.
- 결과: `succeeded` · `2026-10-21T21:34:38.327808+00:00`.

## 결과와 유료 A/B 상태

무료 원고·실측·비교표는 `QA/r31b-ab-demo/`에 보관했습니다. 실제 유료 결과와 혼동하지 않도록 `--demo` 결과임을 별도 README에 표시했습니다.

**유료 A/B는 아직 실행하지 않았습니다.** 이 실행 환경에 `OPENAI_API_KEY`·`ANTHROPIC_API_KEY`·`GOOGLE_API_KEY`가 없음을 값 노출 없이 확인했습니다. 부모님 PC의 셸에서 환경 변수로 키를 지정하고 최종 지시서의 `--paid` 명령을 실행해야 실제 비교 원고·요금이 생성됩니다. 채팅에 키를 적을 필요는 없습니다.

## GitHub

- 운영 소스: [`codex/production-r31b-source`](https://github.com/Eachdoll/271/tree/codex/production-r31b-source), HEAD `665ab3d46df540e1d857a38e348a7241e4255800`. 앞선 앱 반입 커밋 위에 이번 4파일 반입을 이어서 푸시했습니다.
- 최종 지시서 기반의 원본 폴더 형식 및 보고: [`codex/r31b-ab-verified`](https://github.com/Eachdoll/271/tree/codex/r31b-ab-verified).
- 검증 기록: `QA/r31b-ab-import-validation.json`, 무료 결과: `QA/r31b-ab-demo/`.
- 공유 Claude 브랜치는 덮어쓰지 않았으며 `23ad38d` 이후 코드는 반입하지 않았습니다.
