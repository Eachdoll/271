# Codex r3 검토 결과 · 2026-10-17

검토 대상: `donghwa-workshop-codex-r3-2026-10-17.zip`(SOURCE_COMMIT `c4856ab`), `CODEX_R3_COMPLETION_2026-10-17.md`.
검토 방법: 매니페스트 해시 검증, `npm test`(426) · `npm run test:quality`(40) 재실행, r2 대비 실질 diff 973줄 전부 읽음, Chromium 1280×900/390×844 전체 흐름 구동(`pageerror` 0), r2 검토에서 지적한 항목별 브라우저 재현.

## 판정: 통과. 추가 수정 요청 없음.

| 항목 | 재현 결과 |
| --- | --- |
| R2-1 복사본 재다듬기 예외 | 확정 → 복사본 → `이야기 글 다시 다듬기`에서 작업 창이 3단계(쪽 나누기)로 정상 열림. `rebuildStoryDraftFromBook`이 책의 `storyInput`·`worldSettingsSnapshot`·`pagination`·`textGenerationSettings`·`readingLevelSnapshot`에서 초안을 복원하고 `syncStoryDraft`가 이를 재사용. 회귀 테스트 `story-review-ui`에 추가됨. |
| R2-2 `[object Object]` | 검사 패널이 "한글 문장 수 3 (허용 1~2)", "영어 등급 외 어휘 비율 40% (최대 15%)"로 표시. 새 `reading-messages.js`를 `checker.js`·`checks-panel.js`·`reading-ui.js`가 공유. |
| R2-3 데이터 보호 안내 | `storageBlocked`가 예외 상태로 포함되고 상태 칩이 "기존 데이터 보호 중" 표시. |
| R2-4 설정 더티 표시 | 엔진 비교 프롬프트 입력 후에도 탭 점이 꺼져 있고 상태는 "저장된 설정을 보고 있어요." 추적은 4개 폼으로 한정, SR 렉사일은 추천 적용 시에만 추적. |
| R2-5 아이 모드 자동 재생 | 표지 탭은 리더만 열고(상태 "재생 버튼을 누르면…", `speechSynthesis` 미동작), `읽어줘` 버튼만 재생을 시도함. 헤드리스 환경에는 음성이 없어 실제 발화는 실기기 확인 범위. |
| R2-6 토스트 추론 | 정규식 제거. `missingCredentialError`(`code: credential_missing`, `engine`, `credentialKind`)를 글·그림 파이프라인·설정 UI가 던지고 `credentialToastAction`이 버튼을 붙임. 6초 노출. |
| R2-7 저장 공간 0.00 MB | 저장 전에는 현재 state 직렬화 크기로 추정(테스트 포함). |
| R2-8 refresh 실패 전파 | `operation.then(run, run)`. 네트워크 오류·거부 뒤 push 실행 회귀 테스트 2건. |
| R2-9 Blob 캐시 | 64MiB·1,000개 LRU, 라이브러리 교체·계정 잠금·아이 모드 전환 시 비움, 세대 번호로 늦은 fetch 차단. |
| R2-10 시작 검사 완화 | 빈 쪽 책·HTTP(S) 그림 주소 허용, 분리 사유 구분, 원본 보존. |

## 참고

- 서비스 워커 `donghwa-shell-v21`, 새 모듈 2개가 프리캐시 목록에 포함됨.
- `QA/deployment.json`: r3는 2026-10-17 05:16 UTC에 운영 사이트에 배포됨(`succeeded`). r2의 두 회귀는 운영에서도 해소됨.
- 남은 미확인 범위는 Codex 보고와 동일: 실제 유료 모델 품질·청구액, iOS Safari 실기기 음성·가상 키보드.
- 다음 작업은 `CODEX_WORK_ORDER_2026-10-17.md`의 범위를 벗어난 새 요구사항이 생길 때 새 지시서로 진행하면 됨. 현재 r3가 기준 소스.
