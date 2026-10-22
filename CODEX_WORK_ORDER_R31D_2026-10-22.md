# Codex 지시서 r31d · 영어 어휘 허용(활용형·이야기 단어) · 비트별 작가 상태 JSON 제거 · 2026-10-22

## 배경

r31c 유료 검증(`QA/r31c-ab`, 커밋 `ac45fbc`)을 재생해 두 가지를 확인했습니다.

- K2 영어가 E2 어휘 비율 때문에 여섯 펼침면 모두 한 번씩 다시 쓰이고도 세 곳이 남았습니다. E2 목록 363단어는 활용형을 모르고(stop은 있고 stopped는 없음, hid는 있고 hide는 없음), 이야기의 물건(seat belts·handkerchief·kindergarten)은 목록 밖이었습니다. 활용형 처리와 이야기 단어 허용만으로 여섯 펼침면의 목록 밖 비율이 15~30%에서 3~13%로 내려가 전부 통과합니다.
- 비트별 작가가 사건 장부의 상태 JSON을 그대로 받아 안전띠를 여섯 펼침면 중 다섯 곳에 서술했습니다.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·푸시·배포만 합니다. 이 작업에 유료 API 호출은 없습니다(4절의 유료 확인은 부모님 승인 뒤에만).

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`4b42288`** (캐시 `donghwa-shell-v76`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v43 / v75 (r31c까지 배포, Codex 보고 기준) | **`ac45fbc..4b42288`** | v44 |
| v74 (r31b까지) | **`92dce12..4b42288`** | 다음 번호 |
| 그 이전 | r31c 지시서 `CODEX_WORK_ORDER_R31C_2026-10-22.md`의 범위를 끝만 `4b42288`로 바꿔 한 번에 | 다음 번호 |

| 구분 | 파일 |
| --- | --- |
| 새 파일 | `tests/vocab-lean-r31d.test.mjs` |
| 바뀐 코드 | `dist/sw.js`(v76), `dist/reading-checker.js`, `dist/story-reading-context.js`, `dist/app.js`, `dist/story-generation/{checker,beat-writer,page-tools,pipeline,prompt-diet,ui}.js`, `scripts/r31b-ab.mjs` |
| 바뀐 테스트 | `tests/{openings-legacy-r12,r31b-ab-script}.test.mjs` |
| 문서 | `CLAUDE.md` |

패키지 코드(`story-quality/src`, `dist/story-quality/`), DB, 서버, 비밀값은 바뀌지 않았습니다.

## 1. 무엇이 달라졌나 (다이어트 초안만 · 정책이 없는 기존 초안·작업·책은 그대로)

| 항목 | 전 | 후 |
| --- | --- | --- |
| 영어 활용형 | stopped·wagging·bigger·boxes, hide(목록에 hid)는 목록 밖 | lean 규격은 겹자음 과거형·진행형·비교급, -es, -er/-est, 굽은 따옴표 소유격, 기본형↔과거형 표를 접음 |
| 이야기 단어 | 줄거리의 새 단어·인물·세계 이름만(E0만 허용) | 장면 디테일의 소품·소리·생물 영어 이름과 배경 영어 이름까지, 모든 영어 단계에서 허용. 검사와 작가 프롬프트가 같은 출처 |
| 비트별 작가 지도 | 비트마다 `상태: {JSON}`, 끝에 `끝 상태 JSON` | 사건과 `→ 결과:`만 글로 |
| 표시 | 펼침 책 수정 "1/2차"(실제 한 바퀴), 러너 제목 "r31b 다이어트" | "1/1차", "다이어트 · 현재 코드" |

재생 결과: r31c K2 원고의 영어 지적 3곳 → 0. 그 원고의 영어 다시 쓰기 6회는 필요 없었습니다. 요금 추정은 바뀌지 않습니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1003/1003**. 새 테스트 4개: `vocab-lean-r31d`(유료 원고 재생 포함) |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

다시 고정한 핀은 R12 `fullAutoDemo`(데모 K2의 새 단어 참고 수) 하나입니다. `ac45fbc` 덤프와 비교해 그 밖의 차이가 없음을 확인했습니다. `requests`·`checks`·`review`·`estimates`와 R13 핀은 그대로입니다.

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r31d 영어 어휘 허용 반입 · 캐시 v76"
git push origin <운영 브랜치>
```

기존 사이트에 배포합니다. 서비스 워커는 `donghwa-shell-v76`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인

**무료(Codex가 운영 URL에서 확인)**
- ③ 요금 문구가 r31c와 같은지 봅니다(K1 12쪽 약 $0.65, K2 16쪽 약 $1.71).
- 데모로 한 권을 만들어 기존 흐름이 그대로인지 봅니다.

**유료(부모님이 따로 승인한 뒤에만 · K2 한 편 추정 약 $0.8)**

```bash
cd donghwa-workshop
export OPENAI_API_KEY='<부모님이 직접 입력>'
node scripts/r31b-ab.mjs K2 diet QA/r31d-ab --paid
unset OPENAI_API_KEY
```

- 확인할 것: `수정 기록`에 영어 수준(level@…:en) 다시 쓰기가 몇 회인지(기대 0~1회), 영어에 "rag"·"was down" 같은 억지 표현이 없는지, 한글 원문에 안전띠 같은 상태 서술이 반복되지 않는지, 요금.
- 결과 폴더 `QA/r31d-ab/`를 커밋에 포함합니다. 키는 환경 변수에만 두고 어디에도 적지 않습니다.

## 5. 완료 보고

`CODEX_R31D_COMPLETION_2026-10-22.md`에 다음을 적습니다.
- 반입 범위와 커밋
- 2절 결과표
- 배포 URL·운영 버전·캐시(v76)
- 4절 확인 결과
