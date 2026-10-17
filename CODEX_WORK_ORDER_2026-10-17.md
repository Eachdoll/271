# 동화공방 수정 지시서 (Codex용) · 2026-10-17

이 문서는 커밋 `f3a7538`(안정성·가독성 1차 개선) 이후에 **아직 남아 있는 결함**과 **UI/UX 강화안**을 Codex가 바로 실행할 수 있도록 정리한 작업 지시서입니다. 1차 개선에서 이미 고친 항목은 `UPDATE_NOTES_2026-10-17.md`에 있으므로 다시 손대지 않습니다.

## 0. 작업 규칙 (반드시 지킬 것)

- `CLAUDE.md`의 "유지할 동작"을 그대로 지킵니다. 특히 유료 호출을 다시 결제하지 않기, API 오류 때 샘플로 대체하지 않기, 키를 소스·로그·백업에 넣지 않기.
- 편집 대상은 루트 `dist/`(프런트엔드 소스), `server/cloud-api.js`, `story-quality/src/`입니다. `cloud-runtime/public`, `cloud-runtime/dist`, `.wrangler`는 생성물이므로 수정 금지.
- 모든 작업 후 `npm test`와 `npm run test:quality`가 통과해야 합니다(현재 392 + 40). 각 항목의 "수용 기준"에 적힌 테스트를 `tests/`에 추가합니다.
- `dist/` 파일을 바꾸면 `dist/sw.js`의 `CACHE` 버전을 올립니다(현재 `donghwa-shell-v19`). 프리캐시 목록을 바꾸면 `tests/service-worker-shell.test.mjs`의 제외 규칙도 함께 갱신합니다.
- 브라우저 검증: `python3 -m http.server 4174 --bind 127.0.0.1 --directory dist` 후 데스크톱 1280px·모바일 390px에서 책장 → 재료 → 만들기(데모) → 부모 설정 → 책 상세 → 읽기 흐름을 눌러 보고 콘솔 `pageerror`가 없어야 합니다. 정적 미리보기의 `/api/cloud/session` 404는 정상입니다.
- 기능 단위로 커밋하고, 커밋 메시지에 항목 번호(예: `A-3`)를 적습니다.

파일 안 줄 번호는 현재 소스(한 줄이 매우 긴 압축 형식) 기준이며, 심볼 이름으로 찾는 것이 더 정확합니다.

---

## A. 남은 결함 수정 (우선순위 순)

### A-1. [HIGH] 클라우드 저장·불러오기 때 전체 미디어를 base64로 재인코딩 → 모바일 탭 종료
- 위치: `dist/output.js` `createLibraryBackup`(약 556~581행), `dist/cloud-sync.js` `upload()`·`cloudSnapshot()`(약 91~94행, 223행), `dist/app.js` `applyCloudLibrary`(`recovery=(await createLibraryBackup(prior)).text`).
- 현상: 저장이 1.5초 디바운스로 일어날 때마다(FULL AUTO는 매 단계) 모든 그림·음원을 data URL로 바꾸고, 최대 250MB JSON 문자열을 만든 뒤 `validateImport`로 다시 파싱합니다. 그 뒤 cloud-sync가 각 data URL을 `atob`로 되돌려 SHA-256을 계산합니다. 최대 미디어 한도(150MB)에서 메모리 피크가 1GB를 넘습니다.
- 지시:
  1. `createLibraryBackup`에 `{mode:'blobs'}` 옵션을 추가해 `assets`를 `Map<assetId, Blob>`로 돌려주는 경로를 만듭니다. 텍스트 직렬화·`validateImport` 왕복은 파일 내보내기 경로에서만 수행합니다.
  2. cloud-sync는 Blob에서 직접 `crypto.subtle.digest(await blob.arrayBuffer())`로 해시를 계산하고, 자산 id별 sha256을 메모리 캐시(WeakMap 또는 Map)에 보관해 변경되지 않은 자산은 다시 읽지 않습니다.
  3. `applyCloudLibrary`·`showLibraryImport`의 "복구용 보관본"은 `localStorage` 원문(`raw`)만 저장하고, 미디어 포함 백업은 사용자가 '복구용 보관본 내려받기'를 누를 때만 생성합니다(`keepRecoveryPoint`에 `{mediaDeferred:true}` 표시).
  4. 푸시는 `canApplyRemote()`와 같은 조건으로 FULL AUTO 실행 중·리더 열림 중에는 미루고, 작업이 끝났을 때 한 번만 보냅니다.
- 수용 기준: `tests/cloud-sync.test.mjs`에 "미디어 3개 중 1개만 바뀐 두 번째 푸시는 바뀐 자산만 해시·업로드한다"와 "푸시 경로에서 `createLibraryBackup`의 텍스트 모드가 호출되지 않는다"를 추가. 기존 테스트 유지.

### A-2. [HIGH] 시작할 때마다 전체 가져오기 검증 실행, 필드 하나가 잘못되면 라이브러리 전체 차단
- 위치: `dist/app.js` 40행 `readStoredLibrary(localStorage,KEY,{validate:text=>validateImport(text,{allowStoredAssets:true})...})`, `dist/output.js` `validateImport`(약 637~684행)·`checkInlineStateImages`(약 417~428행), `dist/library-storage.js` 5행.
- 현상: 매 로드마다 reviver 파싱 + `withoutCredentials` 왕복 + 모든 인라인 `imageUrl`의 base64 디코딩을 수행합니다. `imageUrl`이 `asset:`/`data:image/`/`/assets/`가 아닌 레코드가 하나라도 있으면 라이브러리 전체가 `blocked` 상태가 되어 샘플만 보입니다.
- 지시:
  1. 시작 경로는 구조 검사만 하는 `validateStoredLibrary(text)`를 새로 만들어 사용합니다(최상위 키 타입, `books[]`·`characters[]`·`backgrounds[]`·`settings` 존재, 버전 필드). 이미지 서명 검사는 파일·클라우드 가져오기에서만 수행합니다.
  2. 잘못된 레코드는 전체 차단 대신 해당 레코드만 `invalidRecords` 목록으로 분리해 보관하고, 책장에 "읽지 못한 항목 N개 · 보기" 안내를 표시합니다. 원본 덮어쓰기 금지 원칙은 유지합니다(분리한 레코드도 `localStorage` 원문에서 제거하지 않음).
- 수용 기준: `tests/library-storage.test.mjs`에 "책 1권의 `imageUrl`이 잘못돼도 나머지 책은 읽힌다"와 "구조 검사 경로는 base64를 디코딩하지 않는다(스파이로 확인)"를 추가.

### A-3. [HIGH] 20초마다 클라우드 라이브러리 전체(최대 8MB) 다운로드
- 위치: `dist/cloud-sync.js` `reconcile()`(`record=await library(op,user)`), `setInterval(focus,20000)`·`focus`·`visibilitychange` 리스너(약 278~282행); `server/cloud-api.js` `getLibrary`(R2 읽기 + 전체 digest + JSON 파싱).
- 지시:
  1. 서버에 `GET /api/cloud/library?meta=1`을 추가해 `{exists, revision, updatedAt, summary:{bookCount,characterCount,backgroundCount}}`만 돌려줍니다. D1 행만 읽고 R2는 열지 않습니다. `summary`는 저장할 때 `cloud_libraries`에 새 컬럼 없이 `manifest_json` 옆의 JSON 포인터에 함께 기록합니다(새 DDL 금지·마이그레이션은 Drizzle로만).
  2. 클라이언트 `reconcile`은 먼저 meta를 읽고, `revision`이 baseline과 같으면 상태만 갱신하고 끝냅니다. 다르거나 명시적 불러오기일 때만 전체를 받습니다.
- 수용 기준: `tests/cloud-api.test.mjs`에 meta 응답 형식과 "meta 조회는 R2를 읽지 않는다(`env.reads` 길이 0)" 추가. `tests/cloud-sync.test.mjs`에 "변경 없는 폴링은 전체 라이브러리 요청을 보내지 않는다" 추가.

### A-4. [MEDIUM] 아이 시뮬레이터 수정 후 쪽 일관성 검사가 두 번 결제됨
- 위치: `dist/story-generation/quality-gates.js` 약 174행 `services.repaginate(outline,nextProse,input,{...options,skipChildGate:true,repair:false})` → `dist/story-generation/pipeline.js` `paginateStory` → `finishPaginationRichness` → `finishPaginationCoherence`(약 457행) → `reviewStoryCoherence`.
- 현상: 내부 `paginateStory`가 일관성 검사(유료, 최대 2회 수정)를 실행하고 그 `meta.coherence`를 버립니다. 바깥 `finishPaginationCoherence`는 UI가 넘긴 오래된 `options.pageCoherence`와 지문이 맞지 않아 같은 검사를 다시 요청합니다.
- 지시: `inspectChildStory`가 내부 결과의 `meta.coherence`를 반환하도록 하고, 바깥 단계는 `isCoherenceCurrent(meta.coherence, 현재 pages)`가 참이면 재검사를 건너뜁니다. 또는 내부 호출에 `skipCoherence:true`를 전달하고 바깥에서 한 번만 검사합니다. 어느 쪽이든 "최종 쪽의 일관성 결과는 검수한 내용 지문에 묶인다"는 규칙은 유지합니다.
- 수용 기준: `tests/story-quality-gates.test.mjs`에 모의 엔진으로 "아이 시뮬레이터가 수정을 요구한 경우 `reviewStoryCoherence` 호출이 정확히 1회"를 추가.

### A-5. [MEDIUM] 완성된 책·작업이 localStorage에 세 벌씩 남고 UI에서 지울 수 없음
- 위치: `dist/story-generation/ui.js` `syncStoryDraft`(`d.pictureBook=clone(book)`), `dist/full-auto.js` 약 82행, `dist/app.js` `finalizeBook`(`stage='final'`, `delete auto.book`만 수행), `ui.js` `drafts()`·`full-auto-ui.js` 9행의 `final` 필터.
- 지시:
  1. `finalizeBook`에서 `state.storyDrafts[id]`의 `pictureBook`·`prose`·`pagination`·`snapshots`·`sceneBriefs`·`pageCoherence`를 제거하고 `{id, bookId, stage:'final', input, wizard, usage, updatedAt}`만 남깁니다. `revise-book-copy`는 책 객체에서 필요한 값을 다시 채우므로 동작을 유지해야 합니다(복사본 생성 뒤 `syncStoryDraft` 호출로 보완).
  2. `fullAutoJobs[id]`는 `status:'final'`이 되면 `usage`·`costs`만 책에 옮기고 항목을 삭제합니다.
  3. 책장 하단 "보관 공간" 패널에 현재 `localStorage` 사용량(문자열 길이 기준 추정)과 "오래된 작업 기록 정리" 버튼을 추가합니다.
- 수용 기준: `tests/story-pipeline.test.mjs` 또는 새 `tests/finalize-cleanup.test.mjs`에서 확정 뒤 `storyDrafts[id]`에 `pictureBook`이 없고 `revise-book-copy` 흐름에 쓰는 필드는 남아 있는지 확인.

### A-6. [MEDIUM] 그림 요청 전에 `page.imageSeed`를 바꿔 실패 시 시드가 어긋남
- 위치: `dist/image-generation/world.js` 약 309행 `if(!options.cover)page.imageSeed=requestSeed;`, `dist/image-generation/pipeline.js` 약 110·138~141행.
- 지시: `sceneGenerationRequest`는 시드를 요청 객체에만 넣고 `page`를 건드리지 않습니다. `commitSceneResult`만 `page.imageSeed`를 씁니다. 실패·중지 경로에서는 기존 시드가 그대로 남아야 합니다.
- 수용 기준: `tests/image-engine-contract.test.mjs`에 "공급자 실패 뒤 `page.imageSeed`와 `imageMeta.requestedSeed`가 변하지 않는다" 추가.

### A-7. [MEDIUM] 장면 메타의 참조 목록이 실제 전송 목록과 다름
- 위치: `dist/image-generation/pipeline.js` 약 77행 `request.referenceImages.slice(0, result.meta?.referenceCount ?? ...)` vs `dist/image-generation/story-renderer.js` 188~191행(`ROLE_ORDER`로 정렬 후 자름).
- 지시: `renderImageRequest`가 실제로 보낸 참조 부분집합(`keptReferences`)을 반환하고 메타는 그것을 기록합니다. BFL(한도 8)에서 배경이 잘린 경우가 정확히 반영돼야 합니다.
- 수용 기준: 참조 10개를 넘긴 모의 요청에서 메타의 역할 목록이 렌더러가 보낸 것과 동일한지 테스트.

### A-8. [MEDIUM] Google 직접 전송의 인라인 참조 20MB 한도
- 위치: `dist/image-generation/providers.js` 약 297~306행(모든 참조를 `inlineData`로 포함).
- 지시: 참조 Blob을 canvas로 최대 1024px·WebP(품질 0.85)로 축소한 뒤 포함하고, 합계가 18MB를 넘으면 전송 전에 "참조 그림이 너무 커서 Google 직접 전송 한도를 넘어요(현재 NN MB). 참조 수를 줄이거나 프록시를 사용해 주세요."라는 전용 오류를 냅니다. 축소는 Google 경로에서만 적용하고 시트 원본은 보존합니다.
- 수용 기준: 모의 Blob(크기만 큰)으로 한도 초과 시 fetch가 호출되지 않고 전용 오류 코드가 나오는 테스트.

### A-9. [MEDIUM] 유사 그림 자동 재생성이 유료 엔진에서 쪽마다 추가 결제
- 위치: `dist/image-generation/pipeline.js` 약 161행 `diversityEnabled` 기본 `true`, 184~186행 자동 재생성.
- 지시: 유료 엔진(`sample`이 아닌 경우)은 기본값을 "묻기"로 바꿉니다. 전체 생성이 끝난 뒤 "비슷한 구도 N쪽 · 다시 그릴까요?(예상 $X)" 확인창을 한 번 띄우고, 선택한 쪽만 재생성합니다. 설정 문구 "유사 그림은 최대 1회 추가 생성 요금"을 "책당 확인 후 선택한 쪽만"으로 바꿉니다.
- 수용 기준: 자동 재생성 없이 `generateAllScenes`가 끝나고 `similarPages` 목록을 반환하는 테스트.

### A-10. [MEDIUM] 엔진 3개 비교를 중지할 수 없음 · 시트 확정 핸들러의 처리되지 않은 거부
- 위치: `dist/image-generation/settings-ui.js` `compareEngines`(약 37행), `#ig-sheet-confirm` onclick(약 41행 `await deleteImageAsset(...)`가 `try` 밖).
- 지시: 비교에 `AbortController`를 두고 `currentOperation`에 등록해 Esc·닫기·`cleanupImageUI`에서 중단합니다. 시트 확정 분기 전체를 `try/catch`로 감싸 실패 시 `api.toast`와 버튼 복구를 수행합니다.
- 수용 기준: 비교 중 `cleanupImageUI()` 호출 시 세 요청의 signal이 모두 aborted인지 확인.

### A-11. [MEDIUM] 클라우드 push/pull이 폴링 중이면 BUSY로 실패 · 저장 뒤 baseline 기록 실패 시 가짜 충돌
- 위치: `dist/cloud-sync.js` `execute()`(`if(operation)return kind==='refresh'?operation:Promise.reject(... 'BUSY')`), `upload()` 약 230~232행, `reconcile()`.
- 지시: `push/pull`은 진행 중인 `refresh`를 기다린 뒤 실행합니다(거부 대신 체인). `reconcile`에서 revision이 다르지만 `hashCloudState(record.state)`가 로컬 해시와 같으면 충돌 대신 baseline만 갱신합니다.
- 수용 기준: `tests/cloud-sync.test.mjs`에 두 경우 추가.

### A-12. [LOW] 다운로드 오류 문구가 API 오류 문구로 표시됨
- 위치: `dist/image-generation/providers.js` `imageResultURL`(약 226행)·`referenceBlob`(약 204행)이 `fetchResponse`의 401/403 문구를 재사용.
- 지시: `fetchResponse(url,options,{download:true})` 플래그를 추가해 "결과 이미지 주소가 만료됐어요. 다시 생성해 주세요." / "참조 이미지를 다시 불러오지 못했어요. 시트를 다시 고정해 주세요."로 구분합니다.

### A-13. [LOW] 참조 Blob을 요청마다 base64로 재인코딩 · 모든 자산을 시작 시 전부 하이드레이트
- 위치: `providers.js` `blobDataURL` 호출(약 298·341·359·485행), `dist/image-generation/assets.js` `hydrateImageAssets`(약 167~177행).
- 지시: `blobDataURL`을 `WeakMap<Blob,string>`으로 메모이즈합니다. `hydrateImageAssets`는 현재 쪽·시트·표지의 자산만 먼저 로드하고 `imageHistory`·`coverHistory`·옷장 이전 버전은 해당 화면을 열 때 지연 로드합니다.

### A-14. [LOW] 금고(API 키) 문제 때 복구 동작이 없음
- 위치: `dist/app.js` `pin-form` 제출 핸들러(1차 개선에서 경고 토스트만 추가), `dist/image-generation/vault.js` `listCredentialStatus`(1차에서 `'corrupt'` 반환).
- 지시: PIN이 맞는데 금고 오류가 난 경우 PIN 창 안에 "저장된 API 키 초기화 · 다시 등록" 버튼을 보여 주고, 부모 설정의 키 상태 목록에서 `'corrupt'` 엔진은 "손상됨 · 삭제 후 다시 등록" 라벨과 삭제 버튼을 표시합니다.

### A-15. [LOW] 이미지 프록시 보안·입력 보호
- 위치: `image-proxy/server.mjs` 47행(Origin 없으면 통과), 14~20행 `rejectCredentials` 재귀 깊이 제한 없음.
- 지시: POST는 `Origin` 헤더 필수 또는 `IMAGE_PROXY_TOKEN` 환경변수 일치 요구. `rejectCredentials`에 깊이 32 제한과 413 응답 추가.

### A-16. [LOW] 서비스 워커 프리캐시 정리
- 위치: `dist/sw.js` `FILES`, fetch 핸들러의 `caches.open(...).then(cache=>cache.put(...))`.
- 지시: `cache.put`을 `event.waitUntil`로 감쌉니다. Node 전용 파일(`story-quality/dist/cli/*`, `distill/*`, `eval/*`, `finetune/*`, `node.js`)과 브라우저가 가져오지 않는 `vocab/*.txt`를 목록에서 제거합니다. `tests/service-worker-shell.test.mjs`의 "모든 JS가 프리캐시" 검사에 같은 제외 규칙을 반영합니다.

### A-17. [LOW] 화면 전체 재렌더가 입력을 지움
- 위치: `dist/app.js` `hydrateImageAssets(state).then(result=>{render();...})`, `render()` 전체 `innerHTML` 교체, `favorite`·`paper-read`·`tab`·`sort` 핸들러.
- 지시: 하이드레이트 완료 시 `document.activeElement`가 입력 요소면 재렌더를 미루고 그림 `<img>`의 `src`만 갱신합니다. 즐겨찾기 토글은 카드 DOM만 갱신합니다. 검색 입력(`search-books`)은 1차에서 부분 갱신으로 되어 있으므로 같은 방식으로 통일합니다.

### A-18. [유지보수] 한 줄 압축 소스 정형화
- `dist/app.js`(312줄에 111KB), `dist/style.css`(43줄에 45KB) 등은 줄 하나가 수천 자라 diff 검토와 협업 수정이 어렵습니다. 동작 변경 없이 한 번에 포매팅하는 커밋을 별도로 만듭니다(Prettier 기본 설정, 세미콜론 유지). 테스트는 포매팅에 의존하지 않습니다. 이 커밋은 다른 변경과 섞지 않습니다.

---

## B. UI/UX 강화안

각 항목은 "현재 → 목표 → 구현 지점 → 확인 방법" 순서입니다. 1차 개선에서 글자 크기·대비·상태 카드 압축·설정 바로가기·PIN 라벨은 반영돼 있으므로, 아래는 그 위에 얹는 구조적 개선입니다.

### B-1. 상태 카드를 상단바 상태 칩으로
- 현재: 클라우드 카드와 기기 보관 카드가 모든 화면 상단을 차지합니다(2열로 줄였지만 여전히 첫 화면 높이의 1/4).
- 목표: 상단바 오른쪽 `local-label` 자리에 "이 기기에 보관 · 클라우드 연결 대기" 한 줄 칩을 두고, 누르면 현재의 `showCloudPanel()`을 엽니다. 카드는 책장(`library`) 화면에만, 그리고 로그인 전·충돌·오류 상태일 때만 보여 줍니다.
- 구현: `dist/app.js` `render()`의 `status-strip` 조건, `cloudStatusCard()`에 `compact` 모드 추가, `updateCloudStatus`가 칩 텍스트도 갱신.
- 확인: 재료·만들기·설정·상세 화면 첫 화면에서 카드가 보이지 않고 칩만 보임. 충돌 상태(`phase:'conflict'`)에서는 어느 화면이든 카드가 다시 나타남.

### B-2. 부모 설정을 3개 탭으로 재구성
- 현재: 16개 패널이 한 페이지(약 8,000px)에 세로로 이어집니다. 바로가기 칩을 붙였지만 저장 버튼이 패널마다 달라 어디까지 저장됐는지 알기 어렵습니다.
- 목표: 탭 "우리 집·읽기·잠금" / "글 엔진·이야기 품질" / "그림 World·화풍". 각 탭 안에서는 지금 패널을 유지하되, 변경된 패널에 "저장 안 됨" 점 표시와 하단 고정 저장 바(현재 탭의 폼을 한 번에 저장)를 둡니다. 탭은 `?settings=text` 같은 해시로 기억해 `openStoryTextSettings()`가 바로 해당 탭을 엽니다.
- 구현: `settingsPage()`를 탭 셸로 바꾸고 `renderTextSettings`·`renderStoryQualitySettings`·`renderImageSettings`·`renderStyleStudioSettings`·`renderWorldVariations`는 그대로 탭 내용으로 호출. 각 패널 `<section class="panel">`에 안정적인 `id`(`settings-reading`, `settings-text-engine`…)를 부여하고 1차의 `renderSettingsJump()`는 탭 안 바로가기로 축소.
- 확인: 마법사에서 "변경" → 글 엔진 탭이 바로 열리고, 저장 뒤 "저장한 설정으로 이야기 돌아가기"가 그대로 동작.

### B-3. 이야기 만들기 2단계 폼 분할
- 현재: 2단계에 주제·언어·길이·읽기 단계·가치·결말·시리즈·세계관 메모·모험 무대·계절·시간·구성 패턴·엔진 요약·FULL AUTO 런처가 한 화면에 있습니다(데스크톱 2,000px).
- 목표: "주제와 분위기"(주제·칩·아이가 고르기·무대·계절·시간) → "읽기와 형식"(언어·길이·K/E 단계·가치·결말·시리즈) → "만들기"(엔진 요약·예상 비용·구성 패턴·세계관 메모·두 가지 실행 버튼)로 3단계. 마지막 단계에서 "줄거리부터 함께 만들기"(기본, 초록)와 "FULL AUTO로 한 번에"(보조)를 같은 카드 안에 나란히 두어 주 행동을 하나로 보이게 합니다.
- 구현: `createPage()`의 `steps` 배열과 `w.step` 분기, `syncWizard()`의 필드 목록을 단계별로 나눔. 검증(`safeTopic`, 옷장 선택 검사)은 마지막 단계 전환 시 실행.
- 확인: 모바일에서 각 단계가 한 화면 반 이내, "이전 단계"로 돌아가도 입력 유지.

### B-4. 이야기 작업 창(모달)의 진행·오류 표시
- 현재: 1020px 모달 안에서 스크롤하며, 오류는 하단 `#story-error`에 표시됩니다(1차에서 스크롤·토스트 보완). 3단계 헤더가 스크롤되면 사라집니다.
- 목표: 단계 헤더(`.story-steps`)와 엔진 요약을 모달 상단에 고정(sticky), 오류·경고는 하단 고정 액션 바 바로 위에 붙여 버튼과 함께 보이게 합니다. "검사 경고 확인" 체크란도 액션 바 안으로 옮깁니다. 진행 중에는 액션 바에 경과 시간·중지 버튼을 함께 표시합니다.
- 구현: `dist/story-generation/ui.js`의 `renderPages`·`renderProse`·`renderOutline`에서 `note()`와 `#story-accept-failures` 위치 이동, `story.css`의 `.story-workspace .modal-actions`를 `position:sticky; bottom:0` 블록으로 확장.
- 확인: 데모 흐름에서 "쪽 승인"을 누르면 액션 바 바로 위에 원인과 체크란이 보이고 스크롤 없이 처리 가능.

### B-5. 검사 결과를 한 패널로 통합하고 쪽으로 이동 링크 제공
- 현재: 편집 화면에 "읽기 규칙", "사건·쪽 검사", "글 풍부함", "플롯 연결"이 각각 접힘 패널로 쌓입니다(모두 주황 경고색이라 심각도 구분이 안 됨).
- 목표: 하나의 "검사 결과" 패널에 탭(읽기·사건·풍부함·연결)과 항목 수 배지를 두고, 각 항목에 "N쪽으로" 링크(`data-action="edit-page" data-page`)를 붙입니다. 심각도 색을 두 단계로 나눕니다(막힘: 적갈색, 확인 권장: 주황).
- 구현: `dist/app.js` `editorPage()`의 `renderReadingCheck`·`renderStoryQuality`·`renderStoryCoherence`·`renderRichnessQuality` 호출을 하나의 `renderChecksPanel(draft)`로 묶음. 스타일은 `.reading-check` 계열 재사용.
- 확인: 경고 항목 클릭 시 해당 쪽이 편집기에 열리고 텍스트에 포커스.

### B-6. 책 카드의 정보 줄 정리
- 현재: 카드마다 "AR 약 1.7 / 렉사일 약 190L (추정) · 공식 점수 아님 · / repeat"와 난이도 피드백 버튼 3개가 부모 모드에서 항상 보입니다.
- 목표: 카드에는 제목·시리즈·언어·쪽수·날짜·"데모" 배지만 두고, 읽기 수준은 "K1 · E0" 칩 하나로 줄이며 자세한 추정치는 툴팁/상세 화면으로 옮깁니다. 난이도 피드백은 책 상세와 리더 마지막 쪽에서만 제공합니다(이미 리더 끝에 있음).
- 구현: `bookCard()`에서 `renderReadingBadge(book,{compact:true})`, `renderFeedbackActions` 제거. `dist/reading-ui.js` `renderReadingBadge`에 compact 모드 추가.
- 확인: 모바일 2열 카드에서 카드 높이가 현재의 2/3 이하.

### B-7. 아이 모드 전용 레이아웃
- 현재: 부모 모드와 같은 격자·검색·정렬 UI에서 버튼만 숨깁니다.
- 목표: 검색·정렬·탭 숨김, 표지 격자 3열(태블릿 2열), 표지 자체가 탭 대상(최소 44px 여백), 상세 화면 대신 바로 리더가 열리는 "읽어줘" 큰 버튼. 하루 제한에 도달하면 책장 상단에 종이책 권유 카드.
- 구현: `libraryPage()`의 `childMode` 분기 확장, `.child-mode` 바디 클래스와 CSS, `open-book` 핸들러에서 `childMode`면 `startReading`.
- 확인: 아이 모드에서 모든 탭 대상이 44×44px 이상(Playwright로 `boundingBox` 검사).

### B-8. 리더(읽기 창) 개선
- 현재: 글자 크기 고정, 단어 하이라이트는 배경색만, 이어 듣기·속도·듣기 전용이 한 줄에 섞여 있습니다.
- 목표: 글자 크기 3단계(기본·크게·아주 크게, localStorage에 저장), 하이라이트에 밑줄 추가(색각 보조), 옵션을 "재생 설정" 접힘 패널로 묶고 기본은 재생·이전·다음만 노출. 태블릿 가로에서는 그림 왼쪽·글 오른쪽 2열 유지, 세로에서는 그림 위·글 아래.
- 구현: `renderReader()`·`.reader-*` CSS, `speak()`의 `onWord` 하이라이트 클래스에 `text-decoration`.
- 확인: 글자 크기 변경이 새로고침 뒤에도 유지, 키보드 ←/→·스와이프 동작 유지.

### B-9. 오류·빈 상태 문구 통일
- 현재: 같은 종류의 실패가 토스트·인라인·모달 안내로 제각각 표시되고, API 키가 없을 때 "부모 설정에서 … 저장해 주세요"만 나옵니다.
- 목표: 오류 안내에는 항상 다음 행동 버튼을 붙입니다(예: "글 엔진 키 등록하기" → 설정 글 엔진 탭의 키 입력으로 이동·포커스). 빈 책장·빈 재료·초안 없음 상태에 같은 톤의 일러스트 없는 카드(제목·한 줄 설명·주 행동 1개).
- 구현: `toast(message,{action:{label,run}})` 확장, 설정 탭 이동은 B-2의 해시 사용.
- 확인: 키 없이 "줄거리 생성"을 누르면 오류 토스트에 버튼이 있고 누르면 키 입력란에 포커스.

### B-10. 모바일 모달을 바텀 시트로
- 현재: 모달이 화면 가운데 작은 창으로 열리고 긴 내용은 창 안에서 스크롤합니다.
- 목표: 640px 이하에서는 모달을 화면 하단에서 올라오는 전체 높이 시트로 바꾸고(상단 손잡이·닫기), 스크롤은 시트 전체. 이야기 작업 창·클라우드 패널·인쇄 옵션에 적용.
- 구현: `.modal-overlay`·`.modal` 미디어 쿼리, `showModal()`에 `sheet` 클래스 자동 부여.
- 확인: iOS Safari 가상 키보드가 열려도 저장 버튼이 가려지지 않음(`env(safe-area-inset-bottom)` 적용).

### B-11. 디자인 토큰 정리
- 현재: 회녹색 계열 글자색이 60여 가지 hex로 흩어져 있습니다(1차에서 대비만 올림).
- 목표: `--text-1`(본문) `--text-2`(보조) `--text-3`(힌트) `--accent`·`--warn`·`--danger` 토큰으로 통합하고 간격 스케일(4·8·12·16·24·32px)을 정합니다. 표지 그림 안의 색은 제외.
- 구현: A-18 포매팅 커밋 뒤에 진행. 변경 전후 스크린샷 비교를 PR에 첨부.

### B-12. 로딩·재렌더 체감
- 현재: 시작 직후 그림이 없는 카드가 보였다가 `hydrateImageAssets` 뒤 전체 재렌더로 깜빡입니다.
- 목표: 카드 그림 자리에 스켈레톤(연한 회색 블록)을 두고 자산이 준비되면 `<img>`만 교체. 전체 `render()`는 뷰 전환 때만.
- 구현: A-17과 함께 처리.

---

## C. 권장 작업 순서

1. A-18 포매팅 커밋(단독) → 이후 모든 diff가 읽히게 됩니다.
2. A-1, A-2, A-3(저장·시작·폴링 비용) → 모바일 안정성에 가장 큰 영향.
3. A-4, A-5, A-6, A-7, A-9(유료 호출·데이터 정확성).
4. B-1, B-2, B-4, B-5(정보 구조) → B-3, B-6, B-7, B-8(흐름) → B-9, B-10, B-11, B-12(마감).
5. 나머지 A 항목은 해당 파일을 건드리는 B 작업과 함께 처리.

## D. 완료 보고 형식

항목 번호 · 바꾼 파일 · 추가한 테스트 이름 · `npm test`/`npm run test:quality` 결과 · 브라우저 확인 결과(데스크톱/모바일 스크린샷 파일명)를 커밋 메시지 본문 또는 PR 설명에 적습니다.
