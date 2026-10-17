# Codex r4 검토 결과 · 2026-10-17

검토 대상: `donghwa-workshop-codex-r4-2026-10-17.zip`(SOURCE_COMMIT `bb8f074`, 운영 배포 2026-10-17 11:54 UTC `succeeded`), `EVAL_INTEGRATION_2026-10-17.md`.
검토 방법: 매니페스트 해시 전부 일치 확인, 반입 기준 커밋 `836a905` 대비 실질 변경 파일 30개 diff 전부 읽음, `npm test`(428) · `npm run test:quality`(43) 재실행, `verify-offline.mjs` 재실행 결과가 동봉된 `verified-offline.json`과 동일함을 확인, Claude 5.5 계열 요청 규칙(사고 모드·effort·temperature)과 대조, Chromium 1280×900/390×844에서 설정 → 데모 제작 → 승인 → 책장 → 상세 흐름 구동(`pageerror` 0, 유료 호출 0).

## 판정: 통과. 아래 2건은 다음 턴에 정리 요청.

### R4-1 · 줄거리와 무관한 프롬프트 3곳에 failureReason 지시문이 들어감 (수정 요청)

`story-quality/src/prompts.ts`에서 "[출력] JSON만." 다음 줄에 `attempt 비트의 failureReason은 … ID 하나만 적는다` 문장을 넣을 때, 줄거리(`OUTLINE_USER`)·비트 후보(`BEAT_CANDIDATES_USER`) 외에 출력에 비트가 없는 세 프롬프트에도 같은 문장이 들어갔다.

| 위치 | 프롬프트 | 출력 형식 |
| --- | --- | --- |
| 219행 | `CHILD_CURIOSITY_USER` (쪽별 호기심 판정) | `{"pages":[…], "dropPages":[], "overall":0}` |
| 231행 | `CHILD_RETELL_USER` (아이 되말하기) | `{"retell":[…], "coveredBeats":[…], …}` |
| 249행 | `WEEKLY_COACH_USER` (주간 코치) | `{"recurringWeaknesses":[…], …}` |

세 출력에는 `failureReason` 필드가 없어 지시문이 가리키는 대상이 없다. 모델이 지시를 맞추려고 없는 키를 추가하거나 JSON을 어그러뜨릴 여지가 있고, 호출마다 토큰만 늘어난다. 219·231·249행의 문장을 제거하고 `story-quality/dist/prompts.js`·`dist/story-quality/dist/prompts.js`를 다시 빌드하면 된다. `evaluated-regressions.test.mjs`의 `/failureReason.*ID/` 검사는 줄거리 프롬프트만 보므로 그대로 두어도 된다.

### R4-2 · 평가 세트 설명문과 프롬프트 문서의 수치가 코드와 어긋남 (문서 정정 요청)

- `story-quality/eval/testset.json`의 `description`이 여전히 "세계는 현재 8·과거 5·미래 4·상상 3"이다. 실제 `worldId`→`worlds.json` era 집계는 현재 9·과거 6·미래 3·상상 2이며, 원 보고서의 잘못된 수치는 이 설명문을 옮긴 것이다. 통합 보고에서 수치는 바로잡았지만 출처인 설명문은 그대로다.
- `story-quality/prompts/outline.v3.md` 끝의 "온도 0.85, maxTokens 1,800"은 코드(`buildOutlinePrompt` 4,000, temperature 미전송)와 다르다.

## 확인한 항목

| 항목 | 결과 |
| --- | --- |
| 패키지 `anthropic.ts` | 반입 그대로. 디버그 출력에서 응답 본문 head/tail만 제거(모델·stop_reason·usage 유지). 사고 모드 표(Haiku `disabled`·Sonnet `between_tools`·그 외 8,000 여유분) 유지. |
| `plotCheck` 정규화 | `plotCheck.js`는 반입 커밋과 바이트 동일. `.d.ts`에 `normalizeFailureReason` 선언만 추가. 모르는 자유 서술은 ID로 바뀌지 않아 순서 검사에서 계속 수정 대상으로 남는 것을 테스트로 확인. |
| 앱 `providers.js` | Sonnet 5.5: `thinking:{type:"between_tools"}` + `output_config.effort`(low/medium/high만 허용, `between_tools`는 high 이하에서만 유효하므로 맞음), 강제 tool 미사용. Haiku 5.5: `thinking:{type:"disabled"}`, effort 미전송(기본 medium, disabled는 high 이하에서만 허용되므로 맞음). Opus/Fable: adaptive 유지, 요청 하한 32,768. `temperature`는 세 모델 모두 미전송. |
| 앱 `models.js` | Haiku 5.5 행 추가($0.10/$0.50, 64,000 출력 한도, `requestOutputTokens` 0이므로 요청 예산은 호출자 값 그대로). `resolveQualityStageSettings`에서 `outline`+`anthropic`만 `medium`(Sonnet)으로, 명시 모델·다른 공급자·`coach` 등 다른 역할은 기존 `upper`(Opus) 유지. 저장된 설정 객체는 변경되지 않음(테스트 포함). |
| 앱 `quality-adapter.js` | 비트 판정 출력 한도 500→1,500, 패키지가 요청한 `maxTokens`가 더 크면 그 값 사용(줄거리 4,000이 1,800으로 깎이지 않음). |
| 설정 화면 | 글 엔진을 Anthropic으로 저장하면 줄거리 모델 자리표시자가 `claude-sonnet-5-5`, 선택지에 Haiku 5.5 1개, 안내 문구 표시. `claude-opus-5-5`를 직접 입력·저장 후 새로고침해도 유지. 1280/390 모두 확인. |
| 서비스 워커 | `donghwa-shell-v22`. 새 파일 없음, 프리캐시 목록 테스트 통과. |
| 오프라인 재집계 | `verify-offline.mjs` 재실행 출력이 동봉 `verified-offline.json`과 동일(Sonnet 9.15·11/20, Opus 9.15·13/20). `fetch`를 막아 두어 유료 호출 불가. |
| 원본 보존 | `sonnet55-trial.jsonl`·`opus55-trial.jsonl`·두 `.summary.json`·`analyze.mjs`(라벨 median→mean만 수정)·`plotcheck-offline.mjs` 그대로. |
| 비밀 | 반입본에 키 문자열 없음. |

## 참고

- `QA/` 폴더는 r3의 before/after 비교 자료가 빠지고 r4 캡처 20장과 `browser-settings.json`으로 교체됨. 이전 자료는 Git 이력(`836a905`)에 남아 있다.
- 다음 유료 측정(같은 20주제로 전문→쪽 나누기→읽기 검사→아이 시뮬레이터)은 통합 보고의 계획대로 별도 요청 때 진행하면 된다. 그 전에 R4-1을 먼저 반영해야 아이 시뮬레이터 호출 결과에 잡음이 섞이지 않는다.
