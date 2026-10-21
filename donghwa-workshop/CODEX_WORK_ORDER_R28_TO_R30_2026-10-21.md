# Codex 통합 지시서 · r28 + r29 + r29.1 + S1 + r30 · 2026-10-21

**기준(운영 중):** 운영 v37 / 서비스 워커 캐시 `donghwa-shell-v66`. r23·r24·r25·r26·r27까지 반영된 상태이고, 그 마지막 소스는 r27 지시서 커밋 `09bb65e`입니다.
**목표:** 그 뒤의 다섯 라운드를 한 번에 반입하고, 검증한 뒤 커밋·푸시·배포합니다 → **운영 v38 / 캐시 `donghwa-shell-v71`**.

구현은 Claude가 모두 해서 커밋했습니다. Codex는 **반입 → 검증 → 커밋 → 푸시 → 배포 → 완료 보고**만 합니다. 이 작업에는 유료 API 호출이 없습니다. 키·비밀값·엔드포인트는 소스·문서·로그·보고서에 넣지 않습니다(기존 규칙 그대로).

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 기준 커밋(운영과 같음) | `09bb65e` (r27 지시서, 캐시 v66) |
| 코드 끝 커밋 | **`f15a97f`** (r30, 캐시 v71) |
| 반입 범위 | **`09bb65e..f15a97f`**. 문서 커밋까지 넣으려면 이 지시서 커밋까지 포함 |
| 앱 폴더 | `donghwa-workshop/` (`dist/`가 배포 소스) |

포함 커밋(오래된 순서):

| 커밋 | 라운드 | 내용 | 캐시 |
| --- | --- | --- | --- |
| `ca9fe54` | r28 | 줄거리 카드에서 비트 장소를 시작·끝 포함 자유롭게 고르기, 품질 규칙은 참고 토스트로 | v67 |
| `d528a51` | 문서 | r28 지시서 | |
| `83fb741` · `035107a` | 문서 | 오케스트레이션 검토·적용안, 서버 오케스트레이션 설계서 | |
| `f224e44` | r29 | 정성 모드 1단계: 성장 설계, 세 각도 플롯 후보 병렬, 긴장 곡선 검사, 설정 스위치 2개 | v68 |
| `755de14` | 문서 | r29 지시서 | |
| `08b88c3` | r29.1 | 정식 줄거리 긴장 곡선 칸과 재검사, 각도 라벨 통일, 예산·게이트 문서 | v69 |
| `d8701fb` | 문서 | r29.1 지시서 | |
| `0157814` | S1 | 글 단계·FULL AUTO에 API 키 출처를 주입할 수 있게 함(브라우저 동작은 바이트 단위로 같음) | v70 |
| `f15a97f` | r30 | 정성 모드 2단계: 비트별 작가, 되풀이 말 카드, 첫 비트 문체 기준, 3시도 뒤 가장 가까운 글, 요금 추정·한 번 안내 | v71 |
| `d2e98cf` | 문서 | r30 지시서 + 검토서 10절 | |

개별 지시서(`CODEX_WORK_ORDER_R28/R29/R29_1/R30_2026-10-21.md`)는 각 라운드의 세부 내용을 설명합니다. **반입·검증·배포는 이 통합 지시서 하나만 따르면 됩니다.**

### 0-1. 반입 방법 (둘 중 하나)

```bash
# A. 같은 히스토리를 쓰는 경우 — 커밋을 그대로 가져옴
git fetch https://github.com/Eachdoll/271 claude/cross-owner-repo-constraint-j20lhz
git cherry-pick 09bb65e..f15a97f        # 문서까지: 09bb65e..<이 지시서 커밋>

# B. 저장소가 다른 경우 — 앱 폴더 diff를 적용
git diff 09bb65e f15a97f -- donghwa-workshop > r28-r30.patch
git apply --3way r28-r30.patch            # 경로 접두어가 다르면 -p/--directory로 맞춤
```

적용한 뒤 아래 두 가지를 확인합니다.
- `dist/sw.js` 첫 줄이 `const CACHE = "donghwa-shell-v71";`이고, 사전 캐시 목록에 `./story-generation/orchestration.js`와 `./story-generation/beat-writer.js`가 있어야 합니다.
- `git diff --stat 09bb65e f15a97f -- donghwa-workshop`는 **33개 파일, +2075 / −93**이어야 합니다.

### 0-2. 새 파일 · 바뀐 파일

| 구분 | 파일 |
| --- | --- |
| 새 코드 | `dist/story-generation/orchestration.js`, `dist/story-generation/beat-writer.js` |
| 새 테스트 | `tests/orchestration-r29.test.mjs`, `tests/s1-portability.test.mjs`, `tests/beat-writer-r30.test.mjs` |
| 바뀐 코드 | `dist/app.js`, `dist/full-auto.js`, `dist/simple-create.js`, `dist/finalize-cleanup.js`, `dist/style.css`, `dist/sw.js`, `dist/story-generation/{council,council-room,pipeline,quality-adapter,stop-report,ui}.js`, `dist/text-generation/{models,settings-ui}.js` |
| 바뀐 테스트·스크립트 | `tests/{openings-legacy-r12,openings-policy-r12,catchphrase-r9,engine-model-choice-r13,prompt-policy-r23,story-review-ui,story-stage-models}.test.mjs`, `scripts/ux-census.mjs` |
| 문서 | `CLAUDE.md`, `ORCHESTRATION_REVIEW_2026-10-21.md`, `SERVER_ORCHESTRATION_DESIGN_2026-10-21.md`, 라운드별 지시서 |

다음은 **바뀌지 않았습니다.** 패키지(`story-quality/`, `dist/story-quality/`), DB 스키마, 서버 API, 서버 비밀값, `.openai/hosting.json`.

## 1. 부모님께 보이는 변화 (요약)

| 라운드 | 화면·동작 |
| --- | --- |
| r28 | 줄거리 카드의 비트마다 '장소 · 보통은 집' 칸이 있고, 접힌 '다른 장소 n곳'에서 아무 서랍 장소나 고를 수 있습니다. 시작을 바꿔도 마무리가 따라 바뀌지 않습니다(두 끝이 모두 집이고 새 장소도 집일 때만 함께 바뀜). 품질 항목이 걸려도 '참고로 남겨요' 토스트만 띄우고 승인합니다. |
| r29 | 새 이야기의 기획 회의는 먼저 **성장 설계**(바라는 것 → 실제로 얻는 것, 걸림돌, 교훈)를 정하고, 세 각도(마음 이야기 · 모험·수수께끼 · 웃음·되풀이)의 후보를 병렬로 받습니다. 후보 선택 화면에 성장 설계 한 줄과 후보별 긴장 막대(▁▂▃▅▇)가 보입니다. 쉬운 ③ 접힌 '엔진·예상 요금'과 프로 글 엔진 설정에 **'정성 모드'(기본 켬)**와 **'정성 모드 작가는 최고 모델로'(기본 끔 = 중간 모델)** 스위치가 생깁니다. |
| r29.1 | 정식 줄거리도 비트별 긴장 값을 돌려주고, 같은 곡선 검사를 한 번 더 합니다. 실패하면 설계서 곡선으로 바꾸고 참고로 남깁니다(추가 호출 없음). |
| S1 | 화면 변화가 없습니다. 나중에 서버에서 실행할 준비로 키 출처만 주입할 수 있게 했습니다. |
| r30 | 정성 모드 본문을 **비트마다 한 장면씩** 한글과 영어로 따로 씁니다. 되풀이 말은 쓰기 전에 고정하고, 첫 비트는 초안 2개 중 하나를 골라 문체 기준으로 삼습니다. 분량이 3번 모두 벗어나면 가장 가까운 글과 경고를 남기고, 책은 멈추지 않습니다. 경고는 ③의 '정성 모드 작가 참고 N건'과 검사 리포트의 '정성 모드 비트별 작가' 절에 보입니다. 설정 요금 요약은 새 이야기 기준으로 바뀌고, 배포 후 첫 화면에 **기기마다 한 번** 안내 토스트가 뜹니다(`localStorage` 키 `donghwa-notice-r30`). |

정성 모드 정책이 없는 기존 초안·작업·책(배포 전에 만든 것)은 요청·모델·추정이 **바이트 단위로 같습니다.** 이를 R12·R13 핀이 지킵니다.

## 2. 요금 (12쪽 새 이야기 글, OpenAI 기본 추정)

| 시점 | 새 작업 추정 | ③ 표시 |
| --- | --- | --- |
| 운영 v37 (r27) | $1.717 | 약 $1.94 |
| r29 (후보 3 + 성장 설계) | $1.862 · 21요청 | 약 $2.08 |
| **r30 (이번 배포)** | **$1.937 · 37요청** | **약 $2.18** |

작가를 최고 모델로 켜면 약 $3.66입니다. 그림 요금은 변하지 않습니다. 이 값은 추정이고, 실제 요금은 4-2절의 유료 1권으로 확인합니다.

## 3. 검증 (전부 통과해야 커밋·배포)

`donghwa-workshop/`에서 실행합니다.

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **969/969** |
| `npm run test:quality` | **85/85** |
| `diff -rq story-quality/dist dist/story-quality/dist` | 출력 없음(두 사본이 같음) |
| `npx http-server dist -p 4960 -s` 띄운 뒤 `node scripts/r12-legacy-dom.mjs --check` | `readerSha256` = `0e5035cff5dcd72be00b346b4cb67aa455c1eab8c848b3fcc3a4e6e4b81f6c16`(expected와 같음) |
| `node scripts/ux-census.mjs <출력폴더> http://127.0.0.1:4960/ <json>` | `PRO SAME AS TABLE true`(표: `02-settings-text` 입력 102, `07-outline` 121), `ERRORS []`, `PAID 0` |
| `node scripts/r9-simple-smoke.mjs http://127.0.0.1:4960/ <출력폴더>` | 1280·390 모두 **PASS**(약 12분) |

Playwright는 이미 설치된 Chromium을 씁니다. 필요하면 `PLAYWRIGHT_MODULE=<playwright index.mjs 경로>`를 지정합니다.

다시 고정한 핀(이미 커밋에 반영됨, Codex가 고칠 것 없음):
- R12 `inputs`·`fullAutoDemo`·`review`·`estimates`
- R13 앱 핀

모두 바로 앞 커밋의 덤프와 비교해, 이유로 적은 항목 외에는 차이가 없음을 확인했습니다. 차이는 새 정책 키와 새 작업 추정, ③의 스위치·요금 문구뿐입니다.

하나라도 기대값과 다르면 **커밋·배포하지 말고** 결과를 그대로 적어 보고합니다.

## 4. 커밋 · 푸시 · 배포

### 4-1. 커밋·푸시

반입 방법 A(cherry-pick)는 원래 커밋이 그대로 남으므로 푸시만 합니다. 방법 B(diff 적용)는 한 커밋으로 묶습니다.

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r28~r30 반입 (비트 장소 자유 선택, 정성 모드 성장 설계·플롯 후보·긴장 곡선, S1 키 주입, 비트별 작가) · 캐시 v71"
git push origin <운영 브랜치>
```

### 4-2. 배포

| 항목 | 값 |
| --- | --- |
| 대상 | 기존 사이트(지금 운영 중인 곳) |
| 운영 버전 | v37 → **v38** |
| 서비스 워커 | `donghwa-shell-v66` → **`donghwa-shell-v71`** |
| DB·서버 비밀값 | 변경 없음 (`FAMILY_SIGNUP_CODE` 등 그대로, 값은 어디에도 적지 않음) |
| 배포 뒤 | 새로 고침을 한 번 더 해서 새 서비스 워커가 잡혔는지 확인 |

### 4-3. 배포 후 확인

**무료(Codex가 운영 URL에서 확인):**
1. 첫 화면에 '정성 모드가 새로워졌어요 … 12쪽 글 요금은 약 $…' 토스트가 **한 번** 뜨고, 새로 고침하면 다시 뜨지 않는지.
2. 설정 › 글 엔진에 '정성 모드(기본 켜짐)'과 '정성 모드 작가는 최고 모델로' 상자가 있는지, 요금 요약에 '정성 모드(… 비트별 작가 약 20회·중간 모델)'가 나오는지.
3. 쉬운 ③의 접힌 '엔진·예상 요금'에 두 스위치가 있고, 글 요금이 약 $2.18로 보이는지(OpenAI·12쪽 기준).
4. 데모 줄거리 카드 비트 1에서 '다른 장소'로 숲을 고르면 비트 1만 바뀌는지(r28).
5. 기존 책 열기와 읽기 화면이 그대로인지.

**유료(부모님 승인 뒤에만, 1권):**
- 쉬운 ③에서 '회의 후 부모 확인'을 켜고 한 권 만듭니다.
- 확인할 것:
  - 후보 화면에 성장 설계 한 줄, 세 각도, 긴장 막대가 보이는지.
  - 진행 문구에 '정성 모드 · n/7비트'가 지나가는지.
  - 완성 글이 비트마다 한 문단이고, 되풀이 말이 정한 비트에 그대로 들어갔는지.
  - 검사 리포트의 '정성 모드 비트별 작가' 절(호출 약 20회, 다시 쓴 비트, 대화 비율).
  - 실제 글 요금이 약 $2.2 근처인지.
- 결과는 리포트 사본으로 보고합니다. 키·엔드포인트·그림은 넣지 않습니다.

## 5. 완료 보고

`CODEX_R28_TO_R30_COMPLETION_2026-10-21.md`에 다음을 적습니다.
- 반입 방법(A/B)과 실제 커밋 해시
- 3절 결과표(명령마다 실제 출력 값)
- 배포 URL, 운영 버전(v38), 캐시(v71)
- 4-3 무료 확인 5항목 결과
- (진행했다면) 유료 1권의 요청 수·요금·리포트 요지
