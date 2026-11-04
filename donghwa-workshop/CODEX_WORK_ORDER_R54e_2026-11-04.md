# Codex 지시서 r54e · 작가실 A/B 반영 (독자단 고르기·밀도 목표·제본 표시·영어판 성별·작가 상위 모델·추정 보정) · 2026-11-04

유료 A/B 리포트(`QA/r54-room-ab/REPORT_2026-11-04.md` 3절)의 개선점 1~7을 넣었습니다. 유료 호출 수는 같고(전제 1 · 독자단 1 · 초고 3 · 읽기 1 · 고쳐쓰기 1 · 영어판 1 · 다듬기 ≤1 · 그림 읽기 1), 작가 모델만 모든 공급자에서 상위로 맞췄습니다.

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | 이 지시서와 같은 커밋 (캐시 `donghwa-shell-v114`) |
| 반입 범위 | r54d 지시서 `801d8fd` 이후: `801d8fd..HEAD` (앞 라운드 미배포면 `81310b2..HEAD` 한 번에) |
| 바뀐 파일 | `dist/story-generation/writers-room.js`, `dist/book-layout.js`, `dist/story-generation/pipeline.js`, `dist/full-auto.js`, `dist/text-generation/models.js`, `dist/story-generation/quality-settings.js`, `dist/sw.js`, 테스트 7개, `CLAUDE.md`, `STORY_ENGINE_REVIEW_2026-11-03.md`, `QA/r54-room-ab/REPORT_2026-11-04.md` |

## 바뀐 것 (R54e)
1. **독자단은 고릅니다.** 전제 라운드: 독자마다 셋만 순위로(1순위 3·2순위 2·3순위 1점, 이유 하나·한마디). 초고 라운드: 독자마다 '다시 읽고 싶은 한 권'과 초고마다 '넘기고 싶은 쪽 하나'·'모른 쪽'·웃은 쪽들. 집계는 결정론 그대로(`countReactions`·`countReadings`). gpt-4.1-mini가 12개에 전부 같은 표시를 하던 문제의 형식 쪽 고침입니다.
2. **브리프 [길이]에 밀도 목표** 한 줄(규격의 쪽 범위: "한글 한 쪽 a~b문장(보통 t) … 영어판은 쪽당 c~d문장"). 규칙이 아니라 목표라 검사기는 그대로입니다.
3. **제본은 작가의 `spread` 표시만 따릅니다**(펼침 책). 작가실 책에서는 R12의 'all-pairs면 마지막 펼침을 펼침면으로' 규칙을 끕니다(`normalizeOpenings(..., {mixGuard:false})`, `acceptEcoPagination(..., {roomBinding:true})`). 옛 길·에코는 그대로.
4. **영어판 요청**에 인물 성별(`[cast] 유하 (Yuha) — boy, he; …`)과 쪽당 문장 목표.
5. **브리프 '좋은 그림책' 문단**: "마지막 줄은 뜻을 말하지 않고, 달라진 것은 행동 하나로 보여요."
6. **작가 상위 모델**: 새 품질 역할 `writer`(부모 '작가 · 상위' 행의 엔진 선택 + 그 공급자의 상위 모델; anthropic은 claude-opus-5-5). FULL AUTO의 작가실 작업만 씁니다. 옛 `outline` 역할(anthropic medium)은 그대로라 R13 레거시 핀·옛 작업은 불변입니다.
7. **추정 보정**: 작가실 행을 실측에 1/3 여유로. ③ K2 16쪽 openai 글 약 $3.19 → $1.33(실측 $0.92). 전제 요청 maxTokens 9,000.

보류: 리포트 3-8(작가실이 낸 새 인물의 카드·시트 — 그림 요금이 늘어 부모님 결정 뒤), Opus 작가 A/B 재실행(약 $1.5, 승인 뒤).

## 검증 (이 커밋 기준)
`npm test` 1120/1120 · `npm run test:quality` 85/85 · `diff -rq story-quality/dist dist/story-quality/dist` 동일 · R12 읽기 DOM `0e5035cf…` 그대로 · 센서스 7표 동일·ERRORS []·PAID 0 · 스모크 PASS×2. R12 핀은 `review`(③ 요금 문구)·`estimates`(작가실 행)만 재고정(덤프 비교로 다른 그룹 동일).

## Codex가 할 일
1. `801d8fd..HEAD`를 반입해 배포(v62). 배포 뒤 캐시가 `donghwa-shell-v114`인지 확인.
2. 작가실로 한 권(K2 16쪽, 한글·영어)을 만들어 — 부모님 승인 뒤 유료 — 다음을 확인하고 `CODEX_R53_COMPLETION_2026-11-03.md`에 덧붙여 주세요: (a) 부모 선택 화면의 전제 셋이 서로 다른 끌림 수를 보이는지(동점 셋이면 독자단 형식이 아직 약한 것), (b) ③ 완료 줄 "작가실 · 초고 3권 …"에 등급 참고 수가 작가 쪽수의 절반 이하인지(밀도 목표가 먹었는지), (c) 마지막 두 쪽이 한 펼침면으로 합쳐지지 않았는지, (d) 영어판의 주인공 대명사가 성별과 맞는지, (e) 멈춤 리포트의 모델 이름이 작가 호출에서 상위 모델(anthropic이면 opus)인지, (f) ③ 추정과 실제 요금의 비율(2배 안이면 됨).
3. 부모님 키·초대 코드는 어디에도 적지 마세요. 그림이 든 피드백 HTML/PDF는 커밋하지 않습니다.
