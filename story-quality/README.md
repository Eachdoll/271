# story-quality — 동화공방 글 품질 패키지 (A·B층 구현)

보급형 모델로도 사건이 있고 반복 없는 줄거리·전문을 만들기 위한 **코드·데이터·프롬프트**. 지시서 4(플롯 패턴·루브릭)에서 한 단계 더 나간 것으로, 의존성 없는 TypeScript(ESM) 패키지다. 앱의 `TextEngine`(지시서 2 시그니처)을 그대로 넘기면 동작한다.

```
story-quality/
  data/
    plot_patterns.json        지시서 4의 패턴 카드 6종 (구조만, 책 제목·본문 없음)
    inventories.json          조합형 생성 인벤토리: 심을 물건 50, 장애물 12, 반전 8, 생물 30, 세부 장소 6묶음, 웃음 15, 실패 이유 3, 금지 키워드
    gesture_dictionary.json   감정 직설어 → 몸짓 사전 12감정 × 5몸짓(ko/en) + 교훈 꼬리말 목록
  prompts/                    프롬프트 원문·설명 (md). src/prompts.ts의 상수가 이것과 1:1
    outline.v3.md  prose_rich.md  prose_simplify.md  child_curiosity.md  child_retell.md  beat_judge.md  weekly_coach.md
  src/
    types.ts            공통 타입 (TextEngine, StoryOutline, BookRecord, …)
    util.ts             시드 난수, JSON 추출, 한글 토큰화, Jaccard
    banList.ts          책 간 금지 목록 (최근 10권의 물건·생물·반전·장소, 패턴은 최근 3권)
    retrieval.ts        승인 줄거리 검색 few-shot (주제 유사도 + 패턴·수준 일치)
    composeSeed.ts      조합형 생성: 인벤토리에서 재료를 뽑아 비트 슬롯을 채움 (결정적)
    gestures.ts         직설어 탐지, 몸짓 치환 후보, 프롬프트 힌트
    prompts.ts          프롬프트 상수 + fill()
    outlinePrompt.ts    outline.v3 조립 (패턴 + 재료 + 예시 + 금지 + 규칙 7 + 금지 예시 4)
    plotCheck.ts        인과 검사기 (심기-회수, 실패 이유, 새 요소, 주제·이름, 후렴, 꼬리말, 문형 반복, 금지 소재, 장소, 금지 목록, 재료 준수)
    beamSearch.ts       비트 단위 탐색: 비트마다 후보 3 → 심사 1
    richThenSimplify.ts 전문 2패스: 한 단계 위 수준으로 풍부하게 → 목표 수준으로 단순화 → 직설어 남으면 1회 수정
    childSimulator.ts   아이 시뮬레이터: 쪽별 호기심 점수, 세 문장 되말하기
    weeklyCoach.ts      주간 코치 패스(상위 모델) + mergeRules(규칙 7·예시 4 상한) + 되돌리기 판단
    pipeline.ts         위 모듈을 잇는 예시: runOutlineStage / runProseStage / runChildGate
  test/smoke.test.mjs   16개 테스트 (가짜 엔진으로 파이프라인 끝까지 실행 포함)
```

## 설치·확인

```bash
cd story-quality
npm install          # typescript만 설치된다
npm run build        # dist/ 생성 (strict 통과)
npm test             # 16 pass
```

앱 저장소에 넣을 때는 `src/`를 앱의 모듈 폴더(예: `src/story-quality/`)로 복사하고, `data/`·`prompts/`는 정적 자원으로 둔다. 앱에 이미 같은 이름의 타입이 있으면 `types.ts`를 앱 타입으로 교체한다(필드명은 지시서 2·4와 같다).

## 통합 순서 (Codex 작업 단위)

### 1. 데이터 적재
- 앱 시작 시 `inventories.json`, `gesture_dictionary.json`, `plot_patterns.json`을 읽어 메모리에 둔다.
- 부모 설정 > 패턴 카드 편집은 `plot_patterns.json` 구조를 그대로 쓴다. 책 제목·본문 입력 칸은 만들지 않는다.

### 2. 책 승인 시 `BookRecord.usedElements` 채우기
- `planted = outline.plan.planted`, `creatures = 브리프의 creature.ko 목록`, `twistTypeId = seed.twist.id`, `patternId`, `places = 브리프의 subLocation 목록`.
- 이 기록이 **금지 목록**과 **검색 few-shot**의 재료다. `approved: true`인 것만 쓰인다.

### 3. 줄거리 단계 교체 → `runOutlineStage()`
입력: 엔진 3개(`outline`=상위 권장, `prose`=보급형 중, `cheap`=보급형 하), 등장인물, 세계관 3줄, 주제, 수준, 쪽 수, 선택된 패턴 카드, 배경 유형(`home|kindergarten|forest|sea|dino_land|sky`), 인벤토리, 승인 책 목록, 결말.

내부 순서:
1. `buildBanList(approvedBooks)` — 최근 책의 요소를 금지.
2. `composeSeed()` — `hashString(bookId)`를 시드로 재료를 뽑는다. 같은 bookId면 같은 재료(디버깅 가능). 주제 키워드로 장애물을 우선 배정(`preferObstaclesForTopic`).
3. `buildOutlinePrompt()` — 승인 예시 2개를 자동 검색해 넣는다. 약 1,300토큰.
4. 엔진 호출 → JSON 파싱(`extractJson`).
5. `plotCheck()` → `fix` 항목이 있으면 **지적된 비트만** 고치는 수정 호출 1회(cheap 엔진). `regenerate` 항목이 있으면 호출자가 보조 패턴으로 재생성(최대 1회) 후 부모에게 표시.
6. `useBeamSearch: true`면 3~4 대신 `generateBeatsWithBeam()`(비트마다 후보 3·심사 1) + 나머지 필드 1회 호출. 보급형 모델로 줄거리를 만들 때 ON 권장.

UI: 줄거리 카드 상단에 `seedSummary`(심은 물건 · 반전 · 생물)를 칩으로 보여 주고 "재료 다시 뽑기"(시드+1) 버튼을 둔다. 작가 메모(plan)는 접어서 표시.

### 4. 전문 단계 교체 → `runProseStage()`
- 목표 수준 K1이면 K2로 먼저 쓰고(`RICH_LEVEL_OF`), cheap 엔진이 K1로 줄인다. 영어도 같은 2패스(E0→E2→E0).
- 몸짓 사전 힌트는 브리프의 감정만 골라 넣는다(`renderGestureHintForPrompt`).
- 문체 샘플(지시서 4의 StyleSample) 2~3개를 넘기면 라벨과 함께 들어간다.
- 결과에 직설어가 남으면 그 문장만 고치는 3번째 호출이 자동으로 1회 돈다(`tellHitsAfter`로 확인).
- 기존 `levelCheck`·`richnessCheck`는 그대로 뒤에 붙인다.

### 5. 쪽 나누기 뒤 게이트 → `runChildGate()`
- `curiosityCheck`: 0점 쪽(`rewritePages`)만 "끝 문장을 궁금하게" 규칙으로 재작성.
- `retellCheck`: want/turn/resolution이 되말하기에 없으면 `recommendTurnRewrite` → 전문의 turn 문단만 재작성.
- 둘 다 cheap 엔진, 병렬 호출.

### 6. 주간 코치 → `runWeeklyCoach()` (scheduled task, 주 1회)
- 최근 7일 승인 책이 3개 미만이면 자동 건너뜀.
- 결과는 부모 설정 > "코치 제안" 카드로. 승인된 항목만 `mergeRules(currentRules, approved, 7)` / `mergeRules(currentBanExamples, approved, 4)`로 반영하고 `RuleVersion`으로 저장. `shouldSuggestRollback()`이 true면 되돌리기 제안.

### 7. 설정 항목 (부모 설정)
- 단계별 엔진(줄거리 상위 / 전문 보급형 중 / 심사·단순화·시뮬레이터 보급형 하)
- `비트 탐색`(기본 OFF; 줄거리 엔진이 보급형이면 ON 제안), `풍부화 2패스`(ON), `아이 시뮬레이터`(ON)
- 금지 목록 창(최근 10권) / 패턴 금지 창(3권)
- 예상 비용: 줄거리 1(+수정 1) + [빔: 비트×2 + 1] + 전문 2~3 × 언어 2 + 시뮬레이터 2. 모두 짧은 호출이라 전문 1회 분량 안팎이 늘어난다.

## 수용 기준
- [ ] `npm test` 16개 통과.
- [ ] 주제 5개(비 오는 날·공룡나라·생일·유치원 첫날·밤의 소리)를 보급형 모델 + 빔 탐색으로 돌렸을 때 `plotCheck.ok`가 5개 중 4개 이상, 나머지는 수정 1회 뒤 통과.
- [ ] 같은 bookId로 두 번 생성하면 `seedSummary`가 같다. bookId를 바꾸면 심은 물건·생물이 바뀐다.
- [ ] 최근 10권의 심은 물건이 새 줄거리에 나오지 않는다.
- [ ] K1 전문에 감정 직설어 0개, 비트 라벨 유지, 대화 2개 이상.
- [ ] 되말하기 검사에서 want/turn/resolution이 모두 잡힌다.
- [ ] 코치 제안을 승인해도 규칙은 7개, 금지 예시는 4개를 넘지 않는다.

## 하지 말 것
- 인벤토리·패턴 카드에 책 제목·캐릭터 이름·본문을 넣지 않는다.
- 금지 키워드에 한 음절 단어를 넣지 않는다('피'는 '피리'에 걸린다). 두 음절 이상 또는 조사 포함.
- 수정 패스에서 줄거리 전체를 다시 쓰게 하지 않는다. `renderFixInstructions`의 항목만.
- 문체 샘플은 반드시 "리듬·종결어미·구체성만" 라벨과 함께 넣는다.
- 시드 고정은 재료 재현용이다. 모델 호출의 샘플링까지 고정하려 하지 않는다.
- 프롬프트가 1,800토큰을 넘으면 규칙을 늘릴 게 아니라 예시를 줄인다(`roughTokenCount`).
