# Codex r2 검토 결과 · 2026-10-17

검토 대상: `donghwa-workshop-codex-r2-2026-10-17.zip`(SOURCE_COMMIT `6401e01`), `CODEX_COMPLETION_2026-10-17.md`.
검토 방법: 압축본을 새 폴더에 풀어 `SOURCE_MANIFEST.sha256` 373개 파일 해시 검증, `npm test`(418) · `npm run test:quality`(40) 재실행, Chromium 1280×900/390×844에서 책장 → 재료 → 설정 3탭 → 만들기 4단계 → 데모 전 단계 → 편집 → 확정 → 상세 → 리더 → 아이 모드 구동(`pageerror` 0), r1을 같은 Prettier 3.3.3로 정형화한 뒤 r2와 실질 diff(약 5,600줄)를 파일별로 읽음. 추가로 "확정한 책 → 복사본으로 수정 → 이야기 글 다시 다듬기" 시나리오를 별도 실행.

## 1. 판정

- 보고서의 주장(테스트 수, 빌드, 브라우저 흐름, 파일 무결성)은 **모두 재현됨**. A-1~A-18, B-1~B-12 모두 코드에 반영되어 있고 핵심 동작은 diff로 확인함.
- 다만 **사용자에게 바로 보이는 결함 2건(R2-1, R2-2)** 과 설계상 재검토가 필요한 항목이 있어 r3 수정이 필요함.
- `QA/deployment.json`에 따르면 r2는 2026-10-17 03:58 UTC에 **운영 사이트에 이미 배포됨**(`status: succeeded`). 아래 R2-1·R2-2는 현재 운영 화면에도 그대로 나타나므로 r3는 빠르게 진행하는 것이 좋음.

## 2. r3에서 고칠 결함 (우선순위 순)

### R2-1. [HIGH · 회귀] 확정한 책을 "복사본으로 그림·글 수정" 뒤 "이야기 글 다시 다듬기"를 누르면 예외
- 재현: 데모로 책 확정 → 상세에서 `복사본으로 그림·글 수정` → 편집 화면에서 `이야기 글 다시 다듬기`.
- 결과: `TypeError: Cannot read properties of undefined (reading 'imageEngine')` at `dist/story-generation/ui.js` `header()`(`s.draft.worldSnapshot.imageEngine`) ← `renderProse` ← `renderSession`. 작업 창이 열리지 않음.
- 원인: A-5의 `finalizeBookRecords`(`dist/finalize-cleanup.js`)가 확정 초안을 `{id,bookId,stage,input,wizard,usage,updatedAt}`로 줄이면서 `worldSnapshot`·`pagination`·`sceneBriefs`·`textSettings`·`readingLevels`·`demo`·`titleIndex` 등 재개에 필요한 필드를 모두 버림. `app.js`의 `revise-book-copy`가 그 헤더를 `structuredClone`해 `stage:'paged'`로 두고 `syncStoryDraft(draft,state)`를 호출하지만, `syncStoryDraft`는 `outline/prose/sceneBriefs/pictureBook`만 채우고 `pagination`은 **기존 `d.pagination`이 있을 때만** 갱신하므로 `pagination`·`worldSnapshot`은 여전히 없음.
- 지시: 둘 중 하나로 통일.
  1. `finalizeBookRecords`가 재개에 필요한 최소 필드를 유지: `worldSnapshot`, `textSettings`, `readingLevels`, `demo`, `titleIndex`, `selectedTitle`, `pagination`(쪽 글은 책에 있으므로 `pages[].scene/staging/variantByCharacter/beatIndex`만), `sceneBriefs`. `pictureBook`·`prose`·`snapshots`·`pageCoherence`만 버림(용량의 대부분).
  2. 또는 `revise-book-copy`에서 복사본 초안을 **책에서 완전히 재구성**하는 `rebuildStoryDraftFromBook(book, state)`를 `ui.js`에 추가(`book.outline/prose/pagination/sceneBriefs/worldSettingsSnapshot/textGenerationSettings/readingLevelSnapshot/storyInput` 사용).
- 수용 기준: `tests/story-review-ui.test.mjs`에 "확정 뒤 헤더만 남은 초안 → 복사본 → `resumeStoryDraft`가 `pages` 모드로 열리고 `worldSnapshot`·`pagination`이 존재"를 추가. 브라우저 시나리오(위 재현)에 `pageerror` 0.

### R2-2. [HIGH · 표시 결함] 검사 결과 패널의 읽기 항목이 "확인 권장 · [object Object]"로 표시됨
- 위치: `dist/checks-panel.js` `collectBookChecks()` — `[...page.ko.violations, ...page.en.violations].map(v => v.message || v)`.
- 원인: 읽기 검사 위반 객체(`dist/reading-checker.js` `violations()`)는 `{code, language, actual, expected}` 형태이고 `message`가 없음. 기존 `reading-ui.js`는 코드를 한글 문장으로 바꾸는 포매터로 표시함.
- 지시: `reading-ui.js`의 위반 설명 포매터(코드→문장, 예 `sentence-count` → "한글 문장 수 3 (허용 1~2)")를 export해 `checks-panel.js`에서 재사용. 포매터가 없는 코드는 `"${code} · 실제 ${actual} / 허용 ${expected}"` 형식으로 표시. 사건·풍부함·연결 항목도 `message`가 없는 경우 같은 규칙 적용.
- 수용 기준: `tests/checks-panel.test.mjs`에 `{code:'sentence-count',language:'ko',actual:3,expected:{min:1,max:2}}` 입력 시 출력에 `[object Object]`가 없고 한글 설명이 포함되는지 검사. 데모 편집 화면 스크린샷 첨부.

### R2-3. [MEDIUM] 데이터 보호 모드(`storageBlocked`) 안내가 책장 밖·로그인 상태에서 사라짐
- 위치: `dist/app.js` `renderStatusStrip()` — 예외 표시 조건이 `conflict`/`account-changed` 또는 (책장 && 미로그인·오류)뿐임.
- 문제: 저장 데이터를 읽지 못해 원본을 보호 중일 때(`storageBlocked`) 로그인 상태이거나 다른 화면이면 "기존 데이터 보호 중 · 읽지 못한 원본 파일 보관" 카드가 전혀 보이지 않음. r1에서는 모든 화면에 표시됐음.
- 지시: `storageBlocked`를 `exceptional` 조건에 포함하고, 이때는 상태 칩 문구도 "기존 데이터 보호 중"으로 바꿈.
- 수용 기준: `readStoredLibrary`가 `blocked`를 돌려주는 상태로 재료·설정 화면을 열어도 카드가 보임(브라우저 시나리오).

### R2-4. [MEDIUM] 설정 탭 '저장 안 됨' 표시가 자체 저장 버튼을 가진 패널에도 붙고, 사라지지 않음
- 위치: `dist/app.js` `rememberSettingsInputs()`·`saveSettingsTab()`·하단 `submit` 리스너.
- 문제: `.settings-tab-content` 안의 모든 입력을 더티로 기록하지만, 탭 저장은 `settings-form`·`text-engine-form`·`story-quality-form`·`ig-world-form` 4개만 제출함. World 배리에이션, 화풍 작업실(`style-forbidden-form`), 엔진 비교 프롬프트, SR 렉사일 입력(즉시 적용 버튼) 등 **자체 버튼으로 저장하는 패널**은 저장해도 점이 남고, 입력만 해도 `canApplyRemote()`가 false가 되어 클라우드 자동 불러오기가 멈춤.
- 지시: (1) 더티 추적을 4개 폼 내부 입력으로 한정하거나, 각 패널이 `data-settings-form="own"`을 선언하면 추적에서 제외. (2) 자체 저장 버튼의 성공 경로에서 해당 패널의 점을 지우는 공용 함수 `markSettingsPanelSaved(panelId)`를 `app.js`가 제공하고 `style-studio.js`·`world-variations.js`·`reading-ui.js`가 호출. (3) `canApplyRemote`는 4개 폼의 더티만 본다.
- 수용 기준: 비교 프롬프트에 글자를 입력해도 탭 점이 켜지지 않고, World 이름을 바꿔 자체 저장하면 점이 꺼짐.

### R2-5. [MEDIUM] 아이 모드에서 표지를 누르면 읽어주기가 자동 시작됨
- 위치: `dist/app.js` `open-book` 핸들러의 `if (childMode) { startReading(activeBook); ... void speak(reader.lastLanguage); }`.
- 문제: 지시서 B-7은 "읽어줘 큰 버튼"으로 리더를 여는 것이었고, README는 손 넘김·스와이프가 재생을 시작하지 않는다고 명시함. 표지 탭만으로 음성이 나가면 부모가 의도하지 않은 소리가 나고, 기기 음성(`speechSynthesis`)에서는 첫 발화가 끊기기도 함. 또한 `startReading`이 하루 읽기 횟수를 즉시 올림.
- 지시: 표지 탭은 리더만 열고(재생 없음), 카드의 `읽어줘` 버튼(`data-action="read-book"`)만 리더를 연 뒤 자동 재생. 리더 안 "읽어주기" 버튼은 그대로.
- 수용 기준: 브라우저에서 아이 모드 표지 클릭 후 `#reader-status` 문구가 "재생 버튼을 누르면…"인지, `읽어줘` 클릭 후에는 재생 상태인지 확인.

### R2-6. [LOW] `toast()`의 자동 행동 버튼 추론이 정규식에 의존함
- 위치: `dist/app.js` `toast(message,{action})` — `/키|인증/`과 `/없|필요|입력|확인|…/` 매칭으로 "키 등록하기" 버튼을 붙임.
- 문제: "키"가 들어가는 무관한 문구(예: 향후 추가될 "쿠키", "스키" 등)에 버튼이 붙을 수 있고, 어떤 엔진의 키인지(글/그림) 추정이 틀릴 수 있음. 12초 노출도 길다.
- 지시: 추론을 제거하고, 키 누락을 아는 호출 지점(`getCredential` 실패, `comparisonConfig`, `engineFor`)에서 `toast(message,{action:{label,run}})`을 명시적으로 전달. 오류 객체에 `code:'credential_missing'`과 `engine`을 실어 매핑.

### R2-7. [LOW] 저장 공간 패널이 첫 저장 전에는 "0.00 MB"
- 위치: `dist/finalize-cleanup.js` `estimateLibraryStorage(storage,key)` — `localStorage` 항목이 없으면 0.
- 지시: 항목이 없으면 `JSON.stringify(state).length*2`로 대체 표시하고 "(저장 전 추정)" 표기.

### R2-8. [LOW] `cloud-sync.js` `execute()`의 refresh 대기 체인이 refresh 실패를 push/pull 실패로 전파
- 위치: `if (operation && kind !== "refresh" && operationKind === "refresh") return operation.then(() => execute(...))`.
- 지시: `operation.then(run, run)` 형태로 refresh의 실패와 무관하게 요청을 실행. 테스트: refresh가 NETWORK_ERROR로 끝난 직후의 명시적 push가 실행되는지.

### R2-9. [LOW] `output.js` `directBlobCache`가 모듈 수명 동안 Blob을 최대 1000개 보관
- 지시: 캐시를 `WeakRef` 또는 크기 합계(예 64MB) 기준 LRU로 제한하고, 라이브러리 교체(`applyCloudLibrary`·가져오기) 시 비움.

### R2-10. [LOW] `library-storage.js` `validateStoredLibrary`의 책 조건이 과거 데이터에 엄격함
- `pages.length === 0`인 책, `imageUrl`이 `http(s)`인 레코드가 '읽지 못한 항목'으로 분리됨. r1에서는 빈 쪽 책도 책장에 표시됐음.
- 지시: 빈 쪽 책은 허용(렌더는 이미 안전), `imageUrl`은 `https?://`도 허용(가져오기 검증과 동일 규칙으로 맞춤). 분리된 항목은 분리 사유별로 안내 문구를 다르게.

## 3. 확인했고 문제없는 것 (재검토 불필요)

- A-1 Blob 모드 백업·해시 캐시·전송 보류, A-2 구조 검사와 원본 보존 재합침, A-3 `?meta=1`(R2 미접근), A-4 `skipCoherence` 전파, A-6 시드는 `commitSceneResult`만 기록, A-7 `keptReferences`, A-8 Google 참조 축소·18MB 한도, A-9 유료 엔진 자동 재생성 제거와 책 단위 확인(중지 시 `AbortError` 처리 포함), A-10 비교 중단·시트 확정 try/catch, A-11 refresh 대기·해시 동일 시 baseline 갱신, A-12 다운로드 오류 문구, A-13 인코딩 WeakMap·history 지연 로드(활성 World 시트·마지막 시트·보관 안 된 옷장은 포함), A-14 `resetVault`는 PIN 검증 후에만 노출, A-15 프록시 토큰 `timingSafeEqual`·깊이 제한, A-16 SW v20(`vocab/*.txt`는 런타임에 가져오지 않음 확인), A-17 부분 갱신과 포커스 보존, A-18 포매팅.
- B-1~B-12는 스크린샷(`QA/`)과 직접 구동으로 확인. 모바일 바텀 시트, 아이 모드 격자·`읽어줘`, 리더 글자 크기, 4단계 마법사, 설정 3탭은 의도대로 동작.
- `/api/cloud/session` 404는 정적 미리보기의 정상 동작.

## 4. r3 전달 형식

`CODEX_WORK_ORDER_2026-10-17.md` 0절 규칙을 그대로 적용. 항목 번호(R2-n)를 커밋 메시지에 적고, R2-1·R2-2는 브라우저 재현 스크린샷(수정 전/후)을 `QA/`에 포함. 운영 배포는 R2-1·R2-2 수정 뒤에 다시 수행.
