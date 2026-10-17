# Codex r3 — r2 리뷰 수정 · 2026-10-17

기준 소스: r2 `6401e01`. 요청 문서: [CODEX_R2_REVIEW_2026-10-17.md](CODEX_R2_REVIEW_2026-10-17.md). 이전 A/B 작업 결과는 [r2 보고](CODEX_COMPLETION_2026-10-17.md)에 유지합니다.

## 반영한 변경

| 리뷰 | 수정과 확인 |
| --- | --- |
| R2-1 | `rebuildStoryDraftFromBook`이 책의 `storyInput`, `worldSettingsSnapshot`, `textGenerationSettings`, `readingLevelSnapshot`, `pagination`에서 재편집 초안을 복원합니다. `syncStoryDraft`가 편집한 쪽 글·장면·의상·구도를 병합하므로 r2의 작은 확정 헤더도 다시 열립니다. 확정 작업의 중복 본문 정리는 유지합니다. |
| R2-2 | `reading-messages.js`의 설명 함수를 `reading-ui.js`에서 export하고 읽기·사건·풍부함·연결 패널이 공유합니다. 문장 수는 ‘한글 문장 수 3 (허용 1~2)’처럼, 어휘 비율은 백분율로 표시합니다. 알 수 없는 코드는 실제/허용 값으로 설명합니다. |
| R2-3 | `storageBlocked`를 모든 부모 화면의 예외 상태로 취급하고 상태 칩에 ‘기존 데이터 보호 중’을 표시합니다. 원본 보호와 복구 화면으로 보내는 접근 가드는 유지합니다. |
| R2-4 | 탭 저장이 담당하는 네 폼만 미저장 추적합니다. 엔진 비교·화풍 금칙어·World 배리에이션·독립 어휘 관리 입력은 추적에서 제외합니다. SR 숫자만 입력할 때는 탭을 막지 않고, 추천 단계 적용으로 기본 영어 단계가 바뀌면 저장할 변경으로 추적하며 탭 이동에도 추천과 점수를 보존합니다. World 자체 저장 후 표시가 해제되는 것도 확인했습니다. |
| R2-5 | 아이 모드 표지는 리더만 열고, 카드의 ‘읽어줘’ 버튼만 자동 재생합니다. 리더 내부의 명시적 재생 버튼과 하루 열람 제한은 유지합니다. |
| R2-6 | 토스트의 문구 정규식 추론을 제거했습니다. 키 누락 오류에 `code: credential_missing`, `engine`, `credentialKind`를 넣고 해당 공급자의 글/그림 설정으로 안내합니다. 행동 버튼은 6초간 표시하며, 이미 선택된 엔진에 불필요한 변경 이벤트를 보내지 않습니다. |
| R2-7 | 저장 전에는 현재 state를 직렬화한 크기로 추정하고 ‘저장 전 추정’을 표시합니다. 저장 후에는 실제 보관 문자열을 기준으로 계산합니다. |
| R2-8 | 진행 중 refresh의 성공·실패 모두에서 명시적 push/pull을 이어 실행합니다. 네트워크 오류와 refresh Promise 거부 뒤에도 push가 수행되는 회귀 테스트를 추가했습니다. |
| R2-9 | 직접 참조 Blob 캐시를 64MiB·최대 1,000항목의 LRU로 제한합니다. 클라우드/파일 라이브러리 교체와 계정 잠금에서 비우며, 교체 전에 시작한 fetch가 옛 Blob을 다시 캐시하지 못하게 세대 번호를 검사합니다. |
| R2-10 | 과거의 빈 쪽 책과 HTTP(S) 그림 주소를 시작 검사에서 허용합니다. 잘못된 주소·본문·식별자 등은 각각 다른 사유로 안내하고, 분리한 원본은 저장할 때도 보존합니다. |

서비스 워커: `donghwa-shell-v21`. DB 스키마·마이그레이션·운영 사용자 데이터는 변경하지 않았습니다.

## 검증

- `npm test`: **426개 통과**(r2 418개 + 회귀 8개).
- `npm run test:quality`: **40개 통과**. 합계 **466개**.
- `npm run build`: 품질 JS 동기화와 Sites Worker 빌드 통과.
- `tests/browser-r1.py`: 1280×900 / 390×900 기본 제작·설정·리더·새로고침·아이 모드 흐름 통과.
- `tests/browser-r3.py`: 같은 두 크기에서 확정 → 복사본 → 쪽 글 수정 → 이야기 재편집, 읽기 경고 설명, 독립 설정 저장, World 자체 저장, 아이 모드 무음 열기/명시적 재생 검증. 로그인·보호 상태의 재료/설정 카드는 테스트 라우트에만 추가한 렌더러 진입점으로 확인했습니다. 실제 보호 상태의 메뉴는 복구 화면으로 안내합니다.
- `tests/browser-r1-extra.py`: 비교 요청 3개 중단, Google 참조 축소·캐시, PIN 검증 후 금고 복구 검증 통과.
- r2 원본의 재편집 예외와 `[object Object]` 표시를 두 화면 크기에서 재현했고, 전후 화면과 로그를 ZIP의 `QA/`에 포함합니다. `QA/comparison.html`로 비교할 수 있습니다.
- 유료 API 호출·증류·실사용자 클라우드 자료 조작 없이 검사했습니다. 기기 음성은 브라우저 스텁으로 재생 경로를 검증했으며 실제 iOS 음성·물리 키보드는 별도 확인 범위입니다.

## 전달·배포

공개 주소: https://donghwa-workshop.seoulsemitec-3654.chatgpt.site

ZIP의 `SOURCE_COMMIT.txt`와 `SOURCE_MANIFEST.sha256`에 정확한 소스 커밋과 파일 해시를 기록합니다. 운영 배포의 최종 결과는 `QA/deployment.json`에 포함합니다. 압축본에는 API 키·배포 토큰·사용자 DB·`.git`·`node_modules`를 넣지 않습니다.

Claude Code는 [시작 안내](CLAUDE_CODE_START_HERE.md)와 `CLAUDE.md`를 읽고 r3를 기준으로 이어 개발하면 됩니다. 소스의 루트 `dist/`는 편집 대상이며, `cloud-runtime/public`·`cloud-runtime/dist`는 생성물입니다.
