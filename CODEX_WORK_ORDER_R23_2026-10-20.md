# Codex 지시서 r23 · 프롬프트 정비(기본 규칙 복원·설계서 우선·줄거리 다이어트·그림 지시 축소) · 2026-10-20

전체 점검 보고서(`UX_PIPELINE_REVIEW_2026-10-20.md`)의 P0 세 가지와 그림 지시 축소를 구현했습니다. **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | v36 합치기 = `9b7bd4b`(Codex `codex/ui-v36`을 fast-forward로 반입, 점검 보고서 `fc0a05a` 포함) |
| 반입 범위 | **`9b7bd4b..6b6db72`** (이 문서는 다음 커밋) |
| 새 파일 | `dist/story-generation/prompt-policy.js`, `tests/prompt-policy-r23.test.mjs` |
| 바뀐 파일 | `dist/story-generation/{quality-adapter,pipeline,ui,craft-rules,council}.js`, `dist/full-auto.js`, `dist/image-generation/scene-prompt.js`, `dist/sw.js`(v62), `story-quality/src/{composeSeed,pipeline}.ts`와 빌드 산출물(`story-quality/dist`·`dist/story-quality/dist`의 composeSeed·pipeline), `story-quality/test/council-r20.test.mjs`, `tests/{openings-legacy-r12,openings-policy-r12,catchphrase-r9,image-forbidden-words}.test.mjs`, `CLAUDE.md` |

패키지 빌드 산출물은 커밋에 포함되어 있어 빌드하지 않아도 됩니다(빌드하면 `@types/node` 없음 TS2688이 나오지만 산출물은 같고, `dist/eval/prose.d.ts`가 `any`로 바뀌면 되돌리세요).

## 1. 무엇이 달라졌나 (새 초안만 · `input.promptPolicy {version: 1}`)

| # | 전 | 후 |
| --- | --- | --- |
| 규칙 복원 | 앱 설정의 빈 `rules: []`·`banExamples: []`가 패키지 기본 규칙 7개·금지 예시 4개를 덮어 줄거리 요청의 `[규칙]`·`[이렇게 쓰지 않는다]`가 비어 있었음 | 정책 초안은 빈 배열을 보내지 않아 기본 규칙·예시가 들어감. 주간 코치가 정한 규칙이 있으면 그대로 대체 |
| 설계서 우선 | 랜덤 시드의 심은 물건·반전 유형·웃음 포인트·세부 장소가 회의 설계서와 어긋남(예: 시드 '치즈 조각' vs 설계서 '빨간 장화') | 설계서가 있으면 시드의 심은 물건·반전을 설계서로 바꾸고 웃음 포인트·세부 장소 줄을 뺌. 배경 생물·실패 이유 순서는 랜덤 그대로 |
| 줄거리 canon | `FROZEN_LEVEL_SPECS` JSON(영단어 400개 포함)과 캐릭터 색·옷·likes가 줄거리 요청에 들어감 | 수준은 한 줄 요약(수준·쪽당 문장 수·비트 수), 인물·장소는 이름·역할·성격·말버릇·설명만. 본문 단계는 예전 그대로 |
| PLACES | 서랍 전체를 세어 부모가 2곳을 골라도 4곳을 요구 | 부모가 고른 장소(`preferredBackgroundIds`)만 셈. 고른 장소가 없으면 예전처럼 전체 |
| 그림 요청 | 사건 장부 JSON 전체, 이전 쪽 전부, 긴 건물 고정 문단(16쪽째 10,400자) | 이 비트의 trigger·attempt·result 세 줄, 직전 2쪽, 두 문장 건물 고정 |
| 작가 봇 피치 | 어른 문장으로 옴 | 독자 나이의 말로 쓰라는 한 줄 추가 |

실측(K2·E2·16쪽, 회의 설계서 포함): 줄거리 시스템 프롬프트 **14,188자 → 8,919자**, `[규칙]` 7개 들어감, 시드 '심을 물건: 빨간 장화'. 정책 없는 기존 초안·작업·책은 요청이 바이트 단위로 같습니다(R12 핀은 `inputs`·`fullAutoDemo`가 새 키 하나로만 바뀌어 다시 고정).

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **935/935** (새 `tests/prompt-policy-r23.test.mjs` 7개) |
| `npm run test:quality` | **85/85**, 두 사본 동일(`diff -rq story-quality/dist dist/story-quality/dist`) |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | 읽기 화면 지문 `0e5035cf…` 그대로 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

## 3. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v62`(사전 캐시에 `prompt-policy.js` 추가). DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더.

## 4. 배포 후 부모님 확인(유료, 한 권)

쉬운 ③에서 K2·16쪽 한 권. 회의가 고른 심은 물건이 줄거리 카드(프로 검사 카드 '기획 회의'와 줄거리의 `plan.planted`)에 그대로 나오는지, 반전이 설계서의 반전과 같은지, 멈춤 리포트의 요청 수가 전과 같은지(호출 수는 바뀌지 않음). 그림 한 쪽을 만들어 건물·소품이 전과 다르지 않은지.

## 5. 완료 보고

`CODEX_R23_COMPLETION_2026-10-20.md`: 반입 방법, 2절 결과표, 배포 URL·버전.
