# Codex 수정 지시서 r6 · 2026-10-17

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소 | https://github.com/Eachdoll/271 |
| 브랜치 | `claude/cross-owner-repo-constraint-j20lhz` |
| 앱 경로 | 저장소 안 `donghwa-workshop/` |
| 기준 | Codex r5 (`SOURCE_COMMIT` `7156d53`)를 반입한 커밋 `6e7ff01` |
| 이번에 반입할 범위 | `6e7ff01..92a9930` (그 뒤 커밋은 이 표의 문구 정정뿐) |

```bash
git clone https://github.com/Eachdoll/271.git
cd 271 && git checkout claude/cross-owner-repo-constraint-j20lhz
git log --oneline 6e7ff01..HEAD
git diff --stat 6e7ff01..HEAD -- donghwa-workshop
```

r4 때처럼 전체 트리를 덮어쓰지 말고 아래 커밋의 변경 파일만 r5 소스에 반입한다. `donghwa-workshop/` 아래 경로가 Codex 패키지의 루트와 같다.

| 커밋 | 내용 |
| --- | --- |
| `2ec40e6` | 전문 단계 실측 스크립트 `prose-trial.mjs`, `analyze-prose.mjs`, `curiosity-rescore.mjs` |
| `e1f347f` | 심은 물건 명사구 대조, 루브릭 반복 기준 명확화, 전문 전체 문장 예산(`pageCount`), 질문 끝맺음 2개 제한, `distill --concurrency` |
| `209c2f2` | 서비스 워커 `donghwa-shell-v24` |
| `a599db7` | 실행 중 결과 스냅샷(이후 커밋이 최종본으로 갱신) |
| `c71d677` | 호기심 전체 점수를 쪽 점수 평균×5로 계산, 프롬프트에 0~10 명시, 기존 방식 전문 실측 결과 |
| `4427f86` | 분량 초과 시 비트별 압축 단계 |
| `89f32b9` | 증류 200편 결과와 승인본 `approved-books.json`, 예산 적용 전문 실측 결과 |
| `744cddd` | 압축 단계를 선택 옵션(`condenseOverBudget`, 기본 끔)으로 변경, 되말하기 통과를 핵심 비트만으로 판정, 압축 실측 결과 |
| `8402cdd`, `92a9930` | `PROSE_EVAL_REPORT_2026-10-17.md`, 이 지시서, README 링크 |

근거와 수치는 [전문 단계 실측 보고](PROSE_EVAL_REPORT_2026-10-17.md)에 있다. 반입 직후 검증 기준은 `npm test` 428개, `npm run test:quality` 50개 통과다. `story-quality/src`를 바꿨으므로 `npm run build`로 `story-quality/dist`와 `dist/story-quality/dist`를 다시 만들어, 반입한 컴파일본과 바이트가 같은지 확인한다. 이번 컴파일본은 TypeScript 6.0.2로 만들었고, 수정 전 소스를 같은 컴파일러로 빌드했을 때 기존 `dist`와 완전히 같았다.

**유료 API 호출은 하지 않는다.** 아래 작업은 모두 모의 엔진 테스트와 기존 결과 파일로 검증한다.

## R6-1 · 앱 전문 단계에 쪽 수 전달 (코드)

패키지 `runProseStage`가 `pageCount`를 받으면 단순화 단계에 "전체 N~M문장" 예산을 건다. 실측에서 질문 끝맺음이 73/157에서 18/157로, 영어 분량이 73문장에서 44문장으로 줄었다. 호기심·되말하기 손실은 없었다. 앱은 아직 이 값을 넘기지 않는다.

1. `dist/story-generation/quality-adapter.js` 1080행 `module.runProseStage({ … })`에 `pageCount: input.pageCount`를 추가한다.
2. `condenseOverBudget`은 넘기지 않는다(기본 끔). 압축은 분량을 맞추지만 호기심 18→13, 되말하기 17→14로 떨어졌다. R6-5 결정 뒤에 다시 다룬다.
3. 앱의 `wrap` 규칙("at least THREE quoted dialogue turns", 비트별 감각 묘사)은 그대로 둔다. 예산 문구와 충돌하지 않는다.
4. 회귀 테스트: 모의 품질 모듈로 `runProseStage` 호출 인자에 `pageCount`가 들어가고 `condenseOverBudget`이 없음을 확인한다.

## R6-2 · 앱 아이 시뮬레이터 호기심 판정 정렬 (코드)

- `dist/story-generation/quality-gates.js` 257행은 `cur.overall >= 6`으로 통과를 정한다. `overall`은 모델이 적은 값이다. 패키지 실측에서 모델이 쓴 값은 평균 3.05였고, 쪽 점수로 환산하면 8.38이었다. 이 차이 때문에 16/20이 8/20으로 판정됐다. 앱은 JSON 스키마로 0~10 범위를 주지만, 값 자체는 여전히 모델이 정한다.
- 수정: `normalizedGate`에서 `overall`을 쪽 점수 평균×5(소수 첫째 자리)로 다시 계산해 판정에 쓴다. 원래 모델 값은 `modelOverall`로 보존한다. 마지막 쪽 면제 규칙(`quietFinalPageExempt`)은 유지한다.
- 호기심 요청의 출력 한도를 최소 2,000으로 올린다. 12쪽 응답이 최대 842토큰까지 나와 패키지 기본 900에 근접했다. 33쪽으로 나눈 파일럿에서는 실제로 잘려 0점이 됐다. 비트 판정 1,500 하한과 같은 방식으로 `Math.max(request.maxTokens, 2000)`을 쓴다.
- 되말하기는 앱이 이미 핵심 유형(`CORE`)으로만 판정하므로 바꾸지 않는다. 패키지도 이번에 같은 기준으로 맞췄다.
- 회귀 테스트: 쪽 점수가 [2,2,1]이고 `overall`이 1.7인 응답이 통과(8.3)하는지 확인한다.

## R6-3 · 증류 비용 추정 수정 (코드)

`story-quality/src/distill/generate.ts`의 `estimateDistillCost`는 출력 1,400토큰을 가정한다. 실측 편당 비용은 Opus 5.5가 $0.135, Sonnet 5.5가 $0.037이었다. Opus 추정은 4.5배 낮았다. 사고 토큰(Opus는 끌 수 없음)과 수정 호출이 빠졌기 때문이다.

1. 추정에 모델별 실측 편당 출력 토큰을 쓴다. 기본값은 이번 `distill/runs/2026-10-17/outlines.jsonl`의 `usage` 평균에서 계산해 상수로 둔다. 실측 근거 파일을 주석에 적는다.
2. `distill` CLI 기본 생성 모델을 `claude-sonnet-5-5`로 바꾼다. 앱 줄거리 기본값과 같고, 줄거리 평가 점수도 같았다. Opus를 고르면 추정 비용과 함께 경고를 출력한다.
3. 회귀 테스트: 같은 셀 수에서 Opus 추정이 Sonnet 추정의 3배 이상인지 확인한다.

## R6-4 · 증류 승인본을 참고 예시 후보로 연결 (코드, 기본 끔)

`story-quality/distill/runs/2026-10-17/approved-books.json`에 승인 161편이 앱 BookRecord 형식으로 있다. 현재 앱은 골드 24편(`gold/gold_outlines_part1/2`)만 참고 예시로 쓴다.

1. `loadStoryQualityData`에 선택 데이터 `distilledBooks`를 추가한다. 이 파일을 지연 로드하고, 서비스 워커 프리캐시에는 넣지 않는다(1.2MB).
2. 부모 설정 "글 품질"에 "증류 예시 함께 쓰기"(기본 끔)를 둔다. 켜면 `referenceBooks`를 골드와 증류본으로 구성한다. 주제가 같은 책은 제외하고, 골드를 먼저 고른다.
3. 증류본은 자동 판정만 통과했다. 사람 검토 전에는 기본으로 켜지 않는다. 설정 설명에도 그렇게 적는다.
4. 회귀 테스트: 끔일 때 `referenceBooks`가 골드와 같은지, 켬일 때 같은 주제가 빠지는지 확인한다. 파일 로드에 실패해도 골드만으로 진행하는지도 확인한다.

## R6-5 · K1·E0 규격 → [r7 지시서](CODEX_WORK_ORDER_R7_2026-10-17.md)로 대체 (2026-10-17 결정)

실측 수치는 보고서 2절과 4절에 있다. 결정이 나면 별도 지시서로 진행한다. 아래는 결정 사항과 결정 뒤의 작업 범위다.

- **K1 분량**: 12쪽 × 쪽당 1~2문장(24문장 이하)과 7~8비트·시도 3번 구조가 충돌한다. 기존 방식은 93문장, 압축 후에도 41문장이었다. 선택지는 쪽당 2~3문장으로 상향, K1 전용 시도 2번 패턴, 분량 검사를 경고로만 두기다. `adaptPattern`과 `BEAT_COUNTS`가 관련 위치다.
- **E0 어휘**: E0 허용 목록이 77단어라 she, her, on, with, they, was 같은 기능어가 없다. 모든 쪽이 어휘 검사에 걸린다. 선택지는 Dolch primer·Fry 첫 100단어 추가, 등장인물 이름·의성어·`newWordsEn` 허용, E0(들려주기)의 어휘 검사를 경고로만 두기다.

## R6-6 · 평가 도구 정리 (코드, 비용 없음)

1. `story-quality/eval/trial-2026-10-17/prose-trial.mjs`를 `npm run eval -- --stage prose --from <outlineRunId>` 형태로 패키지 CLI에 넣는다. 기존 줄거리 결과 재사용, `--budget`·`--condense`, 모의 실행(`--mock`)을 유지한다.
2. 쪽 나누기 근사(12쪽 균등 분할)는 명시적으로 "근사"라고 결과에 적는다. 앱 쪽 나누기 함수를 Node에서 쓸 수 있으면 그것으로 바꾼다.
3. 모의 엔진으로 한 편이 끝까지 도는 테스트를 추가한다.

## R6-7 · 문서 (문서)

- `CLAUDE.md` "대량 증류는 아직 실행하지 않았습니다"를 실제 상태로 바꾼다. 2026-10-17 증류 200편 실행, 결과 경로, 앱 연결은 R6-4 옵션이라는 내용이다.
- `STORY_QUALITY_INTEGRATION.md`에 `pageCount`·`condenseOverBudget`, 호기심 점수 계산 방식, `notedMissing`을 추가한다.
- `README.md`·`CLAUDE_CODE_START_HERE.md`의 안내 링크에 이 지시서와 전문 실측 보고를 추가한다.

## 완료 기준과 전달

- `npm test`·`npm run test:quality` 전부 통과. 기존 428+50개에 R6-1~R6-4·R6-6 회귀 테스트를 더한다.
- `npm run build` 성공, 두 컴파일 사본이 바이트 단위로 같다.
- 서비스 워커 캐시 이름을 v25로 올린다(앱 파일 변경).
- 기존 평가·증류 결과 파일(`*.jsonl`, `*.summary.json`, `*.curiosity.json`, `distill/runs/2026-10-17/*`)은 수정하지 않는다.
- 완료 보고 md 1개와 ZIP(`SOURCE_COMMIT.txt`, `SOURCE_MANIFEST.sha256`, `QA/deployment.json` 포함)을 전달한다.
- R6-5는 결정 전까지 손대지 않는다.
