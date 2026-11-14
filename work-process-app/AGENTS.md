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

## 재고 현황 (15.5)
- 재고는 저장하지 않고 worker.mjs의 STOCK_MOVEMENTS(UNION ALL)로 계산합니다: 발주입고(ok/mismatch의 recv_qty) + 기타입고 + 생산실적(취소 제외) − 생산 투입(실적 × BOM 스냅샷 자재량 ÷ 기준수량) − 출하 ± stock_adjustments. 재고에 영향을 주는 새 기록 종류를 만들면 여기에 한 줄을 추가하세요.
- 합산 키는 TRIM(품목명)+단위(+규격)입니다. BOM 자재에는 규격이 없으므로 기본 보기는 품목+단위 합계(group=item)이고, group=spec에서는 생산 투입이 규격 없는 줄에 나옵니다. 품목명·단위를 임의로 보정·추정하지 마세요.
- 0010: stock_adjustments(기초재고 opening / 실사 count / 조정 adjust, 추가만 가능·request_id 중복 방지)와 stock_levels(품목+단위별 안전재고). 입력은 logistics_approver(물류팀장)·관리자만, 조회는 로그인 사용자. 실사는 기준일 장부 수량과의 차이를 qty로, 센 수량을 counted_qty로 저장합니다.
- 승인 대기 중인 입고 수정·실적 수정 요청은 재고에 반영하지 않습니다(승인 후 원본이 바뀌면 자동 반영). 미래 기준일은 거부합니다.
- public/stock.js(화면·CSV)를 HTML/local.mjs ASSETS/scripts/build.mjs에 포함하세요. 두 표는 전체 백업 대상이며 stock_levels 백업 커서는 rowid입니다.

## 거래처·제품코드 (15.6)
- 0011: vendors(name, name_key UNIQUE, contact_name, phone)와 boms.is_temp, purchase_orders/shipments.product_code. 기존 행의 product_code는 빈 값으로 두고 추정·일괄 채우기를 하지 마세요.
- 거래처는 로그인 사용자 누구나 등록·수정합니다(삭제는 등록자·관리자). 발주·기타입고·출하에서 쓴 이름은 ensureVendor()가 자동 등록합니다. 기록에는 이름 문자열을 저장하므로 거래처 삭제·개명은 과거 기록을 바꾸지 않습니다.
- 이름 비교는 nameKey()(공백 제거·소문자)로 합니다. GET /api/vendors/recent-items?vendor= 는 그 거래처의 최근 발주 품목(품목·규격·단위별 최신 1건)을 돌려주고, 발주 다품목 양식이 '최근 매입 품목' 버튼으로 보여 줍니다.
- 품목(boms)이 제품코드 원본입니다. 발주·출하는 catalogItem()으로 연결합니다: bom_id 선택 > 같은 이름(공백·대소문자 무시)의 활성 품목 > 없으면 is_temp=1 임시 품목 생성(TMP-0000 형식). 저장되는 품목명은 품목 원본의 이름입니다.
- GET /api/boms는 기본적으로 임시 품목을 제외합니다(생산 BOM 선택용). 품목 선택기는 temp=1, 관리자 목록은 include_archived=1, 정리 대상만은 temp=only.
- 임시 품목 정리는 관리자만: PUT /api/boms/:id로 정식 코드 저장(TMP- 코드는 거부) 또는 POST /api/boms/:id/merge {target_id}로 기존 품목에 합치기. 두 경우 모두 relinkCatalog()가 그 임시 코드를 쓴 발주·출하·기타입고의 품목명/코드를 한 batch로 바꿉니다. 수입검사 스냅샷은 바꾸지 않습니다. 정식 품목의 일반 수정은 과거 기록을 바꾸지 않습니다.
- public/master.js(거래처 화면·선택 도우미)를 HTML/local.mjs ASSETS/scripts/build.mjs에 포함하세요. vendors는 전체 백업 대상입니다. my-tasks는 관리자에게 임시 품목 수(temp_items)를 알려 줍니다.

## 분류·샘플의뢰(상품)·반제품 기록 (15.7)
- 품목 분류는 원자재/부자재/반제품/제품/상품입니다(서버·화면의 ITEM_CATEGORIES 순서 유지). other_receipts 테이블의 CHECK는 기존 4개 분류 그대로이므로 반제품은 기타입고로 받지 않습니다(서버가 400으로 안내). 테이블을 다시 만들어 제약을 바꾸지 마세요.
- 0012: boms.cat1/cat2/cat3(선택, 하위 단계는 상위 단계 필요), production_units(라인 line / 세탁 호기 washer), semi_records(커팅/융착 cut = 라인별, 세탁 wash = 호기별).
- 재고 현황의 분류·제품코드·1~3차 분류는 품목(boms)에 같은 이름이 등록되어 있으면 그 값을 우선합니다. 등록되지 않은 품목은 기록에 있는 분류를 씁니다. 반제품 생산일정 실적은 분류 '반제품'으로 잡습니다.
- requests.type=sample_goods(샘플의뢰(상품)): 접수번호 G, 승인·상태 변경은 purchase 역할 또는 관리자. 기존 sample은 화면 이름만 샘플의뢰(제품)로 바꿨고 규칙은 그대로입니다. 새 의뢰 종류를 만들면 worker의 REQUEST_* 표, forms.js의 REQ, app.js의 PAGES/NAV/canApproveRequest, multi-items.js의 종류 판별을 함께 고치세요.
- 라인·호기는 production 역할/관리자가 추가·이름 변경·사용 중지합니다(삭제 없음). semi_records.unit_name은 입력 당시 이름의 스냅샷입니다.
- 반제품 품목은 worker.mjs와 public/semi.js의 SEMI_PRODUCTS(와이퍼: 부직포와이퍼·천와이퍼 / 심리스글러브: 스무드·타키)입니다. 커팅/융착은 종류 필수, 세탁은 와이퍼/심리스글러브만으로도 기록합니다. 입력은 로그인 사용자, 수정·삭제는 등록자·production·관리자. 미래 작업일은 거부합니다.
- 0013: semi_records.spec. 심리스글러브는 사이즈 XS/S/M/L/XL(SEMI_SIZES), 와이퍼는 인치 규격을 `9인치` 형식으로 저장합니다(semiSpec()이 9, 9인치, 9" 입력을 정규화). 커팅/융착은 필수, 세탁은 선택입니다. 사이즈를 품목 이름이나 코드에 넣지 말고 spec에 두세요.
- 커팅/융착(process='cut') 기록은 STOCK_MOVEMENTS에 반제품 생산으로 들어갑니다(품목명: 부직포와이퍼·천와이퍼·심리스 스무드·심리스 타키, 규격 = spec). 세탁 기록은 같은 물건의 공정이라 재고에 넣지 않습니다. 같은 생산량을 반제품 생산일정 실적에도 입력하면 재고가 이중으로 잡히니 화면 안내를 유지하세요.
- 0014 semi_record_changes: 반제품 기록의 수량·품목·사이즈·단위·작업일·라인 변경과 삭제는 PUT/DELETE /api/semi-records/:id가 사유와 함께 pending 요청을 만들고, production_approver(생산팀장)·관리자가 POST /api/semi-changes/:id/approve|reject 해야 반영됩니다(요청자는 /cancel). LOT·비고만 바뀌면 바로 반영합니다. 기록당 pending 1건, 승인 시 old_data가 현재 기록과 같아야 합니다. my-tasks에 semi_changes가 포함됩니다.
- 샘플의뢰(상품)의 승인자는 purchase 역할(구매 담당자)·관리자로 확정되었습니다.
- 0015/0016: semi_records.defect_qty(불량수량, 기본 0)·workers(생산인원, 정수)·start_time/end_time('HH:MM')·work_hours. **수량(qty)은 양품 수량이고 불량은 따로 셉니다**(총 수량 = 양품 + 불량). 재고에는 qty(양품)만 들어갑니다. work_hours는 시작·종료 시각에서 서버가 계산하며(종료가 시작 이전이면 자정을 넘긴 것으로 +24시간) 직접 입력받지 않습니다. 양품수량·품목·사이즈·단위·작업일·라인 변경과 삭제는 생산팀장 승인 대상이고, 불량수량·시각·생산인원·LOT·비고는 등록자·생산 담당자·관리자가 바로 수정합니다(SEMI_DIRECT_FIELDS).
- 0019: semi_records.break_minutes(휴게, 분). 작업시간 = (종료 − 시작 − 휴게)이며 시각 없이 휴게만 넣으면 0으로 둡니다. production_units.yield_target(라인·호기별 목표 수율, 비우면 기본값). 기본 목표는 settings.semi_yield_target(기본 95)이고 GET/PUT /api/semi-settings로 읽고 생산팀장·관리자만 바꿉니다(브라우저 저장 아님).
- GET /api/alerts(대시보드 '확인이 필요한 일'): 납기 지난 미입고·확인중 발주, 완료 희망일 지난 진행 중 의뢰, 3일 넘은 승인 대기(의뢰·실적·입고·반제품), 최근 7일 라인·호기별 수율 목표 미달, 관리자에게는 마지막 전체 백업 일수. 전체 백업을 내려받으면 POST /api/admin/backup-done이 settings.last_backup_at/by를 기록합니다. 서버 예약 실행으로 자동 백업을 하지는 않습니다(Sites 지원 확인 필요).
- GET /api/semi-wip: 품목·규격·단위별 세탁 대기 = 커팅/융착 양품 누계 − 세탁 처리(양품+불량) 누계. 세탁 화면 상단에 표시합니다.
- 수정 이력: 발주·출하·기타입고·생산일정의 PUT과 PUT /api/items/:entity는 recordEdit()로 바뀐 항목을 `[수정] 항목 이전 → 이후` 진행 코멘트로 남깁니다(EDIT_LABELS). 바뀐 게 없으면 남기지 않습니다. 새 수정 경로를 만들면 여기에 연결하세요.
- 발주·출하는 다품목 양식만 보여 줍니다(기존 단건 양식은 DOM에 남기고 숨김 — 페이지 코드가 참조하므로 지우지 마세요). 단위 입력칸은 suggestUnits()가 yd·매·켤레 등 자동완성을 붙입니다. 원단 자재는 주로 yd입니다.
- 0018 반제품 품목 연결: boms.semi_type(부직포와이퍼/천와이퍼/스무드/타키, 분류가 반제품인 품목만)과 semi_records.bom_id·item_name·product_code·bom_snapshot. 커팅/융착은 그 종류에 등록된 모델이 하나라도 있으면 모델 선택이 필수이고(없는 종류는 종전처럼 종류만), 세탁은 선택입니다. 와이퍼는 모델을 고르면 인치 규격을 생략할 수 있고 심리스는 사이즈가 계속 필수입니다. 모델 변경은 생산팀장 승인 대상입니다.
- 모델이 있는 기록의 재고 품목명은 item_name(스냅샷)이고, bom_snapshot의 구성자재를 (양품+불량) × 자재량 ÷ 기준수량만큼 재고에서 차감합니다(불량도 자재를 씁니다). 품목을 나중에 고쳐도 기록의 스냅샷은 바뀌지 않습니다. 계획 연결(semiCutMatch)과 리포트 품목명(`종류 · 모델`)도 item_name을 우선합니다.
- **반제품 생산일정(schedules.kind='semi')의 실적은 커팅/융착 기록에서 자동 집계**합니다(semiCutMatch: 품목명 공백·대소문자 무시 일치, 계획에 spec이 있으면 같은 spec, 작업일이 계획 기간 안). 반제품 일정에 production_actuals를 새로 입력하는 것은 서버가 400으로 막습니다(이전에 입력된 실적은 그대로 보존·합산). 재고는 커팅/융착 기록에서만 잡히므로 이중 계상되지 않습니다. 완제품 일정은 종전과 같습니다. reports.mjs의 생산 실적 식에도 같은 조건이 들어 있으니 한쪽만 고치지 마세요.
- POST /api/semi-batches: 같은 작업일·라인(호기)의 1~30줄을 한 db.batch로 저장합니다(한 줄이라도 잘못되면 전체 거부, `n번째 줄:` 접두 오류). request_id는 줄마다 `요청번호:순번`으로 저장해 재시도 중복을 막습니다. 화면의 입력 양식은 이 API만 사용합니다.
- 0017 semi_records.defect_reason: SEMI_DEFECT_REASONS(커팅/융착·세탁별 목록, worker.mjs와 public/semi.js에 같이 있음) 중 하나 또는 빈 값. 불량이 0이면 서버가 비웁니다. 바로 수정 가능한 항목입니다.
- 리포트 semi.reasons(공정·단위별 불량 사유 비중, 사유 없음은 '미지정')와 semi.series(집계 단위 × 공정 × 와이퍼/심리스글러브별 수율)를 한 번의 GROUP BY 결과에서 계산합니다. 수율 추이 그래프의 목표 수율은 브라우저 localStorage(semiYieldTarget, 기본 95)에만 저장합니다.
- 리포트의 semi(reports.mjs semiReport, public/semi.js semiReportSection): 작업일 기준 커팅/융착·세탁별 품목별/라인(호기)별/상세 합계와 수율(양품÷(양품+불량))·불량률(불량÷(양품+불량))·인시당 양품(시간과 인원을 모두 입력한 기록만). 단위가 다른 수량은 합치지 않습니다. 리포트 분류 필터에 반제품을 포함합니다.
- 빌드 산출물 검사(test/worker.test.mjs)는 번들 안의 `fs.`·`require(`·`process.env` 문자열을 금지합니다. public/*.js에서도 `diffs.`처럼 `fs.`로 끝나는 식별자 사용을 피하세요.
- 발주의 LOT는 선택입니다. public/semi.js를 HTML/local.mjs ASSETS/scripts/build.mjs에 포함하세요. production_units·semi_records는 전체 백업 대상입니다.

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

## 세탁 검수·성적서 (버전 15.15)

- 화면은 `public/laundry-report.js`, 주소는 `#/purchase/laundry-reports`. 기존 세탁관리(불량·폐기 사진)와는 별개 기록이다.
- 세탁일마다 검수 기록 하나(`laundry_reports`, `wash_date` UNIQUE)와 칸별 수량(`laundry_report_lines`)을 둔다. 0과 빈 칸은 저장하지 않는다.
- 옷 종류·사이즈·폐기 구분은 `worker.mjs`의 `LAUNDRY_FORMS`가 유일한 기준이며 화면은 `/api/laundry-report-meta`로 받아 그린다. 종이 양식(생산/QC 확인표)과 같은 배치를 유지한다.
- 단가·고객사·세탁 업체·확인자는 설정값(`laundry_report_settings`)으로만 저장한다. 단가와 사람 이름을 코드에 넣지 않는다.
- 금액(업체 비용, 고객사 청구, 차익, 폐기 금액)은 구매 담당자·관리자에게만 응답한다.
- 발행하면 당시 단가를 기록에 복사하고 수정·삭제를 막는다. 발행 취소는 구매 담당자·관리자만 한다.
- 성적서 인쇄는 `body.printing-cert`로 성적서 창만 인쇄한다(입력 창 위에 열려 있어도).

## 계정 추가 · 과거 세탁 기록 가져오기 · 성적서 서명 (버전 15.16)

- 관리자는 「관리자 설정 → 사용자 추가」(`POST /api/admin/users`)로 승인된 계정을 바로 만든다. 비밀번호는 화면에서만 입력하며 코드·시드에 넣지 않는다.
- 과거 세탁 기록은 관리자만 `POST /api/laundry-report-import`(형식 `laundry-reports-v1`, 요청당 최대 20건, 화면은 10건씩)로 넣는다. 가져온 기록은 파일의 단가로 발행된 상태가 되고, 이미 있는 세탁일은 건너뛴다. 가져오기 파일은 단가가 들어 있으므로 저장소에 넣지 않는다.
- 확인자 서명은 세탁 검수 설정에 이미지 한 장으로 등록한다(R2 저장). 발행하는 순간, 성적서의 확인자가 설정의 확인자와 같을 때만 기록의 `signature`에 복사된다. 작성 중·가져온 성적서에는 찍지 않고, 발행 취소하면 지운다.
- 발행된 성적서가 쓰는 서명 이미지는 교체·삭제해도 저장소에서 지우지 않는다. 전체 백업은 서명 이미지도 사진과 함께 받는다.

## 입력·조회·승인 UX (15.17)
- public/workspace-ux.js는 사용자 ID + 화면별 sessionStorage 초안·필터·스크롤 상태를 관리합니다. 초안은 같은 탭에서만 7일 보관하고 명시적으로 복구합니다. 로그아웃 때 해당 사용자의 상태를 지웁니다. 비밀번호·초대코드·사진·서명·파일은 저장하지 않습니다.
- 다품목 입력, 반제품 작업 입력, 작성 중인 세탁 검수에 bindEntryDraft를 연결합니다. request_id는 초안과 같이 복구하고 서버 저장 성공 즉시 초안을 지워 중복 등록을 방지합니다. 사진 실패는 품목 재등록 없이 기존 사진 재시도 경로를 유지합니다.
- 공통 목록은 bindListControls에서 rememberList를 호출하고, 별도 필터 화면은 선택지 로딩 후 최초 조회 전에 rememberList를 호출합니다. 초기화 버튼으로 지운 필터도 저장합니다. 생산 캘린더 기준일·보기 종류도 유지합니다.
- 입고 수량·생산실적·반제품 기록 변경 승인은 reviewApproval 확인 화면을 거칩니다. GET 변경 목록 API의 id 필터로 요청 한 건을 조회하며 서버의 승인 권한·원본 일치 검증은 그대로 유지합니다. 재고 영향 안내는 예상이며 직접 재고를 수정하지 않습니다.
- workspace-ux.js를 HTML, local.mjs와 운영 빌드에 함께 포함하세요.

## 15.17 검수 후 수정 (15.18)
- 입고 변경 승인 확인 화면은 실입고 수량이 기록되지 않은 예전 입고(`recv_qty` NULL)를 재고 계산과 같이 발주 수량(`order_qty`) 기준으로 보여 줍니다. 입고 취소는 해당 수량 전체가 빠지는 것으로 안내합니다.
- `bindReceiptChanges`는 화면을 떠난 뒤 늦게 도착한 목록(root 없음)을 무시하고, 확인·사유 창을 취소하면(`false` 반환) 목록을 다시 불러오지 않습니다.
- 다품목 입력에서 품목 저장 후 사진만 실패하면 초안 상태 문구를 "사진만 재시도"로 바꾸고 저장 중 상태를 풉니다(나가기 경고가 계속 뜨지 않게).
- 반제품 승인 확인 화면은 종류·규격·라인·작업일로 제목을 만들고, 삭제 요청은 값이 있는 항목만 보여 줍니다.
