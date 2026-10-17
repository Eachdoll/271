# Codex 수정 지시서 r5 · 2026-10-17

기준 소스: Codex r4 (`SOURCE_COMMIT` `bb8f074`, 운영 배포 2026-10-17 11:54 UTC). 근거: [r4 검토 결과](CODEX_R4_REVIEW_2026-10-17.md). 범위는 아래 2건뿐이며, 그 외 코드·DB·설정은 건드리지 않는다. 유료 API 호출은 하지 않는다.

## R5-1 · 줄거리와 무관한 프롬프트 3곳에서 failureReason 지시문 제거 (코드)

### 현상

`story-quality/src/prompts.ts`에서 "[출력] JSON만." 바로 다음 줄에 아래 문장이 다섯 곳에 들어가 있다.

```
attempt 비트의 failureReason은 설명이 아니라 ID 하나만 적는다: "wrong_place" | "wrong_method" | "interrupted". 그 외 비트는 null.
```

이 문장이 필요한 곳은 출력에 `beats[].failureReason`이 있는 두 프롬프트뿐이다.

| 행 | 프롬프트 | 출력에 failureReason | 조치 |
| --- | --- | --- | --- |
| 51 | `OUTLINE_USER` | 있음 | 유지 |
| 100 | `BEAT_CANDIDATES_USER` | 있음 | 유지 |
| 219 | `CHILD_CURIOSITY_USER` | 없음 (`{"pages":[…],"dropPages":[],"overall":0}`) | **제거** |
| 231 | `CHILD_RETELL_USER` | 없음 (`{"retell":[…],"coveredBeats":[…],"missingCore":[],"confusions":[],"coherence":0}`) | **제거** |
| 249 | `WEEKLY_COACH_USER` | 없음 (`{"recurringWeaknesses":[…],"proposedBanExamples":[…],"proposedRules":[…],…}`) | **제거** |

지시 대상이 없는 문장이라 모델이 없는 키를 만들거나 JSON을 어그러뜨릴 수 있고, 아이 시뮬레이터·주간 코치 호출마다 토큰이 늘어난다. 다음 유료 측정(전문→쪽 나누기→아이 시뮬레이터)에 잡음이 섞이지 않도록 먼저 반영한다.

### 할 일

1. `story-quality/src/prompts.ts` 219·231·249행의 문장(해당 줄 전체)을 삭제한다. 51·100행은 그대로 둔다.
2. 루트에서 `npm run build`로 `story-quality/dist/prompts.js`와 `dist/story-quality/dist/prompts.js`를 다시 생성한다. 두 사본이 바이트 단위로 같아야 한다.
3. 회귀 테스트를 `story-quality/test/evaluated-regressions.test.mjs`에 추가한다. `CHILD_CURIOSITY_USER`·`CHILD_RETELL_USER`·`WEEKLY_COACH_USER`에 `failureReason` 문자열이 없고, `OUTLINE_USER`·`BEAT_CANDIDATES_USER`에는 있는지 확인한다.
4. 프롬프트 본문이 바뀌므로 `dist/sw.js`의 캐시 이름을 `donghwa-shell-v23`으로 올린다. 프리캐시 목록은 바뀌지 않는다.

### 완료 기준

- `npm test`·`npm run test:quality` 전부 통과(기존 428+43에 새 테스트 1개 추가).
- `grep -c "failureReason은 설명이 아니라" story-quality/src/prompts.ts` 결과가 2.
- `cmp story-quality/dist/prompts.js dist/story-quality/dist/prompts.js` 출력 없음.

## R5-2 · 평가 세트 설명문과 프롬프트 문서를 코드와 맞춤 (문서)

### 현상

- `story-quality/eval/testset.json` 3행 `description` 끝의 "세계는 현재 8·과거 5·미래 4·상상 3."이 오래된 수치다. 20주제의 `worldId`를 `data/worlds.json`의 `era`로 집계하면 **현재 9·과거 6·미래 3·상상 2**다(`verify-offline.mjs`의 `eraCounts`와 동일). 원 평가 보고서의 잘못된 수치는 이 설명문을 옮긴 것이었다.
- `story-quality/prompts/outline.v3.md` 끝의 "온도 0.85, maxTokens 1,800."이 코드와 다르다. `buildOutlinePrompt`는 `maxTokens: 4000`을 쓰고, Anthropic 엔진은 `temperature`를 보내지 않는다(5.5 계열이 400으로 거부).

### 할 일

1. `testset.json`의 `description` 마지막 문장을 "세계는 현재 9·과거 6·미래 3·상상 2."로 바꾼다. `topics`·`pages`는 바꾸지 않는다(고정 세트).
2. `outline.v3.md`의 해당 줄을 아래로 바꾼다.

   ```
   - maxTokens 4,000. 온도 0.85는 OpenAI·Google 엔진에만 보내고 Anthropic 5.5 계열에는 보내지 않는다. JSON 파싱 실패 시 "JSON만 다시 출력" 1회 재시도.
   ```

3. 설명문이 다시 어긋나지 않도록 `evaluated-regressions.test.mjs`에 검사 하나를 추가한다. `testset.json`의 `topics`를 `worlds.json`으로 집계한 era 수를 `description`에서 정규식으로 읽은 수(현재·과거·미래·상상)와 비교한다.

### 완료 기준

- `node story-quality/eval/trial-2026-10-17/verify-offline.mjs`의 `eraCounts`와 `description`의 수치가 같다.
- 새 테스트 통과. 원본 JSONL·`.summary.json`·`verified-offline.json`은 수정하지 않는다.

## 전달

- 완료 보고 md 1개(변경 파일, 테스트 수, 빌드 결과)와 ZIP(`SOURCE_COMMIT.txt`, `SOURCE_MANIFEST.sha256`, `QA/deployment.json` 포함).
- 이번 범위에는 새 모델 생성·판정·증류·주간 코치 실행이 없다. 전문·쪽 나누기 측정은 별도 지시서로 진행한다.
