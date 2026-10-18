# story-quality — 동화공방 글 품질 패키지 (A·B·C층 구현)

보급형 모델로도 사건이 있고 반복 없는 줄거리·전문을 만들기 위한 **코드·데이터·프롬프트**. 지시서 4(플롯 패턴·루브릭)에서 한 단계 더 나간 것으로, 런타임 의존성 없는 TypeScript(ESM) 패키지다. 앱의 `TextEngine`(지시서 2 시그니처)을 그대로 넘기면 동작한다.

- **A·B층** (앱 안에서 매 책마다): 조합형 생성(변형 포함), 세계 카드 100 + 계절·시간 오버레이, 승인 예시 검색, 금지 목록, 빔 서치, 풍부화→단순화, 아이 시뮬레이터, 주간 코치.
- **C층** (한 번 투자): 골드 줄거리 24편, 증류 주제 1,250(손 50 + 자동 1,200), 증류 데이터셋 생성기, 평가 하네스(고정 20주제), 로컬 LoRA 데이터 변환기 + 레시피.

### 데이터 규모 (2026-10-17, 10배 확장)

| 항목 | 이전 | 지금 | 조합 후 |
|---|---|---|---|
| 세계 카드 | 30 | **100** (현재 40 · 과거 20 · 미래 16 · 상상 24) | 계절 4 × 낮/밤 2 오버레이 → **602가지 모습** (우주·바닷속·상상 세계는 계절 없음) |
| 세부 장소 | 150 | **500** (세계당 5) | |
| 심을 물건 | 50 | **323** | 색 10 × 색 붙는 물건 + 크기 2 × 전부 → **1,645** |
| 생물 | 30 | **260** | 성격 10(아기·엄마·느림보·수줍은…) → **2,715** |
| 장애물 | 12 | **60** (감각 8종) | |
| 반전 | 8 | **30** | |
| 웃음 | 15 | **100** | |
| 감정 몸짓 | 12 × 5 | **30 × 5** | |
| 후렴 틀 | – | **20** (frame/question/count/sound) | |
| 증류 주제 | 50 | **1,250** = 손 50 + 세계 100 × 활동 틀 33 → 12개씩 | × 수준 2 = 2,500셀 |
| 실패 이유 | 3 | 3 (의도적 상한) | |

일부러 늘리지 않은 것: 실패 이유(3이면 충분, 더 늘리면 아이가 패턴을 못 읽는다), 패턴 카드(6). 수량은 `npm test`가 지킨다.

```
story-quality/
  data/
    plot_patterns.json        지시서 4의 패턴 카드 6종 (구조만, 책 제목·본문 없음)
    worlds.json               세계 카드 100: 현재 40(한국 일상·한국 명소·세계 여러 나라)·과거 20·미래 16·상상 24. 랜드마크·세부 장소 5·생물 3·소품 5·소리·팔레트·그림 힌트·규칙·금지·돌아오는 신호
                              + overlays: 계절 4(봄·여름·가을·겨울: 날씨·소품·생물·소리·그림 힌트·팔레트) × 시간 2(낮·밤), 계절 없는 세계 목록
    inventories.json          조합형 생성 인벤토리: 심을 물건 323, 장애물 60(감각 8종), 반전 30, 생물 260, 세부 장소 6묶음, 웃음 100, 실패 이유 3, 금지 키워드 20(두 음절 이상), 후렴 틀 20, 변형 규칙(색 10·크기 2·성격 10)
    gesture_dictionary.json   감정 직설어 → 몸짓 사전 30감정 × 5몸짓(ko/en) + 교훈 꼬리말 목록
  gold/
    gold_outlines_part1/2.json  직접 쓴 골드 줄거리 24편(패턴 6 × 4, 세계 23곳, K1/K2). BookRecord 형식 → 검색 예시 창고·평가 기준·LoRA 시드. 모두 plotCheck 통과
    bad_examples.json         일부러 나쁜 줄거리 3편(템플릿 반복·인과 없음·교훈 설교) — 판정기 캘리브레이션용
  distill/topics.json         증류 주제 1,250 = 손으로 쓴 50 + 자동 생성 1,200(세계 100곳 × 12, 패턴 6종, source 표시) × 수준 2. `npm run topics:gen`으로 재생성
  eval/testset.json           고정 평가 20주제(증류·골드와 겹치지 않음)
  finetune/README.md          Mac Studio MLX LoRA 레시피
  prompts/                    프롬프트 원문·설명 (md). src/prompts.ts의 상수가 이것과 1:1
    outline.v3.md  prose_rich.md  prose_simplify.md  child_curiosity.md  child_retell.md  beat_judge.md  weekly_coach.md
  src/
    worlds.ts           세계 카드 로드·세계관 3줄 생성(오버레이 상태면 '때: 가을 밤' 포함)·주제별 세계 추천·시대 순환
    expand.ts           10배 조합: expandInventory(색·크기·성격 변형), applyOverlay/allWorldStates(계절·시간), generateTopics(세계 × 활동 틀 33), josa/fillKo(한국어 조사)
    engines/anthropic.ts        Claude Messages API 어댑터(fetch만; 모델 ID·단가 2026-10-17 기준; JSON 스키마 출력)
    engines/openaiCompat.ts     OpenAI 호환 어댑터(OpenAI·LM Studio·Ollama·mlx_lm.server·Gemini 호환 엔드포인트)
    eval/rubricJudge.ts         루브릭 판정기(5항목 0~2)
    eval/harness.ts             평가 하네스: runEval / summarize / compareSummaries / calibrateJudge
    distill/generate.ts         증류 생성기: 주제×수준×변형, plotCheck+루브릭 필터, 재개, 데이터셋 내 금지 목록
    finetune/convert.ts         승인 샘플+골드 → mlx(messages) / completions JSONL, 주제 단위 train/valid/test
    cli/distill.ts  cli/eval.ts  cli/finetune.ts  cli/topics.ts
    types.ts            공통 타입 (TextEngine, StoryOutline, BookRecord, …)
    util.ts             시드 난수, JSON 추출, 한글 토큰화, Jaccard
    banList.ts          책 간 금지 목록 (최근 10권의 물건·생물·반전·장소, 패턴은 최근 3권)
    retrieval.ts        승인 줄거리 검색 few-shot (주제 유사도 + 패턴·수준 일치)
    composeSeed.ts      조합형 생성: 인벤토리에서 재료를 뽑아 비트 슬롯을 채움 (결정적)
    gestures.ts         직설어 탐지, 몸짓 치환 후보, 프롬프트 힌트
    prompts.ts          프롬프트 상수 + fill()
    outlinePrompt.ts    outline.v3 조립 (패턴 + 재료 + 예시 + 금지 + 규칙 7 + 금지 예시 4)
    plotCheck.ts        인과 검사기 (심기-회수, 실패 이유, 새 요소, 주제·이름, 후렴, 꼬리말, 문형 반복, 금지 소재, 장소, 금지 목록, 재료 준수, 말버릇 2회 이상·후렴 겹침)
    catchphrase.ts      말버릇 비교(앱과 공유): catchphraseCore / countCatchphrase / sharesCore / catchphraseClause(s). 공백·문장부호·끝 어미 하나는 무시하고 단어 경계를 지킨다
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
npm install          # typescript, @types/node만
npm run build        # dist/ 생성 (strict 통과)
npm test             # 40 pass (가짜 엔진으로 증류·평가·변환까지 끝까지 실행)
```

## C층 사용 순서 (키만 넣으면 돌아간다)

```bash
# 0) 판정기 신뢰 확인 — 골드 24편 ≥8점, 나쁜 예시 3편 ≤기준이어야 한다 (Haiku 5.5, 약 $0.05)
ANTHROPIC_API_KEY=... npm run eval:calibrate -- --judge anthropic:claude-haiku-5-5

# 1) 기준선 3개 — 같은 20주제 (각 약 $0.5~2)
ANTHROPIC_API_KEY=... npm run eval -- --run-id haiku55-v3  --gen anthropic:claude-haiku-5-5
ANTHROPIC_API_KEY=... npm run eval -- --run-id sonnet55-v3 --gen anthropic:claude-sonnet-5-5
ANTHROPIC_API_KEY=... npm run eval -- --run-id haiku55-v3-beam --gen anthropic:claude-haiku-5-5 --beam
npm run eval:compare -- --baseline sonnet55-v3

# 2) 증류 — 비용 먼저 확인, 그다음 생성(중단해도 재실행하면 이어서)
npm run distill:estimate -- --gen anthropic:claude-sonnet-5-5 --limit 200       # 주제 200 × 수준 2 = 400편 ≈ $6 (Opus ≈ $12)
npm run distill:estimate -- --gen anthropic:claude-sonnet-5-5                   # 전체 1,250 × 2 = 2,500편 ≈ $40 (Opus ≈ $75, 배치 API면 절반)
ANTHROPIC_API_KEY=... npm run distill -- --gen anthropic:claude-sonnet-5-5 --judge anthropic:claude-haiku-5-5 --limit 200
# 주제 파일은 세계별 라운드로빈 순서라 --limit N 으로 잘라도 100세계에 고루 걸린다. 셀마다 계절·시간이 결정적으로 바뀐다(변형 0=낮, 1=밤).

# 3) 학습 데이터 → Mac Studio LoRA (finetune/README.md)
npm run finetune:data -- --format mlx --out finetune/data
```

- 평가·증류·파인튜닝 CLI의 주인공 말버릇은 기본으로 비어 있다(프롬프트에 말버릇 구절이 없다). 넣으려면 `--catchphrase "내가 먼저 해 볼래!"`. 말버릇은 책 전체에서 최대 1번이며 `plotCheck`가 2회 이상·후렴 겹침을 수정 항목으로 잡는다. 2026-10-17 이전 결과는 예전 고정값 "같이 가자!"로 만들어졌고 다시 만들지 않는다.
- 증류 결과(`distill/out/outlines.jsonl`)의 승인 샘플은 그대로 앱의 **승인 예시 창고**(검색 few-shot)로도 쓴다: `sampleToBookRecord()`로 BookRecord를 만들어 approvedBooks에 합친다. 골드 24편 + 승인 300편이면 보급형 모델도 예시 힘으로 크게 좋아진다.
- 엔진 지정 문법: `anthropic:<model>` / `openai:<model>` / `local:<baseUrl>#<model>` (예: `local:http://localhost:8080/v1#default`).
- 골드 세트는 세계 23곳에 걸쳐 있다. 세계 카드(`data/worlds.json`)를 늘리면 `npm run topics:gen`이 그 세계의 주제 12개를 자동으로 붙인다(손 주제·평가 세트·골드와 겹치는 문장은 뺀다). 틀을 늘리려면 `src/expand.ts`의 `TOPIC_TEMPLATES`에 `{creature:와}`처럼 조사 표시를 붙여 추가한다.
- **변형 규칙**: `composeSeed({ variantChance: 0.35 })`(기본)는 심을 물건에 색(색 붙는 물건만)·크기, 생물에 성격을 확률로 붙인다. 금지 목록은 머리 명사로 비교하므로 '빨간 우산'이 금지면 '우산'·'파란 우산'도 걸린다.
- **계절·시간**: `applyOverlay(lib, world, 'autumn', 'night')` → 소품·생물·소리·팔레트·그림 힌트가 합쳐진 `WorldState`. `worldCoreLines()`에 넣으면 첫 줄에 '때: 가을 밤, 선선한 바람, 달빛과 등불'이 붙고, `worldStyleLine()`은 그림 프롬프트에 계절·밤 분위기를 더한다. 앱에서는 만든 날짜(계절)와 '잠자리 책' 여부(밤)로 고르면 된다.

앱 저장소에 넣을 때는 `src/`를 앱의 모듈 폴더(예: `src/story-quality/`)로 복사하고, `data/`·`prompts/`는 정적 자원으로 둔다. 앱에 이미 같은 이름의 타입이 있으면 `types.ts`를 앱 타입으로 교체한다(필드명은 지시서 2·4와 같다).

## 통합 순서 (Codex 작업 단위)

### 1. 데이터 적재
- 앱 시작 시 `inventories.json`, `gesture_dictionary.json`, `plot_patterns.json`, `worlds.json`, 골드 24편을 읽어 메모리에 둔다. 골드는 `approvedBooks`의 초기값(검색 예시 창고)이다.
- 부모 설정 > 패턴 카드 편집은 `plot_patterns.json` 구조를 그대로 쓴다. 책 제목·본문 입력 칸은 만들지 않는다.
- **세계 선택**: 이야기 만들기 입력에 '세계' 칩을 둔다(`suggestWorlds()`가 주제·최근 사용으로 3개 추천, 시대별 탭: 현재·과거·미래·상상). 기존 '배경 서랍'은 세계 카드의 subLocations로 대체하거나, 부모가 만든 배경을 `worlds.json` 형식의 사용자 세계로 저장한다. 세계 카드의 `styleHint`·`landmarks.en`은 지시서 3의 이미지 프롬프트 6번 자리(`worldStyleLine()`)에, `palette`는 lightMood 팔레트에 쓴다.
- 세계가 정해지면 `worldCoreLines()`가 [세계관 핵심] 3줄을 만들고, `composeSeed({ world })`가 그 세계의 세부 장소·생물·소품을 재료로 뽑는다. 거실 소파 뒤 모험터널이 공통 출입구이며(`needsPortal`), 일상 세계는 터널 없이 간다.

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

## 동화공방 앱 통합 보완 (2026-10-17)

- 브라우저 진입점은 `dist/index.js`입니다. 파일을 읽고 쓰는 증류·평가 하네스·학습 변환기는 별도 **Node 전용** `dist/node.js`에서 가져옵니다. CLI는 기존 `npm run` 명령을 그대로 사용합니다.
- `runOutlineStage()`는 선택적으로 `world`, `variantChance`, `referenceBooks`, `banWindow`, `patternBanWindow`, `excludeBookIds`를 받습니다. `referenceBooks`의 골드 예시는 검색에만 쓰고 최근 사용자 책의 반복 금지 목록에는 넣지 않습니다. 반환 `seed`에는 실제 재료와 반전 ID가 들어 있습니다.
- 앱의 추가 배경·감정 흐름·사건 상태표는 빔 탐색의 최종 결합에서도 보존합니다. 비트 후보·심사 응답의 형식은 전체 줄거리 응답과 구분합니다. 승인 예시 때문에 패키지 프롬프트가 1,800 추정 토큰을 넘으면 예시를 2→1→0개로 줄입니다.
- `runProseStage({twoPass:false})`는 상위 수준의 초안을 거치지 않고 목표 수준으로 한 번 씁니다. 기본 2패스와 감정 직설어 수정은 유지합니다.
- 반복 소품·생물은 선택 전과 생성 후 모두 머리 명사로 비교합니다. 예를 들어 빨간 우산을 쓴 직후 파란 우산으로 바꾸어 반복 제한을 피할 수 없습니다. 긴 고유명사에 포함된 일부 문자열은 재료 등장으로 세지 않습니다. 세계 생물을 모두 최근에 사용했다면 아직 사용하지 않은 공용 생물로 넘어갑니다.
- 괄호 주석을 제거한 이름을 기준으로 한국어 조사를 선택합니다. 이 처리는 카드의 재료·주제 이름에만 사용하며 저장된 동화 본문을 일괄 수정하지 않습니다.

검증은 TypeScript strict 빌드와 가짜 엔진을 사용하는 패키지 테스트 40개, 주제 생성 CLI, 비용 추정 CLI로 진행했습니다. 실제 유료 증류·평가·LoRA 학습은 실행하지 않았습니다. `topics:gen`은 주제 파일을 덮어쓰므로 검토할 때는 복사본에서 실행하세요. 등록되지 않은 모델 단가는 무료가 아니라 `unavailable (unpriced)`로 표시합니다.

증류 샘플 재개 ID는 주제·한글 단계·영어 단계·변형 번호를 포함합니다. `--dry-run` 결과는 이후 실제 생성을 건너뛰게 하지 않습니다. 모델·규칙·주제 데이터가 바뀌면 새 출력 파일/평가 run ID를 사용하세요. 동시 생성에서 승인 목록이 바뀌는 순서는 응답 속도의 영향을 받으므로 같은 시드만으로 전체 데이터셋의 동일성을 보장하지는 않습니다. 순서까지 재현해야 할 때는 코드 설정의 `concurrency: 1`을 사용하세요.
