# Codex 지시서 r29 · 정성 모드 1단계(성장 설계 + 플롯 후보 3개 경쟁) · 2026-10-21

멀티에이전트 스펙 v1.0 적용안(`ORCHESTRATION_REVIEW_2026-10-21.md`)의 첫 라운드입니다. 부모님 결정: **정성 모드 기본 켬**, 비트별 작가 모델은 **선택 가능·기본 중간 모델**. **Claude가 구현해 커밋했습니다.** Codex는 반입·검증·배포만 합니다. 유료 API 호출은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 | r28 지시서 = `d528a51`. r28을 아직 반입하지 않았다면 r28 지시서(범위 `09bb65e..ca9fe54`)를 먼저 따릅니다. |
| 반입 범위 | **`d528a51..f224e44`** (이 문서는 다음 커밋) — 사이의 `83fb741`(검토서)·`035107a`(서버 설계서)는 문서만 |
| 새 파일 | `dist/story-generation/orchestration.js`, `tests/orchestration-r29.test.mjs` |
| 바뀐 파일 | `dist/story-generation/{council,council-room,pipeline,ui}.js`, `dist/full-auto.js`, `dist/text-generation/{models,settings-ui}.js`, `dist/simple-create.js`, `dist/style.css`, `dist/sw.js`(v68, 사전 캐시에 `orchestration.js`), `scripts/ux-census.mjs`, `tests/{openings-legacy-r12,openings-policy-r12,catchphrase-r9,engine-model-choice-r13,prompt-policy-r23}.test.mjs`, `CLAUDE.md`, `ORCHESTRATION_REVIEW_2026-10-21.md`(7·8절) |

패키지(`story-quality/`)는 바뀌지 않았습니다.

## 1. 무엇이 달라졌나 (새 이야기만 · `input.orchestrationPolicy`)

| 단계 | 전 | 후 |
| --- | --- | --- |
| 기획 회의 시작 | 작가 봇 1회(보급형)로 피치 3개 | **성장 설계 1회**(주인공이 바라는 것 want / 실제로 얻는 것 need / 걸림돌 flaw, 주제, 행동으로 보여 줄 교훈) |
| 후보 | 한 번에 3개 | **세 각도(① 마음 이야기 ② 모험·수수께끼 ③ 웃음·되풀이)를 각각 따로, 병렬로**(중간 모델). 세 후보가 같은 성장 설계를 공유 |
| 긴장 곡선 | 없음 | 후보마다 비트별 긴장 숫자 → 코드 검사(절정은 뒤쪽 55% 이후, 끝은 풀림, 평평하면 안 됨). 걸리면 1회만 다시, 그래도면 경고 달고 심사 |
| 심사 | 편집자·그림 감독·독자 봇 + 의장 | 그대로 + 편집자 점검표에 'want ≠ need, 교훈은 행동으로' |
| 바이블·줄거리 | 뼈대 규칙 | + GROWTH·THEME/LESSON·TENSION per beat 규칙(줄거리 모델이 따름) |
| 부모 선택 화면 | 제목·한 줄·반전 | + 성장 설계 한 줄, 후보마다 각도 태그·긴장 막대(▁▂▃▅▇) |

- 설정: 쉬운 ③ 접힌 '엔진·예상 요금' 안 **'정성 모드'(기본 켜짐)**·**'정성 모드 작가는 최고 모델로'(기본 꺼짐 = 중간 모델)**, 프로 글 엔진 설정에 같은 두 상자. 이야기가 시작되면 그 이야기의 값으로 잠김.
- 비트별 작가(r30)·점수 편집 루프(r31)는 아직 없습니다. 작가 모델 선택은 지금 고정만 해 두고 r30에서 씁니다.
- 요금(12쪽 새 이야기 글): **약 $1.94 → $2.08**(+3요청). 정책 없는 기존 초안·작업·책은 요청·추정이 바이트 단위로 같습니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **958/958** (새 `tests/orchestration-r29.test.mjs` 5개) |
| `npm run test:quality` | **85/85**, 두 사본 동일 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`(글 설정 입력 102로 표 갱신), `ERRORS []`, `PAID 0`, 쉬운 ③ 단계 버튼 11개(≤12) |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

다시 고정한 핀(모두 `035107a` 덤프와 비교해 이유 외 차이 없음): R12 `inputs`·`fullAutoDemo`(새 키), `review`(③ 스위치·새 이야기 요금), `estimates`(새 작업 추정), R13 앱 핀(새 작업 추정). R23 테스트는 회의가 성장 설계를 먼저 묻는 것에 맞춰 피치 요청을 찾도록 고쳤습니다.

## 3. 배포

기존 사이트에 배포합니다. 서비스 워커 `donghwa-shell-v68`. DB·서버 비밀값 변경 없음. 배포 뒤 새로 고침 한 번 더.

## 4. 배포 후 부모님 확인(유료, 1권)

쉬운 ③에서 '회의 후 부모 확인'을 켠 채 한 권: 선택 화면에 성장 설계 한 줄과 세 각도 후보·긴장 막대가 보이는지, 고른 후보로 만든 줄거리의 마지막 비트에서 want가 바뀌고 need를 얻는지, 멈춤/검사 리포트의 요청 수(회의 8~11회).

## 5. 완료 보고

`CODEX_R29_COMPLETION_2026-10-21.md`: 반입 방법, 2절 결과표, 배포 URL·버전.
