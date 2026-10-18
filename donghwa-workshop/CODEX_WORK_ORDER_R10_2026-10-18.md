# Codex 지시서 r10 · r9 구현 반입·검증·배포 · 2026-10-18

r9(말버릇 반복 해결, 쉬운 만들기 다섯 단계와 프로페셔널 모드)는 **Claude가 코드까지 구현해 커밋했다.** 이번 차수에서 Codex는 새로 구현하지 않는다. 커밋을 그대로 반입하고, 아래 체크리스트로 검증한 뒤 배포한다.

무엇이 왜 바뀌었는지는 [Claude r9 구현 완료 보고](CLAUDE_R9_IMPLEMENTATION_2026-10-18.md)에 있다. 원래 요구는 [r9 지시서](CODEX_WORK_ORDER_R9_2026-10-18.md)다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소 | https://github.com/Eachdoll/271 |
| 브랜치 | `claude/cross-owner-repo-constraint-j20lhz` |
| 앱 경로 | 저장소 안 `donghwa-workshop/` |
| 기준 | Codex r8 (`SOURCE_COMMIT` `785f977`). 저장소 커밋 `0c2b756`에 그대로 반입되어 있다. |
| 반입 범위 | **`0c2b756..브랜치 끝`**. r9 지시서 커밋 `992496f`·`1dcaa7d`·`873bc2e`, 구현 커밋 `060cca4`~`04b7fb3`, 이 문서와 구현 보고를 추가한 문서 커밋까지다. 코드의 마지막 커밋은 `04b7fb3`이며, 그 뒤 커밋은 문서뿐이다. |

```bash
git clone https://github.com/Eachdoll/271.git
cd 271 && git checkout claude/cross-owner-repo-constraint-j20lhz
git log --oneline 0c2b756..HEAD
git diff --stat 0c2b756..HEAD -- donghwa-workshop     # 약 150개 파일, +14,000줄
```

Codex 작업 저장소에는 `donghwa-workshop/` 아래 변경을 그대로 옮긴다. 예: `git diff --binary 0c2b756..HEAD -- donghwa-workshop > r9.patch` 후 `git apply -p2 --binary r9.patch`(QA 스크린샷 PNG 포함). 적용이 깨끗하지 않으면 해당 파일을 브랜치 끝 내용으로 덮어쓰고 완료 보고에 파일명을 적는다.

**유료 API 호출은 하지 않는다.** 모든 검증은 모의 엔진·데모·네트워크 차단 테스트와 브라우저 확인으로 한다.

---

## 1. 반입 규칙

1. 코드를 다시 작성하거나 "정리"하지 않는다. 구현 보고 4절의 "지시서와 다른 점"은 의도된 동작이다. 특히:
   - 화면 모드는 설정이 아니라 기기별 `localStorage` `donghwa-ui-mode`(`simple` 기본 | `pro`)다.
   - 앱 줄거리 단계의 말버릇 반복은 **권고**다. 말버릇 항목만 있으면 유료 수정 호출을 하지 않는다. 패키지 `plotCheck`는 수정 항목으로 잡는다.
   - ③ 생성은 글만 만든다(`stopBefore: "text"`). 그림은 ④에서 만든다.
   - FULL AUTO 작업이 가진 초안은 프로의 "이야기 글 다시 다듬기"로 다시 엮지 않는다.
2. 품질 패키지는 `story-quality/src`가 원본이다. 빌드 결과가 커밋된 `story-quality/dist`·`dist/story-quality/dist`와 바이트 단위로 같아야 한다. 다르면 손으로 맞추지 말고 보고한다.
3. 테스트를 통과시키려고 테스트를 고치거나 건너뛰지 않는다. 실패하면 출력 전체를 완료 보고에 붙인다.
4. 기존 사용자 데이터는 바꾸지 않는다. 저장된 유하의 말버릇 "같이 가자!"는 그대로 두고, 새 설치만 새 기본값을 쓴다.
5. 평가·증류 결과 파일(`story-quality/eval/trial-2026-10-17/`, `story-quality/distill/runs/2026-10-17/`)은 다시 만들지 않는다.
6. `CLAUDE.md`의 "유지할 동작"을 지킨다. r9 항목이 추가되어 있다.

---

## 2. 검증 체크리스트

Node.js 22.13 이상. 결과는 `QA/` 아래 로그로 남긴다.

### 2-1. 자동 테스트

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **570/570** 통과 (r8 446) |
| `npm run test:quality` | **74/74** 통과 (r8 58) |
| `npm --prefix cloud-runtime ci && npm run build` | 성공. `diff -rq story-quality/dist dist/story-quality/dist` 차이 없음, `cmp story-quality/data/inventories.json dist/story-quality/data/inventories.json` 같음 |
| `node scripts/r9-catchphrase-recheck.mjs` | 모델 호출 없음. `QA/r9-catchphrase-recheck.json`이 커밋된 파일과 같다(줄거리 20편 중 수정 항목 16·권고만 12, 한글 전문 권고 15, 증류 예시 98편 제외·63편 사용) |

### 2-2. 브라우저 (PC 1280px · 모바일 390px)

```bash
(cd dist && npx http-server -p 4180 -s .) &
PLAYWRIGHT_MODULE=playwright node scripts/r9-simple-smoke.mjs http://127.0.0.1:4180/ QA/r9-simple
npx http-server dist -p 4178 -s &
node scripts/ux-census.mjs QA/ux-census http://127.0.0.1:4178/ QA/r9-ux-census.json
```

- 같은 포트에 예전 서버가 떠 있으면 결과가 틀린다. 실행 전에 먼저 끈다.
- 스모크는 두 폭 모두 `PASS`. 데모 엔진으로 ①→⑤, 중지·재개, 쪽 그림 1장, 글 고친 쪽의 그림 그대로 두기, 모든 쪽 그림, 프로 모드 왕복, 저장·재열기를 확인한다.
- 화면 조사: `PRO SAME AS TABLE true`, 기본 모드 각 단계 버튼 12개 이하(① 10 · ② 2 · ③ 6 · ④ 8 · ⑤ 3), `ERRORS []`, `PAID 0`, 가로 넘침 0.

### 2-3. 손으로 확인할 것

| 확인 | 기대 |
| --- | --- |
| 새 기기 첫 실행 | 쉬운 만들기(5단계)로 시작. 부모 설정은 네 묶음(우리 아이 · 엔진과 키 · 잠금 · 보관) |
| 모드 전환 | 부모 설정 맨 위·만들기 화면 오른쪽 위 스위치. 전환해도 설정·초안·책이 그대로 |
| 프로 모드 | r9 이전 화면과 같다(기능 삭제 없음) |
| r8 백업 복원 | 저장된 캐릭터 말버릇·초안·책이 바뀌지 않는다. `catchphrasePolicy` 없는 기존 초안을 이어 만들 때 프롬프트가 r9 이전과 같다 |
| ③ 글 만들기 | 데모로 체험 → 줄거리·글·쪽 나누기 후 ④로. 이 단계에서 그림 요청이 없다 |
| ④ 글 고치기 | 저장 뒤 "이 쪽 그림도 다시 만들까요?"를 묻는다. 자동 결제 없음 |
| `plotContract` 책 그림 | 본문 그림이 금칙어 오류 없이 만들어진다(r9 이전 운영 버그: 장면 머리말의 "FROZEN"이 걸림) |
| 금칙어 | 부모가 적은 캐릭터 설명 "a cape like Frozen"은 시트 생성 전에 거부, 쪽 글 "The frozen lake shines."는 통과. FULL AUTO가 만든 장소 "Frozen Lake"는 `tests/image-forbidden-words.test.mjs`가 확인한다 |
| 서비스 워커 | 캐시 이름 `donghwa-shell-v32`, 프리캐시에 `simple-create.js`·`story-generation/page-tools.js` |

---

## 3. 배포

1. 검증이 모두 통과하면 기존 사이트(`.openai/hosting.json`의 프로젝트)에 배포한다.
2. `QA/deployment.json`에 `sourceCommit`(Codex 작업 저장소 커밋)과 `sourceRange`(`0c2b756..` 브랜치 끝 해시)를 적는다.
3. 배포된 사이트에서 새 시크릿 창으로 쉬운 만들기 ①이 뜨는지, 이전 버전 캐시가 남지 않는지(v32) 확인한다.

## 4. 완료 보고

- `CODEX_R10_COMPLETION_2026-10-18.md`: 반입 방법과 깨끗하지 않았던 파일, 2절 결과표(명령·수치), 손 확인 결과, 배포 URL·버전.
- ZIP: `SOURCE_COMMIT.txt`, `SOURCE_MANIFEST.sha256`, `QA/deployment.json`, `QA/r9-simple/`(스모크 스크린샷과 `smoke.json`), `QA/r9-ux-census.json`, 테스트·빌드 로그.
- `README.md` 첫 줄의 안내를 r10 완료 보고로 바꾼다.

## 5. 이번 범위 아님

구현 보고 6절의 알려진 한계 9개(부모 추가 금칙어의 적용 범위, "Dis ney"처럼 쪼갠 상표, 반려동물 이름 "Mickey", 수정본의 다시 엮기 등)는 고치지 않는다. 배포 중 실제로 부딪히면 재현 방법과 함께 완료 보고에 적는다.
