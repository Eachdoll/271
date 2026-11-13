# AGENTS.md (Codex / AI 에이전트용 안내)

## 구조
- `worker.mjs` — 운영 Worker의 REST API, 인증, 부서별 업무 규칙. 요청마다 D1/R2 바인딩을 사용합니다.
- `storage.mjs` — 비동기 D1 쿼리 어댑터. 쿼리 결과를 사용하기 전에 반드시 await 하세요.
- `drizzle/` — 순서대로 적용하는 D1 스키마 마이그레이션. 적용한 SQL/저널은 수정하지 마세요.
- `.openai/hosting.json` — 기존 Sites ID와 D1/R2 선언. ID와 공유 범위를 유지하세요.
- `server.js`, `local.mjs` — 로컬 Node.js HTTP 서버 및 SQLite/사진 어댑터. 운영 번들에는 포함하지 않습니다.
- `scripts/build.mjs` — `dist/server/index.js`에 Worker 및 public 파일을 묶는 의존성 없는 빌드.
- `public/index.html` — 단일 페이지.
- `public/forms.js` — 분석/개발/샘플 의뢰 양식 정의. `core: true`만 서버 컬럼이고 나머지는 requests.data JSON입니다.
- `public/app.js` — 해시 라우트, 업무 화면, 관리자 백업.
- `public/style.css` — CSS 변수 기반, 다크모드 지원.
- `test/api.test.js`, `test/worker.test.mjs` — 기존 업무 및 Worker/스토리지 통합 검증.

## 규칙
- 외부 패키지를 추가하지 마세요. Workers에서는 fs, node:sqlite, Node HTTP 서버를 사용할 수 없습니다.
- 의뢰 상태: pending → waiting → progress → done, 반려는 rejected.
- 승인/반려/상태변경 권한: analysis=quality, development=dev, sample=production.
- 발주 입고 상태 recv_status: 빈 값(미입고), ok(초록), mismatch(빨강, recv_qty 필수), checking(노랑).
- 생산일정 period: day/week(월요일로 정규화)/month(1일로 정규화).
- 사용자 입력은 화면에 넣기 전에 반드시 esc()로 이스케이프하세요.
- D1 prepare마다 한 문장만 사용하고 다중 쿼리는 batch를 사용하세요. 요청 처리 중 DDL을 실행하지 마세요.
- 운영 시간은 Asia/Seoul입니다. 클라우드 호스트의 UTC 기본값에 의존하지 마세요.
- 사진은 R2 비공개 객체로 저장하며 다운로드에도 앱 인증이 필요합니다.
- 초대코드 등 비밀 값은 Sites 환경변수로 설정하며 소스/번들/manifest에는 넣지 마세요.
- 기존 SQLite 데이터 이관은 별도 작업입니다. 기존 파일을 삭제하거나 계정을 자동 덮어쓰지 마세요.

## 확인
```bash
npm test
npm run build
INVITE_CODE=local-test-code npm start
```

후속 배포는 DEPLOY.md를 따르세요. GitHub 푸시와 Sites 배포는 별개입니다.

## 구매·물류 필드
- purchase_orders.item_category: 제품/상품/원자재/부자재. 기존 기록의 빈 값은 미분류로 표시합니다. 새 등록에는 분류가 필요합니다.
- purchase_orders.coa_requested: 정수 0/1. 브라우저 체크박스의 배열 값도 서버에서 명시적으로 변환합니다.
- other_receipts: 발주 없는 기타입고. 수정/삭제 권한은 등록자·logistics·관리자입니다. 백업 대상에 포함합니다.
- shipments.lot: 선택 입력, 최대 100자.
- HTTPS 세션 쿠키는 wpa_sid, HttpOnly/Secure/SameSite=None/Partitioned입니다. Sites의 포함 화면에서 로그인 상태가 끊기지 않도록 정책을 유지하세요.

## 입고 → 분석 자동 등록
- 발주입고는 recv_status=ok로 처리할 때만, 기타입고는 POST 등록 시 analysis/waiting/수입검사를 자동 생성합니다.
- receiptAnalysisQuery()가 원본 스냅샷과 Q 접수번호를 만들고 입고 쓰기와 D1 batch로 원자적으로 저장합니다.
- requests(source_type, source_id)의 UNIQUE 인덱스가 중복을 막습니다. source_type은 purchase_order/other_receipt입니다.
- 입고 재확인은 기존 분석 상태·결과를 초기화하지 않습니다. 원본 수정·삭제도 이미 생성한 분석 이력을 덮어쓰거나 삭제하지 않습니다.
- 자동 분석의 상태/결과 변경 권한은 기존 quality/관리자 규칙을 유지합니다. 수동 분석의뢰 승인 절차도 유지합니다.

## BOM·공통 첨부
- BOM 생성/수정/사용 중지는 관리자만 가능합니다. 로그인 사용자는 active BOM을 조회할 수 있습니다.
- boms.materials는 자재명/분류/기준 사용량/단위 배열입니다. schedules.bom_snapshot은 등록 당시 기준과 서버가 계산한 소요량을 보관합니다.
- 기존 생산일정은 원래 BOM이 수정/사용 중지되어도 스냅샷을 유지합니다. BOM 사용 중지는 삭제가 아닙니다.
- attachments는 request(개발/샘플만), purchase_order, other_receipt, shipment별 최대 10장 사진과 수동 판정/메모를 저장합니다.
- 사진은 savePhotos()로 R2에 저장하고 권한은 attachmentEntity()에서 검사합니다. revision으로 오래된 저장이 다른 사진을 덮어쓰지 않게 합니다.
- 개발/샘플 사진 수정 권한은 기존 의뢰 수정 권한과 같습니다. 출하/기타입고는 등록자·물류·관리자, 발주입고는 기존 입고 처리 권한을 따릅니다.
- 원본 입고 삭제 시 연결된 분석 이력이 있으면 첨부도 보존합니다. 분석 상세는 원본 입고 첨부 API로 사진·판정을 조회합니다.
- 백업 대상에 boms/attachments를 포함하고 첨부 사진도 전체 백업에 포함합니다.

## BOM 품목 분류·입고 탭·입력자
- boms.item_category는 품목 자체의 원자재/부자재/제품/상품 분류입니다. materials의 자재 분류와 다릅니다.
- 제품 BOM은 구성자재가 필요하며 다른 분류는 빈 materials 배열로 입고용 품목을 등록할 수 있습니다.
- 새 other_receipts는 활성 BOM 선택이 필수입니다. 품목명·분류·단위는 서버가 BOM에서 가져오고 bom_snapshot에 보존합니다.
- 같은 BOM으로 입고를 수정할 때는 저장 당시 스냅샷을 유지합니다. 기존 수기 입고는 별도 이관 없이 수정할 수 있습니다.
- 물류 내 입고목록은 발주입고/기타입고 탭으로 통합했습니다. 이전 해시 주소는 탭별 진입점으로 유지하세요.
- showInputAuthors()가 동적으로 열린 폼까지 입력자 표시를 추가합니다. 수정 폼의 data-entry-author에는 최초 입력자를 지정합니다.
- 업무 기록의 created_by/requester_name/recv_by는 인증 세션에서 가져오며 클라이언트가 지정한 작성자 이름을 신뢰하지 마세요.

## 리포트
- reports.mjs: GET /api/reports의 읽기 전용 집계. public/reports.js: SVG 차트·필터·CSV·인쇄 화면.
- 빌드에 서버 reports.mjs와 정적 reports.js를 함께 포함하세요. 초기 HTML의 script 경로가 모두 배포되어야 합니다.
- 분석 지표는 등록기간별 현재 상태를 집계합니다. 완료 발생일 기준 실적으로 바꾸어 설명하지 마세요.
- 생산은 선택한 schedules.period 하나만 집계하고 시작일 기준 계획/완료 체크 수량을 표시합니다. 서로 겹치는 일/주/월 계획을 합산하지 마세요.
- 입고는 ok/mismatch의 recv_qty 및 기타입고 수량을 사용합니다. 반복 ok 처리는 기존 입고 일자/처리자/수량을 유지합니다.
- 수량은 단위별로 나눕니다. 단위가 없는 기록은 품목별로 분리하며 분류를 임의로 추정하지 않습니다.
- reports.js의 조회 폼은 data-read-only로 표시하여 등록 폼의 입력자 표시와 구분합니다.

## 목록 필터
- applyListKeyword()로 SQL 바인딩과 LIKE 특수문자 이스케이프를 공통 처리합니다. 검색어는 최대 200자입니다.
- applyListDates()로 실제 날짜/역전 기간을 검증합니다. 의뢰는 created_at 날짜, 발주는 due_date, 입출고/세탁은 각 업무일 기준입니다.
- 생산 GET /api/schedules는 기존 기간 겹침 조건에 q/done/period를 결합합니다. 일/주/월 구간 의미를 바꾸지 마세요.
- 사진 검수는 applyInspectionFilter()로 unchecked/normal/abnormal 조건을 적용합니다.
- 화면의 listControls()/bindListControls()는 읽기 전용 필터 폼, 검색/초기화/건수를 공통 처리합니다.
- 페이지별 queryVersion 검사로 오래된 응답이 새 결과나 발주입고 선택 데이터를 덮어쓰지 않게 합니다.
