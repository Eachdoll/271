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
- 의뢰 승인/반려 권한: analysis=quality_approver(품질책임자), development=dev_approver(개발책임자), sample=production. 관리자도 승인할 수 있습니다.
- 일반 상태/결과 변경 등 업무 권한: analysis=quality, development=dev, sample=production. quality_approver/dev_approver는 각각 팀 업무 권한도 포함합니다. 일반 quality/dev를 승인권자로 자동 승격하지 마세요.
- 책임자 역할은 가입 승인된 사용자에게만 관리자가 지정합니다. GET /api/approval-managers는 지정된 승인권자 id/이름만 로그인 사용자에게 제공합니다.
- 발주 입고 상태 recv_status: 빈 값(미입고), ok(초록), mismatch(빨강, recv_qty 필수), checking(노랑).
- 생산일정 period: day/week(월요일로 정규화)/month(1일로 정규화).
- 사용자 입력은 화면에 넣기 전에 반드시 esc()로 이스케이프하세요.
- D1 prepare마다 한 문장만 사용하고 다중 쿼리는 batch를 사용하세요. 요청 처리 중 DDL을 실행하지 마세요.
- 운영 시간은 Asia/Seoul입니다. 클라우드 호스트의 UTC 기본값에 의존하지 마세요.
- 사진은 R2 비공개 객체로 저장하며 다운로드에도 앱 인증이 필요합니다.
- 초대코드 등 비밀 값은 Sites 환경변수로 설정하며 소스/번들/manifest에는 넣지 마세요.
- 기존 SQLite 데이터 이관은 별도 작업입니다. 기존 파일을 삭제하거나 계정을 자동 덮어쓰지 마세요.

## 화면 버전 관리
- 로그인·가입 화면과 로그인 후 상단에 `버전 15.1` 형식으로 앱 버전을 표시합니다. 단일 원본은 `public/app.js`의 `APP_VERSION`입니다.
- **work-process-app 변경을 커밋할 때마다** 같은 커밋에서 APP_VERSION의 점 뒤 정수를 1 올리세요(15.1 → 15.2 → 15.3). 15.9 다음은 15.10입니다. Sites 소스 동기화용 커밋에서는 다시 올리지 않습니다.
- 버전은 Git 커밋과 함께 관리하는 앱 버전이며 Sites의 배포 버전 번호와 별개입니다. 빌드·재배포만으로 올리지 마세요.
- 화면 버전과 변경 사항을 확인하고 같은 Site에 배포합니다.

## 화면 공통 (15.4)
- GET /api/my-tasks: 내가 승인할 수 있는 대기 건(의뢰 승인권자·production_approver·logistics_approver·관리자만 해당 항목 포함)과 내가 올린 요청(대기 + 최근 7일 반려)을 반환합니다. 대시보드 '내가 처리할 일' 카드와 사이드 메뉴 배지가 사용합니다. 새 승인 흐름을 만들면 여기에도 추가하세요.
- toast(msg,'err')는 닫을 때까지 유지하고 일반 안내는 2.6초 뒤 사라집니다.
- photoPicker()는 파일 선택(교체)과 '바로 촬영'(capture, 이어 붙이기), 미리보기 × 빼기를 제공합니다. 최대 10장 규칙을 유지하세요.
- 700px 이하에서는 table.grid를 카드로 표시합니다. labelGridTables()가 thead 글자를 각 td의 data-label로 붙이므로 새 표도 thead를 갖춘 table.grid로 만드세요. 열이 적은 숫자 요약표는 `keep-table` 클래스로 표 형태를 유지합니다.

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
- 발주입고는 recv_status=ok 또는 mismatch로 처리할 때(수량상이는 실입고 수량 기준), 기타입고는 POST 등록 시 analysis/waiting/수입검사를 자동 생성합니다. checking은 생성하지 않습니다. 수량상이 후 ok로 바뀌어도 분석은 추가로 만들지 않고 처음 스냅샷을 유지합니다.
- 수량상이(mismatch) 항목을 ok로 처리하면 **입고 종결**입니다. recv_qty는 실입고 수량 그대로 유지하고(발주수량으로 덮어쓰지 않음) 남은 수량은 기타입고로 받습니다. 화면에서는 `입고완료 · 90/100 종결`로 표시합니다.
- 입고 수량이 기록된(ok/mismatch) 발주는 /api/po/receive로 바로 바꿀 수 없습니다(409). 허용: ok→ok 재확인, mismatch→ok 종결, 같은 수량 mismatch 재저장. 수량 변경·미입고/확인중 되돌리기는 0009 receipt_qty_changes 요청(POST /api/po/:id/receipt-changes, action=qty|revert)을 logistics_approver(물류팀장) 또는 관리자가 /api/receipt-changes/:id/approve|reject 해야 반영됩니다. 요청자는 /cancel로 철회합니다. 발주당 pending 1건이며 pending 중에는 입고 처리도 막습니다.
- 승인 시 현재 값이 요청 당시와 같은지 확인하고, 발주와 연결된 자동분석 양쪽 progress_comments에 수정 내용을 남깁니다. 자동분석의 입고 스냅샷은 바꾸지 않습니다. 입고 취소 승인 후에도 기존 분석 이력은 남습니다.
- 발주입고 처리는 로그인 사용자 누구나 할 수 있습니다. 상태를 바꿀 때마다 같은 batch에서 progress_comments에 `[입고 처리] 이전 → 이후` 기록(처리자 이름)을 남겨, 나중에 상태가 바뀌어도 처리한 사람이 보존되게 하세요.
- 입고 자동분석을 수정해도 title/customer/qty/sample_qty/spec/lot/lot_etc는 입고 스냅샷으로 유지합니다. 접수대기·반려 의뢰 삭제는 의뢰자 본인·승인권자·관리자만 가능합니다.
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

## 가입 승인
- users.approval_status: pending/approved/rejected. 0005 마이그레이션은 기존 계정을 approved로 보존합니다. 신규 가입은 첫 관리자만 자동 승인하고 나머지는 pending이며 세션을 발급하지 않습니다.
- 관리자 POST /api/admin/users/:id/approval로 승인·반려하고 검토자/시각/사유를 기록합니다. 관리자 계정 반려는 금지하며 반려 시 세션을 삭제합니다. currentUser도 approved를 검사해야 합니다.
- 가입 승인과 업무 의뢰 승인은 별개입니다. 기존 업무 권한 규칙을 유지하세요.

## 진행현황 코멘트
- progress_comments는 entity_type/entity_id별 누적 코멘트입니다. 대상은 purchase_order/request/other_receipt/shipment/schedule/laundry/bom이며 테이블 이름은 COMMENT_TABLES 허용 목록만 사용하세요.
- GET/POST /api/comments/:entity/:id는 승인된 로그인 사용자만 접근합니다. 원본 존재 여부와 사용 중지 BOM 권한을 확인하고 작성자/한국 시각은 서버에서 결정합니다.
- 본문은 1~2,000자, GET은 최신 50건과 next 커서를 반환합니다. before는 양의 정수 ID이며 오래된 기록 방향으로 조회합니다.
- public/comments.js의 공통 창과 commentButton()을 모든 업무 목록에 연결합니다. 클릭 캡처로 행 선택/상세 열기와 충돌하지 않게 하고 모든 사용자 입력은 esc()로 출력하세요.
- 코멘트는 진행상태나 결과 메모를 변경하지 않습니다. 수정/삭제 API 없이 이력을 보존하고 author_id는 사용자 삭제 시 NULL, author_name은 보존합니다. 원본 업무 삭제 시에도 코멘트를 일괄 삭제하지 마세요.
- comments.js를 HTML/로컬 ASSETS/운영 빌드에 포함하고, progress_comments는 관리자 전체 백업 대상입니다.

## VOC
- VOC는 별도 테이블 대신 requests.type=voc로 저장합니다. REQUEST_TYPES.voc=quality, 접수번호 접두어 V, 승인/반려는 quality_approver(품질팀장/품질책임자) 또는 관리자입니다.
- 고객사/제품명/수량(양수)/VOC 내용은 필수이며 data.qty/lot/unit/extra에 저장합니다. LOT는 미확인 시 빈 문자열을 허용합니다. 승인 전에는 intake, 승인 후 waiting/progress/done은 list에 표시합니다.
- 품질 메뉴 #/quality/voc/request 및 #/quality/voc/list는 공통 의뢰 UI를 사용하며 수량·LOT 컬럼, 사진 첨부, request 댓글을 제공합니다.
- VOC 첨부는 entity=request로 기존 권한·R2 검증/제한을 유지합니다. 일반 의뢰자가 접수/반려 상태에 첨부하고 승인 후 품질 담당자가 관리합니다.
- approval-managers의 analysis 승인권자와 VOC 승인권자는 동일한 quality_approver입니다. 기존 승인권자 API 형태는 유지합니다. 기존 분석 리포트에 VOC를 합산하지 마세요.

## 다품목 등록·생산 실적
- public/multi-items.js는 기본 다품목 입력, 품목 메타데이터, 생산실적 창을 제공합니다. 기존 상세 입력은 접힌 양식으로 유지합니다. HTML/ASSETS/빌드에 포함하세요.
- POST /api/batches/:entity는 purchase_order/request/other_receipt/shipment/schedule/laundry를 허용합니다. common+items(1~30개)를 검증한 뒤 item_batches 헤더와 모든 품목·자동분석을 하나의 db.batch로 저장합니다. 클라이언트 request_id와 payload_hash/작성자로 재시도 중복·타인 재사용을 막습니다.
- 각 행은 기존 테이블에 독립 ID를 갖고 batch_id로 묶입니다. spec/unit/lot는 별도 컬럼이며 laundry.item은 옷 종류, requests.qty는 다품목 수량입니다. 이전 기록의 빈 메타데이터는 추정·일괄 덮어쓰지 마세요.
- 기타입고는 각 행별 활성 BOM을 확인하고 단위는 BOM 스냅샷에서 결정합니다. 입고 자동분석에 batch_id/spec/unit/lot/qty도 스냅샷으로 전달하며 기존 자동분석 중복 방지와 트랜잭션을 유지합니다.
- PUT /api/items/:entity/:id로 본인/담당자가 규격·단위·LOT를 정정합니다. 입고 자동분석의 스냅샷과 실적 있는 일정의 품목 정체성·기간·단위는 보호합니다.
- production_actuals는 schedule_id별 날짜/수량의 누적 이력이며 request_id로 중복 쓰기를 막습니다. 계획 기간 안 날짜만 허용합니다. 입력은 일정 등록자/production/관리자, 조회는 로그인 사용자입니다.
- POST /api/schedules/:id/actuals, GET 동경로. 실제 생산량 0은 허용합니다. 오늘(KST) 이후 날짜는 거부합니다. 실적 이력 있는 일정은 삭제 금지입니다. 실적이 있는 일정도 LOT 정정은 허용하고 규격·단위는 잠급니다.
- 입력된 실적의 수정·취소는 바로 반영하지 않습니다(0008 production_actual_changes). POST .../actuals/:actualId/changes(수정: 생산일·수량·메모, 지난 기간 포함) 또는 .../void(취소)는 사유와 함께 pending 요청을 만들고, production_approver(생산팀장) 또는 관리자가 POST /api/actual-changes/:id/approve|reject 해야 반영됩니다. 요청자는 /cancel로 철회합니다. 실적당 pending 요청은 1건(부분 UNIQUE 인덱스)이고 request_id로 재시도 중복을 막습니다.
- 승인은 요청 당시 값(old_*)이 현재 실적과 같을 때만 반영하고, 반영 시 corrected_at/corrected_by(수정) 또는 voided_*(취소)를 남깁니다. 요청 이력은 삭제하지 않으며 백업 대상입니다. production_approver는 production 업무 권한을 포함하지만 일반 production을 승인권자로 승격하지 마세요. GET /api/approval-managers 응답 형태는 그대로 둡니다.
- done은 기존 완료 체크로만 유지하고 실제 생산량으로 이관/간주하지 마세요. actual_qty/actual_count는 취소 제외 실적에서 계산합니다.
- 리포트는 기존 plan_period 하나/계획 시작일 기준을 유지하면서 실제 실적 누적량·차이·달성률을 추가합니다. SUM 상관 서브쿼리로 여러 실적 때문에 계획수량이 중복 합산되지 않도록 하세요. 규격과 단위를 구분합니다.
- item_batches 백업 커서는 id가 아닌 batch_id 문자열입니다. production_actuals 취소 이력과 함께 전체 백업에 포함합니다. 0007 마이그레이션은 기존 완료 체크를 실적으로 자동 변환하지 않습니다.
