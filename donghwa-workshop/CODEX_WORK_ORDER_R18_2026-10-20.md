# Codex 지시서 r18 · 직접 입력한 끝맺음이 집으로 돌아오지 않게 · 2026-10-20

부모님 지적: "이야기 끝맺음을 직접 입력했는데도 집으로 돌아오는 이야기가 돼 버려." **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 하지 않습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | r17(10절까지) = `06d12f3` |
| 반입 범위 | **`06d12f3..894ab59`** (이 문서는 다음 커밋). r17을 아직 반입하지 않았다면 r17 지시서(범위 `47f5bdf..0d309b6`)를 먼저 따릅니다. |
| 새 파일 | `tests/custom-ending.test.mjs` |
| 바뀐 파일 | `dist/story-generation/{ui,pipeline,plot-contract,schemas,outline-normalize,quality-adapter}.js`, `dist/app.js`, `dist/sw.js`(v53), `story-quality/src/{pipeline,outlinePrompt,types}.ts`와 그 `dist` 선언 파일(.d.ts) 3개 + `dist/story-quality/dist` 사본, `CLAUDE.md` |

## 1. 원인

프로 마법사 '이야기의 끝 · 직접 입력'은 글(`endingNote`)만 전달하고 결말 방식은 항상 `home_sleep`(집에 돌아와 잠들기)로 고정됐습니다. 그래서

- 줄거리 규칙이 "첫 비트와 마지막 비트는 같은 집 배경", "Close calmly at home", "endingNote는 집에서의 마지막 행동으로"를 요구했고,
- 사건 장부 규칙이 "11~12쪽은 집으로 돌아와 차분히 끝"을, 쪽 나누기 규칙이 "처음과 끝은 집 ID"를 요구했으며,
- 앱 검사 `home_start_end`가 마지막 비트가 집이 아니면 지적했고,
- 기본 경로인 **품질 경로는 끝맺음 글을 아예 받지 못했습니다**(JSON 템플릿의 `endingType`만 전달).

## 2. 바뀐 것 (끝맺음을 적은 새 초안만)

| 항목 | 후 |
| --- | --- |
| 입력 | 직접 입력에 글이 있으면 `endingType: "custom"` + `endingNote`. 빈 입력은 예전처럼 집 결말 |
| 줄거리 규칙 | "첫 비트는 집, 마지막 비트는 끝맺음이 두는 곳(어느 배경이든)" + "부모가 적은 끝을 그대로 마지막 비트의 구체 행동으로; 집·잠자리를 덧붙이지 않기" |
| 사건 장부 규칙 | "return home" 대신 "부모 끝맺음대로, 그 자리에서 차분히" |
| 쪽 나누기 규칙 | "home ID at the beginning"만 |
| 앱 검사 | `home_start_end`는 시작 비트만 봄 |
| 품질 경로 | canon 맨 앞에 ENDING 블록(줄거리·본문 단계)으로 끝맺음 글을 전달 |
| 스키마·검사 | 요청 스키마 `endingType` enum에 `custom`(custom 입력에서만), `validateOutline`·응답 정리는 세 값 허용. 패키지는 타입 합집합만 확장(JS 동일) |
| 안내문 | 직접 입력 칸의 예시 문구가 "집에 돌아온 뒤…"에서 "이야기가 어디서 어떤 행동과 말로 끝날까요? (집으로 돌아오지 않아도 돼요)"로 |

끝맺음을 적지 않은 초안·기존 작업은 요청이 바이트 단위로 같습니다(R12 핀 그대로). 쉬운 ①에는 끝맺음 선택이 없어 집 결말 기본입니다(필요하면 다음 라운드에서 추가).

## 3. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **888/888** (새 `tests/custom-ending.test.mjs` 5개 포함) |
| `npm run test:quality` | **79/79**, 두 사본 동일(`diff -rq story-quality/dist dist/story-quality/dist`) |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | 읽기 화면 지문 `0e5035cf…` 그대로 |

패키지 빌드는 하지 않아도 됩니다(선언 파일 3개만 바뀌었고 JS는 같습니다). 빌드하려면 `@types/node`가 없어 TS2688이 나오지만 산출물은 같습니다; `dist/eval/prose.d.ts`가 `any`로 바뀌면 되돌리세요.

## 4. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v53`. DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더.

## 5. 배포 후 부모님 확인(유료)

프로 마법사에서 '이야기의 끝 · 직접 입력'에 "바닷가에서 친구들과 조개를 나눠 들고 노래하며 끝나요"처럼 집 밖의 끝을 적고 K2 12쪽 한 권. 줄거리 카드의 마지막 비트 장소가 바닷가이고 집으로 돌아오지 않는지, 마지막 쪽 글이 적은 대로 끝나는지.

## 6. 완료 보고

`CODEX_R18_COMPLETION_2026-10-20.md`: 반입 방법, 3절 결과표, 배포 URL·버전.
