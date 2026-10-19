# Codex 지시서 r11 · 단계 이동·가족 아이디 반입·검증·배포 · 2026-10-19

r11은 **Claude가 코드까지 구현해 커밋했습니다.** Codex는 새로 구현하지 않고 커밋을 그대로 반입하고, 아래 체크리스트로 검증한 뒤 배포합니다. 무엇이 왜 바뀌었는지는 [Claude r11 구현 보고](CLAUDE_R11_IMPLEMENTATION_2026-10-19.md)에 있습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소 | https://github.com/Eachdoll/271 |
| 브랜치 | `claude/cross-owner-repo-constraint-j20lhz` |
| 앱 경로 | 저장소 안 `donghwa-workshop/` |
| 기준 | Codex r10 배포본 = 저장소 `c490ba3` |
| 반입 범위 | **`c490ba3..baf2558`** (코드) + 이 지시서와 구현 보고서를 추가한 문서 커밋. 이 브랜치에는 이후 r12(펼침 구성) 작업이 이어서 올라오므로 **브랜치 끝이 아니라 위 범위만** 가져옵니다. 문서 커밋의 해시는 사용자가 함께 전달합니다. |

```bash
git clone https://github.com/Eachdoll/271.git
cd 271 && git checkout claude/cross-owner-repo-constraint-j20lhz
git log --oneline c490ba3..baf2558
git diff --binary c490ba3..baf2558 -- donghwa-workshop > r11.patch   # 작업 저장소에서 git apply -p2 --binary r11.patch
```

적용이 깨끗하지 않으면 해당 파일을 `baf2558`의 내용으로 덮어쓰고 완료 보고에 파일명을 적습니다. **유료 API 호출은 하지 않습니다.**

---

## 1. 반입 규칙

1. 코드를 다시 쓰거나 정리하지 않습니다. 테스트를 통과시키려고 테스트를 고치거나 건너뛰지 않습니다. 실패하면 출력 전체를 완료 보고에 붙입니다.
2. `CLAUDE.md`의 "유지할 동작"을 지킵니다. R11 항목(단계 이동, 가족 계정, 통합 검수 규칙)이 추가되어 있습니다.
3. 가족 계정 세션은 **쿠키가 아니라 `X-Family-Session` 헤더**입니다. 의도된 설계입니다.
4. `FAMILY_SIGNUP_CODE` 값은 소스·문서·ZIP·로그·완료 보고 어디에도 넣지 않습니다.

---

## 2. 검증 체크리스트

### 2-1. 자동 테스트 (Node 22.13 이상, Node 24도 통과해야 함)

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **675/675** (r10 570). r10 보고의 Node 24 잠금 테스트 실패는 `93c80e2`에서 고쳤습니다. Node 24에서도 675/675여야 합니다. |
| `npm run test:quality` | **74/74** |
| `npm --prefix cloud-runtime ci && npm run build` | 성공. 품질 패키지 두 사본 바이트 동일(`diff -rq story-quality/dist dist/story-quality/dist`) |

### 2-2. 브라우저 (1280px · 390px)

```bash
(cd dist && npx http-server -p 4180 -s .) &
PLAYWRIGHT_MODULE=playwright node scripts/r9-simple-smoke.mjs http://127.0.0.1:4180/ QA/r11-simple
node scripts/ux-census.mjs QA/ux-census http://127.0.0.1:4180/ QA/r11-ux-census.json
# 가족 계정 두 기기 E2E (실제 server/cloud-api.js + 메모리 D1·R2)
FAMILY_SIGNUP_CODE=<임시 20자 이상 무작위> node scripts/r11-family-e2e.mjs 4800 &
FAMILY_SIGNUP_CODE=<같은 값> PLAYWRIGHT_MODULE=playwright node scripts/r11-family-scenarios.mjs http://127.0.0.1:4800/ QA/r11-family 1280,390
```

- 같은 포트에 예전 서버가 떠 있으면 결과가 틀립니다. 먼저 끕니다.
- 스모크 두 폭 PASS. 화면 조사: 쉬운 단계 최대 10개(≤12), `PRO SAME AS TABLE true`, `ERRORS []`, `PAID 0`.
- 가족 E2E 두 폭 PASS: 틀린 초대 코드 → 가입 → 복구 코드(뒤로 가기 후에도 유지) → A 기기 책 저장 → B 기기 로그인 자동 수신 → 아이 모드 읽기 무충돌 → 틀린 비밀번호 → 로그아웃·'이 기기 자료로 계속 쓰기' → 복구 → 비밀번호 변경 → 삭제.

### 2-3. 손으로 확인할 것

| 확인 | 기대 |
| --- | --- |
| 쉬운 만들기 ④에서 단계 표시 ① 누르기 | 고정된 주제와 '이 주제로 새로 만들기'. 다시 ④로 오면 보던 쪽 그대로, 아무 결제 없음 |
| 브라우저 뒤로 | 단계 사이를 오가고 앱을 벗어나지 않음. 글 고치는 중에는 거절되고 원래 단계 유지 |
| 휴대폰(390px) | 이전/다음 버튼 줄이 화면 아래에 항상 보임 |
| 앱 첫 화면 | 로그인 없이 그대로 사용 가능 |
| 부모 설정 '보관' | '가족 아이디로 로그인'·'가족 계정 만들기'와 작은 'ChatGPT로 로그인' 링크 |

---

## 3. 배포

1. **D1 마이그레이션 `cloud-runtime/drizzle/0002_lively_synch.sql`을 운영 D1에 적용합니다.** 새 표(`family_accounts`, `family_sessions`, `auth_throttle`)만 만들며 기존 표는 바꾸지 않습니다. 0001을 적용했던 방식과 같게 합니다.
2. **서버 비밀값 `FAMILY_SIGNUP_CODE`를 설정합니다.** 20자 이상 무작위 값(예: `openssl rand -base64 24`). 이 값은 **사용자에게만 따로** 전달하고 보고서·ZIP·로그에는 넣지 않습니다. 설정하지 않으면 가족 계정 가입이 닫혀 있습니다(로그인·기존 ChatGPT 클라우드는 정상).
3. 기존 사이트(`.openai/hosting.json`의 프로젝트)에 배포합니다. 서비스 워커 캐시는 `donghwa-shell-v35`입니다.
4. **배포된 사이트에서 한 번 확인합니다**(실제 Cloudflare D1·Sites에서만 확인 가능한 항목):
   - 새 시크릿 창 두 개에서 가입(초대 코드) → 다른 창에서 로그인 → `GET /api/cloud/session`이 `kind: "family"` 사용자를 돌려줌(= `X-Family-Session` 헤더가 Sites를 통과함)
   - 로그인 실패를 11번 반복하면 429가 나옴(= D1에서 `INSERT ... ON CONFLICT ... RETURNING`과 하위 질의 `LIMIT`가 동작함)
   - 가입·로그인 응답 시간이 정상(PBKDF2 2만 회가 요청 CPU 한도 안)
   - 시험 계정은 확인 뒤 '가족 계정 삭제'로 지웁니다.
5. `QA/deployment.json`에 `sourceCommit`과 `sourceRange`(`c490ba3..baf2558` + 문서 커밋)를 적습니다.

## 4. 완료 보고

- `CODEX_R11_COMPLETION_2026-10-19.md`: 반입 방법, 2절 결과표, 3-4 배포 후 확인 결과, 배포 URL·버전. 초대 코드 값은 적지 않습니다.
- ZIP: `SOURCE_COMMIT.txt`, `SOURCE_MANIFEST.sha256`, `QA/deployment.json`, 스모크·화면 조사·가족 E2E 결과와 스크린샷, 테스트·빌드 로그.
- `README.md` 첫 줄 안내를 r11 완료 보고로 바꿉니다.

## 5. 이번 범위 아님

- 구현 보고 6절의 알려진 한계(클라우드 용량 회수, 초대 코드 추측 방지 방식)는 고치지 않습니다.
- 같은 브랜치의 `baf2558` 이후 커밋(r12 펼침 구성)은 반입하지 않습니다. 다음 지시서로 따로 전달합니다.
