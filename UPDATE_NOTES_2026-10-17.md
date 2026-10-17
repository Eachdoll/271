# 2026-10-17 안정성·효율·가독성 개선 노트

이 문서는 2026-10-17 패키지(`SOURCE_COMMIT.txt` 기준)에 적용한 변경을 정리합니다. 검증은 `npm test`(392개) · `npm run test:quality`(40개)와 Playwright로 데스크톱(1280px)·모바일(390px) 화면을 실제로 구동해 확인했습니다. 유료 API 호출은 실행하지 않았습니다.

## 1. 오류가 나지 않게 · 데이터를 잃지 않게

| 위치 | 문제 | 조치 |
| --- | --- | --- |
| `dist/app.js` | 쪽이 없는 책(가져오기·구버전)이 있으면 책장 전체 렌더가 중단됨 | `illustration/cover/bookCard`가 빈 쪽 배열을 안전하게 처리 |
| `dist/app.js` | 삭제·동기화로 사라진 책 id를 가진 버튼(즐겨찾기·종이로 읽음·열기)을 누르면 예외 | id 조회 실패 시 안내 후 중단 |
| `dist/app.js` | 리더·마법사 버튼이 닫힌 뒤 늦게 눌리면 예외 | `reader`/`wizard` 존재 확인 |
| `dist/app.js` | `Map.groupBy`(Safari 17.4 미만 없음), `crypto.randomUUID`(http LAN 주소에서 없음)로 구동 불가 | 기기 내 대체 구현 추가 |
| `dist/app.js` | PIN 변경이 원자적이지 않아 라이브러리 저장 실패 시 부모 모드 영구 잠금 | PIN 해시를 먼저 저장하고 금고 재암호화 실패 시 되돌림. 기존 PIN이 맞는데 금고만 문제면 부모 모드는 열고 경고 표시 |
| `dist/story-generation/ui.js` | 이미 선택된 장소·감정 칩을 다시 누르면 유료로 만든 장면·전문·쪽 나누기 결과가 삭제됨 | 줄거리 내용이 실제로 바뀐 경우에만 무효화 |
| `dist/story-generation/ui.js` | 제목 후보만 고쳐도 전문·쪽 나누기 결과가 삭제됨 | 제목 후보를 제외한 내용으로 변경 여부 판단, `refrain`의 추가 키(variation) 보존 |
| `dist/story-generation/ui.js` | 쪽 수 다시 나누기가 실패·중지되면 목표 쪽 수만 바뀌어 승인 불가 상태로 고정 | 성공한 뒤에만 목표 쪽 수 반영 |
| `dist/story-generation/ui.js` | 전문 문단 분할이 파이프라인과 달라 문단 인덱스가 어긋날 수 있음 | 파이프라인과 같은 분할(trim 후 필터) |
| `dist/story-generation/ui.js` | 승인 실패 안내가 스크롤 밖에 표시되어 버튼이 안 눌리는 것처럼 보임 | 안내를 화면 안으로 스크롤하고 토스트로도 표시 |
| `dist/text-generation/providers.js` | JSON 재요청 2회가 한 타이머를 공유해 두 번째 유료 요청이 첫 요청 시간 때문에 중단됨 | 시도마다 대기 시간 재설정 |
| `dist/text-generation/settings-ui.js` | 잘못된 주소 입력 시 브라우저 영어 오류가 그대로 표시 | 한글 안내 |
| `dist/management.js` | FULL AUTO 실행 중 재료 수정·책 삭제를 하면 실행 중 작업이 복제본과 분리되어 진행 상황이 저장되지 않고 재개 시 재결제 | 관리 기능이 건드리지 않는 `fullAutoJobs`·`storyDrafts`의 원본 객체 유지 |
| `dist/image-generation/pipeline.js` | 그림 응답이 도착한 직후 중지하면 결제된 그림을 버리고 재개 때 다시 결제 | 도착한 그림은 저장·기록한 뒤 중지 적용 |
| `dist/image-generation/settings-ui.js` | 스타일 시트 그림이 복원되지 않은 상태면 부모 설정 화면 전체가 열리지 않음 | 참조를 비워 두고 화면은 표시 |
| `dist/image-generation/vault.js` | 손상된 키 기록 하나 때문에 모든 엔진의 키 상태 조회 실패 | 엔진별로 `corrupt` 표시 |
| `dist/cloud-sync.js` | 응답이 멈춘 요청 하나가 재접속 전까지 동기화 전체를 막음 | 요청별 대기 한도(조회 45초·업로드 120초) |
| `server/cloud-api.js` | 저장할 때마다 R2에 스냅샷이 쌓이고 CAS 충돌 시 쓴 객체도 남음 | 성공 후 이전 스냅샷 삭제, 충돌 시 방금 쓴 객체 삭제 |
| `dist/library-storage.js` | 복구용 보관본이 IndexedDB에 무한히 누적 | 최신 3개만 유지 |
| `dist/full-auto-control.js` | 시작 시 클라우드 중지 신호 조회가 멈추면 작업이 시작도 재시작도 안 됨 | 5초 한도 후 로컬 중지만으로 진행 |
| `dist/audio-playback.js` | 데스크톱 Chromium이 15초 이상 발화를 `onend` 없이 끊어 이어 듣기가 멈춤 | 긴 문장은 주기적 pause/resume으로 유지 |
| `dist/sw.js` | 파일 하나가 404면 오프라인 셸 전체 설치 실패, 요청마다 허용 목록 재계산 | 파일별 개별 캐시·허용 목록 1회 계산·캐시 버전 v19 |

## 2. 효율

- `dist/story-generation/richness.js`: 어휘 정규식을 용어별로 한 번만 컴파일(검사 1회당 수천 번 → 캐시).
- `dist/story-generation/pipeline.js`: 단계별 옵션 객체마다 엔진·키 복호화를 한 번만 수행(문단별 풍부화 30~50회 요청에서 반복 제거).
- `dist/story-generation/ui.js`: 아무도 읽지 않는 초안 스냅샷을 종류당 5개 → 2개로 줄여 localStorage 사용량 감소.
- `dist/sw.js`: fetch 핸들러의 허용 경로를 `Set`으로 1회 계산.

## 3. 인터페이스 가독성

- 기본 글자 15px, UI 최소 글자 12px(10px→12px, 11px→13px 등). 표지 그림 안의 작은 글자는 유지.
- 본문·보조 글자색을 WCAG AA(4.5:1 이상)로 어둡게 조정(`--muted`, 125개 색 선언). 주황 버튼은 흰 글자가 읽히도록 `--orange` 조정.
- 한글 어절 단위 줄바꿈(`word-break:keep-all`)과 버튼 줄바꿈 허용. 모바일 난이도 버튼이 글자 중간에서 끊기지 않음.
- 매 화면 상단의 클라우드·기기 보관 카드를 2열 압축 배치, 모바일에서는 2줄로 요약.
- 부모 설정(16개 구역) 상단에 고정 ‘항목 바로가기’ 추가.
- PIN 입력창에 보이는 라벨·자리표시 추가, 입력 포커스 테두리 강화.

## 4. 추가한 테스트

- `tests/service-worker-shell.test.mjs`: 서비스 워커 캐시 목록과 실제 파일의 일치, 개별 캐시 설치.
- `tests/cloud-api.test.mjs`: 이전 스냅샷 정리와 CAS 충돌 시 객체 정리.
- `tests/text-engines.test.mjs`: 시도별 대기 시간 적용(원본 코드에서는 실패, 수정 후 통과).

## 5. 확인했지만 이번에 바꾸지 않은 것

- 클라우드 저장 전 전체 미디어를 base64로 다시 인코딩하는 구조(`output.js createLibraryBackup`)와 시작 시 전체 가져오기 검증. 메모리 사용이 크지만 구조 변경이 커서 별도 작업으로 권장.
- Google 직접 전송의 20MB 인라인 참조 한도, 유사 그림 자동 재생성 기본값(유료 엔진에서 쪽당 1회 추가 과금), 엔진 3개 비교의 중지 불가. 정책 판단이 필요해 그대로 두었습니다.
- 정적 미리보기에서 `/api/cloud/session` 404 콘솔 메시지는 정상 동작입니다.
