# Codex 지시서 r20 · 기획 회의(작가·편집자·그림 감독·독자 봇) · 2026-10-20

부모님 요청: "봇으로 역할을 분리해서 의논 후 스토리를 만들게 하고, 삽화까지 고려하는 봇도 넣어 달라. 역할은 관점을 가진 페르소나로, 조건은 한 블록으로, 독자 나이를 먼저 규정하고, AI 제안 중 무엇을 채택·수정·폐기했는지 기록하라." **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 하지 않습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | r19 = `b306f1d`(코드) / `a113ead`(지시서) |
| 반입 범위 | **`a113ead..deb5da1`** (이 문서는 다음 커밋). r19를 아직 반입하지 않았다면 r19 지시서(범위 `9e15d6d..b306f1d`)를 먼저 따릅니다. |
| 새 파일 | `dist/story-generation/council.js`, `tests/story-council.test.mjs`, `story-quality/test/council-r20.test.mjs` |
| 바뀐 파일 | `dist/story-generation/{pipeline,quality-adapter,quality-gates,ui,schemas,stop-report}.js`, `dist/image-generation/scene-prompt.js`, `dist/full-auto.js`, `dist/app.js`, `dist/simple-create.js`, `dist/text-generation/models.js`, `dist/style.css`, `dist/sw.js`(v55), `story-quality/src/{childSimulator,pipeline}.ts`와 그 `dist` 산출물 4개 + `dist/story-quality/dist` 사본, `tests/openings-legacy-r12.test.mjs`, `tests/openings-policy-r12.test.mjs`, `tests/catchphrase-r9.test.mjs`, `tests/engine-model-choice-r13.test.mjs`, `CLAUDE.md` |

## 1. 무엇이 생겼나

줄거리를 쓰기 **전에** 네 역할이 한 번 짧게 의논합니다(새 초안만, `councilPolicy {version: 1}`). 의장은 코드입니다.

| 역할 | 관점 | 받는 것 | 내는 것 | 거부권 |
| --- | --- | --- | --- | --- |
| 의장(코드) | 토론하지 않음 | 방향·조건·참조 | 회의 진행, 채점, 결정 기록 | 라운드 상한(재피치 1회) |
| 작가 봇 | 20년 그림책 작가, "반전은 아이가 먼저 알아차리게" | 방향·조건·주제 | 피치 3개 → 바이블 | 없음 |
| 편집자 봇 | "바라는 것이 분명하지 않은 원고는 돌려보낸다" | 피치 3개, 점검표(뼈대 6항목), 참조 자리 | 0~2점 × 6, 고칠 점 2개, pick | 뼈대 결격 |
| 그림 감독 봇 | "글이 말하지 않는 것을 그림이 말한다, 반전은 펼침면" | 피치 3개, 고정 재료 | 그릴 수 있는가 0~2점 × 4, 모티프 2~3개 | 그릴 수 없는 반전·재료 밖 장소 |
| 독자 봇 | 독자 카드의 나이(K1 4세·K2 5세·K3 7세·K4 9세), 글을 못 읽고 듣기만 | 피치 3개 | "다음엔?" 0~2, 반전 되말하기 | 되말하기 실패 |

- **방향**: 마법사의 새 칸 '이 책의 방향'(프로 3단계, 접힌 '선택' 칸, 200자 — 접혀 있어 단계의 입력 칸 수 규칙(3개 이하)은 그대로). 비우면 의장이 "5~6세 독자가 절정에서 '가치'를 사건으로 느끼고, 끝은 처음을 비춘다"처럼 수준·가치·끝맺음에서 만듭니다. 모든 봇이 같은 문장을 받습니다.
- **조건 블록**: 독자 카드(집중·인과·맞는 반전·웃음·금지), 분량과 문장 규칙, 끝맺음, 가치(말로 하지 않기), 고정 인물·고정 장소(새 인물·새 장소 금지), 금지 소재, K1/K2 소리말 후렴. 코드가 조립해 모든 봇에 같은 블록을 줍니다.
- **채점**: 편집자 12점 만점 × 5, 그림 감독 8점 × 4, 독자 4점 × 3 → 12점 척도. 거부권에 걸린 피치는 뺀 뒤 최고점. 셋 다 거부되면 거부 사유를 주고 작가 봇이 한 번만 다시 피치합니다.
- **바이블**: 고른 피치 + 세 봇의 고칠 점을 작가 봇이 반영해 확정. 잃는 것, 심은 물건(한/영), 시도 사다리, 바닥, 반전(보는 것/아이의 말/뒤집히는 믿음), 해결, 끝 + 그림 계획(비트마다 '아이가 보는 것' 한/영, 반전 펼침면 = 비트 수−2, 모티프, 1비트의 심은 물건 자리).
- **바이블이 묶는 곳**: 줄거리 규칙(앱 경로·품질 canon 모두 STORY BIBLE 블록), 장면 디테일(비트별 그림 약속·1비트 소품에 심은 물건), 쪽 나누기(펼침 책은 반전 비트를 cue reveal 펼침면, 쪽 책은 반전 첫 쪽에 심은 물건 크게, 바로 앞은 바닥), 그림 요청(1비트 PLANTED OBJECT·반전 REVEAL·MOTIFS, 표지 제외).
- **결정 기록**: 의장이 제안·검토·채택·폐기·수정을 남기고(300건 상한), 부모가 프로 줄거리 카드에서 승인하면 '부모 · 수정'으로 기록됩니다. 검사 카드 '줄거리 카드'의 '기획 회의' 접기, 쉬운 ③의 한 줄 요약, 멈춤 리포트 '## 기획 회의'(줄거리 전에 멈춘 작업도 체크포인트의 기록으로)에서 봅니다.
- **독자 나이**: 아이 시뮬레이터가 정책 초안에서 독자 카드 나이로 말합니다(패키지 `opts.age`). 기존 초안은 4세 문안 그대로입니다.
- **재개·요금**: 회의 저널은 `councilCheckpoint`(작업·초안)에 남아 재개 때 다시 사지 않습니다. 보급형 모델 5회(재피치 시 9회), 권당 약 2~5센트. 새 작업의 추정과 ③ 요금 줄에 포함됩니다. 회의 사용량은 줄거리 결과의 사용량·요청 수에 합쳐집니다.
- **참조 자리**: 편집자 봇의 `[참조]`는 비어 있습니다. 부모님이 레퍼런스 동화를 주시면 그 뼈대 카드를 여기에 넣습니다.

정책 없는 기존 초안·작업·책은 요청이 바이트 단위로 같습니다(R12 `requests`·`fullAutoResume`·`demo`·`scene` 핀 그대로). `inputs`·`fullAutoDemo`(새 초안·새 데모 작업의 `councilPolicy`)·`review`·`estimates`(새 작업의 회의 5회 요금)와 R13 앱 핀(새 작업 추정)은 사유를 적고 다시 고정했습니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **906/906** (새 `tests/story-council.test.mjs` 10개 포함). R12 핀 `inputs`·`fullAutoDemo`·`review`·`estimates`와 R13 앱 핀은 사유를 적고 다시 고정(`requests`·`fullAutoResume`·`demo`·`scene` 그대로) |
| `npm run test:quality` | **84/84**(새 `test/council-r20.test.mjs` 1개), 두 사본 동일(`diff -rq story-quality/dist dist/story-quality/dist`) |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | 읽기 화면 지문 `0e5035cf…` 그대로 |
| `scripts/r9-simple-smoke.mjs` | `PASS` |

패키지를 다시 빌드하면 `@types/node`가 없어 TS2688이 나오지만 산출물은 같습니다. `dist/eval/prose.d.ts`가 `any`로 바뀌면 되돌리세요.

## 3. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v55`(precache에 `council.js` 추가). DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더.

## 4. 배포 후 부모님 확인(유료)

쉬운 ①~③ 또는 프로 마법사로 K2 12쪽 한 권. 글 만들기 중 진행 문구에 "기획 회의 · …"가 먼저 보이고(20~60초), ③ 완료 줄에 "기획 회의 · 피치 3개 중 '…' 채택 · 편집자 n/12 · 그림 n/8 · 독자 n/4"가 나오는지. 프로 줄거리 카드의 '기획 회의' 접기에서 피치 3개와 점수, 바이블(잃는 것·바닥·반전), 결정 기록이 보이는지. 완성 책의 반전 쪽이 펼침면(펼침 책)인지와 첫 그림에 심은 물건이 보이는지. 가벼움이 남으면 멈춤·검사 리포트의 '## 기획 회의'와 줄거리 JSON을 Claude에게 보내 주세요.

## 5. 완료 보고

`CODEX_R20_COMPLETION_2026-10-20.md`: 반입 방법, 2절 결과표, 배포 URL·버전.
