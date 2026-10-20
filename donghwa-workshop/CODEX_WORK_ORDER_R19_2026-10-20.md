# Codex 지시서 r19 · 이야기 뼈대(기승전결·반전) 살리기 · 2026-10-20

부모님 지적: "통독·퇴고를 거쳐도 이야기가 너무 가벼워. 증류나 다른 동화를 레퍼런스 삼아 기승전결과 반전이 살아나게." **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 하지 않습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | r18 = `894ab59`(코드) / `9e15d6d`(지시서) |
| 반입 범위 | **`9e15d6d..b306f1d`** (이 문서는 다음 커밋). r18을 아직 반입하지 않았다면 r18 지시서(범위 `06d12f3..894ab59`)를 먼저 따릅니다. |
| 새 파일 | `dist/story-generation/arc-rules.js`, `tests/story-arc.test.mjs`, `story-quality/test/arc-r19.test.mjs` |
| 바뀐 파일 | `dist/story-generation/{ui,pipeline,book-revision,quality-adapter,schemas,stop-report,quality-settings}.js`, `dist/full-auto.js`, `dist/simple-create.js`, `dist/sw.js`(v54), `story-quality/src/{retrieval,outlinePrompt,pipeline,richThenSimplify}.ts`와 그 `dist` 산출물 8개 + `dist/story-quality/dist` 사본, `tests/openings-legacy-r12.test.mjs`, `tests/openings-policy-r12.test.mjs`, `CLAUDE.md` |

## 1. 원인

| 단계 | 전 |
| --- | --- |
| 줄거리 규칙 | 심은 물건·서로 다른 실패 이유·반전 하나만 요구. 바라는 것이 왜 중요한지(stakes), 시도가 점점 커지는지, 반전 직전의 바닥, 반전이 무엇을 뒤집는지는 어느 규칙도 요구하지 않음 |
| 참고 예시 | 2편을 넣지만 비트마다 첫 문장 한 줄뿐(카드당 420자). 반전 비트·바닥 비트의 전문을 모델이 본 적이 없음 |
| 본문(풍부→단순화) | 단순화가 "곁가지 묘사·반복·덧붙인 대화"를 줄이며 바닥 문장과 반전의 연출까지 함께 깎음 |
| 통독 | 사건은 동결, 표현만 손봄. 항목에 stakes·바닥·반전 연출이 없어 평평한 반전을 살릴 수 없음 |

## 2. 바뀐 것 (새 초안 = `arcPolicy {version: 1}`만)

| 단계 | 후 |
| --- | --- |
| 줄거리 규칙(앱 경로·품질 canon) | STORY SPINE 6줄: STAKES(want 비트에 '못 하면 무엇을 잃는지' 한 줄) · RISING TRIES(시도마다 더 큰 대가) · LOW POINT(마지막 시도 끝 = 포기 직전, 단서는 바로 옆) · TURN = SEEING AGAIN(twistReveal에 믿었던 것/실제/심은 물건의 새 역할) · PAYOFF(주인공의 손으로 해결, 끝은 처음을 비춤) · EMOTION LADDER |
| 참고 예시(품질 경로) | 증류 9점 이상(149편)+골드를 '뼈대 카드'로: 심은 물건·바라는 것/걸림돌·시도 사다리·바닥 비트 전문·반전 비트 전문·뒤집힌 뜻·되돌아옴(카드당 1,300자, 예산 3,200으로 2편 유지). 스위치와 무관하게 후보에 넣음 |
| 본문 규칙(앱 본문·풍부화·품질 canon) | STORY SPINE IN PROSE: stakes 한 문장, 마지막 attempt 끝의 가장 조용한 문장, 반전 세 걸음(보거나 듣기 → 주인공이 제 말로 → 뜻), '알고 보니/it turned out' 서술 금지, 손으로 해결, 처음을 비추는 끝 |
| 패키지 단순화·고침·압축 | '[반드시 지킬 것]'에 뼈대 보존 줄(`keepLines`) |
| 통독 | 항목 stakes·lowPoint·turn 추가, 반전 쪽을 '보기/듣기 → 제 말 → 뜻'으로 다시 쓰라는 지시(사건 동결 그대로) |
| 앱 검사 | `arc_turn_planted`(soft): 반전 비트에 심은 물건이 없으면 수정 호출로 고침, 멈추지 않음 |
| 안내문 | 설정·쉬운 ③의 '증류 예시' 설명: 새 이야기는 9점 이상 예시를 늘 참고, 스위치는 예전 초안과 8점 예시에만 |

정책 없는 기존 초안·작업·책은 요청이 바이트 단위로 같습니다(R12·R13 핀 그대로). 줄거리 요청은 카드 때문에 약 +600~800 토큰(약 $0.002~0.005/권) 늘어납니다.

## 3. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **896/896** (새 `tests/story-arc.test.mjs` 8개 포함). R12 핀 `inputs`·`fullAutoDemo`·`review` 세 개는 새 초안의 `arcPolicy`와 ③ 도움말 문구 때문에 사유를 적고 다시 고정했습니다(`requests`·`demo`·`scene` 등 나머지 핀은 그대로) |
| `npm run test:quality` | **83/83**(새 `test/arc-r19.test.mjs` 4개 포함), 두 사본 동일(`diff -rq story-quality/dist dist/story-quality/dist`) |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | 읽기 화면 지문 `0e5035cf…` 그대로 |

패키지를 다시 빌드하면 `@types/node`가 없어 TS2688이 나오지만 산출물은 같습니다. `dist/eval/prose.d.ts`가 `any`로 바뀌면 되돌리세요.

## 4. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v54`(precache에 `arc-rules.js` 추가). `dist/story-quality/examples/approved-books.json`이 함께 올라가야 뼈대 카드가 들어갑니다(없으면 골드 24편만으로 카드를 만들고 멈추지 않습니다). DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더.

## 5. 배포 후 부모님 확인(유료)

쉬운 ①~③ 또는 프로 마법사로 K2 12쪽 한 권. 줄거리 카드에서 (1) want 비트에 '못 하면 무엇을 잃는지'가 있는지, (2) 마지막 시도 비트가 포기 직전으로 끝나는지, (3) 반전 비트가 심은 물건을 다시 보여 주는지. 본문에서 반전 쪽이 '보거나 듣고 → 아이의 말 → 뜻' 세 걸음으로 읽히는지, 마지막 쪽이 첫 쪽의 물건이나 말을 되비추는지. 가벼움이 남으면 멈춤·검사 리포트 대신 완성 책의 줄거리 JSON과 쪽 글을 Claude에게 보내 주세요.

## 6. 완료 보고

`CODEX_R19_COMPLETION_2026-10-20.md`: 반입 방법, 3절 결과표, 배포 URL·버전.
