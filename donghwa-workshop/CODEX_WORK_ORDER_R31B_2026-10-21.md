# Codex 지시서 r31b · 프롬프트 다이어트(창작을 방해하는 제약 제거) · 2026-10-21

## 배경

부모님 판단: "반드시"가 쌓인 프롬프트 때문에 글이 문맥에 안 맞거나 재미가 없고, 의성어가 부자연스럽다. 실측해 보니 맞았습니다.

| 요청 | 전(r31a) | 후(r31b) |
| --- | --- | --- |
| K1 줄거리 시스템 프롬프트 | 15,319자 · 명령형 77개 | **3,169자 · 18개** |
| K1 줄거리 사용자 입력 | 5,160자(규격 JSON·설정 덤프) | **1,102자** |
| K1 책 전체 작가 시스템 | 4,087자 | **1,193자** |
| K2 줄거리 시스템(정성 품질 경로) | 12,826자 · 58개 + 패키지 시드 `[플롯 패턴]/[정해진 재료] (반드시 이대로 쓴다)` | **3,657자 · 12개, 시드 없음** |
| K2 줄거리 사용자 입력 | 3,748자 | **1,579자** |
| K2 비트별 작가 시스템 | 3,114자 · 10개 | **659자 · 2개** |

보내지 않게 된 것(새 초안만): STORY SPINE 명령(줄거리·본문·캐논·통독), SUSPENSE·심은 물건 공식, 소리말 후렴 3곳·소리말 다섯 개 할당량, 패키지 플롯 패턴 시드, 읽기 규격 JSON과 설정 덤프, 본문의 인용 3개·감각 1개 카운터, 비트별 작가의 "EVERY sentence / Never repeat" 카운터, 풍부화 단계. 남긴 것: 안전(무섭거나 벌주는 내용 없음, 말로 하는 교훈 없음), 읽기 단계 한 문장(검사기가 재는 것), 어휘 목록은 차단 단계(E1~E2 등 400어 이하)의 본문 단계에만, 재료·장소·사람·돌려줄 모양, 기획 회의 피치는 "이 피치로, 자기 방식대로" 계획으로.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·푸시·배포만 합니다. 이 작업에 유료 API 호출은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`92dce12`** (캐시 `donghwa-shell-v74`) |

지금 운영 상태에 따라 범위를 고릅니다.

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v37 / v66 (r28~r31a 미반입) | **`09bb65e..92dce12`**를 한 번에. 통합 지시서 `CODEX_WORK_ORDER_R28_TO_R30_2026-10-21.md`의 절차를 따르되 `npm test` **988**, 캐시 **v74**로 읽기 | v38 |
| v71 (r28~r30 배포) | **`f15a97f..92dce12`** (r30.1·r31a 포함) | 다음 번호 |
| v72 (r30.1까지 배포) | **`354eda7..92dce12`** (r31a 포함) | 다음 번호 |
| v73 (r31a까지 배포) | **`327dede..92dce12`** | 다음 번호 |

| 구분 | 파일 |
| --- | --- |
| 새 파일 | `dist/story-generation/prompt-diet.js`, `tests/prompt-diet-r31b.test.mjs` |
| 바뀐 코드 | `dist/full-auto.js`, `dist/sw.js`(v74), `dist/story-generation/{arc-rules,book-revision,council,craft-rules,k1-book,pipeline,ui}.js`, `dist/text-generation/{models,settings-ui}.js` |
| 바뀐 테스트 | `tests/{catchphrase-r9,k1-book-r31a,openings-legacy-r12,openings-policy-r12,prompt-policy-r23,story-stage-models}.test.mjs` |
| 문서 | `CLAUDE.md` |

패키지 코드(`story-quality/src`, `dist/story-quality/`), DB, 서버, 비밀값은 바뀌지 않았습니다.

## 1. 무엇이 달라졌나 (새 이야기만)

| 항목 | 전 | 후 |
| --- | --- | --- |
| 정책 | — | 새 초안마다 `promptDiet {version: 1}` 고정. 정책이 없는 기존 초안·작업·책은 바이트 단위로 같음 |
| 글 요청의 시스템 | 바탕 규칙 + 규격 JSON + 단계별 명령 수십 줄 | 바탕 4줄 + 언어별 읽기 단계 한 문장 + 좋은 그림책의 느낌(숫자 없음) + 돌려줄 모양 |
| 글 요청의 입력 | 전체 설정 덤프 | 인물·배경 요약, 주제, 끝맺음 |
| K2 이상 줄거리 | 정성 품질 경로(패키지 시드·STORY SPINE·SUSPENSE) | 앱 경로. 기획 회의 피치·감정 곡선·성장 설계는 그대로, 피치는 "자기 방식대로" 계획으로 |
| K1 줄거리 | K1 STORY 블록 + 규격 | K1 모양 한 문단, 사건 장부(plotContract) 없음 |
| 비트별 작가·K1 작가 | 문장마다 지켜야 할 카운터 | 소리 내어 읽는 그림책의 목소리, 읽기 단계 한 문장 |
| 통독 | 긴장(suspense) 항목 포함 | suspense 항목 없음 |
| 풍부화 | FULL AUTO·프로 풍부화 실행 | 건너뜀 |

- **K2 새 작업 글 요금:** 줄거리를 단계 모델로, 품질 본문·풍부화 행 없음. 16쪽 약 $2.41 → **약 $1.66**, 12쪽 약 $2.18 → **약 $1.52**(요청 수는 같음). K1은 r31a 그대로(12쪽 약 $0.99).
- **되돌리기:** `dist/story-generation/ui.js`의 `inputFromWizard`에서 `promptDiet: promptDiet()` 한 줄을 빼면 새 초안이 예전 프롬프트로 돌아갑니다. 기존 초안은 어느 쪽이든 그대로입니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **988/988**. 새 테스트 6개: `prompt-diet-r31b` |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

다시 고정한 핀은 R12 `inputs`·`fullAutoDemo`·`review`·`estimates`입니다. `a3f361e` 덤프와 비교해 `promptDiet` 키와 K2 이상 새 작업의 요금 외에는 차이가 없음을 확인했습니다. R12 `requests`(정책 없는 초안의 요청)와 R13 앱 핀은 그대로입니다.

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r31b 프롬프트 다이어트 반입 · 캐시 v74"
git push origin <운영 브랜치>
```

기존 사이트에 배포합니다. 서비스 워커는 `donghwa-shell-v74`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인

**무료(Codex가 운영 URL에서 확인)**
- 쉬운 ③에서 K2 16쪽 새 이야기 요금이 약 $1.66으로 나오는지 봅니다(K1 12쪽은 약 $0.99 그대로).
- 데모로 한 권을 만들어 기존 흐름(④ 글 고치기·그림)이 그대로인지 봅니다.

**유료(부모님 승인 뒤에만)**
- 같은 요청으로 r31a와 r31b 원고를 나란히 비교합니다: "4살 유하가 스쿨버스를 타고 해니를 만나 장난치며 유치원에 가는 이야기, 12쪽" — K1 1권(글 약 $0.9), K2 1권(글 약 $1.5).
- 확인할 것: 의성어가 문맥에 맞는지, 쪽마다 넘기고 싶은 재미가 있는지, 끝이 유치원 장면인지, 검사 리포트의 문장 항목이 통과하는지.
- 원고의 숫자는 모델이 말한 값이 아니라 검사기 실측값으로만 적습니다.

## 5. 완료 보고

`CODEX_R31B_COMPLETION_2026-10-21.md`에 다음을 적습니다.
- 반입 범위와 커밋
- 2절 결과표
- 배포 URL·운영 버전·캐시(v74)
- 4절 확인 결과
