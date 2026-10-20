# Codex 지시서 r27 · 저장(큰 보관함 IndexedDB + 작업 기록 정리) · 2026-10-20

압축해도 브라우저 저장 한도(약 5MB)를 넘는 책장이 저장되지 않던 문제와, 완성된 작업이 유료 호출 기록을 계속 들고 있던 문제를 고쳤습니다. **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | r25 지시서 = `2b94f8b`. r25를 아직 반입하지 않았다면 r25 지시서(범위 `38cc8de..46afae8`)를 먼저 따릅니다. |
| 반입 범위 | **`2b94f8b..5daac59`** (이 문서는 다음 커밋) |
| 새 파일 | `tests/storage-r27.test.mjs` |
| 바뀐 파일 | `dist/library-storage.js`, `dist/finalize-cleanup.js`, `dist/app.js`, `dist/full-auto.js`, `dist/sw.js`(v66), `tests/editor-round.test.mjs`, `CLAUDE.md` |

패키지·요청·모델·추정은 바뀌지 않았습니다(R12·R13 핀 그대로).

## 1. 무엇이 달라졌나

### 1-1. 큰 보관함

| 단계 | 동작 |
| --- | --- |
| 저장 | 평문 → 압축(기존) → **그래도 넘치면** 압축 값을 IndexedDB(`donghwa-workshop-library-spill`)에 먼저 쓰고, 그다음에만 localStorage를 작은 포인터로 바꿈. 중간에 끊겨도 예전 책장이 그대로 남음 |
| 저장 중 또 저장 | 최신 상태로 한 번 더 옮김(포인터는 항상 가장 새 책장) |
| IndexedDB도 거절 | '큰 보관함에도 저장하지 못했어요 … 백업 후 오래된 작업 기록을 정리' 토스트(예전 'The quota has been exceeded.' 대신) |
| 열기(부팅) | 포인터면 IndexedDB를 먼저 읽고 평소처럼 검증. 못 읽으면 샘플로 덮지 않고 **저장을 막고** 복구 안내(기존 '기존 데이터 보호 중') |
| 공간이 다시 생기면 | 다음 저장이 localStorage(압축)로 돌아오고 포인터는 사라짐 |
| 클라우드 불러오기·파일 가져오기 | 같은 순서(넘치면 큰 보관함). 복구 보관본은 포인터가 아닌 책장 글로 남김 |
| 보관 공간 패널 | 책장 실제 크기 + '큰 보관함(IndexedDB) 사용 중' |

### 1-2. 작업 기록 정리

- FULL AUTO 작업의 글이 끝나 책이 만들어지면 재개용 유료 호출 기록 다섯(줄거리 품질·회의·풍부화·통독·아이 시뮬레이터 체크포인트)을 지웁니다. 회의 기록은 줄거리(`outline.council`)에 남아 회의실·검사 카드·멈춤 리포트가 그대로 보입니다.
- 책이 없거나 글이 끝나지 않은 작업(멈춤·회의 홀드·실행 중)은 하나도 지우지 않습니다 — '다시 시도'가 받은 결과를 다시 사지 않게.
- 책장의 '오래된 작업 기록 정리'는 승인 책 정리에 더해, 실행 중이 아닌 완성 작업의 기록도 지우고 정리한 건수를 알려 줍니다(예전 작업에도 적용).

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **953/953** (새 `tests/storage-r27.test.mjs` 4개) |
| `npm run test:quality` | **85/85**, 두 사본 동일 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | 읽기 화면 지문 `0e5035cf…` 그대로 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

Claude 실브라우저 확인(Chromium): 책장 키의 localStorage 한도를 300자로 줄인 뒤 저장 → 포인터 61자 + IndexedDB 저장, 새로 고침 뒤 바뀐 즐겨찾기가 그대로 읽히고 저장 막힘 없음, 패널에 '큰 보관함(IndexedDB) 사용 중'.

`tests/editor-round.test.mjs`는 책을 만든 뒤 통독 체크포인트가 지워지는 것(R27)을 확인하도록 고쳤고, 재개 경로는 저장된 체크포인트를 넣어 그대로 확인합니다.

## 3. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v66`. DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더. `app.js`가 부팅 때 IndexedDB를 기다릴 수 있어(포인터일 때만, 최대 8초) 첫 화면이 조금 늦을 수 있습니다.

## 4. 배포 후 부모님 확인(무료)

- 책장이 큰 기기(아이폰 Safari 등)에서 저장 오류 토스트가 사라졌는지, 보관 공간 패널 문구.
- '오래된 작업 기록 정리'를 한 번 누르고 MB 수가 줄었는지.

## 5. 완료 보고

`CODEX_R27_COMPLETION_2026-10-20.md`: 반입 방법, 2절 결과표, 배포 URL·버전.
