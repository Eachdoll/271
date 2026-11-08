# Codex 지시서 r55c · 작가실 책은 줄거리를 사지 않음 + 그림 읽기가 구도·글 자리·몫을 읽음 + 작가실 쪽에 스테이징 (B-1) · 2026-11-08

2차 A/B 개선안(`QA/r54-room-ab-opus/IMPROVEMENTS_2026-11-05.md`) B-1입니다. 작가실 책에서 줄거리 호출(시스템 18,000자, 29~48초, 요금의 한 몫)은 작가가 읽지 않았고(초고는 브리프와 전제로 씀) 쪽은 위치로만 비트에 대응됐습니다. 그런데 그 줄거리의 비트별 그림 계획(구도·글 자리·단색 바탕)이 그림 요청을 정했습니다 — 아무도 쓰지 않은 비트의 계획으로. 이제 **앱이 줄거리를 쓰고**, 완성 글을 읽는 싼 호출이 쪽마다 구도를 읽고, 그림이 읽는 줄거리는 완성 쪽에서 다시 만듭니다. 유료 −1회(중간~상위 모델 1회, 책당 약 $0.06~0.2·30~50초).

**덤으로 고친 결함**: 작가실 책의 쪽에는 스테이징(카메라·인물 쪽·빛)이 없어서 그림 요청이 **옛 fallback 프롬프트**("Illustrate page …")로 나갔습니다 — COMPOSITION FIRST·그림 계획·글 자리(TEXT FIELD)·"같은 쪽에서, 뒤집지 않기"·맞은편 쪽 구분이 작가실 책에는 하나도 적용되지 않았던 것입니다(코드로 재현: `scratch r55d/roomprompt.mjs`). 이번부터 작가실 쪽은 스테이징을 받아 새 프롬프트 경로로 갑니다.

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | 이 지시서와 같은 커밋 (캐시 `donghwa-shell-v119`) |
| 반입 범위 | r55d 지시서 커밋 `28a3c4a` 이후: `28a3c4a..HEAD` (r55d 미반입이면 `2e51250..HEAD` 한 번에) |
| 바뀐 파일 | `dist/story-generation/writers-room.js`, `dist/story-generation/pipeline.js`, `dist/text-generation/models.js`, `dist/full-auto.js`, `dist/sw.js`, `tests/writers-room-r55c.test.mjs`(새), r51·r53·R12 테스트, `CLAUDE.md`, `QA/r54-room-ab-opus/IMPROVEMENTS_2026-11-05.md`, `STORY_PICTURE_ROUNDTABLE_2026-11-08.md` |

## 바뀐 것
1. **줄거리 호출 없음**(`generateOutline`): 작가실 초안은 전제 → 독자단 → (부모 선택) 뒤 `roomOutline(input, record)`가 앱 검사(`validateOutline`)를 통과하는 뼈대 줄거리를 씁니다 — 제목 셋(전제·독자단 셋의 제목), 한 줄, 비트 C개(펼침 수 또는 쪽수의 비트 수; setup·want·attempt…·turn·resolution·close), 인물, 고른 장소, 새 낱말(주제 명사), 감정, 끝맺음. 표식 `outline.roomOutline {version: 1, stage: "skeleton"}`. 요청 수는 작가실의 둘뿐.
2. **그림 읽기 확장**(`extractRequest`, 그림책 결 초안만): 쪽마다 `shot`(wide/middle/close)·`space`(full/airy)·`carrier`(words/picture/both)와, 드라마 표식이면 `focus`(시선이 가는 것)·`backdrop`(scene/plain — 단색 바탕은 책에 둘까지, 첫·마지막 쪽 아님), 글 자리 표식이면 `pocket`(left/right/top/bottom/none). `beatIndex`와 `[beats]`는 더 묻지 않습니다 — 비트는 앱이 쪽에 **나눠 줍니다**(펼침 책은 R54b 규칙, 낱쪽 책은 고르게 순서대로 `evenBeats`). 글이 많은 책(wordy)의 읽기는 예전 필드 그대로.
3. **완성 쪽에서 줄거리 재구성**(`roomOutlineFromPages`): 비트 요약 = 그 비트 쪽들의 한글, 장소 = 쪽들이 가장 많이 댄 공급 장소 ID(없으면 `newPlace` 글), 감정 = 첫 쪽의 것, 그림 계획 = 첫 쪽의 읽기(shot·space·carrier·focus·backdrop·pocket) → 작가 줄거리와 같은 정리기(`settlePicturePlans`·`settleDramaPlans`·`settlePockets`: 구도 단조로움 가드, 단색 바탕 상한, 글 자리 조건)를 거침. `meta.outline`으로 돌려주고 FULL AUTO가 `job.outline`을 바꿉니다(표식 `stage: "pages"`). 이 줄거리를 `pocketOf`(글 자리)·`planOf`(그림 계획)·`pagePlace`(장소)·시리즈 요약이 읽습니다.
4. **스테이징 켬**: `runRoomPages`가 `acceptEcoPagination(..., {staging: true})`로 쪽마다 `staging`(카메라 회전·인물 쪽·글 쪽·빛·동사·시드)을 붙입니다. 그림 요청이 `buildScenePrompt`(COMPOSITION FIRST·PICTURE PLAN·TEXT FIELD·FACING PAGE·같은 쪽에서) 경로로 갑니다. 읽기의 `backdrop: plain`은 쪽에도 실려 `settleBackdrops`가 비트 계획과 맞을 때만 남깁니다.
5. **추정**: 작가실 행에서 `outline` 행 삭제(③ 새 K2 16쪽 openai 글 약 $1.33 → $1.26, 요청 12 → 11).
6. **저널**: 그림 읽기 요청이 바뀌어 저널 키가 달라집니다 — 업그레이드 전에 '쪽과 그림 읽기' 단계 **직전**까지 간 작업을 재개하면 그림 읽기 1회(싼 모델, 약 $0.01)를 다시 삽니다. 이미 쪽이 있는 작업·책은 그대로입니다.

## 바뀌지 않은 것
옛 길(K1·작가실 끔·데모)의 줄거리 요청·검사·추정은 바이트 단위로 그대로(R12 `requests`·`demo`·`inputs`·`fullAutoDemo`·`scene`·`print`·`checks` 핀 그대로; `review`·`estimates`만 ③ 요금 줄·작가실 행으로 재고정, 28a3c4a 덤프 비교). 작가에게 가는 지시는 늘지 않았습니다(초고 요청 그대로).

## 검증 (이 커밋 기준)
`npm test` 1139/1139 · 품질 85/85 · 미러 동일 · R12 핀 `review`·`estimates`만 재고정 · 읽기 DOM `0e5035cf…` · 센서스 7표 동일·ERRORS []·PAID 0 · 스모크 PASS×2. `tests/writers-room-r55c.test.mjs`(4): 뼈대 줄거리 검사 통과·generateOutline 요청 2회·읽기 스키마·완성 줄거리(요약·장소·계획)·쪽 스테이징·그림 요청이 COMPOSITION FIRST/PICTURE PLAN/TEXT FIELD를 담음·추정 행.

## Codex가 할 일
1. `28a3c4a..HEAD`(또는 `2e51250..HEAD`) 반입·배포. 캐시 `donghwa-shell-v119` 확인.
2. 무료로 확인: 작가실이 켜진 새 K2 이야기의 ③ '엔진·예상 요금'이 요청 11건(16쪽 openai 약 $1.26)인지; 데모 책은 예전 그대로인지.
3. 작가실로 한 권(부모님 승인 뒤 유료) 만들 때 `CODEX_R53_COMPLETION_2026-11-03.md`에 덧붙이기: (a) ③ 단계 줄에서 '줄거리 만들기'가 전제·독자단만으로 끝나고 요청 수가 2인지(교신 기록에 StoryOutline 요청이 없음), (b) 그림 요청(`imageMeta.prompt`)이 "COMPOSITION FIRST"로 시작하고 글 자리 책이면 "TEXT FIELD"가 있는지 — 이전 작가실 책은 "Illustrate page"로 시작했을 것, (c) 쪽마다 구도가 바뀌는지(같은 wide 열두 장이 아닌지), (d) 책 저장 뒤 서재 한 줄·시리즈 요약이 실제 글로 나오는지.
4. 키·초대 코드는 어디에도 적지 않습니다.
