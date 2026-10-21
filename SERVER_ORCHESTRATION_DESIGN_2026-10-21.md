# 서버 오케스트레이션 구현 방법 조사·설계 · 2026-10-21

목표: 정성 모드(약 45~55회 글 호출, 8~12분)를 **휴대폰을 닫아도 서버에서 끝까지** 돌리기.
현재: 모든 호출을 브라우저 FULL AUTO가 실행합니다(키는 PIN 보관함, 창을 닫으면 멈추고 재개 시 저널로 다시 사지 않음).

## 1. 조사 결과 (확인한 것 / 확인 못 한 것)

| 항목 | 내용 | 근거 |
| --- | --- | --- |
| 지금 사이트(OpenAI Sites, chatgpt.site) | Cloudflare Workers 위에서 돌고 D1·R2를 씀. 우리 `.openai/hosting.json`도 `d1: DB`, `r2: BUCKET`만 선언 | 소스 + 공개 글 |
| Sites의 예약 실행·Durable Objects·Workflows | **공식 문서로 확인 못 함**(커뮤니티 글만 있음). 서버 비밀값은 됨(`FAMILY_SIGNUP_CODE`가 이미 그렇게 배포됨) | 공개 글, 우리 배포 |
| Cloudflare Workflows(별도 워커) | 단계마다 결과를 저장하고 단계별 재시도, 장시간 대기, **사람 승인 대기(이벤트 기다리기)** 지원. 인스턴스당 단계 수 기본 10,000, 상태 1GB(유료) | Cloudflare 문서·변경 기록 |
| 우리 글 파이프라인의 이식성 | 줄거리·회의·본문·검사·통독·FULL AUTO 모듈에 `document`·`window`·`localStorage` 사용 **0건**. 지금도 `npm test`가 Node에서 FULL AUTO 전체를 모의 엔진으로 돌림 → Workers(ESM)로 옮길 수 있음 | 소스 grep |

## 2. 방식 비교

| | A. 지금 사이트 안 '단계 실행 API' | **B. 별도 Cloudflare 워커 + Workflows (권장)** | C. 브라우저 키를 서버 메모리에만 |
| --- | --- | --- | --- |
| 어떻게 | D1에 작업 상태, 요청 1번 = 글 호출 1번. 다음 단계는 열린 앱이 계속 두드림 | Workflows가 단계(회의·줄거리·비트별 작가·편집…)를 순서대로 실행, 각 단계 결과 자동 보관 | 작업 시작 때 키를 보내 서버 메모리에만 |
| 폰을 닫아도 계속 | **아니오**(Sites 예약 실행 미확인) | **예** | 서버가 재시작되면 끊김 |
| 회의 결과 보고(부모 선택) | 지금처럼 | 이벤트 대기로 자연스럽게(며칠 기다려도 됨) | 어려움 |
| 키 | 사이트 비밀값 | 워커 비밀값 | 매번 전송 |
| 추가 비용 | 없음 | Cloudflare 계정, Workers 유료 월 $5 권장 | 없음 |
| 판정 | 브라우저 실행과 차이가 작음 | **목표를 만족** | 안정성 부족 — 제외 |

## 3. 권장안 B의 구조

```
[앱(브라우저, Sites)] ──로그인한 가족 계정──▶ [Sites API /api/cloud/stories/*]
        ▲  상태 보기·회의 선택·결과 받기          │ 서명(HMAC, 짧은 만료)
        │                                         ▼
        └──────── 결과 JSON ◀──────── [오케스트레이터 워커 (Workflows)]
                                        단계: 재료 계획 → 회의(후보 3·심사) → [부모 선택 대기] →
                                        정식 줄거리 → 장면 디테일 → 비트별 작가(한·영) →
                                        편집 점수·비트 수정 ≤2라운드 → 쪽 나누기 → 연결 검토 → 아이 시뮬레이터
                                        상태: 워커 R2(작업 JSON = 지금의 job), 키: 워커 비밀값
```

- **같은 코드 재사용**: 워커는 지금의 `dist/story-generation/*`·`dist/full-auto.js` 글 단계를 그대로 import합니다(저장·그림·키 보관함은 서버용 어댑터로 교체). 단계 결과 = 지금의 저널이라 "받은 결과는 다시 사지 않기"가 그대로 성립합니다.
- **키 원칙**: 키는 워커 비밀값에만(소스·로그·결과 JSON에 없음). CLAUDE.md의 '별도 프록시 환경변수' 규칙과 같습니다. 이 경우 **요금은 키 주인(부모님)이 냅니다**.
- **남용 방지**: 가족 계정만 허용, 계정별 하루 권수·월 금액 상한(D1), 작업당 호출 상한 60, 실패 시 저널까지 보관.
- **결과 받기**: 완료된 작업 JSON을 앱이 받아 지금의 작업·초안으로 넣고(`fullAutoPayload` 형식), 그림은 앱(④)에서 지금처럼 만듭니다. 서버 그림 생성은 다음 단계(S4).
- **앱 화면**: ③에 '서버에서 만들기(폰을 닫아도 계속)' 선택, 상태 창은 서버 진행을 폴링해 회의실·단계 표시를 그대로 그림.

## 4. 단계 계획

| 단계 | 내용 | 필요한 것 |
| --- | --- | --- |
| S1 | 글 파이프라인 코어 정리: FULL AUTO 글 단계를 저장·키 어댑터 주입식으로(브라우저 동작은 바이트 동일) | 없음 — **지금 바로 가능** |
| S2 | `orchestrator-worker/`(wrangler, Workflows, R2), 작업 시작·상태·부모 선택 이벤트·결과 API, HMAC 검증 | **Cloudflare 계정**(워커 배포 권한) |
| S3 | Sites API 중계 라우트(가족 세션 확인 → 서명 → 워커), 앱 ③ '서버에서 만들기', 결과 가져오기 | 워커 주소·공유 비밀값(배포 때 비밀값으로) |
| S4 | (선택) 서버 그림 생성 → R2 → 책장 동기화 | 그림 키 비밀값 |

정성 모드 자체(r29~r31)는 브라우저에서 먼저 완성하고, S1에서 그 코드를 서버에서도 돌 수 있게 정리하는 순서가 안전합니다(같은 코드가 두 곳에서 돌기 때문).

## 5. 정해 주실 것

1. Cloudflare 계정을 쓸 수 있는지(없으면 A 방식 = 열린 앱이 서버 단계를 두드리는 반쪽 서버로 갑니다).
2. 서버 실행 요금을 키 주인이 내는 방식에 동의하시는지(가족 계정별 상한 금액도).
3. 키 등록은 부모님이 Cloudflare 대시보드에서 직접 비밀값으로 넣어 주세요. 채팅·소스로는 받지 않습니다.

참고: OpenAI Sites 자체가 예약 실행이나 Durable Objects를 지원하는지는 OpenAI 지원 문서·문의로 확인할 가치가 있습니다. 지원된다면 B를 별도 계정 없이 Sites 안에서 할 수 있습니다.

출처: [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/index.md) · [Workflows 단계 한도 상향(2026-03)](https://developers.cloudflare.com/changelog/post/2026-03-03-step-limits-to-25k/) · [Workflows 한도 상향(2026-04)](https://developers.cloudflare.com/changelog/post/2026-04-15-workflows-limits-raised/) · [Workflows V2(InfoQ)](https://infoq.com/news/2026/05/cloudflare-workflows-v2-release/) · [OpenAI–Cloudflare: Sites on Workers with D1·R2](https://pasqualepillitteri.it/en/news/4197/openai-cloudflare-codex-sites-d1-r2) · [What is ChatGPT Sites (Stacktree)](https://stacktr.ee/blog/what-is-chatgpt-sites) · [ChatGPT Sites explained (PlayCode)](https://playcode.io/blog/chatgpt-sites-explained)


## 6. 3차 검토 반영 (2026-10-21)

- **시기**: 서버 작업(S2~S4)은 정성 모드 품질 검증(r31 + 평가 게이트) 뒤. S1(코어 분리, 브라우저 동작 바이트 동일)만 r30과 함께.
- **부모 선택 대기**: Workflow가 며칠 잠자며 기다리지 않습니다. 후보 제출에서 인스턴스를 끝내고 상태를 R2/D1에 저장, 부모의 선택 이벤트가 이어하기 인스턴스를 새로 시작합니다.
- **이식성**: 글 단계 모듈에 Node 전용 API 없음(grep 확인: `Buffer`·`process`·`require`·`XMLHttpRequest`·`node:` 0건; `structuredClone`·`crypto.randomUUID`·`fetch`·`TextEncoder`만 사용). `full-auto.js`가 화면·그림·키 보관함 모듈을 가져오는 것은 S1에서 분리.
- **남용 방지**: 계정별 하루 권수 상한 + 월 금액 상한 + 비정상 사용률 알림을 출시 전 필수로.
