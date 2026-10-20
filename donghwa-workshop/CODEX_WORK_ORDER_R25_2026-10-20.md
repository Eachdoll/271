# Codex 지시서 r25 · 멈추지 않는 책(바쁜 공급자 자동 재전송) + 회의 금지 목록 · 2026-10-20

공급자가 잠깐 바쁘다고(429·5xx) 답할 때 책이 멈추던 문제를 고쳤고, 기획 회의가 최근 책의 심은 물건을 피하게 했습니다. **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | r24 지시서 = `38cc8de`. r24를 아직 반입하지 않았다면 r24 지시서(범위 `311e4df..0e7883c`)를 먼저 따릅니다. |
| 반입 범위 | **`38cc8de..46afae8`** (이 문서는 다음 커밋) |
| 새 파일 | `dist/transient-retry.js`, `tests/transient-retry-r25.test.mjs` |
| 바뀐 파일 | `dist/text-generation/providers.js`, `dist/image-generation/providers.js`, `dist/story-generation/{council,pipeline,ui}.js`, `dist/full-auto.js`, `dist/sw.js`(v65, 사전 캐시에 `transient-retry.js`), `tests/{story-council,openings-legacy-r12,openings-policy-r12,catchphrase-r9}.test.mjs`, `CLAUDE.md` |

패키지(`story-quality/`)는 바뀌지 않았습니다(패키지 엔진은 이미 429·5xx를 다시 보냅니다).

## 1. 무엇이 달라졌나

### 1-1. 바쁜 공급자 자동 재전송 (#47의 최소 범위)

| 상황 | 전 | 후 |
| --- | --- | --- |
| HTTP 429(요청 한도)·500·502·503·504·529(과부하) | 바로 멈춤, '다시 시도'를 눌러야 함 | **같은 요청을 두 번 더 보냄**(3초 → 8초, `Retry-After`가 있으면 최대 30초). 그래도 바쁘면 '지금 바빠요 … 잠시 뒤 다시 시도'로 멈춤 |
| 잔액·한도 소진 429(`insufficient_quota` 등) | 멈춤 | 그대로 멈춤(기다려도 소용없음) |
| 400·401·403·404·422 | 멈춤 | 그대로, 문구도 그대로 |
| 네트워크 오류·시간 초과(답을 못 받음) | 멈춤 | **그대로 멈춤** — 공급자가 이미 처리·청구했을 수 있어 다시 보내면 두 번 살 수 있음 |
| 결과 그림·참조 그림 다운로드 | — | 다시 보내지 않음(예전 그대로) |

- 적용: 글 엔진 모든 요청(`text-generation/providers.js`), 그림 생성·조회 요청(`image-generation/providers.js`). 기다리는 중 '중지'를 누르면 바로 멈춥니다.
- 바쁨 응답에는 결과가 없으므로 청구되지 않습니다. 재개 저널은 그대로라 '다시 시도'도 받은 결과를 다시 사지 않습니다.
- 멈춤 원칙 점검: 앱 경로에 남은 멈춤(`StoryValidationError` 25곳)은 모두 구조 검사(비트·쪽 번호, 필수 필드, 장부, 쪽 나누기 형식)이거나 금지 소재·고른 재료 밖입니다. 품질 항목은 이미 참고로 남습니다(R16~R17). 이번 라운드에서 멈춤 조건은 바꾸지 않았습니다.

### 1-2. 기획 회의 금지 목록(새 초안만)

- 새 초안은 만들 때 최근 승인 책의 심은 물건(머리 낱말이 같으면 하나, 최대 6개)을 `input.councilRecent`에 고정합니다.
- 목록이 있으면 작가 봇 피치 요청에 '[최근 책에서 심은 물건 — 이번에는 심지 않는다] …', 편집자 봇 점검표에 '같은 물건이면 fixes에 적고 direction 1점 낮춤'이 붙습니다.
- 키가 없거나 목록이 빈 초안(승인 책이 없는 가족 포함)은 요청이 전과 바이트 단위로 같습니다. 모델에게 보내는 `input`에는 들어가지 않습니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **949/949** (새 `tests/transient-retry-r25.test.mjs` 4개, `story-council` R25 1개) |
| `npm run test:quality` | **85/85**, 두 사본 동일 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | 읽기 화면 지문 `0e5035cf…` 그대로 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

R12 `inputs`·`fullAutoDemo` 핀만 새 키(`councilRecent`, 빈 목록)로 다시 고정했습니다(`38cc8de` 덤프와 비교해 그 키 말고는 같음). 요청·추정 핀은 그대로입니다.

## 3. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v65`. DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더.

## 4. 배포 후 확인

- 무료: 없음(바쁨 응답은 실제 공급자에서만 재현됩니다).
- 유료(선택, 한 권): 승인한 책이 있는 계정에서 새 이야기를 만들고, 프로 검사 카드 '기획 회의'의 피치 심은 물건이 최근 책의 물건과 다른지 봅니다.

## 5. 완료 보고

`CODEX_R25_COMPLETION_2026-10-20.md`: 반입 방법, 2절 결과표, 배포 URL·버전.
