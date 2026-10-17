# Claude r1 이후 Codex 작업 완료 · 2026-10-17

기준: 제공된 Claude r1 패키지(`f3a7538`). 원본 반입 커밋은 `29150d9`, A-18 포매팅 단독 커밋은 `fd6df6f`입니다. `CODEX_WORK_ORDER_2026-10-17.md`의 0절과 `CLAUDE.md` 유지 규칙을 적용했습니다. 루트 `dist/`가 실제 프런트엔드 소스이며, 런타임 산출물은 빌드로만 갱신했습니다. DB 스키마·기존 마이그레이션은 바꾸지 않았습니다.

## 확인 결과

- `npm test`: **418/418 통과**(r1 기준 392개에서 26개 추가).
- `npm run test:quality`: **40/40 통과**.
- `npm run build`: TypeScript 품질 패키지 동기화와 Vinext Worker 빌드 성공.
- Chromium 1280×900 / 390×900: 책장 → 재료 → 만들기 4단계 → 데모 7비트/12쪽 → 편집 → 확정 → 상세 → 읽기 → 아이 모드 통과. 두 크기 모두 `pageerror` 0, 유료 API 요청 0.
- 설정의 공급자 변경·ID 없는 역할별 모델 입력을 탭 이동 후 보존, 탭별 일괄 저장, 마법사의 설정 왕복, 키 누락 오류의 ‘글 엔진 키 등록하기’ 버튼과 포커스 확인.
- 즐겨찾기·탭 전환 뒤 검색어 보존, 검사 결과의 쪽 이동과 본문 포커스, 아이 모드 터치 영역 44×44px 이상, 리더 글자 크기의 새로고침 후 유지 확인.
- Google 참조의 2048×1536 → 1024×768 WebP 변환·원본 보존, 잘못된 PIN의 복구 차단과 올바른 PIN의 금고 UI 복구를 확인.
- 엔진 3개 비교의 실제 요청 signal 3개가 `cleanupImageUI()` 뒤 모두 aborted임을 별도 브라우저 시나리오로 확인.
- 실제 유료 모델의 그림·글 품질, 공급자 계정 권한/CORS/청구 금액과 iOS Safari 실기기 가상 키보드는 이번 자동 검증 범위에 포함하지 않았습니다. 모바일 높이는 `visualViewport`, `dvh`, safe-area로 처리합니다.

## A 항목

| 번호 | 변경 파일 | 동작 및 수용 검증 |
| --- | --- | --- |
| A-18 | `dist/**/*.js/css`(생성된 품질 패키지 제외), `server/cloud-api.js`, `image-proxy/server.mjs` | Prettier 기본값·세미콜론 유지. 별도 커밋. Acorn 비교로 런타임 구문 의미 유지 확인. SW 테스트의 공백·따옴표·끝 쉼표 의존 제거. |
| A-1 | `dist/output.js`, `dist/cloud-sync.js`, `dist/library-storage.js`, `dist/audio-playback.js`, `dist/app.js` | `{mode:'blobs'}`는 Blob Map을 반환하고 텍스트/base64 왕복 생략. Blob 해시·인코딩과 음원 원본 재사용. 편집·FULL AUTO·리더·미저장 설정 동안 전송 보류. 복구점은 raw+`mediaDeferred`로 남기고 내려받을 때만 미디어 포함 파일 생성. `device-transfer`의 Blob 검사, `cloud-sync`의 보류/단일 flush/해시 읽기 횟수 검사 추가. |
| A-2 | `dist/library-storage.js`, `dist/app.js` | 시작 시 `validateStoredLibrary` 구조 검사. 잘못된 레코드만 `invalidRecords`로 분리하고 저장 때 원본 레코드를 다시 합침. 책장 ‘읽지 못한 항목 · 보기’. `library-storage`의 부분 손상·base64 디코딩 금지·원본 보존 및 World 마이그레이션 후 v2 재접속 검사. |
| A-3 | `server/cloud-api.js`, `dist/cloud-sync.js` | `?meta=1`은 D1의 버전/시각/요약만 반환. 요약은 기존 `state_json` R2 포인터에 기록. 변경 없는 폴링은 R2/전체 상태 요청 생략. `cloud-api` R2 reads=0, `cloud-sync` 전체 요청=0 검사. |
| A-4 | `dist/story-generation/pipeline.js`, `quality-gates.js` | 내부 아이 시뮬레이터 재분할에는 `skipCoherence`를 전파하고, 최종 전문/쪽을 묶어 한 번 검수. `story-coherence-pipeline`에서 반전 문단 수정·재분할 뒤 일관성 호출 1회와 최종 내용 지문 확인. |
| A-5 | `dist/finalize-cleanup.js`, `dist/app.js` | 확정 초안은 작은 revision 헤더만 보관. FULL AUTO usage/costs는 책으로 옮기고 작업 삭제. 수정 복사본은 `syncStoryDraft`로 재구성. 책장 보관 공간과 중복 작업 정리. `finalize-cleanup`의 중복 제거·미완성 작업 보존 검사. |
| A-6 | `dist/image-generation/world.js`, `pipeline.js` | 요청 준비는 page 시드 미변경, 성공 commit에서만 기록. 중지 직후 도착한 유료 표지도 저장해 재개 시 재사용. `world-generation` 실패 전후 시드/메타 동일 검사, `device-transfer` 늦게 도착한 표지 보존 검사. |
| A-7 | `dist/image-generation/story-renderer.js`, `providers.js`, `pipeline.js` | 실제 정렬·한도 적용 후 `keptReferences` 반환/기록. `image-engine-contract`에서 BFL의 실제 8개 참조 역할/순서와 메타 일치 검사. |
| A-8 | `dist/image-generation/providers.js` | Google 직접 경로만 최대 1024px WebP 0.85 변환. base64 팽창을 포함한 인라인 참조 합계 18MB 초과 시 API 전송 전 `reference_limit_bytes`. 원본 미변경. 큰 Blob 요청의 fetch=0 검사. |
| A-9 | `dist/image-generation/pipeline.js`, `settings-ui.js`, `dist/app.js`, `dist/text-generation/settings-ui.js` | 유료 엔진은 유사 구도 추가 생성 금지, 전체 결과에 `similarPages` 반환. 책 단위 1회 안내에서 예상 비용·선택 쪽 확인 후 생성. 무료 sample만 기존 자동 처리. 유료 batch 호출 수=쪽수 검사. |
| A-10 | `dist/image-generation/settings-ui.js` | 비교 요청을 하나의 AbortController에 연결. 닫기/Esc/정리에서 중단. 시트 확정 전체 try/catch와 버튼 복구. `browser-r1-extra.py`에서 3개 요청 모두 aborted 확인. |
| A-11 | `dist/cloud-sync.js` | push/pull은 실행 중 refresh를 기다림. 서버와 기기 내용 해시가 같으면 오래된 baseline만 갱신. `cloud-sync` 두 시나리오 검사. |
| A-12 | `dist/image-generation/providers.js` | 결과 주소 만료와 참조 다운로드 실패를 인증 오류와 구분. HTTP와 네트워크 실패 모두 다음 행동 안내. `image-engine-contract` 오류 코드/문구 검사. |
| A-13 | `dist/image-generation/providers.js`, `assets.js` | Blob 인코딩 WeakMap. 시작 시 history/이전 버전 하위 트리는 생략하고 `hydrateImageReferences`로 열린 기록을 지연 로드. `device-transfer`의 실제 IDB 읽기 목록 검사(지난 시트·보관한 옷장 항목 포함). |
| A-14 | `dist/image-generation/vault.js`, `settings-ui.js`, `dist/app.js` | 앱 PIN 검증 후 금고 복구 버튼. 암호화 키 초기화와 ‘키 없이 부모 모드’ 선택 제공. 손상 엔진 라벨/삭제. `vault-recovery`에서 손상 금고 복구·무관한 라이브러리 유지·평문 미저장 검사. |
| A-15 | `image-proxy/server.mjs` | POST Origin 필수 또는 서버 `IMAGE_PROXY_TOKEN`과 `X-Image-Proxy-Token` 일치. 기존 Origin allowlist 유지. 깊이 32 초과는 413. `image-engine-contract` 검사. |
| A-16 | `dist/sw.js` | shell v20. Node CLI/distill/eval/finetune/node.js와 브라우저 미사용 어휘 txt 프리캐시 제외. 쓰기는 `event.waitUntil`. `service-worker-shell` 동일 제외·존재/누락 검사. |
| A-17 | `dist/app.js` | 하이드레이션은 자산 노드만 교체. 즐겨찾기는 카드만, 정렬·탭·검색은 책 목록만 갱신. 같은 화면 잔여 렌더의 활성 입력/커서 유지. 브라우저 검색어 유지 시나리오 확인. |

## B 항목

| 번호 | 변경 파일 | 확인 |
| --- | --- | --- |
| B-1 | `dist/app.js` | 상단 상태 칩→클라우드 관리. 보관 카드는 책장의 미연결/오류, 전체 화면의 충돌 때만 표시. 재료·만들기·설정의 카드 제거 확인. |
| B-2 | `dist/app.js`, `dist/image-generation/settings-ui.js` | 세 탭·해시·현재 탭 바로가기·패널별 미저장 점·고정 일괄 저장. 엔진을 바꾼 동적 폼과 ID 없는 역할별 입력까지 메모리에서 보존. World 변경 확인을 기다린 후 저장 완료 표시. |
| B-3 | `dist/app.js`, `dist/full-auto-ui.js` | 재료 다음을 주제/분위기→읽기/형식→만들기로 분할. 마지막 카드에 초록 수동 진행과 보조 FULL AUTO 버튼. 뒤로 이동·설정 왕복 입력 보존. |
| B-4 | `dist/story-generation/ui.js`, `story.css`, `dist/style.css` | 작업 창 sticky 단계/엔진 헤더, 오류·검사 동의·경과 시간·중지 버튼을 하단 액션 바에 배치. 데모 쪽 승인 흐름 확인. |
| B-5 | `dist/checks-panel.js`, `dist/app.js` | 읽기·사건·풍부함·연결 탭과 개수, 오류/권고 색 구분, 쪽 이동·본문 포커스. `checks-panel`의 severity/escape/잘못된 쪽 번호 검사. |
| B-6 | `dist/reading-ui.js`, `dist/app.js` | 카드에는 K/E 칩, 추정치/공식 점수 아님은 툴팁·상세에 유지. 카드 피드백 제거, 상세·리더 끝 유지. compact badge 검사. 모바일 표준 카드 높이는 449.5px→295.0px(65.6%)로 확인. |
| B-7 | `dist/app.js`, `dist/style.css` | 아이 모드 검색·정렬·탭 숨김, 표지 격자·직접 읽기, 읽기 제한 종이책 안내. 모든 표시된 터치 대상 44px 이상 확인. |
| B-8 | `dist/app.js`, `dist/style.css` | 글자 3단계 기기 저장, 밑줄 하이라이트, 접힌 재생 설정, 기본 읽기·이전·다음. 키보드 이동과 새로고침 후 크기 유지 확인. |
| B-9 | `dist/app.js`, `dist/story-generation/ui.js` | 행동 버튼을 지원하는 toast, 키 누락 시 해당 설정·입력 포커스. 책장·재료·초안 빈 상태의 제목/한 줄/단일 행동 통일. |
| B-10 | `dist/app.js`, `dist/style.css` | 모바일 전체 높이 하단 시트·손잡이·닫기, safe-area/visualViewport 처리. 모바일 리더의 viewport 높이 확인. |
| B-11 | `dist/style.css`, `dist/story-generation/story.css` | 본문/보조/힌트·accent/warn/danger와 4/8/12/16/24/32 간격 토큰. 삽화 픽셀은 미변경. 전후 스크린샷 제공. |
| B-12 | `dist/app.js`, `dist/style.css` | 자산 스켈레톤→해당 그림만 교체. 하이드레이션 완료 후 실제 누락은 복원 안내. 전체 시작 화면 재렌더 제거. |

## 브라우저 재현과 전달 파일

정적 서버를 실행한 뒤 별도 터미널에서 검증합니다. `CHROMIUM_PATH`로 Chromium 경로, `R1_QA_OUTPUT`으로 스크린샷 폴더를 지정할 수 있습니다. Python Playwright가 필요합니다.

```bash
python3 -m http.server 4174 --bind 127.0.0.1 --directory dist
R1_QA_OUTPUT=/tmp/donghwa-r1-qa python3 tests/browser-r1.py
python3 tests/browser-r1-extra.py
```

정적 미리보기의 `/api/cloud/session` 404는 정상입니다. 클라우드 동작은 실제 SQLite/D1 모의 바인딩·R2 모의 저장소와 동기화 클라이언트 테스트로 검증했습니다.

소스 전달 ZIP의 `QA/` 폴더에는 다음 결과를 포함합니다.

- 전후: `before-library-1280.png`, `library-1280.png`, `before-library-390.png`, `library-390.png`.
- 화면 흐름: `materials-*`, `settings-*`, `wizard-*`, `pages-*`, `editor-*`, `detail-*`, `reader-*`, `child-*` (`1280`/`390`).
- `comparison.html`에서 책장 전후 이미지를 나란히 확인할 수 있습니다.
- 테스트·빌드·브라우저 결과 로그, 원본 커밋과 파일 해시 목록을 함께 전달합니다. API 키·PIN 금고·사용자 DB·Git 자격 증명·node_modules는 압축하지 않습니다.
