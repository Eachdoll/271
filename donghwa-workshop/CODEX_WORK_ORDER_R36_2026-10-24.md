# Codex 지시서 r36 · 글·그림 분담 (기획 단계의 그림 계획) · 2026-10-24

## 배경

부모님 지시(원문): "크리스호튼책처럼 구성하려면 근데 기획단계에서 플롯표현을 글로 풀어낼지 그림으로 풀어낼지 정하고, 그림이라면 어떻게 디테일하게 표현할지 들어가야하지 않아?" → "보여주는쪽으로해".

R35는 "그림이 글보다 먼저 말한다"를 줄거리 요청의 한 문장으로만 말했고, 비트마다 글과 그림의 몫을 정하는 단계가 없었습니다. 회의의 그림 감독이 만든 비트별 그림도 다이어트 줄거리 요청에는 들어가지 않았고, 작가는 그림이 무엇을 보여 줄지 몰랐습니다. R36은 줄거리 단계에서 비트마다 **그림 계획**을 정하고 작가·쪽 나누기·그림 요청·에코 화면이 그것을 받게 합니다.

**Claude가 구현해 커밋했습니다.** Codex는 반입·검증·커밋·배포·확인을 맡습니다. 필수 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`bf7522a`** (캐시 `donghwa-shell-v82`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v49 / v81 (r35까지 배포) | **`dcba2a5..bf7522a`** | v50 |
| v48 / v80 (r34까지) | r35 지시서의 범위를 끝만 `bf7522a`로 바꿔 한 번에(`c0b33c2..bf7522a`) | v50 |

| 구분 | 파일 |
| --- | --- |
| 새 파일 | `dist/story-generation/picture-plan.js`, `tests/picture-plan-r36.test.mjs` |
| 바뀐 코드 | `dist/sw.js`(v82 · 새 모듈 1개), `dist/eco-mode.js`, `dist/simple-create.js`, `dist/image-generation/{scene-prompt,world}.js`, `dist/story-generation/{beat-writer,demo,k1-book,outline-normalize,pipeline,prompt-diet,ui}.js` |
| 바뀐 테스트 | `tests/{lean-checks-r31c,picture-led-r35,prompt-diet-r31b}.test.mjs`(글자 예산·새 줄 허용) |
| 문서 | `CLAUDE.md`(R36 항목) |

패키지·DB·서버·비밀값·화풍 프리셋은 바뀌지 않았습니다. R12 고정값은 하나도 다시 고정하지 않았습니다.

## 1. 무엇이 달라졌나 (그림책 결 다이어트 초안만)

### 그림 계획 `beat.picturePlan`

| 칸 | 뜻 |
| --- | --- |
| `carrier` | 누가 말하나: `words` 글 · `picture` 그림(글은 한 줄이나 소리) · `both` 함께 · `contrast` 어긋나게(글은 "괜찮아", 그림은 거대한 파도) |
| `words` | 글만의 몫(한국어): 대사·속마음·소리·시간 |
| `picture` | 그림만 보여 줄 것(영어): 표정·크기 대비·숨은 것·다가오는 것 |
| `shot` / `space` | 멀리서·중간·가까이 / 꽉 찬 화면·여백 많이 |
| `hook` | 넘김 장치(없으면 빈칸) |
| `unit` | 펼침면 한 장·낱쪽 두 장(펼침 책만) |

줄거리 요청에 PICTURE PLAN 한 문단("decide who tells this moment before anyone writes it … a plan for the artist, not a script")이 붙고 스키마가 칸을 요구합니다. 받은 계획은 정리만 합니다 — 모르는 값은 버리고, 빈 계획은 지우며, **멈추거나 다시 사지 않습니다**.

### 받는 곳

| 단계 | 내용 |
| --- | --- |
| 비트별 작가 | "[그림과 글의 몫] … 그림이 보여 줘요: … — 글로 다시 말하지 않아도 돼요. 글의 몫: … 읽어 주는 사람이 혼자 읽어도 무슨 일인지는 알 수 있게 써요."(허락이지 금지가 아님) |
| K1 작가 | 줄거리 지도 줄 끝 "/ 그림 계획: …" |
| 쪽 나누기 | 계획한 펼침 형태를 우선(글이 분명히 다른 형태를 원하면 그쪽), 장면 설명은 계획의 그림으로 |
| 그림 요청 | 연출 한 줄 "PICTURE PLAN (decided with the story): …", 계획한 거리가 스테이징 거리를 대신함(카메라 지시가 둘이 되지 않게), 표지 제외 |
| 에코 | 그림 프롬프트(부모님이 복사하는 글)에 같은 줄, ③ '받은 줄거리'에 비트마다 "그림 계획 · …" |
| 프로 | 줄거리 비트 카드의 사건 칸 아래 "그림 계획 · …" |

검사기는 계획을 보지 않습니다. 새 차단도 새 참고도 없습니다.

비용: 유료 호출 0회 추가. 줄거리 요청 약 +1,000자, 응답 비트당 약 +60토큰, 쪽 나누기 규칙 약 +300자. 추정 행은 기존 여유 안이라 그대로입니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1066/1066**. 새 테스트 8개: `picture-plan-r36` |
| `npm run test:quality` | **85/85**, `diff -rq story-quality/dist dist/story-quality/dist` 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

하나라도 다르면 커밋·배포하지 말고 결과를 보고합니다.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r36 글·그림 분담 반입 · 캐시 v82"
git push origin <운영 브랜치>
```

서비스 워커는 `donghwa-shell-v82`입니다. DB와 비밀값은 바꾸지 않습니다. 배포 뒤 새로 고침을 한 번 더 합니다.

## 4. 배포 후 확인

**무료(운영 URL)**
- 에코 모드 K2 16쪽(주제 '유하가 바닷가에서 파도를 처음 만나요', ② 바닷가만): ③ 1단계 요청에 "PICTURE PLAN: for every beat return picturePlan"과 OUTPUT 스키마의 `"picturePlan"`. 답을 붙여 넣은 뒤 ③ '받은 줄거리'에 비트마다 "그림 계획 · …" 줄. 2단계 요청에 "PICTURE PLAN: each approved beat carries picturePlan". ④ 그림 프롬프트에 "PICTURE PLAN (decided with the story): …" 줄(표지 프롬프트에는 없음).
- 데모 K2 16쪽: 프로 줄거리 카드의 비트마다 "그림 계획 · …"(전환 비트는 "그림이 말해요 … 가까이 · 여백 많이 · 펼침면 한 장").
- 글이 많은 책·기존 책: 계획 줄이 어디에도 없음.

**유료(선택 · 부모님이 따로 승인한 뒤에만 · K2 한 편)** — r35와 같은 명령(`node scripts/r31b-ab.mjs K2 diet QA/r36-ab --paid`). md와 작업 JSON에서 보는 것: 줄거리 비트마다 `picturePlan`이 있는지(빠진 비트 수), `carrier`가 한 가지로 쏠리지 않았는지, 계획이 `picture`인 펼침의 한글 문장 수(작을수록 의도대로), 작가 재시도·쪽 수정 횟수가 r35보다 늘지 않았는지, 요청 수·요금. 숫자는 러너 md의 검사기 실측과 JSON만 믿습니다.

## 5. 완료 보고

`CODEX_R36_COMPLETION_2026-10-24.md`: 반입 범위와 커밋, 2절 결과표, 배포 URL·운영 버전(v50)·캐시(v82), 4절 확인 결과, 유료 실행이 있었다면 비트별 carrier 표와 문장 수·요금.

## 6. 하지 말 것

- 키·초대 코드·엔드포인트·그림을 보고·커밋·로그에 넣지 않습니다.
- 부모님 승인 없이 유료 호출을 하지 않습니다.
- 패키지·DB·서버·화풍 프리셋은 이번 범위가 아닙니다.
