# Codex 지시서 r26 · 검사 모델 분리(사건 연결 판정은 중간 모델) · 2026-10-20

한 권 글 요금의 큰 몫이던 사건 연결 검토 2회의 **판정**을 한 단계 낮은 모델로 옮겼습니다. 글을 쓰고 고치는 호출과 책 전체 통독은 상위 모델 그대로입니다. **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | r23 지시서 = `0109553`. r23을 아직 반입하지 않았다면 r23 지시서(범위 `9b7bd4b..6b6db72`)를 먼저 따릅니다. |
| 반입 범위 | **`0109553..bfd7f23`** (이 문서는 다음 커밋) |
| 새 파일 | `tests/review-model-r26.test.mjs` |
| 바뀐 파일 | `dist/text-generation/{models,settings-ui}.js`, `dist/full-auto.js`, `dist/simple-create.js`, `dist/story-generation/{pipeline,ui,page-tools,book-coherence}.js`, `dist/sw.js`(v63), `scripts/ux-census.mjs`(표 +1 입력), `tests/{openings-legacy-r12,engine-model-choice-r13}.test.mjs`, `CLAUDE.md` |

패키지(`story-quality/`)는 바뀌지 않았습니다.

## 1. 무엇이 달라졌나

| 항목 | 전 | 후 |
| --- | --- | --- |
| 사건 연결 판정(전문·쪽 각 1회) | 상위 모델(예: GPT-6 Astra) | **중간 모델**(예: GPT-6.1 Sol) |
| 사건 연결 수정(지적된 곳만) | 상위 모델 | 상위 모델 그대로 |
| 책 전체 통독 | 상위 모델 | 상위 모델 그대로(쪽을 고쳐 쓰므로) |
| 그림 전 검사(부모가 글을 고친 뒤, 수정 없음) | 상위 모델 | 중간 모델 |
| 글 요금 추정(기본, 새 이야기) | 16쪽 약 $2.66 · 12쪽 약 $2.41 | **16쪽 약 $2.09 · 12쪽 약 $1.87** |

- 새 FULL AUTO 작업(데모 제외)과 새 프로 초안이 만들 때 이 선택을 고정합니다(`textSettings.reviewTier`). 진행 중인 작업과 기존 책은 그대로 상위 모델로 검사하고, 요청·추정이 전과 바이트 단위로 같습니다.
- **'검사는 최고 모델로' 스위치**: 쉬운 ③의 접힌 '엔진·예상 요금' 안, 프로 부모 설정의 글 엔진 화면. 켜면 새 이야기의 판정도 상위 모델로 돌아갑니다(기본 꺼짐). 이야기가 시작되면 ③ 스위치는 그 이야기의 값으로 잠깁니다.
- 로컬 엔진은 두 단계가 같은 모델이라 스위치를 보이지 않습니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **940/940** (새 `tests/review-model-r26.test.mjs` 5개) |
| `npm run test:quality` | **85/85**, 두 사본 동일 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`(글 설정 입력 100개로 표 갱신), `ERRORS []`, `PAID 0`, 쉬운 ③ 단계 버튼 9개 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | 읽기 화면 지문 `0e5035cf…` 그대로 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

R12 `review`(③의 새 스위치와 새 이야기 요금)·`estimates`(새 작업 추정 세 필드)와 R13 앱 핀(새 작업 추정)만 다시 고정했습니다. 요청·모델 핀은 그대로입니다.

## 3. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v63`. DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더.

## 4. 배포 후 부모님 확인(유료, 선택)

같은 주제로 두 권: 하나는 스위치 꺼짐(기본), 하나는 켜짐. 멈춤 리포트(③ '검사 리포트')의 연결 검사 항목 수와 요청 수, 공급자 청구액을 비교합니다. 판정이 너무 느슨해 보이면(참고 항목이 눈에 띄게 줄거나 모순이 남음) 스위치를 켜 두고 알려 주세요.

## 5. 완료 보고

`CODEX_R26_COMPLETION_2026-10-20.md`: 반입 방법, 2절 결과표, 배포 URL·버전.
