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

## 오퍼레이터 모드 (15.19)
- `operator` 역할을 가진 일반 계정은 입력 전용 화면을 사용합니다. 다른 업무 역할이 함께 있어도 제한이 우선하며 관리자는 제외됩니다. 기존 계정 역할을 자동 변경하지 않습니다.
- 메뉴: 반제품 커팅/융착, 반제품 세탁, 완제품 실적, 내 정보. 반제품은 기존 POST /api/semi-batches, 완제품은 기존 계획의 POST /api/schedules/:id/actuals로 등록합니다. 계획 등록·수정·승인·삭제는 허용하지 않습니다.
- Worker의 operatorRequestAllowed가 모든 API 요청을 제한하고 사진 접근도 차단합니다. 메뉴 숨김만으로 권한을 구현하지 마세요. 본인 기록은 created_by_id/author_id로 필터링하며 요청 쿼리로 다른 사람을 지정할 수 없습니다.
- /api/operator/catalog·plans는 입력에 필요한 필드만 반환합니다. 새 조회 경로에서 BOM 구성·가격·다른 사용자의 기록을 노출하지 마세요. 기존 서버의 기간·수량·중복 등록 검증과 재고 계산을 유지합니다.
- public/operator.js를 HTML, local.mjs, 빌드에 포함합니다. 스키마·마이그레이션 변경은 없습니다.
- confirmBox/promptBox는 ×·Esc·바깥 클릭으로 닫아도 취소로 완료합니다. 확인값은 modal.close 전에 resolve합니다.
- 반제품 저장 성공 뒤 목록 조회만 실패했을 때 저장 실패로 안내하거나 초안을 되살리지 않습니다. 최대 30줄 저장 뒤에도 resetSemiRows로 한 줄을 남깁니다.

## 검사규격·수입/출하 검사 이력 (15.20)
- 0022는 requests.inspection_snapshot(빈 문자열 기본값), inspection_specs / inspection_spec_keys / inspection_measurements / inspection_measurement_history를 추가합니다. 과거 데이터·판정을 변환하거나 규격을 자동 시드하지 않습니다. 네 표 모두 전체 백업에 포함합니다.
- 규격 설정은 quality_approver·관리자만, 측정값 입력은 quality(quality_approver 포함)·관리자만 할 수 있습니다. 일반 사용자는 조회만, 오퍼레이터는 접근할 수 없습니다.
- 수입검사·출하검사와 원자재/부자재/반제품/제품/상품 카테고리를 분리합니다. 같은 검사·카테고리 안의 품명/별칭 키는 유일합니다. 품명 또는 제품코드(공백·영문 대소문자 무시)가 한 규격에만 맞으면 의뢰 등록 시 규격 JSON을 복사합니다. 자동 입고 검사도 동일한 INSERT 안에서 스냅샷을 만듭니다. 여러 규격과 맞거나 없으면 규격 미지정으로 두세요.
- 적용된 스냅샷은 규격 변경·중지 후에도 유지합니다. 미지정 건은 품질팀장이 같은 검사·카테고리의 규격을 명시적으로 적용합니다. 이미 적용된 규격과 의뢰의 품명·검사 구분·카테고리를 덮어쓰지 마세요.
- 규격별 항목·단위·하한·상한·측정 횟수(1~20)를 정의합니다. 측정은 LOT/시료별 1~30행입니다. 모든 측정값이 경계 포함 범위 안이면 pass, 하나라도 밖이면 fail, 범위 이탈 없이 빈 칸이 있으면 pending. 0은 실제 측정값이며 평균은 판정에 쓰지 않습니다. 최종 판정은 서버 inspectValues에서 계산합니다.
- 측정 저장은 revision 검사 및 수정 이력과 한 batch로 처리합니다. 판정된 기록을 수정하면 사유가 필수입니다. 측정 이력이 있는 의뢰는 삭제하지 않습니다. 측정 후 pending이면 진행, pass/fail이면 완료로 바뀝니다(업무 완료와 검사 합격은 별개).
- public/inspections.js: #/quality/specs 규격 설정, #/quality/inspections 이력 조회, 분석 의뢰 상세의 검사규격·측정값 버튼. 검색은 검사/카테고리/품명·별칭/LOT/판정/의뢰일을 조합하며 100건 단위로 더 보기 합니다. HTML·로컬·빌드에 포함하세요.
- 천와이퍼 NX-7/NX-707D(흡수속도 MD/CD ≤60초), 심리스 HD-08p/Coolove(박리강도 ≥3kgf)는 UI 규격 작성 예시이며 팀장이 측정 횟수·품명/별칭을 확인해 저장해야 합니다. 기존 품목이나 운영 규격을 자동 수정하지 않습니다.

## 오퍼레이터 검사 조회·대시보드 복구 (15.21)
- 오퍼레이터도 검사 이력 목록·측정값·수정이력을 조회합니다. 검사 쓰기·규격 설정 API는 계속 차단하며, 다른 품질 역할이 함께 있어도 can_write/can_manage는 false입니다.
- 대시보드 재고 경고는 STOCK_MOVEMENTS 원천별로 집계 후 품명·단위를 합산합니다. 재고 경고 조회 실패는 stock=null로 반환하고 화면에 명시하며 나머지 현황을 표시합니다. 실패를 재고 경고 0건으로 표시하지 마세요.

## 화면 시작 검증 (15.22)
- 각 JS는 클래식 script로 같은 전역 스코프를 공유합니다. 새 전역 함수·const 이름이 기존 파일과 겹치면 파일별 구문검사와 서버 테스트가 통과해도 화면이 멈춥니다.
- 수입·출하 검사 판정 칩은 qualityInspectionBadge를 사용합니다. 기존 사진검수 inspectionBadge와 구분합니다. test/browser-startup.test.mjs는 HTML의 실제 로딩 순서로 전체 스크립트를 실행하고 로그인 렌더링을 확인합니다.

## 검사 항목 보관함·세탁 간편 입력 (15.23)
- GET/POST /api/inspection-items: 품목군별 재사용 항목을 settings.inspection_item_library에 revision과 함께 보관합니다. 설정 저장은 품질팀장/관리자만, 운영 규격과 기존 의뢰 스냅샷은 자동 변경하지 않습니다. 새 스키마는 없습니다.
- 품목별 규격 작성 화면에서 보관함 항목을 선택해 복사하고, 항목별로 기준을 완성해 다시 보관할 수 있습니다. 흡수량·파티클·린트·외관의 미확정 기준은 빈 값으로 제시하며 임의 합격 기준을 넣지 않습니다.
- 세탁(wash)은 start_time을 진행시각으로 사용하며 종료시각·휴게·인원 입력을 생략합니다. 단일 시각을 허용하되 기존 양쪽 시각·작업시간 기록은 보존합니다. 커팅/융착의 양쪽 시각 검증은 유지합니다.
- 세탁 입력은 등록된 반제품 모델 코드를 검색·선택하고 종류·단위를 자동 연결합니다. 모델은 반제품 품목에 semi_type과 제품코드가 등록되어 있어야 합니다. 세탁은 생산 재고를 추가하지 않는 기존 계산을 유지합니다.

## 커팅/융착 제품코드 입력 (15.24)
- 커팅/융착 입력·수정은 등록된 반제품 제품코드를 선택하고 시작·종료 시각을 입력합니다. 종류·규격·단위·휴게·인원 입력칸을 숨깁니다.
- entry_mode=code인 커팅 기록은 서버가 BOM에서 종류를 결정하고 와이퍼=매, 심리스글러브=켤레로 고정합니다. 신규 기록의 휴게=0, 인원=NULL이며 양품·불량을 별도 보존합니다. 기존 API의 구형 기록 형식은 호환합니다.
- 기존 기록의 같은 모델 수정에서는 이전 규격·단위·휴게·인원 값을 보존합니다. 마스터 품목이나 이전 재고 기록을 일괄 변환하지 않습니다. 코드 방식의 새 기록은 별도 규격을 요구하지 않습니다.

## 세탁 수량·가동 집계 (15.25)
- 세탁 화면은 양품/불량 입력·수율·목표수율을 사용하지 않습니다. entry_mode=wash_quantity의 신규 수량은 qty 하나에 저장하고 defect_qty=0입니다. 과거 qty+defect_qty는 전체 세탁수량으로 표시하며, 수정할 때 기존 defect_qty를 보존하고 전체 수량에서 차감해 qty를 계산합니다.
- GET /api/wash-summary는 날짜·호기별 총수량과 가동 횟수를 반환합니다. 같은 날짜·호기·시각은 한 회이며, 시각이 없는 기록은 request_id의 batch 접두(없으면 행 id)로 구분합니다. 여러 제품 행·재시도를 중복 회수로 세지 않고 서로 다른 수량 단위는 나눕니다. 오퍼레이터도 전체 호기의 요약을 조회합니다.
- 세탁은 저수율 경고에서 제외하고 리포트 수율·불량률·인시당 수량을 NULL로 제공합니다. 과거 데이터나 호기의 기존 목표 값은 삭제하지 않습니다. 커팅/융착 수율 정책은 유지합니다.

## 15.19~15.25 브라우저 검증 후 수정 (15.26)
- `promptBox(title, html, { submit })`: submit을 주면 저장이 끝날 때까지 창을 열어 두고, 서버가 거부하면 입력값을 유지한 채 오류만 보여 줍니다. submit이 없으면 기존처럼 값을 돌려주고 닫습니다.
- 반제품(커팅/융착·세탁) 기록 수정은 이 방식을 씁니다. 수정 사유 누락 등으로 거부돼도 입력이 사라지지 않고, 창 하나에서 재시도해도 request_id는 같습니다.
- 세탁 진행시각은 선택 입력입니다(시각 없는 기록은 등록 묶음 기준으로 가동 횟수 집계). 라벨에 필수 표시를 붙이지 않습니다. 커팅/융착의 시작·종료 시각은 필수이며 라벨에 *를 표시합니다.
- 검사 측정 창은 저장 직후 다시 열 때 「저장된 판정」, 값을 고친 뒤에만 「저장 전 미리보기」로 표시합니다.

## 세탁 진행시각 필수·단위 자동 (15.27)
- 세탁 입력 화면에는 단위·사이즈·인치 칸이 없습니다. 제품코드를 고르면 그 반제품 품목의 단위를 세탁수량 옆에 보여 주고, 서버도 `entry_mode=wash_quantity`이고 bom_id가 있으면 종류·단위를 품목에서 정합니다(품목 단위가 비면 와이퍼=매, 심리스=켤레). 같은 품목으로 수정하면 기존 단위·규격을 유지합니다.
- 진행시각은 필수 값입니다. 새 기록에서 비우면 저장 시각(KST HH:MM)을 넣으며, 한 번에 등록한 여러 줄은 같은 시각을 받아 1회로 집계됩니다. 같은 호기에서 같은 분에 따로 저장한 기록도 1회로 합쳐집니다.
- 시각이 있는 기록을 수정할 때는 시각을 비울 수 없습니다. 시각 없는 과거 기록은 수정해도 시각을 만들어 넣지 않습니다.

## 토스 스타일 적용 (15.28)
- public/style.css 끝의 "토스 스타일" 블록이 색·둥글기·버튼·입력·면 규칙을 덮어씁니다. 클래스 이름과 HTML·JS는 바꾸지 않았습니다. 새 스타일은 이 블록에 추가하고 기존 변수(--bg, --panel, --accent 등)를 그대로 사용하세요.
- 회색 바탕(#F2F4F6) 위 흰 면으로 구분하고 카드·표·KPI에는 테두리·그림자를 쓰지 않습니다. 그림자는 모달 등 떠 있는 창에만 씁니다. 기본 버튼은 옅은 회색, 주요 버튼만 파랑(#3182F6) 채움입니다.
- 외부 폰트·토스 로고·토스 서체는 쓰지 않습니다(시스템 한글 고딕). 화면 로고·이름은 서울세미텍을 유지합니다.
- 다크 모드 값은 같은 블록의 prefers-color-scheme: dark 안에 함께 고칩니다. CSS를 바꾸면 데스크톱·390px·다크·인쇄(성적서)를 다시 확인하세요.

## 제품등록·세부 분류 (15.29)
- 메뉴 「BOM 관리」는 「제품등록」입니다(주소 #/admin/bom 유지). 목록 위 탭으로 원자재/부자재/반제품/제품/상품을 나눠 봅니다.
- 0023은 item_category_nodes(품목 분류별 1~3차 트리)를 만들고, 기존 품목에 쓰인 분류 값과 반제품 기본 분류(와이퍼›부직포와이퍼/천와이퍼, 심리스글러브›스무드/타키)를 노드로 넣습니다. 기존 품목 행은 바꾸지 않습니다.
- 품목의 cat1~3은 미리 만든 노드에서만 고릅니다(서버 bomCategoryPath 검증). 바꾸지 않은 기존 경로는 노드가 사용 중지돼도 그대로 저장됩니다. 분류는 삭제하지 않고 사용 중지만 합니다.
- 반제품의 semi_type은 분류 경로의 가장 깊은 노드 생산 종류를 따릅니다. 노드의 생산 종류를 바꾸면 그 아래 품목의 semi_type도 다시 계산합니다. 분류 없이 semi_type만 보내는 예전 API 호출은 그대로 받습니다.
- 노드 이름을 바꾸면 같은 경로의 품목 cat 값도 함께 바꿉니다. 분류 관리 API(POST/PUT /api/item-categories)는 관리자만 씁니다. 전체 백업에 item_category_nodes를 포함합니다.
- 화면에서 반제품은 생산 종류가 정해진 분류와 품목코드가 있어야 저장됩니다. 비활성화된(빈) 분류 선택칸도 cat1~3을 빈 값으로 보내 이전 값이 남지 않게 합니다.

## 사이즈 묶음·반제품으로도 사용·단위 환산 (15.30)
- 0024: item_category_nodes.sizes(사이즈 묶음, 쉼표 구분 최대 20개), boms.semi_unit(생산 기록 단위)·pack_qty(1 unit = pack_qty semi_unit).
- 사이즈 묶음은 분류에 두고 하위 분류·품목이 가장 가까운 상위 값을 물려받습니다. GET /api/boms와 저장 응답에 sizes 배열이 붙습니다. 다품목 입력(발주·기타입고·출하·생산계획)은 sizes가 있는 품목을 고르면 규격·수량 대신 사이즈별 수량칸을 보여 주고, 저장 시 수량이 있는 사이즈만 spec=사이즈인 줄로 펼칩니다(서버는 기존 batch API 그대로). 사이즈 칸은 data-line-key="size:XS" 형식이며 초안 복구 때 품목 선택 뒤 다시 채웁니다.
- 3차(2차 포함) 세부 분류는 선택 사항입니다. 반제품만 생산 종류가 정해지는 분류가 필요합니다.
- 반제품이 아닌 품목은 「반제품으로도 사용」(semi_enabled)을 켜야 semi_type을 가집니다(켜지 않고 semi_type만 보내면 400). 이때 제품코드·생산 종류·생산 기록 단위가 필요하고, 품목 단위와 생산 기록 단위가 다르면 pack_qty가 필수입니다.
- 커팅/융착·세탁·오퍼레이터 목록은 분류와 상관없이 semi_type이 있는 품목을 쓰며, 기록 단위는 semi_unit(없으면 반제품은 품목 단위, 그 외 매/켤레)입니다.
- 재고는 품목·단위별로 따로 집계하고 섞지 않습니다. pack_qty가 있으면 각 줄에 다른 단위 환산값(converted)을 함께 보여 줍니다. 자동으로 박스 재고를 낱장으로 옮기지 않습니다.

## 화면 언어 전환 (15.31)
- 기본 언어는 한국어입니다. 로그인 화면과 상단(오퍼레이터 포함)의 언어 선택으로 English / Tiếng Việt / ភាសាខ្មែរ / 中文을 고르면 그 기기 브라우저(localStorage `wpa:lang`)에 저장하고 새로 고칩니다. 서버·DB는 바뀌지 않습니다.
- public/i18n.js가 화면에 그려진 한국어 문구(텍스트, placeholder·title·aria-label·alt)를 사전으로 바꿉니다. 화면 코드는 한국어 원문을 그대로 쓰며 **사전의 키가 한국어 원문**입니다. 새 문구를 추가하면 public/i18n-{en,vi,km,zh}.js 네 파일에 같은 키로 번역을 넣으세요(test/i18n.test.mjs가 키·자리표시자 일치를 검사). 사전에 없으면 한국어로 보입니다.
- 키 규칙: 공백은 한 칸으로, 끝의 필수표시 ` *`는 뺍니다. `${...}` 자리는 `{0}`, `{1}`로 씁니다(예: `{0}건 조회`). 변수 앞뒤 조각(예: `계정을 만들었습니다.`)도 키가 될 수 있고, 문구의 앞·뒤에서 일치하면 나머지(이름·숫자)는 그대로 둡니다.
- 번역하지 않는 것: 입력값과 서버로 보내는 값(value 없는 option은 번역 전에 한국어 value를 고정), 사용자 데이터, 성적서(.cert), `data-no-i18n` 영역, CSV·백업 파일 내용. 서버 오류 문구도 사전에 있으면 번역됩니다.
- 사전 파일은 HTML·local.mjs·빌드 목록에 포함합니다. 번역문에 빌드 검사 금지 문자열(`fs.`, `require(`, `process.env`)이 들어가지 않게 하세요.

## 제품코드 선택 시 입력칸 정리·날짜칸·화면 모드 (15.32)
- 다품목 입력(발주·출하·기타입고)에서 제품코드를 고르면 규격·단위·분류 입력칸을 숨기고 코드의 값(단위·분류·제품코드)을 요약으로 보여 줍니다(multi-items.js fromCatalog). 직접 입력(임시 코드)으로 돌아가면 칸이 다시 나옵니다. 규격은 비워 저장하며, 사이즈가 있는 품목은 사이즈별 수량칸이 규격을 정합니다. 생산계획(schedule)은 바꾸지 않았습니다.
- iPhone(Safari)의 날짜·시간 칸은 `@supports (-webkit-touch-callout: none)` 안에서 기본 모양을 끄고 왼쪽 정렬·칸 너비 맞춤을 합니다. 다른 브라우저 모양은 그대로입니다.
- 화면 모드: public/theme.js(가장 먼저 로드)가 자동/라이트/다크를 localStorage `wpa:theme`에 저장하고 `<html data-theme>`를 설정합니다. style.css의 다크 규칙은 모두 `:root:not([data-theme="light"])`(기기 다크일 때)와 `:root[data-theme="dark"]`(강제 다크) 두 벌로 씁니다. 새 다크 규칙도 이 형태로 추가하세요.
- 언어·화면 모드 버튼은 로그인 카드와 상단에 두고, 820px 이하 일반 화면에서는 왼쪽 메뉴(☰) 맨 위(.side-prefs)로 옮깁니다. 오퍼레이터 화면은 메뉴가 없어 상단에 작게 둡니다.

## 다단 메뉴·입력/목록 화면 분리 (15.33)
- NAV 항목은 `[주소, 이름]` 또는 하위 메뉴 `{ sub, items }`입니다. 하위 메뉴는 `<details class="nav-sub">`로 그리고 현재 화면이 들어 있으면 열어 둡니다. 승인 대기 배지는 화면 링크와 하위 메뉴 제목에 함께 붙습니다.
- VIEW_SPLIT의 주소는 한 페이지 함수를 입력 화면(`…/new`)과 목록 화면(기존 주소)으로 나눠 보여 줍니다. applyView가 `form.list-filters`와 그 뒤를 목록 부분, 앞의 입력 양식을 입력 부분으로 표시하고 `#main[data-view]` CSS로 한쪽을 숨깁니다. 승인 대기 상자(#semiPending, #actualChanges, #receiptChanges)는 목록 화면에 둡니다. 기존 목록 주소와 대시보드·승인 링크는 그대로 목록을 엽니다.
- 새 입력+목록 화면을 만들 때는 입력 양식을 목록 검색 양식(`listControls` / `.list-filters`)보다 앞에 두고 VIEW_SPLIT·PAGES·NAV에 두 주소를 등록하세요.
- listControls의 `dateFold` 옵션은 기간 검색을 「…로 찾기」 접힘 안에 넣습니다(발주 목록의 납기일). 저장된 조회 조건에 날짜가 있으면 펼칩니다.
- 사진 첨부 칸(.photo-picker)은 block으로 표시합니다(인라인이면 점선 테두리가 줄마다 끊김).

## 화면 점검 개선 (15.34)
- todayStr는 기기 시간대가 아닌 한국 시간(Asia/Seoul)으로 오늘 날짜를 냅니다(서버 날짜와 맞추기 위함). 해외 시간대 기기에서도 오늘 기준 조회가 같습니다.
- applyView가 입력↔목록 전환 버튼(`.view-switch`)을 제목(h1) 오른쪽에 넣고, 입력 화면에는 「오늘 내가 입력한 것」(showRecentEntries, RECENT_SOURCES의 API에서 오늘·본인 작성분)을 붙입니다. 저장 성공 토스트가 뜨면 다시 불러옵니다. 입력 화면의 중복 카드 제목(h3)은 CSS로 숨깁니다.
- foldHelp: 80자 이상 안내문(p.muted)은 「도움말 · 이 화면 설명」 접힘으로 바꿉니다.
- labelGridTables: PC 표는 모든 행이 비었거나 「—」인 열을 숨기고(col-empty) 짧은 값 열은 한 줄로 둡니다(nowrap-cell). 휴대폰 카드는 CARD_SECONDARY 열을 숨기고 「자세히/접기」로 펼치며, 30건 초과는 「더 보기」로 나눠 보여 줍니다. 빈 칸(cell-empty)은 접힌 카드에서 숨깁니다.
- foldListFilters: 휴대폰에서 목록 검색 조건을 「조건」 버튼 뒤로 접고 적용 중인 조건 수를 표시합니다. foldReportSections: 휴대폰 보고서의 두 번째 섹션부터 접어 둡니다.
- 대시보드 납기 지난 발주는 한 줄씩 최대 5건, 생산계획 카드는 진행 막대(planProgress)로 보여 줍니다. 「규격·단위」 버튼은 직접 입력(임시 코드) 품목에만 표시합니다. 화면 모드 아이콘은 SVG입니다.

## 입력 폼 UX: 검사규격 등록·수정 (15.35)
- 검사규격 폼(inspections.js editInspectionSpec)은 1. 기본 정보 → 2. 검사 항목(항목명·단위·측정 횟수 → 합격 범위 하한·상한) → 3. 사용 여부 순서입니다. 필수는 빨간 `*`(span.req), 선택은 `(선택)`(span.opt)으로 표시합니다.
- 브라우저 기본 검증 대신(`novalidate`) inspectionSpecCheck가 서버 validateInspectionSpec과 같은 규칙으로 먼저 검사합니다. 오류는 해당 칸의 label 안(span.field-error)에 「무엇을, 어떻게」 고칠지 적고, 칸에 `aria-invalid`·`aria-describedby`를 붙이고 첫 오류 칸으로 포커스합니다. 칸을 고치면 바로 지워집니다. 서버 규칙을 바꾸면 이 함수도 함께 바꾸세요.
- 서버 오류는 inspectionSpecServerError가 문구로 칸을 찾아 붙이고(중복 409 → 별칭 칸), 못 찾으면 폼 위 `[data-form-error]`(role=alert)에 표시합니다. 500·연결 실패·동시 수정(409)은 「입력한 내용은 그대로 있다」와 다음 행동을 안내합니다.
- 저장 버튼 상태: 저장 중(`.is-loading`, disabled, form aria-busy, 「저장 중…」) → 저장됨(`.is-done`, 「저장됨 ✓」) → 0.5초 뒤 닫힘. 실패하면 버튼을 다시 켭니다. 결과는 `[data-save-status]`(aria-live)로도 알립니다.
- 하한·상한은 `type=text inputmode=decimal`입니다(number 칸은 잘못 친 값을 빈 값으로 바꿔 오류 안내를 할 수 없음). data-k 이름·보내는 값은 그대로입니다.
- modal()은 Tab/Shift+Tab을 창 안에서 순환시키고 닫을 때 연 버튼으로 포커스를 돌려줍니다(맨 위 창만 키 처리). 폼은 저장 후 다시 그려진 목록의 버튼으로 포커스를 돌려줍니다.

## 대시보드 화면 구성 (15.36)
- pageHome은 같은 데이터(/api/dashboard, /api/my-tasks, /api/alerts)·같은 숫자·같은 링크를 그대로 쓰고 배치만 바꿨습니다: 제목+날짜 → 내가 처리할 일·확인이 필요한 일(넓은 화면 2열) → 「현황 한눈에」(구매·물류 / 재고·생산 / 의뢰 접수 대기 묶음) → 진행 현황 표 → 업무 흐름(휴대폰은 접힘, 넓은 화면은 펼침).
- KPI 타일은 `kpi(href, 값, 이름, tone, note)`로 만들고 0건은 `.is-zero`로 흐리게 합니다. 조건부 타일(입고 수정 승인대기, 안전재고 미달, 재고 음수, 생산실적 수정 승인대기)의 표시 조건은 이전과 같습니다. 휴대폰에서는 2열입니다.
- 제목 계층: h1 대시보드 → h2 카드·섹션 → h3 하위(tasksCard·alertsCard도 h2/h3로 바뀜). 진행 현황 표는 caption(sr-only)과 th scope를 씁니다. 문장 속 링크는 밑줄로도 구분합니다.
- 라이트 모드 노란 글자(.chip.yellow, .kpi.yellow 숫자)는 대비 4.5:1을 위해 진하게 덮어씁니다. 다크는 기존 색 유지. axe-core(wcag2a/aa·best-practice)로 휴대폰 라이트·다크와 PC에서 위반 0건을 확인했습니다.

## 모든 입력 폼 공통 UX (15.37)
- public/form-ux.js(app.js 다음에 로드)가 모든 `<form>`에 자동 적용됩니다. 제외: `.list-filters`, `[data-read-only]`, `.spec-form`, `[data-own-errors]`, `[data-no-form-ux]`. 새 폼은 별도 작업 없이 적용되며, 자체 오류 표시를 쓰는 폼만 `data-own-errors`를 붙이세요.
- 표시: required 칸은 label 글자 끝 `*`를 빨간 span.req로 바꾸고(없으면 추가), 필수 칸이 있는 폼의 나머지 칸에 span.opt `(선택)`을 붙입니다. legend 끝 `*`도 같습니다. 라디오 선택지 label이 원래 `.opt` 클래스를 쓰므로 「(선택)」 스타일은 반드시 `span.opt`로 한정하세요.
- 검사: 폼에 novalidate를 켜고 document 캡처 단계 submit에서 checkValidity를 먼저 봅니다. 실패하면 각 칸 label 안(라디오·체크 묶음은 fieldset 안)에 span.field-error로 해결 방법을 적고 aria-invalid·aria-describedby를 붙인 뒤 첫 칸으로 이동하고, 원래 submit 처리는 실행하지 않습니다. 통과하면 원래 처리로 그대로 넘깁니다. 코드에서 부르는 `form.reportValidity()`도 같은 안내를 씁니다(프로토타입 교체).
- 상태: 제출 후 버튼에 `.is-loading`(aria-busy) → 성공 토스트가 오면 `.is-done`(✓), 오류 토스트가 오면 해제 후 버튼 위 `[data-fx-form-error]`(role=alert)에 안내합니다. api()를 감싸 마지막 HTTP 상태를 기억해 500·연결 실패·409를 구분하고, 400 문구에 칸 이름이 있으면 그 칸 아래에도 붙입니다. 12초 또는 다른 곳을 누르면 처리 중 표시를 풉니다. 기존 토스트는 그대로 뜹니다.
- 칸 이름은 label 글자 → aria-label → 표 머리글(data-label) → placeholder → (칸 하나뿐인 폼) 폼 제목 순서로 찾습니다. 안내 문구를 추가하면 4개 언어 사전에도 넣으세요.

## 관리 메뉴 정리 (15.38)
- 거래처 관리(#/purchase/vendors)와 검사규격 설정(#/quality/specs)을 구매·품질 메뉴에서 「관리」 묶음으로 옮겼습니다. 주소·권한은 그대로입니다.
- 「관리」 묶음은 모든 사용자에게 보이며 NAV_MANAGE(기준 정보)는 모두에게, NAV_ADMIN(관리자 설정·제품등록)은 관리자에게만 붙습니다. 화면 안의 수정 권한은 각 화면과 서버가 전과 같이 판단합니다.
- 품질의 「수입·출하 검사」 하위 메뉴는 항목이 하나만 남아 「수입·출하 검사 이력」 단일 링크로 바꿨습니다. 거래처 관리 제목 옆 부서 표시는 「관리」입니다.

## 입고목록 통합·화면 점검 수정 (15.39)
- 기타입고 목록을 입고목록(#/logistics/receive)에 합쳤습니다. pageReceipts가 발주입고 구역(pageReceive)과 기타입고 구역(pageOtherReceipts(…, { entry: false }) — 등록 양식 없이 목록만)을 한 화면에 두고, 맨 위 「구분: 전체/발주입고/기타입고」(localStorage `wpa:receipt-kind`)로 구역을 보이거나 숨깁니다. 두 구역은 처리 방식·날짜 기준이 달라 각자의 검색·처리를 그대로 씁니다. 구분 버튼의 건수는 각 구역의 「N건 조회」를 읽어 붙입니다(같은 값이면 쓰지 않음 — 관찰자 무한 반복 방지).
- 메뉴 「입고」는 입고목록·기타입고 입력 두 개입니다. 옛 주소 #/logistics/other는 입고목록을 「기타입고」로 걸러 엽니다. 기타입고 입력(#/logistics/other/new)의 전환 버튼은 「입고목록 보기」입니다.
- 대비: 라이트 흐린 글자 --muted #5f6b78, 채움 버튼은 --btn-primary/--btn-green/--btn-red(라이트·다크 각각) 변수로 색을 정합니다. 상태 글자(칩·상태 선택칸)는 --green-ink/--yellow-ink/--accent-ink. axe-core wcag2a/aa 기준 72개 화면(PC 라이트·휴대폰 다크) 위반 0건을 확인했습니다. 새 색을 넣을 때 이 변수를 쓰세요.
- `.btn`은 줄바꿈하지 않습니다(글자가 「CS / V」처럼 깨지지 않게). 버튼 묶음(.actions/.toolbar/.actionbar/.row)이 줄을 넘깁니다.
- fixHeadingLevels(app.js): 제목 단계가 건너뛰면 aria-level만 맞추고, 가로로 넘치는 .table-wrap/.report-chart-scroll에 tabindex를 붙입니다. 화면 변경·data-view·hidden·open 변화 때 다시 실행됩니다.
- form-ux: 화면 코드가 직접 그리는 `*`/`(선택)` 표시(예: 커팅 입력 data-semi-model-mark)가 있으면 자체 표시를 붙이지 않습니다. 「(선택)」 스타일은 label/legend 바로 아래 span.opt에만 적용합니다(라디오 선택지·「기타」 칸의 .opt와 구분).
- 휴대폰 카드: 표 caption은 block, 행 색(row-red/yellow/green)은 카드 전체에, 「자세히」·「더 보기」·생산일정 × 버튼은 36px 이상.

## 재고 현황 D1 조회 복구 (15.40)
- 재고 현황·변동내역·실사 기준수량은 STOCK_MOVEMENTS의 원천별 SELECT를 같은 D1 batch 트랜잭션에서 실행합니다. 큰 UNION 서브쿼리에 대한 의존을 제거하고 품목·규격·단위별 합계를 서버에서 합칩니다. 기존 계산식·단위·환산·권한을 유지합니다.
- 원천별 5001행과 전체 5000품목 제한을 적용하고 변동내역은 모든 원천의 최신 행을 합친 뒤 200건으로 자릅니다. 일부 원천 조회 실패를 재고 0으로 숨기지 않습니다. 실사는 모든 원천의 전체 기준수량으로 계산합니다.
- 오류 로그는 예외 message도 기록해 D1 원인 문구가 스택과 함께 남게 합니다. 비밀 값이나 요청 헤더는 기록하지 않습니다.

## 휴대폰 카드 글자 가독성 (15.41)
- 펼친 카드(as-cards)는 항목 이름(td::before, 13px)을 값(15px) 위에 따로 둡니다. 예전처럼 이름을 왼쪽 90px 칸에 absolute로 두면 긴 이름이 여러 줄로 접히며 아래 칸과 겹칩니다(관리자 설정의 권한 이름).
- 체크박스만 있는 칸은 「이름 …… ☑」 한 줄(flex, 높이 44px)로 보입니다.
- 「자세히/접기」(.card-more)는 펼침·접힘 모두 카드 오른쪽 위(absolute)에 두고, `tr:has(.card-more)::before` float 빈칸으로 첫 줄만 비켜 갑니다. 접힌 카드의 오른쪽 76px 고정 여백은 없앴습니다.
- 접힌 카드 요약 글자 14.5px, 이름표 12.5px, 품목명 15.5px. 카드 안 작은 버튼은 14px·36px 이상. PC 표는 바뀌지 않습니다.

## 휴대폰 글자·배치 개선 (15.42)
- 휴대폰(700px 이하)에서 13px 미만 글자를 없앴습니다(측정 705곳 → 0곳): .small·.hint 13.5px, 칩·부서·태그 13px, label·legend·검색칸 이름 14px, 표 머리글 13.5px, 차트 글자 13px, 「(선택)」 13px, 임시저장 안내 13.5px. 새 글자 스타일을 넣을 때 휴대폰에서 13px 아래로 내리지 마세요. PC 크기는 그대로입니다.
- 접힌 카드의 「이름 값」 칸은 inline-block이라 줄이 모자라면 묶음째 다음 줄로 갑니다(「PR-」/「105」처럼 코드가 끊기지 않음). 품목명 칸과 체크박스 칸은 예외입니다.
- 세탁 검수 표(.lr-list): 합계 줄은 테마 색(var(--bg)/var(--text)) — 다크 모드에서 흰 줄이 튀지 않음. 휴대폰에서 첫 칸(세탁일)은 sticky로 고정합니다.
- .tag/.dept/.chip은 줄어들거나 줄바꿈되지 않습니다(긴 이름 옆 코드 배지가 세로로 찌그러지던 문제).
- 생산일정: 휴대폰에서 주간·월간 계획의 기간 글자를 카드 위로 올리고(.plan-row column), 빈 날짜 칸은 얇게 표시합니다.
- lineInfo의 내부 묶음 번호(batch_id)는 화면 글자에서 빼고 title(마우스 올림)로만 둡니다. 다품목 등록 토스트에서도 뺐습니다.
- form-ux: 팝업의 item/product/title 입력칸이 칸보다 길면 아래에 .input-full로 전체 글자를 보여 줍니다(입력칸·저장 값·Enter 동작은 그대로).

## 회사 R2 사진 저장소 (15.43)
- image-storage.mjs가 기존 BUCKET과 회사 R2 S3 API 접근을 통합합니다. R2_STORAGE_MODE 기본값은 native이며 명시적으로 external을 설정하기 전에는 기존 저장소를 계속 사용합니다. native BUCKET 바인딩과 D1, 기존 마이그레이션은 유지하세요.
- 회사 연결 변수: R2_S3_ENDPOINT, R2_S3_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. 키는 서버의 비밀 환경변수로만 설정합니다. endpoint는 HTTPS Cloudflare R2 계정 주소만 허용하며 서명 요청의 리다이렉트는 금지합니다. 외부 패키지 없이 Web Crypto SigV4(region=auto)를 사용합니다.
- 사진 URL과 권한은 기존 /uploads/:file 그대로입니다. external 조회는 회사 버킷의 404에서만 기존 버킷으로 대체합니다. 인증·연결 실패를 숨기지 않습니다. external 삭제는 회사 버킷만 대상으로 하며 이전 원본은 보존합니다.
- 관리자 설정의 회사 사진 저장소와 /api/admin/image-storage{,/check,/copy}는 관리자 전용입니다. copy는 원본 BUCKET.list를 3개씩 순회해 같은 객체 키·Content-Type을 유지하여 조건부 업로드(If-None-Match: *)하고 SHA-256과 형식 정보를 비교합니다. 충돌·복사 실패 시 중단하며 원본을 삭제하거나 D1 참조를 수정하지 않습니다. 재실행은 기존 복사본부터 비교합니다.
- 복사 중에는 사진 변경을 잠시 멈추고 마지막 전체 검증을 끝낸 뒤 external로 전환·재배포합니다. 전환 이후 새 사진은 회사 버킷에만 저장하므로 native로 되돌리기 전에는 신규 사진의 역복사가 필요합니다. scripts/build.mjs에도 image-storage.mjs를 포함합니다.

## 회사 R2 접근 검증·임시 도구 종료 (15.45)
- seoulsemi-images의 S3 API에서 테스트 객체의 조건부 생성·업로드·조회·SHA-256 및 Content-Type 비교·삭제 후 404를 확인했습니다. 테스트 객체는 정리했고 기존 사진에는 접근하거나 변경하지 않았습니다.
- 두 접근 키는 Sites의 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY에 비밀 값으로 등록합니다. 값은 소스·번들·manifest·로그·D1에 넣지 않습니다.
- 현재 R2_STORAGE_MODE는 external입니다. 신규 업로드는 회사 버킷에 저장하며 기존 사진은 원래 BUCKET에서 대체 조회합니다. 기존 사진을 일괄 복사하지 않았습니다. INVITE_CODE·D1·기존 BUCKET·마이그레이션을 유지하세요.
- 키 전달용 임시 HTML은 제거했고 /r2-key-handoff.html은 HTTP 410을 반환합니다. 임시 공개키를 다시 배포하거나 해당 페이지를 다시 활성화하지 마세요.

## R2 Workers 호환·클라이언트 8MB 검증 (15.46)
- Workers는 Request의 redirect:error를 지원하지 않습니다. 서명 요청은 redirect:manual로 만들고 3xx 응답은 본문을 닫고 명시적으로 거부합니다. 서명 헤더를 다른 주소로 전달하지 않습니다. Node에서 성공한 검사만으로 Workers 호환성을 단정하지 마세요.
- 원본 사진은 한 장당 8×1024×1024바이트 이하, 최대 10장입니다. photoPicker와 서명 입력에 8MB 안내를 표시하며 validatePhotoFiles로 디코딩 전에 검사합니다. preparePhotos는 여러 장을 순서대로 최적화하고, validatePhotoPayload는 변환 후 한 장 8MB 및 JSON 요청의 여유를 남기는 전체 크기를 검사합니다. 서버도 Base64 해제 전후에 8MB를 검사합니다.
- 세탁 신규·수정도 bindPhotoDraft를 사용합니다. 변환 중 제출을 막고 선택 오류가 나도 기존 draft를 지우지 않습니다. 수정 제출 시 유지할 사진과 새 사진을 합쳐 10장인지 다시 검사합니다.
- 테스트는 Workers의 redirect 제한을 재현한 세탁 사진 업로드·조회·삭제, 외부 이동 차단, 8MB 경계와 초과 차단, 기존 사진 보존을 포함합니다. 운영 저장소 모드는 external 그대로입니다.

## 기타입고 화면 용어 정리 (15.47)
- 기타입고(다품목 입력·단일 양식·수정 팝업)에서 「BOM」 표현을 뺐습니다: 「BOM 검색」→「품목 검색」, 「BOM 품목」 선택칸→「품목명」, 「BOM 품목을 선택하세요」→「품목을 선택하세요」, 안내문 「BOM에서 품목을…」→「등록된 품목을…」. 보내는 값(bom_id, item)은 그대로입니다. 일정(schedule)의 「BOM 검색/BOM 품목」은 직접 입력과 섞여 있어 그대로 둡니다.
- 품목을 고르면 채워지는 읽기 전용 품목명 칸(.receipt-item-name)은 CSS로 숨깁니다(값은 저장됨). 예전 수기 기록을 고칠 때(읽기 전용이 아닐 때)만 「품목명 (직접 입력)」으로 보입니다.
- 입고목록의 기타입고 구역 아래 「+ 기타입고 입력」 버튼·안내는 메뉴(입고 › 기타입고 입력)와 중복이라 없앴습니다.

## 영업 › 구매의뢰 전자결재 (15.48)
- 0025_purchase_requests.sql: users.position·department(빈 값 기본, 기존 사용자 추정·일괄 채우기 금지), purchase_requests(의뢰서 머리·photos JSON·status pending/approved/rejected·current_step·revision), purchase_request_items(품목·단가·공급선 등, 금액은 저장하지 않고 수량×단가로 계산, po_id), purchase_request_lines(kind approve/agree/cc, step, 상신 당시 이름·직급, decision, read_at). 세 표는 전체 백업 대상이며 의뢰서 사진도 백업에 포함합니다.
- 결재 규칙(worker.mjs 「영업: 구매의뢰」): 결재자 1명 이상 필수, 결재(step 1..n) → 합의(이어서) 순서, 참조는 step 0. 지금 차례(current_step)인 사람만 승인·반려합니다(관리자도 자기 차례만). 반려는 사유 필수이며 작성자에게 돌아가고, 작성자가 고쳐 다시 올리면(PUT) 결재선·결정이 모두 초기화되어 1번부터 다시 진행합니다. 아직 아무도 결정하지 않은 의뢰서도 고칠 수 있습니다. 동시 처리는 revision으로 막습니다.
- 보기 권한: 작성자, 결재선(결재·합의·참조)에 지정된 사람, 관리자, 그리고 최종 승인된 의뢰서는 구매 담당(purchase). 열면 해당 결재선 행의 read_at을 남깁니다(참조 ✓ 열람).
- 발주 생성(POST /api/purchase-requests/:id/po): 구매 담당만, 최종 승인 후. 발주 등록과 같은 createPurchaseOrder()를 쓰며 구매의뢰번호=의뢰서 번호(PR-YYMMDD-NN), 거래처=품목의 공급선, 분류=등록 품목의 분류(없으면 입력값). 품목마다 po_id를 남겨 같은 품목을 두 번 발주하지 않습니다.
- 사진은 의뢰서 행의 photos에 둡니다. 공통 attachments·progress_comments 표는 entity_type CHECK가 고정이라 쓰지 않습니다(표를 다시 만들어 제약을 바꾸지 마세요). 저장은 savePhotos(회사 R2·8MB·10장) 그대로이며 작성자가 최종 승인 전에만 바꿉니다. 별도 진행 코멘트 대신 결재선의 승인 의견·반려 사유를 씁니다.
- 화면: public/sales.js(index.html·local.mjs·build.mjs에 포함), 메뉴 영업 › 구매의뢰(작성 #/sales/pr/new, 목록 #/sales/pr). 내 결재 차례는 my-tasks의 approvals.purchase_requests로 대시보드·메뉴 배지에 나오고, 내가 올린 의뢰(결재 중·최근 반려)는 mine.purchase_requests입니다. 직급·부서는 내 정보와 관리자 설정(사용자 행 「직급·부서」)에서 바꿉니다. GET /api/directory는 승인된 사용자의 id·이름·직급·부서만 줍니다.
- form-ux: 우리가 붙인 *·(선택) 표시는 data-fx-mark로 찾습니다(칸이 label 안 더 깊은 곳에 있을 때 표시가 끝없이 늘어나던 문제). 입력값이 아닌 선택 도구에는 data-no-mark를 붙이세요. 휴대폰 카드에서 접혀도 보여야 하는 버튼 칸은 td에 data-card-primary를 붙입니다.

## 조직 구성 · 가입 시 부서/직급 선택 (15.49)
- 0026_org_structure.sql: org_departments(name UNIQUE, parent_id, sort, active)·org_positions(name UNIQUE, sort=서열, 낮은 직급이 앞), 비어 있는 상태로 시작. 사용자에는 users.department/position 이름 문자열을 저장합니다.
- worker.mjs 「조직 구성」: GET /api/org(로그인 없이, 사용 중 항목만 — 가입 화면용), GET/POST/PUT/DELETE /api/admin/org/:kind(/:id), POST …/:id/move(같은 상위 안에서 순서), POST /api/admin/org-import(사용자 값으로 빈 목록 채우기). 모두 관리자 전용(GET /api/org 제외). 상위 부서 순환 금지, 이름 변경 시 users의 같은 이름도 batch로 함께 바꿉니다(지난 구매의뢰서 스냅샷은 그대로). 사용자가 있거나 하위 부서가 있으면 삭제를 거부하고 「사용 중지」를 안내합니다.
- orgChoice(): 목록이 있으면 사용 중 항목 중에서만 고를 수 있습니다. 가입(register)은 목록이 있으면 필수, 관리자 사용자 추가·수정은 선택. 목록이 비어 있으면 자유 입력(첫 관리자 가입 등).
- 사용자가 자기 부서·직급을 바꾸는 /api/me/profile은 없앴습니다(조직은 관리자가 관리). 내 정보에는 읽기 전용으로 보입니다.
- 구매의뢰: 의뢰부서는 입력받지 않고 작성자의 users.department, 요청자 직급은 users.position을 상신(재상신) 당시 값으로 저장합니다. 「부서명」 입력칸과 품목 「담당자」 칸은 없앴습니다(예전 기록에 담당자 값이 있으면 상세 표에만 보입니다).
- 화면: public/org.js(index.html·local.mjs·build.mjs 포함) — orgFields()(가입·사용자 추가·사용자 행 「직급·부서」에서 공용), pageOrg(#/admin/org, 관리 메뉴 「조직 구성」, 관리자만). 조직도는 부서 순서대로 높은 직급부터 보여 주고 그 자리에서 부서·직급을 바꿉니다.
- showInputAuthors는 form[data-no-author]를 건너뜁니다(조직 구성 양식, 요청자를 따로 보여 주는 구매의뢰 양식).

## 영업 → 생산 생산의뢰 · 생산계획 연동 (15.50)
- 0027_production_requests.sql: production_requests(req_no MR-YYMMDD-NN, 발주일·업체·주문번호·출고 희망 글/날짜·사양·비고, 요청자·부서, shipped·shipped_date·shipped_by, revision, request_id), production_request_lines(품목·제품코드·규격/사이즈·단위·수량, 사이즈별 수량은 사이즈마다 한 줄), schedules.production_line_id(생산의뢰에서 만든 일정의 연결). 세 곳 모두 추가만 했고 기존 데이터는 그대로입니다. 두 표는 전체 백업 대상입니다(15.49 조직 표도 이번에 백업 목록에 넣었습니다).
- worker.mjs 「영업 → 생산: 생산의뢰」: 등록은 로그인 사용자 누구나(업체는 거래처 목록에 자동 등록), 수정·삭제는 작성자가 생산계획 반영 전까지만. POST /:id/plan(생산 담당 hasRole production)은 줄마다 아직 계획되지 않은 수량만큼 schedFields()로 일정을 만들고 production_line_id를 남깁니다(반제품 BOM은 semi, 나머지 finished, 메모 「생산의뢰 번호 · 업체 · 주문번호 · 사양」). POST /:id/ship은 작성자·물류·생산이 출고 완료/취소를 표시합니다.
- 진행은 저장하지 않고 계산합니다: planned_qty=연결 일정 수량 합, produced_qty=연결 일정 실적 합(생산실적 + 반제품 커팅 기록, GET /api/schedules의 actual_qty와 같은 식 MR_ACTUAL), 상태 waiting/partial/planned/producing/done/shipped, 생산 완료일=마지막 실적일. 목록 status=open은 출고 전 전체(생산완료 포함).
- GET /api/production-requests/needs: 출고 전 의뢰의 품목·규격별 생산 필요 수량(의뢰−생산)과 계획 안 된 수량. my-tasks approvals.production_requests(생산 담당: 계획 안 된 수량이 있는 의뢰) → 대시보드·메뉴 배지(#/prod/orders).
- GET /api/schedules는 order_ref(「MR-… · 업체 · 주문번호」)·order_id를 함께 줍니다. 생산일정 항목은 이를 링크로 보여 주고 메모에서 같은 앞부분을 뺍니다. 일정을 지우면 그 수량은 다시 「계획 안 됨」이 됩니다.
- 화면(public/sales.js): 영업 › 생산의뢰(작성 #/sales/mr/new · 목록 #/sales/mr), 생산 › 생산의뢰 접수(#/prod/orders, 생산 필요 수량 표 + 「접수·계획 반영」). 「사이즈별 입력」은 XS~XXL 수량을 사이즈별 줄로 만듭니다.
- i18n: textarea의 placeholder도 번역합니다(입력 내용은 번역하지 않음).

## 15.50 점검 수정 · 동시 처리 · D1 매개변수 한도 (15.51)
- **동시 수정 규칙(여러 문장을 묶는 저장)**: batch(D1 트랜잭션) 안의 모든 문장이 「읽은 revision·고칠 수 있는 상태가 그대로」를 조건으로 갖고, revision을 올리는 헤더 UPDATE(또는 헤더 DELETE)는 **맨 마지막**에 둡니다. 성공 여부는 `result.at(-1).meta.changes`로 판단합니다. 헤더를 먼저 올리고 자식 문장이 `revision = 기존값 + 1`을 확인하는 방식은 다른 요청이 올린 revision을 자기 성공으로 착각하므로 쓰지 마세요(15.50의 혼합 저장 원인).
  - 적용: 생산의뢰 PUT·DELETE·계획 반영, 구매의뢰 PUT·결재(decision)·DELETE. 결재는 결재선 기록(decision='')을 먼저, 헤더를 마지막에 둡니다. 삭제는 헤더가 지워졌을 때만 사진을 정리합니다.
  - 생산계획 반영은 일정 INSERT마다 「의뢰 revision·출고 전·그 줄의 현재 계획 합계가 읽은 값 그대로」를 조건으로 두고, 마지막에 의뢰 revision을 올립니다. 동시에 두 번 눌러도 한 번만 들어가고 나머지는 409입니다. 화면은 plan·DELETE에 revision을 함께 보냅니다.
- **출고 완료 의뢰**: mrEditable이 서버에서도 수정·삭제를 거부합니다(화면 can_edit와 같은 조건). 출고 취소 후에는 다시 고칠 수 있습니다.
- **D1 매개변수 100개**: local.mjs의 `bind()`가 D1처럼 100개 넘으면 오류를 냅니다(`D1_MAX_PARAMS`). 로컬에서만 통과하는 `IN (?, …)` 쿼리를 막기 위한 것이니 끄지 마세요. ID 목록은 `inChunks(ids)`(90개씩)로 나눠 읽거나 서브쿼리로 바꿉니다.
  - 생산의뢰 목록은 진행 상태를 SQL(MR_STATUS_SQL, mrState와 같은 규칙)로 계산해 **LIMIT 전에** 거르고, 300건씩 `page`로 나눕니다. 화면은 `paged=1`로 `{rows, page, more}`를 받아 「더 보기」를 붙입니다(paged 없이 부르면 첫 페이지 배열). 생산 필요 수량은 매개변수 없는 서브쿼리로 출고 전 전체를 읽습니다.
- **하루 번호**: 생산의뢰(MR-YYMMDD-NN)·구매의뢰(PR-…) 번호는 `nextDocNo()`로 INSERT 문장 안에서 숫자 부분 최댓값+1로 정합니다(…-99 다음 -100, -101). 줄·결재선은 번호 대신 request_id(화면이 안 보내면 서버 토큰 `srv:…`)로 의뢰를 찾아 붙입니다. 기존 번호는 바꾸지 않습니다.
- **저장 재시도**: 화면은 작성 화면 하나에 request_id 하나를 쓰고 재시도에도 그대로 보냅니다. 서버는 같은 request_id가 있으면 같은 작성자일 때만 처음 저장된 기록을 `duplicate: true`로 돌려주고(내용은 처음 저장 그대로), 다른 사람이면 409입니다.
- **생산의뢰 초안**: 새 의뢰 작성은 bindEntryDraft(`production-request:new`)로 머리·품목 줄을 이 탭에 보관합니다(비밀번호·사진·파일 없음). 저장 성공 시 지우고 실패 시 남깁니다.
- **단위별 합계**: mrState가 `units`(단위별 의뢰·계획·생산)와 `mixed_units`를 줍니다. 화면의 합계·진행 막대·생산 필요 수량 TOTAL은 단위별(같은 품목·같은 단위끼리)로 보여 줍니다. total_qty 등 합친 값은 호환용으로만 남아 있으니 화면에 쓰지 마세요.
- 회귀 테스트: test/request-concurrency.test.mjs(동시 수정·결재·계획·삭제, 100/300건 초과 목록·필터·필요 수량, 번호 99→100→101·동시 등록, 출고 후 수정 차단, 재시도, 단위별 합계). 마이그레이션 없음.

## 추가 점검 수정 (15.52)
- **승인 요청을 동시에 두 번 승인**(입고 수량 수정·생산실적 수정·반제품 기록 수정): 예전에는 상태를 먼저 approved로 바꾸고 뒤 문장이 `status='approved' AND reviewed_at=같은 초`를 확인해서, 같은 초에 두 번 승인하면 진 쪽이 409를 받으면서도 이력 댓글을 한 번 더 남겼습니다. 이제 모든 문장이 `status='pending'`을 조건으로 갖고 상태 UPDATE를 마지막에 둡니다(15.51과 같은 규칙).
- **대시보드·메뉴 배지 건수**: my-tasks의 승인 대기·생산의뢰 접수 대기·구매의뢰 결재 차례 건수는 COUNT로 셉니다(예전에는 50건에서 멈춤). 목록은 5건만 읽습니다.
- **발주 삭제**: 구매의뢰에서 만든 발주를 지우면 purchase_request_items.po_id를 비워 그 품목을 다시 「발주 생성」할 수 있습니다.
- **결재 차례가 남은 사람**: 결재 대기 중인 구매의뢰에서 아직 차례가 남은(step ≥ current_step, 미결재) 결재·합의자는 삭제·가입 반려를 막습니다(의뢰가 영원히 멈추는 것 방지). 결재를 마치면 삭제할 수 있습니다.
- **사용자 수정(관리자)**: 모든 검사를 먼저 하고 한 batch로 저장합니다(일부만 저장된 뒤 400이 나지 않음). 바꾸지 않은 부서·직급은 사용 중지돼 있어도 그대로 둘 수 있고(orgChoice의 keep), 새로 고르는 값만 목록에서 검사합니다.
- **생산의뢰 완료일**: 반제품 커팅 기록(semi_records)으로만 완료된 줄도 생산 완료일이 나옵니다.
- **초안 안내 문구**: 「이 탭에서만 보관됩니다. 사진은 다시 첨부하세요.」가 영어 등에서 번역되지 않던 것을 고쳤고, 사진이 없는 화면은 bindEntryDraft(..., { noPhotos: true })로 사진 안내를 뺍니다(생산의뢰).
- 휴대폰 생산의뢰 상세: 생산 진행 막대를 접힌 카드에도 보이게 했습니다(data-card-primary). 목록이 300건을 넘으면 건수에 「더 있음」을 붙입니다.
- 남은 한계: 같은 반제품·같은 규격·같은 기간의 반제품 생산일정이 둘 이상이면(예: 두 생산의뢰를 같은 주에 반영) 커팅 기록이 일정마다 중복으로 집계됩니다(생산일정 화면의 실적 규칙과 같음). 한 일정으로 묶거나 기간을 나눠 반영하세요.
- 회귀 테스트: test/review-fixes-1552.test.mjs, receipt-changes(동시 승인), request-concurrency(건수 50 초과), i18n(초안 문구).

## 구매의뢰 목록 「더 보기」 (15.53)
- GET /api/purchase-requests는 200건씩 `page`로 나눕니다. 화면은 `paged=1`로 `{rows, page, more}`를 받아 「더 보기」를 붙이고 건수에 「더 있음」을 표시합니다(생산의뢰 목록과 같은 방식). paged 없이 부르면 첫 페이지 배열입니다.

## 부서별 직급 체계 (15.54)
- 0028_department_positions.sql은 org_departments.positions_json(선택) 칸만 추가합니다. NULL은 기존 공통 직급, JSON 배열은 높은 직급부터의 부서별 직급입니다. 기존 사용자·결재 기록은 바꾸지 않습니다.
- 관리 › 조직 구성의 부서별 「직급 체계」에서 공통/별도 목록을 저장합니다. 연구소 템플릿은 연구소장→수석→선임→연구원이며 버튼을 누른 후 저장해야 적용됩니다. 하위 부서에는 자동 상속하지 않습니다.
- 가입·관리자 사용자 추가/수정은 선택 부서의 직급을 표시하고 서버에서도 조합을 검사합니다. 같은 부서의 기존 직급은 목록에서 빠져도 관리자 수정 시 보존할 수 있지만, 부서 이동 시에는 새 부서의 직급을 골라야 합니다. 부서만 이동할 때 조직도는 호환되지 않는 직급을 비워 저장합니다.
- 공통 직급 개명은 별도 체계를 쓰는 부서의 사용자에게 전파하지 않습니다. 업무/결재 권한은 직급으로 자동 변경하지 않습니다. 신규 마이그레이션을 적용한 뒤 같은 Site에 배포합니다.

## 생산의뢰 「출고 희망」 글 입력 제거 (15.55)
- 작성 화면에서 「출고 희망」(ship_text) 글 입력칸을 뺐습니다. 「출고 희망일」(ship_date)과 겹치기 때문입니다. DB 칸은 그대로 둡니다(마이그레이션 없음).
- 서버 mrHead(body, prior): ship_text를 보내지 않으면 고치기에서는 기존 글을 유지하고, 새 의뢰는 빈 값입니다. 예전 의뢰의 글은 목록·상세의 「출고 희망」에 계속 보입니다.

## 구매 › 발주 입력: 승인된 구매의뢰 불러와 발주 (15.56)
- 구매 담당(hasRole purchase)의 발주 입력 화면 맨 위에 「승인된 구매의뢰에서 불러오기」(#poFromPr, sales.js poFromRequests)가 있습니다. 최종 승인됐지만 아직 발주하지 않은 품목을 구매의뢰별로 보여 주고, 품목을 골라 「발주 처리」하면 POST /api/purchase-requests/:id/po(item_ids)로 발주목록에 올립니다. 그 아래 「직접 발주 등록」은 그대로입니다. 목록 화면(#/purchase/po)에서는 보이지 않습니다(입력 화면의 일부).
- GET /api/purchase-requests?box=order는 행마다 open_items(미발주 품목: id·품목·규격·수량·단위·공급선·입고요청일·bom_id)를 함께 줍니다. 다른 box에는 없습니다.
- 발주 생성 창(prCreateOrders, 구매의뢰 상세의 「발주 생성」도 같은 함수)은 납기일을 고른 품목의 입고요청일 중 가장 이른 날짜로 채웁니다(prDueDate: 2026-12-01·2026.12.1·12/1·12월 1일, 오늘 이전이면 오늘). 날짜가 없으면(ASAP 등) 오늘+7일.
- my-tasks approvals.purchase_orders_waiting(구매 담당): 발주 대기 구매의뢰 건수 → 대시보드 할 일, 메뉴 배지(#/purchase/po/new).
- 표의 빈 열 숨김(col-empty)은 입력칸·버튼이 있는 칸을 빈 칸으로 보지 않습니다(글자 없는 체크박스 열이 숨던 문제).

## 입력칸 겹침 정리 (15.57)
- 생산의뢰: 「비고」 입력칸을 빼고 「사양·요청사항」 하나로 씁니다(노란 강조·생산일정 메모에 붙는 칸). DB note 칸은 유지합니다. mrHead는 note를 보내지 않으면 기존 값을 유지하고, 비고가 있던 예전 의뢰를 고칠 때만 비고 칸을 보여 사양으로 옮기고 비울 수 있게 합니다.
- 구매의뢰: 「납품예정수량」은 비우면 「전량」으로 표시합니다(저장값은 빈 값). 분할 납품일 때만 적습니다.
- 발주 납기일과 입고요청일 중복은 15.56에서 정리했습니다(입고요청일로 납기일 미리 채움).

## 거래처 구분: 매입처·매출처 (15.58)
- 0029_vendor_types.sql: vendors에 is_purchase·is_sales(0/1) 칸 추가. 둘 다 체크할 수 있고, 둘 다 0이면 「구분 없음」으로 어느 목록에나 나옵니다. 마이그레이션은 기존 기록으로 구분을 채웁니다(발주·기타입고 거래처 → 매입처, 출하·생산의뢰 고객사 → 매출처, 이름은 공백 제거·소문자 비교). 지우는 데이터는 없습니다.
- GET /api/vendors?type=purchase|sales: 그 구분 + 구분 없는 거래처. `only=1`이면 그 구분만, `type=none`이면 구분 없는 것만(거래처 관리 필터).
- 화면별 목록: 매입처 = 발주(공급선)·기타입고·구매의뢰 공급선, 매출처 = 출하·생산의뢰 업체·구매의뢰 사용고객사·의뢰 접수의 고객사(VOC·분석·개발·제품 샘플). 상품 샘플의 「공급처 · 고객사」는 전체 목록. bindPartnerPicker(input, hint, { type }).
- 자동 등록(ensureVendor(name, user, type)): 새 거래처는 쓰인 구분으로 등록하고, 이미 있는 거래처는 구분이 하나도 없을 때만 채웁니다(사람이 정한 구분은 바꾸지 않음).
- 거래처 관리: 등록·수정에 매입처·매출처 체크, 목록 「구분」 표시, 구분 필터(고르면 바로 거름). PUT은 체크값을 보내지 않으면 기존 구분을 유지합니다.

## 메뉴 열람 권한 (15.59)
- 업무 묶음(영업·구매·품질·개발·생산·물류·기준 정보) 단위로 메뉴를 숨기고 막습니다. 홈·리포트·내 정보는 항상 보이고, 관리자 화면은 지금처럼 관리자만, 관리자는 항상 전체입니다. **화면에서 숨기고 막는 정리 목적**이며 데이터 API 권한은 바꾸지 않았습니다(역할 체크의 승인·접수 권한도 그대로).
- 0030_menu_access.sql: org_departments.menus(''=제한 없음 → 상위 부서를 따르고 끝까지 없으면 전체, 'home,sales,…'=제한), users.menu_mode(department 기본값·all·custom), users.menus(직접 지정). 처음에는 제한이 하나도 없어 기존 사용자 모두 전체를 봅니다.
- 서버: effectiveMenus(u) → /api/me·로그인·가입 응답의 user.menus(null=전체, 배열=그 묶음만). 부서 PUT의 menus(null 또는 배열), 사용자 PUT의 menu_mode·menus.
- 화면: shell()이 NAV를 canSeeMenu로 거르고(관리 묶음의 거래처·검사규격은 「기준 정보」), render()가 routeMenu(route)로 막힌 주소는 pageNoMenu를 보여 줍니다. 대시보드는 applyMenuAccess가 막힌 업무의 KPI·진행 현황 줄·할 일(대표 링크 기준)을 빼고 나머지 링크는 글자로 바꿉니다. 새 화면을 추가하면 주소 접두어(#/sales, #/purchase, …)가 routeMenu의 묶음과 맞는지 확인하세요.
- 설정: 조직 구성 › 부서 줄 「메뉴」(부서 기본), 관리자 설정 › 사용자 줄 「메뉴: …」(부서 기본 따름·전체 보임·직접 지정).

## 메뉴 권한·거래처 구분 점검 수정 (15.60~15.61)
- 가입용 GET /api/org(로그인 전)는 부서 메뉴 제한(menus)을 빼고 보냅니다.
- **역할 = 그 업무 메뉴**: 구매·품질·개발·생산·물류 역할(책임자 포함)을 받은 사람은 메뉴 제한과 관계없이 그 묶음이 보입니다(effectiveMenus의 ROLE_MENU). 승인·접수 화면이 그 묶음에 있어서, 막으면 일을 처리할 수 없기 때문입니다.
- **구매의뢰 목록(#/sales/pr)은 막지 않습니다**: 결재선은 역할과 관계없이 누구나 지정될 수 있고, 서버가 본인 관련(작성·결재선·참조, 구매 담당은 승인분) 의뢰만 보여 줍니다. 메뉴에는 영업 묶음이 있을 때만 보이고, 대시보드 「구매의뢰 결재 차례」에서 들어옵니다. 작성(#/sales/pr/new)은 그대로 막힙니다.
- 대시보드 할 일 카드: 막힌 업무의 줄을 뺀 뒤 칸별(승인할 일·내가 올린 요청) 건수를 남은 줄 수로 고치고, 칸이 비면 「표시할 건이 없습니다.」로 바꿉니다(카드는 유지). 확인이 필요한 일 카드는 줄이 없으면 뺍니다.
- 거래처 자동 등록: 이미 있는 거래처가 다른 용도로 쓰이면 그 구분을 더합니다(매출처로 등록된 곳에 발주하면 매입·매출 둘 다). 다른 구분은 지우지 않습니다.
- 발주 입력의 「승인된 구매의뢰에서 불러오기」는 200건씩 「더 보기」로 이어 봅니다.

## 휴대폰 사용성 (15.62)
- **하단 탭(820px 이하)**: 홈 · 할 일(#/tasks, 승인·접수 대기 합계 배지 taskTotal) · 자주 쓰는 화면(#/favorites) · 메뉴(☰). 상단의 버전·로그아웃은 휴대폰에서 숨기고 메뉴 아래 「내 정보·로그아웃」(.side-account)으로 옮겼습니다. main 아래 여백은 탭 높이만큼 늘렸습니다.
- **자주 쓰는 화면**: 화면 제목 옆 ☆(favoriteTools)로 고정합니다. 고정 목록은 서버의 내 설정(PUT /api/me/prefs favorites, 최대 20개)에 저장해 다른 기기에서도 보이고, 최근 연 화면 8개는 이 기기(localStorage `wpa:recent:<id>`)에만 둡니다. 메뉴 권한으로 막힌 화면은 보이지 않습니다.
- **내 설정(prefs)**: settings 표의 `prefs:<사용자 id>` 한 줄(JSON, 30KB 이하, 마이그레이션 없음). /api/me·로그인 응답의 `user.ui`로 받습니다(이름이 `prefs.`이면 빌드 금지 문자열 `fs.`에 걸리므로 화면에서는 ME.ui로 씁니다). 사용자를 삭제하면 함께 지웁니다.
- **목록 조건 기억**: rememberList가 선택칸·체크 값은 내 설정 filters[화면주소:폼id]에 저장해(0.8초 뒤) 다음 접속·다른 기기에서도 유지하고, 검색어·날짜는 지금처럼 이 탭에서만 기억합니다. 탭에 기억된 값이 있으면 그것이 먼저입니다.
- **저장 버튼 고정**: 휴대폰에서 입력 폼의 마지막 `.actions`(주요 버튼 포함)는 화면 아래(탭 위)에 sticky로 붙습니다. 모달 안에서는 창 아래에 붙습니다. 목록 검색 폼은 제외합니다.
- **터치 크기(700px 이하)**: 체크·라디오 22px, 선택지(.opts > label.opt)는 높이 44px 칩. 카드 표의 체크박스만 있는 칸은 칸 어디를 눌러도 체크됩니다.
- **입고목록**: 하나라도 체크하면 처리 버튼 줄(.actionbar)을 화면 아래에 띄우고 원래 자리에 같은 높이 빈칸을 둡니다(목록이 튀지 않게).
- **대시보드(700px 이하)**: 「현황 한눈에」「진행 현황」을 접어 두고 할 일·알림을 먼저 보여 줍니다. 할 일의 구매의뢰·생산의뢰 번호는 버튼으로 바로 상세를 엽니다(data-task-pr / data-open-mr).
- **입력 초안 확대**: 새 구매의뢰(머리·품목·결재선), 의뢰서 상세 양식(분석·VOC·개발·샘플, 칸 순서로 보관 uxIndexRead/uxIndexRestore)에도 bindEntryDraft를 붙였습니다. 사진은 보관하지 않습니다.
- **홈 화면에 추가**: public/manifest.webmanifest(standalone), assets/icon-192·512.png, apple-touch-icon.png, theme-color·apple 메타. local.mjs·scripts/build.mjs 자산 목록에 포함합니다. 서비스 워커(오프라인)는 없습니다.

## 관리자 설정 사용자 표 정리 (15.63)
- 증상: 권한 10개를 열 하나씩 두고 머리글에 긴 이름(「물류팀장(입고 수량 수정 승인)」 등)을 줄바꿈 없이 쓰는 데다, 15.59에서 버튼 칸(한 줄 고정)에 「메뉴」 버튼이 늘어 표가 넓어지면서 이름 칸이 한 글자 폭으로 눌려 세로로 보이고 가로 스크롤이 생겼습니다.
- 표는 이름 · 가입 상태(가입일 포함) · 권한 · 버튼 네 칸입니다. 권한 10개와 관리자는 한 칸 안의 이름 붙은 체크 칩(.role-chip, 짧은 이름 ROLE_SHORT, 긴 이름은 title·aria-label)으로 줄바꿈하며, 체크하면 지금처럼 바로 저장됩니다(data-role / data-admin 그대로). 버튼은 여러 줄로 감싸고(.user-tools) 이름은 한 줄로 고정합니다. 1000·1360·1920px에서 가로 스크롤 없음.
- 체크된 칩·선택지 칩의 글자는 var(--text)(다크 모드 대비), 비활성 칩은 흐린 글자·점선 테두리(opacity 쓰지 않음).
- 왼쪽 메뉴 스크롤바는 가늘게(6px, 테마 선 색) 표시합니다.

## 품목(제품코드) 완전 삭제 (15.64)
- 제품등록 카드마다 「삭제」 버튼(관리자). GET /api/boms/:id/usage가 사용처(BOM_USES: 발주·출하는 product_code, 기타입고·생산일정·반제품 기록·구매의뢰·생산의뢰·의뢰 data.bom_id는 bom_id, 다른 제품 구성자재는 materials의 이름)를 세고, 하나도 없을 때만 DELETE /api/boms/:id?purge=1이 행을 지웁니다. 확인과 삭제 사이 경합은 DELETE 문장의 NOT EXISTS 조건으로 막습니다(변경 0건이면 409).
- 쓰이는 품목은 사용처·건수를 보여 주고 「사용 중지」(기존 DELETE, purge 없이)나 임시 코드의 「기존 품목으로 합치기」를 안내합니다. 임시 코드는 합치면 기록이 정식 품목으로 옮겨져 사용처가 0이 되므로 그 뒤 삭제할 수 있습니다.
- 진행 코멘트(entity bom)는 이력이라 지우지 않습니다. 새 표에 bom_id·product_code를 저장하면 BOM_USES에도 추가하세요.

## 오퍼레이터 화면 로그아웃 복구 (15.65)
- 15.62에서 휴대폰(820px 이하) 상단의 #logout을 숨기고 메뉴 안(.side-account)으로 옮겼는데, 오퍼레이터 화면은 메뉴가 없어서 로그아웃할 방법이 없어졌습니다. 숨김 규칙을 `body:not(.operator-mode)`로 한정했습니다(오퍼레이터는 상단 로그아웃 그대로). test/operator-ui.test.mjs가 이 조건을 검사합니다.

## 발주 처리 수량·단가 수정 · 발주서 출력 (15.66)
- 0031_po_unit_price.sql: purchase_orders.unit_price(REAL, NULL 허용) 칸만 추가합니다. 기존 발주는 빈 값으로 두고 추정해 채우지 않습니다.
- 구매의뢰에서 발주 처리(POST /api/purchase-requests/:id/po)는 `lines: [{ id, qty, unit_price }]`로 품목별 발주 수량·단가를 바꿀 수 있습니다(없으면 의뢰 수량·매입단가). 수량이 다르면 비고에 「의뢰 10 → 발주 12」를 붙이고, 규격(spec)·단가를 발주에 함께 저장합니다. 발주 수량 0 이하·음수 단가는 거부합니다.
- 발주 수정(PUT /api/po/:id)·직접 등록(POST /api/po)도 unit_price를 받습니다(빈 값이면 지움). 수정 이력 라벨 「단가」.
- 발주서(app.js poPrintSheet): 거래처별 한 장(발주일·발주번호=구매의뢰번호·수신 거래처와 담당·연락처·발주 담당·납기일·품목/규격/단위/수량/단가/금액/합계·비고·발주처 (인)). 단가 없는 품목은 금액을 비우고 합계에서 뺀다고 표시합니다. 발주 처리 직후 자동으로 열리고, 발주목록 각 줄의 「발주서」는 같은 구매의뢰번호·거래처의 발주를 한 장으로 엽니다. 인쇄는 세탁 성적서와 같은 body.printing-cert 방식이며 거래처마다 쪽을 나눕니다. 발주서 본문(.cert)은 번역하지 않습니다.

## 제품등록 목록 표로 바꿈 (15.67)
- 제품등록(#/admin/bom) 목록을 카드에서 표(table.grid.bom-table)로 바꿨습니다: 제품명·코드 · 분류(세부 분류·생산 종류·사이즈) · 종류·기준 · 구성자재(「자재 N개」 details로 펼침) · 상태 · 입력 · 버튼(진행 코멘트·합치기·수정/정식 코드로 확정·사용 중지·삭제). data-bom-* 버튼과 동작은 그대로입니다. 한 화면에 약 14개(예전 약 2개)가 보입니다.
- 사용 중지된 품목은 줄 글자를 흐리게(.row-off) 표시합니다. 휴대폰에서는 공통 규칙대로 카드로 바뀌며 버튼 칸은 접힌 카드에도 보입니다(data-card-primary).

## 제품등록 세부 분류 칩 · 거래처 구분 탭 (15.68)
- 제품등록: 분류 탭(원자재 등)을 고르면 그 아래 #bomSubTabs에 1차 세부 분류 칩(건수, 「세부 분류 없음」 포함)이 나오고, 1차를 고르면 2차 칩이 이어집니다. 칩은 받은 목록을 화면에서 거르며(서버 요청은 분류 탭·검색 조건 그대로), 분류 탭을 바꾸면 초기화됩니다. 「전체」 탭과 세부 분류가 없는 분류에서는 숨깁니다. 원자재·부자재·상품은 의미 없는 「완제품 · 기준」 대신 「단위」를 보여 줍니다(제품·반제품만 종류·기준).
- 거래처 관리: 「조건」 안의 구분 선택칸 대신 목록 위 탭(전체 / 매입처 / 매출처 / 매입·매출 / 구분 없음, 검색 결과 기준 건수)으로 거릅니다. 고른 탭은 이 기기에 기억합니다(localStorage `wpa:vendor-tab`). 서버 API(type·only)는 그대로입니다.

## 운송비 조건 · 내부 메모 · 넓은 발주 처리 창 · 발주 삭제 후 되살아남 수정 (15.69)
- 0032_freight_internal_note.sql: 칸만 추가합니다(기존 데이터는 그대로). vendors.freight_terms(JSON 배열, 기본 '[]'), purchase_requests.freight(JSON 객체 {거래처: 금액}, 기본 '{}'), purchase_orders.internal_note(기본 '')·freight(REAL, NULL 허용), purchase_request_items.order_closed(기본 '').
- 매입처 운송비 조건(거래처 관리 「운송비 조건」): 최대 10줄 `{ when: always|gte|lt, amount, fee, per: order|line, note ≤30 }`. 맞는 줄을 모두 더합니다(per=line은 품목 수만큼). 서버 freightTerms()가 검사하고, PUT에서 보내지 않으면 기존 값을 유지합니다. 화면 계산은 app.js freightCalc/freightSummary(만원 표기는 한국어 화면만).
- 구매의뢰서: 공급선별 운송비 칸(조건으로 자동 계산, 손으로 고친 값은 유지)을 body.freight로 저장하고, 상세·목록에 freight/freight_total을 줍니다. 이익 = 판매 − 매입 − 운송비.
- 발주 처리 창(prCreateOrders): 넓은 창(promptBox wide/onOpen). 품목별 발주 수량·단가·내부 메모(기본 「사용고객사+향」), 거래처별 운송비(그 거래처로 아직 발주하지 않았으면 의뢰서 값, 아니면 조건 계산), 발주 금액·운송비·총액을 실시간 표시. 서버는 lines[].internal_note와 body.freight를 받고, 운송비는 거래처별 첫 발주 한 건에만 붙입니다. body.freight가 없으면 의뢰서 값을 쓰되 같은 의뢰서의 앞선 발주에서 이미 운송비가 붙은 거래처는 빼서 두 번 붙지 않게 합니다.
- 내부 메모는 발주목록·입고목록(물류)에 「내부」 칩으로 보이고 발주서에는 나가지 않습니다. 발주서는 운송비가 있으면 운송비·총액 줄을 붙입니다. 발주 수정·직접 입력(POST /api/po, 다건 입력 공통 칸)도 internal_note·freight를 받습니다. 수정 이력 라벨 「내부 메모」「운송비」.
- 발주 삭제: 예전에는 구매의뢰에서 만든 발주를 지우면 의뢰 품목의 연결만 풀려 「발주 대기」에 다시 나타났습니다(사용자 보고: 삭제한 발주가 계속 살아남). 이제 DELETE /api/po/:id는 기본으로 그 품목을 order_closed(「발주 삭제 · 이름 · 시각」)로 닫고, `?requeue=1`일 때만 발주 대기로 되돌립니다. 발주목록 삭제 버튼은 구매의뢰 발주(GET /api/po의 pr_item_id)에 「삭제 (발주 안 함)」/「삭제 후 다시 발주 대기로」 선택창을 띄웁니다.
- 발주 대기 목록 품목별 「발주 안 함」, 의뢰서 상세 「발주 안 함」 칩과 「발주 대기로」: POST /api/purchase-requests/:id/items/:itemId/order-closed `{ closed, reason }`(구매 담당·최종 승인된 의뢰·미발주 품목만). 발주 대기·할 일 건수·can_order·발주 처리는 `po_id IS NULL AND order_closed=''`만 봅니다. 목록 행에는 closed 건수를 줍니다.

## 품목 찾기 창 · 등록 품목 고정 · 현재고 · 발주서 비고 (15.70)
- public/item-picker.js(index.html·local.mjs·build.mjs 포함, multi-items.js보다 먼저 로드): openItemPicker(catalog, { query, filter }) → 고른 품목(boms 행) 또는 null. 분류 탭(.seg) · 1차/2차 세부 분류 칩(.sub-chip, 건수) · 검색(여러 단어 AND, 띄어쓰기·대소문자 무시, 코드 일치·이름 시작 우선) · 표(코드·품목명·단위·현재고·분류·사이즈, 200건까지). ↑↓·Enter, 줄 클릭으로 고릅니다. 마지막에 고른 분류 탭은 이 페이지에서 기억합니다.
- 구매의뢰·생산의뢰 품목 줄과 생산의뢰 「사이즈별 입력」은 브라우저 기본 목록(datalist prCatalogList/mrCatalogList)을 없애고 「품목 찾기」 버튼 + 품목명 칸 Enter·↓로 이 창을 엽니다. 등록 품목명을 그대로 입력하면 자동 연결합니다(bindItemPick). 발주·출하·기타입고·생산계획 다품목 입력은 「BOM/품목 검색」 칸 대신 「품목 찾기」 버튼이 선택칸(data-line-key=bom_id) 값을 정합니다.
- 등록 품목 고정(itemLockApply): 코드를 고르면 품목명·제품코드·단위를 등록 값으로 채우고 읽기 전용, 규격은 등록 사이즈가 있으면 그 사이즈 선택칸(select data-k=spec), 없으면 입력칸(사이즈·메모용)입니다. 「직접 입력으로」가 풀어 줍니다. 서버 prItems·mrLines도 bom_id가 있으면 단위=품목 단위(비어 있으면 입력값), 규격은 등록 사이즈 중 하나 또는 빈 값만 받습니다(lockedSpec, 아니면 400). 등록 사이즈가 없는 품목은 규격을 그대로 받습니다(사이즈를 정하려면 제품등록 › 분류 관리). 품목명·제품코드는 예전부터 품목 원본 값으로 저장합니다.
- 현재고: itemStockLoad()가 GET /api/inventory?asof=오늘(재고 현황과 같은 계산: 기초재고·입고·생산 − 투입·출하 ± 조정)을 한 번 읽어 1분 동안 씁니다. 품목명(띄어쓰기·대소문자 무시)으로 맞추고 단위별로 보여 줍니다(품목 단위 먼저, 기록 없으면 0). 찾기 창 표, 고정 안내, 생산의뢰 사이즈별 입력, 다품목 입력의 품목 요약에 나옵니다. 구매의뢰의 「현재고」 칸 자동 채움은 그대로입니다.
- 발주서 비고: 예전에는 발주서 비고 칸이 항상 비어 있었습니다. poSheetMemo()가 발주 note에서 사람이 쓴 부분만 모읍니다(구매의뢰 발주의 자동 문구 「구매의뢰 PR-…」·규격·「의뢰 a → 발주 b」 제외, 모두 같으면 한 번, 다르면 「품목 규격: 비고」 줄). 내부 메모는 넣지 않습니다. 미리보기의 비고 칸은 인쇄 전에 고칠 수 있습니다(contenteditable, 저장하지 않음). 구매의뢰 발주 처리 창의 「발주서 비고」(body.note, 300자)는 자동 문구 뒤에 ` · 비고`로 붙습니다.
- 마이그레이션 없음.

## 고정된 칸 표시 (15.71)
- 등록 품목을 골라 읽기 전용이 된 칸(품목명·제품코드·단위, 다품목 입력의 품목명·단위, 생산의뢰 사이즈별 입력)은 itemLockMark(input)가 라벨에 .is-locked와 「🔒 고정」(.lock-tag, title로 이유)을 붙이고, CSS가 회색 빗금 바탕(--locked-bg/--locked-stripe, 라이트·다크 두 벌)·흐린 글자·점선 테두리·not-allowed 커서로 표시합니다. 「직접 입력으로」 등으로 풀면 함께 사라집니다. 새 고정 칸을 만들면 readOnly를 바꾼 뒤 itemLockMark를 부르세요.

## 입고 입력 개편: 입고번호·LOT 여러 개·부분 입고·창고·입고증·LOT 라벨·LOT별 재고 (15.72)
- 0033_receipts_lots_warehouses.sql(추가만): receipts(입고 묶음, receipt_no RC-YYMMDD-NN, receipt_date, vendor, note, request_id UNIQUE), po_receipt_lots(발주입고의 LOT 줄: po_id, receipt_id, lot, qty, received_date, warehouse, location, note, voided_at), other_receipts.receipt_id·warehouse·location, warehouses(name UNIQUE, locations 쉼표 목록, sort, active). 세 표는 전체 백업 대상입니다.
- POST /api/receipts `{ receipt_date, vendor, note, request_id, lines: [{ po_id | bom_id, lot, qty, warehouse, location, note, spec }] }`(1~100줄): 한 batch로 저장합니다.
  - 발주 줄은 발주별로 모아 LOT 줄을 쌓고, recv_qty = 취소 안 된 줄의 합, 상태는 합 = 발주 수량이면 ok, 아니면 mismatch(부분 입고 포함, 남은 수량은 더 받거나 기존 「입고확인·완료」로 종결). 이미 ok인 발주·다른 거래처·승인 대기 수정이 있는 발주는 거부합니다. recv_at = 입고일 + 저장 시각, lot 칸 = LOT 목록.
  - **불변식**: po_receipt_lots에 취소 안 된 줄이 있는 발주는 recv_qty = 그 합. 예전 방식(줄 없음)으로 기록된 발주에 LOT 줄을 더하면 먼저 기존 recv_qty를 「이전 입고」 줄로 옮깁니다. 입고 수량 수정 승인은 차이를 보정 줄로 더하고, 입고 취소 승인은 줄을 모두 voided 처리합니다(receipt-changes approve). /api/po/receive의 기존 규칙은 그대로입니다.
  - 동시 처리: 발주 UPDATE에 읽은 상태·수량을 조건으로 걸고 바로 뒤에 `SELECT json('conflict') WHERE changes()=0`(RC_GUARD)를 둡니다. 바뀐 줄이 없으면 오류로 batch 전체가 되돌려지고 409를 줍니다.
  - 수입검사: 발주는 첫 입고 때 한 건(기존과 같음), 이후 추가 입고는 그 검사에 「[추가 입고] RC-…」 코멘트. 기타입고 줄은 줄(LOT)마다 other_receipts 한 줄과 수입검사 한 건(기존과 같음), batch_id = request_id.
  - request_id 재시도: 같은 작성자면 처음 저장된 입고를 duplicate:true로 돌려주고, 다른 사람이면 409.
- 재고(STOCK_MOVEMENTS): LOT 줄이 있는 발주는 줄마다 입고일로(새 원천 1개, 원천 수 9), 없는 발주는 예전처럼 recv_qty·recv_at. test/inventory.test.mjs의 원천 수 검사를 9로 바꿨습니다.
- GET /api/receipts(검색: 입고번호·거래처·비고·입력자·품목·LOT, 200건씩 page), /api/receipts/:id(줄 포함), /api/receipts/open-po?vendor=(미입고·확인중·수량상이 발주), /api/lots/next?prefix&date&count(접두어+YYMMDD_순번 3자리, 발주입고·기타입고에 쓰인 번호 다음부터 제안).
- 창고: GET /api/warehouses(?all=1), POST/PUT(물류팀장·관리자, 삭제 없이 사용 중지). 이름을 바꾸면 LOT 줄·기타입고의 창고 이름도 함께 바꿉니다. 줄의 창고는 사용 중 창고만, 위치는 그 창고 목록 안에서만(목록이 비면 자유) 받습니다.
- LOT별 재고 GET /api/inventory/lots?asof&q&state=instock: LOT가 적힌 입고(LOT 줄·예전 발주입고·기타입고) − 같은 LOT 출하. 생산 투입은 LOT가 없어 빼지 않습니다(화면에 안내). 원천 4개를 batch로 나눠 읽습니다(큰 UNION 금지).
- 화면 public/receipts.js(index.html·local.mjs·build.mjs 포함): 메뉴 물류 › 입고 › 입고 입력(#/logistics/receipt/new)·입고목록·입고증 목록(#/logistics/receipts). 예전 「기타입고 입력」(#/logistics/other/new)은 주소만 남깁니다.
  - 입고 입력: 입고일·거래처·비고 → 발주입고 탭(거래처의 미입고 발주 표, 체크 후 「선택 발주 담기」, 남은 수량으로 줄 생성) / 기타입고 탭(품목 찾기, 반제품 제외) → 입고 상세 표(LOT·수량·창고·위치·비고, 발주 줄은 발주·기입고·이번·남음 요약).
  - 「LOT 나누기」(개수·줄마다 수량, 자동 번호), LOT·수량 칸 붙여넣기(여러 줄·「LOT[탭]수량」 → 아래로 같은 품목 줄), Enter = 아래 줄 같은 칸, 「LOT 자동 번호」(빈 LOT), 「일괄적용」(창고·위치·수량·비고, 선택 줄 또는 전체), 「선택 줄 삭제」, 「창고·위치 관리」(물류팀장·관리자). 초안은 이 탭에 보관(bindEntryDraft receipt:new). 거래처가 그대로면 발주 표를 다시 그리지 않습니다(체크 유지).
  - 저장하면 입고증(입 고 증, .cert 번역 안 함, 인쇄는 body.printing-cert)을 열고, 「LOT 라벨(QR) 출력」은 줄마다 라벨(QR 내용 `LOT|코드|수량 단위|입고번호`). QR은 외부 라이브러리 없이 receipts.js의 qrMatrix(바이트 모드·M·버전 1~10)로 만듭니다(jsQR로 1~10버전·한글 읽힘 확인).
  - 입고목록의 「LOT·부분 입고 처리」: 체크한 발주(같은 거래처, 입고완료 제외)를 sessionStorage `wpa:rc-preload`로 넘겨 입고 입력에 담습니다. 부분 입고(수량상이 중 발주보다 적음)는 상태 옆에 「남음 N」을 보여 줍니다.
  - 재고 현황의 「LOT별 재고」 창. 줄을 다시 그릴 때마다 휴대폰 카드 이름표(td data-label)를 직접 붙입니다(labelGridTables는 표마다 한 번만).

## 제품등록 BOM 트리·바로 고치기·역조회 (15.73)
- 제품등록에 「보기: 목록 / BOM 트리」(이 기기에 기억, localStorage `wpa:bom-view`)와 「사용 / 미사용 / 전체」 칩(목록 조건 「사용 상태」와 같은 값)을 두었습니다.
- public/bom-tree.js(index.html·local.mjs·build.mjs 포함) renderBomTree: 구성자재가 있는 품목만, 제품 줄(코드·이름·분류·세부 분류·구분·단위·기준 수량·비고+포장 환산 `1PK = 100SH`·사용·수정) 아래 자재 줄(코드는 같은 이름의 등록 품목에서 찾음, 없으면 「미등록」·세부 분류·단위·소요량). ▾로 제품별 접기, 전체 펼치기·접기(접힌 상태는 페이지 안에서 기억). 자재 코드·역조회는 조건과 상관없이 전체 품목(include_archived=1)에서 찾습니다.
- 품목명을 누르면 그 품목을 자재로 쓰는 제품(역조회: 코드·이름·소요량·기준·상태)을 보여 줍니다(이름은 공백·대소문자 무시 비교).
- 바로 고치기(관리자 화면): 기준 수량·자재 소요량·사용 체크를 고치면 칸이 표시되고 「변경 저장 (N)」이 제품별로 POST /api/boms/:id/quick `{ updated_at, before: { base_qty, active, qty[] }, base_qty?, materials?: [{ item, qty }], active? }`를 보냅니다. 서버는 읽은 값(before·updated_at)이 지금과 다르면 409, 자재 이름·순서가 다르면 409, 0 이하는 400. 저장은 조건부 UPDATE + RC_GUARD + 진행 코멘트 `[수정] 기준 수량 1 → 2 · 자재 소요량 a → b`. 이름·단위·자재 추가/삭제는 기존 「수정」 창에서 합니다.
- 마이그레이션 없음.

## 제품등록 목록 가독성 (15.74)
- 목록 표 열: 코드(첫 칸, 없으면 「코드 없음」) · 품목명(+비고) · 분류(「원자재 › 1차 › 2차」 한 줄, 생산 종류·사이즈) · 단위 · 기준(제품·반제품은 「· 완제품 기준 N」, 포장 환산) · 구성자재(1개면 자재 이름, 여러 개면 「자재 N개」 펼침) · 상태(점 + 사용/중지) · 작업. 입력자·입력일 칸은 없애고 줄 title로 보여 줍니다.
- 한 줄 높이(위아래 7px)·줄 구분선·마우스 올림 강조. 사용 중 품목을 먼저, 중지 품목을 뒤로(화면에서 정렬). 중지 줄은 흐린 글자.
- 줄 버튼은 「수정」 + 「더보기 ▾」(details.row-menu). 메뉴(진행 코멘트·기존 품목으로 합치기·사용 중지 또는 다시 사용·삭제)는 버튼 아래에 화면 기준(position: fixed)으로 떠서 줄 높이를 바꾸지 않고, 한 번에 하나만 열리며, 바깥을 누르면 닫히고, 스크롤하면 위치를 다시 맞춥니다(버튼이 화면 밖이면 닫음). data-bom-* 속성은 그대로라 기존 동작이 같습니다. 「다시 사용」(data-bom-enable)은 POST /api/boms/:id/quick active:true.
- 분류 칩·「사용/미사용/전체」 칩과 겹치는 「분류」「사용 상태」 선택칸은 화면에서 숨깁니다(.dup-filter, 값은 그대로 조회 조건).

## 15.69~15.74 점검 수정 (15.75)
- 발주 삭제: 취소 안 된 LOT 입고 줄이 있으면 409(「입고 취소 요청」으로 되돌린 뒤 삭제). 발주 삭제와 의뢰 품목 닫기/되돌리기는 deleteEntityWithAttachments(…, extra)로 한 batch.
- 입고 수량 수정 승인: 보정 줄은 활성 LOT가 하나면 그 LOT, 여럿이면 LOT 없이 저장하고 LOT별 재고에 「(LOT 미지정 수량 수정)」 줄로 보여 LOT별 합 = 실입고. 입고 취소 승인은 LOT 줄로 받은 발주의 lot 칸도 비웁니다. 새 입고의 LOT 목록에 발주의 예전 lot는 예전 방식 입고를 옮길 때만 넣습니다.
- /api/lots/next: `LIKE` 대신 접두어 정확 일치(대소문자 구분) + 뒤가 숫자뿐인 LOT만 셉니다. 화면은 서버의 다음 번호와 표에 이미 있는 번호 중 큰 것 다음부터 붙이고(저장 전 줄끼리 중복 없음), LOT 나누기는 적어 둔 LOT를 남깁니다.
- /api/inventory/lots: 원천마다 SQL에서 품목·단위·LOT로 묶어 읽고, 한 원천이 5000묶음을 넘으면 more=true.
- 고치는 구매의뢰·생산의뢰: 기존 줄과 같은 품목·같은 규격이면 등록 사이즈에 없어도 받습니다(lockedSpec prior). 화면은 그 값을 「(이전 값)」 선택지로 남깁니다.
- 입고 입력 표에 「규격」 칸: 발주 줄은 발주 규격 표시, 기타입고 줄은 등록 사이즈가 있으면 선택칸, 없으면 입력칸(나누기·붙여넣기 줄로 복사).
- BOM 트리: renderBomTree(…, onEdit)로 다시 그려도(변경 취소 등) 「수정」이 동작합니다.

## 입고 입력 화면 폭·입고증 비고 (15.76)
- 입고 입력에 줄을 담으면 1024~1280px에서 양식 전체가 표 최소 폭만큼 늘어나 「입고 등록」이 화면 밖으로 밀렸습니다. .stack(grid)의 자식 min-width:auto 때문이라 .rc-form 계열에 min-width:0을 주고, 표 마지막 머리칸의 sr-only 글자(absolute)가 표 스크롤 밖으로 나가 문서를 넓히지 않도록 해당 .table-wrap에 position:relative를 줬습니다(입고 입력·발주 표·제품등록). 표만 가로 스크롤합니다.
- 입고증: 기타입고 줄 비고가 머리 비고와 같으면(머리 비고를 줄 비고로 저장하는 기존 규칙) 줄에는 비우고 아래 비고 칸에만 보입니다.

## 2차 점검 수정 (15.77)
- /api/po/receive: UPDATE마다 읽은 recv_status·recv_qty를 조건으로 걸고(이미 입고완료를 다시 입고완료로 누르는 것은 허용) 바로 뒤 RC_GUARD. 같은 순간 입고 입력(LOT 줄)이 저장되면 409로 batch 전체를 되돌려 recv_qty = LOT 합을 지킵니다. 결과 묶음은 발주당 4문장(업데이트·가드·코멘트·분석).
- PUT /api/po/:id: 취소 안 된 LOT 줄이 있으면 수량·거래처·품목·단위 변경을 409로 막습니다(납기·비고·단가·내부 메모 등은 가능). 고치려면 입고 취소 요청 뒤.
- 입고 입력: 이번 줄에 LOT가 없고 예전 입고도 없으면 발주에 미리 적어 둔 lot를 유지하고, 화면은 그 LOT로 첫 줄을 미리 채웁니다. recv_at은 지난 입고일로 넣어도 뒤로 가지 않습니다(가장 늦은 입고).
- 발주 삭제의 LOT 확인을 batch 안의 첫 문장(`SELECT json('conflict') WHERE EXISTS(활성 LOT)`)으로도 겁니다. 입고증 줄은 LEFT JOIN이라 지운 발주의 줄은 「(삭제된 발주)」로 보입니다.
- LOT별 재고: 원천마다 kind(in/out)로 입고·출하를 나눠 셉니다(수량 수정 보정은 입고 쪽 음수, 출하로 보이지 않음). LOT 줄로 받은 발주의 LOT 없는 줄(보정·LOT 없이 받은 줄)은 「(LOT 미지정)」 한 줄로 모아 그 발주의 LOT별 합 = 실입고. 한 원천이 5000묶음을 넘으면 잘린 잔량 대신 400(검색어로 좁히기).
- reports.mjs 입고 집계: LOT 줄로 받은 발주는 po_receipt_lots를 발주·입고일별로 묶어 입고일에 넣고(나눠 받은 날짜별), 줄 없는 발주는 예전처럼 recv_at.
- 대시보드 po.partial(수량상이 중 발주보다 적게 받음)을 따로 세어 「부분 입고 (남음)」 노란 KPI로 보이고, po.mismatch는 다 받았거나 초과한 수량상이만 셉니다.
- 제품등록 「더보기」 메뉴의 문서 수준 이벤트(click·scroll·resize·Esc)는 app.js 최상위에서 한 번만 등록합니다(화면을 다시 열 때마다 쌓이던 문제). Esc로 닫고 버튼으로 포커스를 돌려줍니다.
- 창고 이름에 쉼표 금지(LOT별 재고 위치 목록 구분자).

## 수입검사 판정을 목록에 표시 (15.78)
- 사용자 보고: 수입검사가 불합격이어도 분석리스트에는 「완료」만 보였습니다(판정은 수입·출하 검사 이력 화면에만 있었음).
- GET /api/requests는 행마다 inspection_result(inspection_measurements.result: pass/fail/pending, 측정값이 없으면 null)를 함께 줍니다. 분석리스트에 「판정」 칸(규격이 있으면 합격/불합격/검사 대기, 규격 미지정은 「규격 미지정」), 불합격 줄은 row-red, 상태 칩 옆에 「전체 판정·합격·불합격·검사 대기」 칩(화면에서 거름).
- GET /api/po·/api/other-receipts는 연결된 수입검사의 qc_result를 함께 주고, 입고목록(발주입고 상태 칸·기타입고 품목 칸)에 qcChip()으로 「수입검사 합격/불합격/측정 중」을 보여 줍니다(판정 전에는 표시 없음).

## 입고 입력: 품목 여러 개 + LOT 수 한 번에 (15.79)
- openItemPicker(catalog, { multi: true }): 줄 앞 체크·줄 끝 「LOT 수」(1~50) 칸·하단 「LOT 자동 번호」·「확인 (N줄 추가)」. 줄·품목명 클릭과 Enter는 체크를 바꾸고(창이 닫히지 않음), LOT 수를 바꾸면 자동 체크, Ctrl/⌘+Enter로 확인. 고른 품목은 검색·분류를 바꿔도 유지(Map, 고른 순서). 결과 `{ items: [{ bom, count }], autoLot }`. multi가 아니면(구매의뢰·생산의뢰·발주 다품목 등) 예전처럼 한 개를 바로 고릅니다.
- 입고 입력 기타입고 탭 「품목 추가 (여러 개·LOT 수)」가 이 창을 열어 품목마다 count만큼 줄을 만들고, 자동 번호면 nextLots로 한꺼번에 번호를 붙입니다. 단가 칸은 두지 않습니다(사용자 결정). 입고 내역과 입력은 지금처럼 다른 화면입니다(사용자 결정).
- 품목 찾기 표: 공통 표 처리(labelGridTables)가 처음 그릴 때 빈 열 머리칸에 col-empty를 붙이지만 줄은 다시 그려지므로, draw마다 col-empty를 지워 머리칸이 밀리지 않게 합니다.

## 매입전표·매입 마감 (15.80)
- 흐름: 물류가 입고(발주입고 LOT 줄·LOT 없는 발주입고·기타입고)를 잡으면, 구매가 공급사 거래명세서를 받아 「매입전표 입력」에서 거래처를 고르고 전표 없는 입고 줄을 체크·단가 확인(발주 단가 미리 채움, 기타입고는 직접)·운송비·명세서 합계 대조 후 저장합니다. 달이 끝나면 「매입 마감」에서 거래처별로 마감합니다.
- 마이그레이션 0034: purchase_bills(PB-YYMMDD-NN, 과세/영세, 공급가액·부가세·합계, 명세서 번호·합계, request_id UNIQUE), purchase_bill_lines(source_type po_lot/po/other + source_id, `active=1`인 원천은 UNIQUE → 한 입고 줄은 한 전표에만), purchase_closings(period·vendor_key, status='closed' UNIQUE, 마감 취소는 reopened로 이력 유지).
- 금액: 줄마다 trunc(수량×단가) + trunc(운송비) = 공급가액, 부가세 = trunc(공급가액×0.1)(영세·면세는 0), 원 미만 절사. 단가는 서버가 원천을 다시 읽어 body 단가 또는 발주 단가를 쓰며, 없으면 400.
- LOT 줄로 받은 발주의 '이전 입고' LOT는 그 발주가 이미 'po' 전표 줄을 가졌으면 원천에서 빠집니다(이중 청구 방지).
- 잠금: 전표에 들어간 발주는 입고 취소 요청·삭제·수량/거래처/품목/단위 변경이 409, 전표에 들어간 기타입고는 수정·삭제 409. 마감한 달·거래처는 전표 생성·취소 409. 이번 달·미래 달은 마감 불가. 마감 취소는 관리자.
- 얼마에요 엑셀 내보내기는 사용자가 업로드 양식을 주면 따로 합니다.
- 분류 관리: 「삭제」 추가. DELETE /api/item-categories/:id(관리자)는 하위 분류가 있거나 이 분류 경로로 등록된 사용 중(active=1) 품목이 있으면 409(사용 중지 안내). 지운 뒤 반제품 생산 종류 상속을 다시 맞춥니다.

## 매출전표·입금·기간별 거래보고·매출 마감, 엑셀 (15.81)
- 영업 › 매출전표: 매출전표 입력 / 매출전표 목록 / 입금 / 기간별 거래보고 / 매출 마감. 권한은 새 역할 `sales`(영업, 관리자 화면에서 부여) 또는 관리자.
- 마이그레이션 0035: sales_bills(SB-YYMMDD-NN), sales_bill_lines(source_type ship/manual, 출하 줄은 `active=1 AND source_id IS NOT NULL` UNIQUE, 줄마다 vat), sales_payments(kind payment=입금·잔액에서 뺌 / opening=기초 미수금·잔액에 더함), sales_closings(period·customer_key, closed UNIQUE, 마감 취소는 reopened).
- 금액: 줄 trunc(수량×단가), 부가세 trunc(공급가액 합×0.1)(영세 0)를 줄마다 trunc(줄×0.1)로 나누고 차이는 가장 큰 줄에(splitVat). 단가는 출하 줄마다 「이 거래처에 마지막으로 판 단가」(같은 품목코드, 없으면 같은 품목명)를 미리 채움. 출하 기록이 없는 줄은 manual.
- 잠금: 전표에 들어간 출하는 PUT/DELETE /api/shipments와 단위 변경(/api/items/shipment) 409. 마감한 달·거래처는 전표·입금 생성/취소 400. 이번 달은 마감 불가.
- GET /api/sales-ledger?from&to[&customer]: 거래처가 있으면 기초잔액(시작일 전 매출 합 + 기초 미수금 − 입금) + 기간 줄(같은 날은 입금 먼저)·줄마다 잔액·합계, 없으면 거래처별 요약.
- GET /api/bill-lines?side=sales|purchase&from&to[&party]: 엑셀용 확정 전표 줄(최대 1만). 매입은 운송비를 그 전표 끝 「운송비」 줄로 붙임.
- public/xlsx.js: 라이브러리 없이 .xlsx(무압축 zip) 생성. 한 값 한 칸(병합 없음), 표 안 빈 줄 없음, 금액·수량은 숫자 칸(#,##0), 날짜는 날짜 칸(yyyy-mm-dd), 머리글 틀 고정 + 자동 필터, 합계 줄. 사용자 요청: 얼마에요 엑셀처럼 열을 골랐을 때 옆 칸까지 잡히거나 합계가 0이 되면 안 됨.
- rangePresets(from, to, {onPick}): 오늘·어제·이번 주·지난 주·이번 달·지난 달·1~4분기·상/하반기·금년·작년 + ◀▶(같은 단위로 이동). 매출전표 목록·입금·기간별 거래보고·매입전표 목록에 붙임. 매입전표 목록에도 「엑셀 (줄별)」.

## 매입전표 입력 개선: 발주별 묶음·수량 나눠 잡기 (15.82)
- 사용자 결정(로스제로·얼마에요 화면 PPT 검토 후): 매입전표는 「물류가 입고 잡은 것만」, 명세서 수량이 입고와 다르면 「수량 고치기 허용 + 차이 표시 + 덜 잡은 수량은 다음 전표」.
- 마이그레이션 0036: purchase_bill_lines의 UNIQUE(source_type, source_id) WHERE active=1을 지우고 일반 인덱스로 바꿈, source_qty(전표 잡을 때 입고 수량) 열 추가. 기존 데이터 변경 없음.
- 입고 줄은 「유효 전표가 잡은 수량 합 < 입고 수량」이면 열림(unbilled). 원천 줄에 billed_qty·po_qty·po_recv_qty·po_date·po_note·po_batch·last_price(같은 거래처·품목 마지막 매입 단가)를 함께 줌.
- 저장: 줄 qty(비우면 남은 수량, 0 이하 400). 겹쳐 잡기는 INSERT … SELECT … WHERE ROUND(현재 잡은 합,6)=ROUND(읽은 합,6) + RC_GUARD로 막아 그 사이 다른 전표가 잡으면 409로 batch 전체를 되돌림. 같은 전표에 같은 입고 줄 두 번은 400.
- 화면: 발주 묶음(batch_id, 없으면 발주 id) 머리 줄에 발주번호·발주일·발주금액·발주 비고 + 묶음 체크, 줄에 발주량·입고량·전표 잡은·이번 수량(입력, 입고와 차이 표시)·단가(입력, 지난 매입 단가 안내), 「결과 내 찾기」, 합계에 「수량 고친 줄 N」. 전표 보기에 입고 수량이 다르면 「입고 N」.
- 「최근 매입목록·전체 상품목록」에서 입고 없이 줄을 담는 기능은 「입고된 것만」 결정에 따라 넣지 않음(지난 매입 단가는 안내로 보여 줌).

## 세금계산서: 건별·월별 담기, 관리·발행, 받는 이메일 2개 (15.83)
- 사용자 결정: 계산서 담기는 건별·월별만(선택 합계 없음), 발행은 세금계산서 관리 창에서 체크 후 「발행」(얼마에요 발행V3.0처럼), 받는 이메일 2개, 연동은 트러스빌 유지.
- 마이그레이션 0037: vendors에 biz_no·biz_name·ceo·address·biz_type·biz_item·tax_email·tax_email2 열 추가, tax_invoices(uid·invoice_no TI-…·kind single/monthly·write_date·period·charge claim/receipt·받는 쪽 사업자 정보 복사·email1/2·items JSON·금액·status draft/queued/issued/sent/failed/cancelled·approval_no·status_message), tax_invoice_bills(전표 하나는 active 계산서 하나에만 UNIQUE).
- 우리 회사 정보: settings 'company_tax_info'(GET 영업, PUT 관리자). 거래처 사업자 정보: PUT /api/vendors/:id/tax-info(거래처 관리·세금계산서 화면의 「사업자 정보」).
- 담기: POST /api/tax-invoices kind single(bill_ids → 장마다 1건, 작성일자 기본 전표 일자, 품목=전표 줄) / monthly(customer·from·to → 담지 않은 전표 전부 1장, 작성일자 기본 기간 마지막 날, 품목=전표마다 1줄 「첫 품목 외 N건」). 발행 전·실패만 고치기(작성일자·청구/영수·이메일 2개·비고·거래처 정보 다시 불러오기)·담기 취소. 담긴 매출전표는 취소 409.
- 발행: POST /api/tax-invoices/issue {ids}. 먼저 점검(우리 회사·거래처 사업자번호 10자리·상호·대표자·이메일 1) 400, 그다음 settings 'tax_link'가 없으면 409 「트러스빌 연동이 아직 연결되지 않아…」(조용히 쌓지 않음). 연결되면 queued.
- 트러스빌: Windows Agent(DB 연동) 사용 예정. Agent는 회사 PC에서 ODBC/OLE로 SaleEBill·Itemlist(최대 99줄)·EB_Status 등 표를 읽어 서명·전송하고 상태를 받는다. SaleEBill에 RecEMail·RecEMail2가 있어 받는 이메일 2개와 맞음. 우리 D1에는 직접 붙을 수 없으므로 회사 PC의 로컬 DB + 연결 프로그램(queued → SaleEBill/Itemlist, EB_Status·NTS 승인번호 → 우리 API)이 다음 단계. 공급자 담당자 TrusBill ID(MemID)·담당자명·이메일·전화가 순발행 필수.
- 사용자 PPT(계산서 발행하는 법) 반영: 매출전표 보기에 「세금계산서 담기」(로스제로 납품전표 TAX 버튼처럼 건별), 매출전표 목록에 세금계산서 칸(안 담음/상태·번호), 담긴 전표는 보기에서 취소 버튼 숨김. 청구/영수 기본값은 영수(사용자 화면 기준).

## 15.82~15.83 검증 수정 · 표 격자 · 메뉴 부서 구분 (15.84)
- 「이전 입고」 LOT의 잡은 수량 = 그 LOT의 po_lot 전표 줄 + 그 발주의 예전 'po' 전표 줄(lotBilled). 예전 방식으로 일부만 전표를 잡은 뒤 LOT 입고가 붙어도 남은 수량이 열려 있습니다(예전에는 그 LOT 전체가 빠져 남은 수량을 영영 못 잡음). 저장 가드도 같은 합으로 비교합니다.
- 매입전표 수량은 남은 입고 수량까지만(넘으면 400, 「물류에서 입고 수량을 먼저 고치세요」). 그 발주에 처리 중인 입고 수정 요청이 있으면 409. 입고 수정 승인은 batch 첫 문장에서 활성 매입전표 줄이 있으면 오류로 전체를 되돌립니다(409).
- 매출전표 취소 UPDATE에 「활성 계산서 연결 없음」 조건, 계산서 담기의 연결 INSERT는 「확정 전표일 때만」 + RC_GUARD(경합 시 409). 월별은 전표마다 문장을 만들지 않고 INSERT … SELECT 한 문장 + 건수·합계 가드(D1 요청당 문장 수 제한). 같은 request_id 재시도가 겹치면 저장된 것을 duplicate로 돌려줍니다.
- PUT /api/vendors/:id/tax-info는 영업·구매 담당·관리자만(받는 이메일이 계산서 발송 주소이므로).
- 표 가독성(사용자 요청 「재고·수치 화면에 그리드가 없어 불편」): PC 표(table.grid:not(.as-cards))에 연한 가로 격자(--grid-line), 짝수 줄 음영(--zebra, row-*·bill-picked·bill-group·ledger-pay 줄 제외), 마우스 올림 강조, 합계(tfoot) 바탕. 숫자 칸(td.r)이 있는 표는 세로 격자도 긋고 숫자는 tabular-nums. 휴대폰 카드는 그대로. 라이트·다크 변수 두 벌.
- 메뉴: .nav-group에 data-dept(home·sales·purchase·quality·dev·production·logistics·manage)를 붙이고 부서 이름을 색 막대가 있는 굵은 머리로, 묶음 사이에 구분선, 현재 화면 링크 왼쪽에 부서 색. 새 업무 묶음을 만들면 NAV_GROUP_KEY와 색(--dept)을 함께 넣으세요.

## 입고 입력 엑셀 붙여넣기를 엑셀처럼 (15.85)
- 사용자 보고: 엑셀에서 긁어 셀에 붙여넣으면 줄이 늘어남. 예전에는 여러 칸이면 첫 칸만 그 줄에 넣고 나머지는 그 아래에 새 줄을 끼워 넣었고, 빈 칸은 걸러져 값이 밀렸습니다.
- 이제 LOT·수량·비고 칸에 붙여넣으면 그 칸부터 아래 줄을 차례로 채웁니다(LOT 칸은 「LOT[탭]수량」 두 열도). 표 끝을 넘을 때만 마지막 줄과 같은 품목 줄을 더하고(비고는 넘는 값을 버림), 엑셀이 붙이는 끝 줄바꿈은 버리며 가운데 빈 칸은 빈 값으로 둡니다. 한 칸도 「1,200」처럼 쉼표 숫자를 받습니다. 한 품목 LOT 여러 개는 「LOT 나누기」 또는 마지막 줄에 붙여넣기.

## 거래처 칸: 지우지 않고 다른 거래처 고르기 (15.86)
- 사용자 요청: 매입전표 입력에서 거래처를 지우지 않고 화살표만 눌러 다른 거래처를 고르고 싶음. 브라우저 목록(datalist)은 칸 글자로 걸러지므로 이름이 들어 있으면 그 거래처만 보였습니다.
- bindPartnerPicker: 등록된 거래처 이름이 들어 있을 때 칸을 누르거나(↓·Alt+↓ 포함) 열면 이름을 placeholder로 옮기고 칸을 비워 전체 목록을 보여 줍니다(data-partner-prev). 다른 거래처를 고르거나 입력하면 그대로 바뀌고, 고르지 않고 나가거나 Esc면 원래 이름으로 돌립니다. 값만 바꾸고 input/change 이벤트는 보내지 않아 화면이 다시 불러오지 않습니다. 거래처 선택 도구를 쓰는 모든 화면(발주·입고·출하·매입/매출전표·입금 등)에 같이 적용됩니다.

## 구매 › 입고현황 · 임가공 분류 · 메뉴 스크롤 유지 (15.87)
- 사용자 요청: 매입 마감용으로 기간별 원자재·부자재·제품·상품·임가공 금액이 나오는 「입고현황」. 결정: 임가공은 품목 분류에 추가, 금액은 입고일 기준·전표 금액 우선.
- 임가공: ITEM_CATEGORIES(서버·화면)에 '임가공' 추가(boms·purchase_orders item_category에는 CHECK가 없음). other_receipts·item_category_nodes는 CHECK가 있어 막음: 기타입고(receiptCategory·otherReceiptFields)는 「임가공은 발주로 받습니다」 400, 분류 관리 1차 분류 추가는 400, 분류 관리 탭·입고 입력 기타입고 품목 찾기에서 뺌. 재고 집계에는 그대로 들어가므로 재고 화면에서는 분류로 거르세요.
- GET /api/purchase-receipt-status?from&to[&vendor](구매 담당): 원천(po_lot·po·other)별로 입고일 기간 줄을 읽어(원천마다 1만 줄 한도) 줄마다 확정 = 유효 매입전표 줄 공급가액(이전 입고 LOT는 예전 'po' 전표 포함), 미확정 = 남은 수량 × 발주 단가(단가 없으면 unpriced), 상태 billed/partial/open. 분류별(원자재·부자재·제품·상품·임가공은 0이어도 표시, 반제품·미분류는 있을 때)·거래처별(분류 열) 합계, 기간 안 명세서 일자의 확정 전표 운송비(분류 없음, 따로 표시), 줄은 3000줄까지.
- 화면 bills.js pageReceiptStatus(#/purchase/receipt-status, 메뉴 구매 › 매입전표 › 입고현황): 기간 빠른 선택·거래처, 분류별 표(분류 누르면 줄 거름), 거래처별 표(줄 보기·전표 입력으로 이동), 입고 줄(분류 탭, 단가 없음 노란 줄), 엑셀(줄별 + 합계, 제목에 분류별 합계).
- 메뉴 스크롤: shell()이 다시 그릴 때 왼쪽 메뉴(.side)의 scrollTop과 펼친 하위 메뉴를 기억했다 되돌립니다(누른 메뉴 자리에 머묾). 처음 열 때는 지금 화면 메뉴가 보이도록 메뉴 안에서만 스크롤합니다.

## 입고현황 분류 탭: 한 화면에 한 분류 (15.88)
- 사용자 요청: 한 화면에 한 카테고리만, 전체/원자재/부자재 등을 눌러 바꿔 보기. 맨 위 분류 탭(#rsTabs, 탭마다 금액, 이 기기에 기억 localStorage `wpa:rs-cat`)을 고르면 요약(그 분류 한 줄)·거래처별(그 분류의 입고 줄·확정·미확정·합계·전표 안 잡은 줄)·입고 줄(분류 칸 없음)·엑셀이 모두 그 분류만입니다. 「전체」는 예전처럼 분류별 합계·운송비·거래처×분류 표.
- 서버 vendors[].by: 거래처별·분류별 세부(lines·confirmed·estimate·open·unpriced).

## 기간 선택 한 줄로 접기 · 조회 양식 입력자 제거 · 휴대폰 버튼 줄 정리 (15.89)
- 사용자 요청: 휴대폰에서 기간 버튼(17개)이 세 줄을 차지해 지저분함 → 펼쳐 보는 방식으로. rangePresets는 「◀ [라벨 ▾] ▶」 한 줄(라벨 = 고른 기간 이름, 직접 고친 날짜면 MM/DD ~ MM/DD)이고, 가운데를 누르면 일·주·월 / 분기 / 반기·년 세 열 창(data-rp-panel)이 펼쳐집니다. 고르면 닫히고, 바깥 클릭·Esc로도 닫힙니다. data-rp 값·onPick은 그대로이며 끝 날짜 칸 label 바로 뒤에 붙습니다. 처음 날짜가 어떤 기간과 같으면 그 이름을 라벨로 보입니다.
- showInputAuthors: data-read-only(값 없이 써도)·.list-filters 양식에는 「입력자(자동 기록)」를 붙이지 않습니다(예전에는 값이 정확히 true일 때만 건너뛰어 매출전표 목록 등 조회 줄에 붙었음).
- 휴대폰(700px 이하): 목록 조건 줄은 「조건·조회·엑셀」 한 줄 + 기간 한 줄(order), 입고목록 처리 버튼 줄(.actionbar)은 3열 격자. 휴대폰으로 모든 메뉴 화면을 돌며 버튼이 3줄 이상 쌓이는 곳을 찾아 0곳으로 만들었습니다.

## 검증 수정: 줄어든 입고·「이전 입고」 구분·리포트 임가공 (15.90)
- 입고 수량 수정 승인으로 생기는 음수 보정 LOT 줄은 매입전표 원천에서 빼고(l.qty > 0), 발주 전체로 아직 안 잡은 실입고(PO_OPEN = recv_qty − 그 발주의 활성 전표 줄 합)를 넘지 않게 합니다: 원천 목록 조건·저장 시 남은 수량 min(줄 남은, 발주 남은)·저장 가드(같은 batch의 앞 줄 포함 합 ≤ recv_qty). 예전에는 10 → 8로 줄여도 LOT 줄이 10으로 열려 있어 입고보다 많이 잡혔습니다.
- 입고현황: 음수 보정 줄은 상태 「수량 수정」, 미확정 금액을 음수로 넣어 같은 발주 줄과 순액이 맞습니다. 거래처 집계는 줄을 한 번만 돌아 모읍니다.
- 「이전 입고」(예전 방식 입고를 옮긴 줄)는 note와 receipt_id IS NULL로 구분합니다(PREV_LOT). 사용자가 입고 비고에 같은 말을 써도 예전 전표 수량과 합쳐 세지 않습니다.
- reports.mjs REPORT_CATEGORIES에 임가공(분류 필터 400 해소).

## 화면 검토 수정 (15.91)
- 거래처 칸(bindPartnerPicker): 눌러서 비운 채 Enter나 「조회」로 제출하면 원래 이름으로 되돌린 뒤 제출(빈 거래처로 전체가 조회되던 문제). 목록을 불러오는 동안 칸을 눌러도 응답을 버리지 않도록 화면은 data-partner-prev ?? value로 비교하고, 기간이 바뀐 늦은 응답은 버립니다(매입·매출전표 입력, 입고 입력).
- 기간별 거래보고 조회 줄에는 거래처 안내 글(partner-hint)을 붙이지 않습니다: 칸을 벗어날 때 글이 생기며 「조회」 버튼이 밀려 클릭이 빗나갔습니다.
- 세금계산서 월별 담기: 거래처마다 새 request_id, 실패하면 화면의 request_id도 새로(예전에는 같은 번호를 다시 보내 앞서 담긴 계산서가 duplicate로 돌아와 「담았습니다」인데 안 담김), 기간은 화면에 보이는 조회 결과(data.from/to).
- 입고 입력 붙여넣기: 한 칸이면 브라우저 기본(커서 자리에 넣기), 수량 칸의 쉼표 숫자만 숫자로.
- 메뉴: 펼친 하위 메뉴는 data-sub(이름)로 맞춤(배지·번역 글자가 붙어도 유지).
- rangePresets: 만든 직후·제출할 때 날짜로 라벨을 다시 맞춤(box.sync, 저장된 조건으로 날짜를 채운 목록), 올해가 아니면 YY.MM/DD, 화면이 바뀌면 문서 리스너 정리.
- 매입전표 입력: 줄을 하나씩 체크해도 묶음·전체 체크가 맞춰짐. 매출전표 보기 「세금계산서 담기」 두 번 누름 방지.

## 수주 → 분할 매출전표 → 출하지시 → 출하 (15.92, 마이그레이션 0038)
- 표: sales_orders(SO-YYMMDD-NN, status open/closed/cancelled), sales_order_lines(bom_id 필수 — 품목·코드·단위는 품목 등록에서), ship_instructions(전표 줄 하나당 하나, pending/shipped/cancelled), sales_bill_lines.order_line_id, vendors.code(빈 값이 아니면 UNIQUE).
- 거래처코드: 직접 넣으면 대문자(영문·숫자·-·_ 20자), 비우면 VENDOR_AUTO_CODE(C0001부터 다음 번호). ensureVendor로 자동 등록되는 거래처도 코드를 받습니다. 관리자 「빈 코드 자동 채우기」(POST /api/vendors/fill-codes). bindPartnerPicker는 목록 라벨에 코드를 보이고, 코드를 그대로 치면 change(capture)에서 이름으로 바꿉니다.
- 잔량 = 수주 수량 − 유효한(active) 매출전표 줄 수량(ORDER_BILLED). 마감·취소된 수주는 잔량 0. 상태: waiting/partial/done(+closed/cancelled)은 계산값.
- POST /api/sales-bills의 source_type 'order' 줄: 수주 열림·같은 거래처·잔량 이하·한 전표에 같은 수주 줄 한 번. 저장은 source_type 'manual' + order_line_id로, INSERT…SELECT가 잔량·열림을 다시 확인하고 RC_GUARD로 전체를 되돌립니다. 같은 배치에서 ship_instructions를 만듭니다.
- 출하 처리(POST /api/ship-instructions/ship, 물류): 지시를 shipped로(+RC_GUARD), shipments에 batch_id 'si:<지시 id>'로 한 줄, 지시에 shipment_id, 전표 줄을 source_type 'ship'·source_id=출하로 바꿉니다(이후 출하 수정·삭제는 기존 규칙대로 전표가 막음).
- 매출전표 취소: 대기 중인 지시도 cancelled. 이미 출하된 것은 출하로 남아 「전표 없는 출하」에 다시 나옵니다.
- 수주 고치기는 전표를 한 번도(취소된 전표 포함) 잡지 않았을 때만, 줄을 통째로 바꿉니다. 그 뒤에는 「잔량 마감」·다시 열기.
- 화면: 영업 › 수주(입력·목록·상세 modal), 매출전표 입력 「수주 잔량」 구역(wpa:sbill-order로 상세에서 넘어오면 그 수주 줄이 체크됨), 물류 › 출하 › 출하지시(배지: my-tasks ship_instructions), 발주 목록 입고·전표·잔량 칸(billed_qty).
- 표 그리기: 전체가 빈 칸은 숨기는 규칙(col-empty)을 입력 표에서 끄려면 table에 data-keep-cols. 수주 입력 표는 품목 칸이 가장 넓습니다(.so-grid).

## 거래처 찾기 · 자동 의뢰번호 · 업무 표 (15.93)
- bindPartnerPicker는 이름 입력 옆 「거래처 찾기」 창을 제공합니다. 코드·이름·담당자·연락처를 서버에서 검색하고 매입/매출 구분을 유지합니다. 선택 시 input/change를 보내 기존 품목·전표 조회를 갱신합니다. 취소·늦은 응답은 선택 값을 덮어쓰지 않습니다.
- 직접 발주에서 req_no를 비우면 저장 INSERT 안에서 PR-YYMMDD-NN을 발급합니다. purchase_orders.req_no와 purchase_requests.doc_no의 같은 날짜 최대 순번을 함께 사용합니다. 여러 품목 묶음은 첫 줄에서 발급한 번호를 공유하고 item_batches 재시도로 번호를 중복 발급하지 않습니다. 승인 의뢰에서 만드는 발주는 기존 doc_no를 유지합니다. 기존 번호는 변경하지 않습니다.
- 발주목록·물류 입고목록·매입 입고현황은 keep-table dense-grid로 휴대폰에서도 카드로 바꾸지 않고 행·열 격자·합계와 좌우 스크롤을 유지합니다.
- 물류 직접 출하는 영업 › 매출전표 입력 › 거래처 › 전표 없는 출하에서 선택·단가 확인 후 전표로 잡습니다. 기존 서버의 전표 중복 방지·재고 규칙은 그대로입니다.

## 거래처 찾기 적용 범위 보완 (15.94)
- 구매의뢰 품목의 공급선·사용고객사, 생산의뢰 거래처, 발주 단일 입력·수정과 매출전표·입금 조회에도 같은 거래처 찾기를 연결합니다. 이미 읽은 매입/매출 거래처 목록(directory)을 재사용해 품목 줄마다 같은 목록을 다시 요청하지 않습니다.

## ERP식 화면 정리 (15.95)
- 표(.table-wrap, .dense-wrap, table.grid, 휴대폰 카드 줄)는 각진 모서리. 둥근 테두리에 격자 끝이 잘리던 문제. 701px 이상은 머리줄 진하게(--total-bg, 굵게, 세로 격자)·줄 간격 7px 10px.
- 입력 화면(#main의 list-filters·data-read-only가 아닌 form)의 마지막 .actions에 기본 저장 버튼(.btn.primary, type≠button)이 있으면 화면 아래에 고정(sticky)되는 저장 줄이 됩니다. 마우스가 있는 넓은 화면에서 저장 버튼에 F8 표시(::after, 글자는 DOM에 없음).
- form-ux.js 단축키: F8 = 열린 창이 있으면 그 창, 아니면 지금 칸이 있는 폼 → 화면의 첫 입력 폼의 저장 버튼 클릭(검사·중복 방지는 기존 submit 그대로). F3 = 목록 조회 조건의 검색 칸으로. 한글 조합 중·보조키와 함께면 무시.
- 거래처 찾기 묶음(.partner-picker)이 있는 칸의 필수 * 표시는 묶음 앞(라벨 글자 옆)에 붙습니다.
- 15.93·15.94 새 문구 번역 추가.

## 입고현황 거래 있는 분류만 (15.96)
- shownCats는 그 기간에 입고 줄이 있는 분류만(예전에는 원자재~임가공 5개를 늘 보임). 탭·분류 합계·거래처별 칸이 모두 이것을 따릅니다. 거래처가 그 분류 입고가 없으면 칸을 비웁니다(v.by[분류] 없음). 입고가 하나도 없으면 분류 합계 자리에 빈 안내.
- 조회 줄(.list-filters)의 거래처 찾기 묶음은 입력칸 11em(휴대폰은 한 줄 가득).

## ERP식 목록·입력 (15.97)
- 표 머리줄: 넓은 화면에서 연한 파랑 바탕·파랑 글자·가운데 정렬(--erp-head*), 다크 모드 값 따로.
- 머리글 정렬: sortableTable(입력칸·colspan/rowspan 줄이 없고 줄마다 칸 수가 같은 표, data-no-sort·창 안 표 제외)이면 labelGridTables가 th에 .sortable, 누르면 오름/내림(aria-sort). 숫자는 쉼표·원·% 빼고 수로, 빈 칸은 늘 아래.
- 매입·매출전표 목록: billMonthBody로 월마다 「YYYY/MM 계」 줄(month-sum)과 tfoot 합계(grand-sum), 확정 전표만 더함. 전표번호는 .link-btn(data-bill-open). 이 표는 data-no-sort.
- 입력 화면 아래 저장 줄(15.95) 왼쪽에 erpEntryBar가 「다시 작성」(확인 → 보관 초안 지우고 render)과 「리스트」(NAV 같은 하위 메뉴의 목록, 없으면 /new 뗀 주소)를 붙입니다.
- 거래처 찾기 버튼은 입력칸에 붙은 돋보기(.partner-find, 글자는 aria-label·title로만). 테스트용 가짜 DOM에는 classList가 없으니 className으로 지정합니다.
- 번들 금지 문자열 검사는 변수 이름에도 걸립니다(예: hrefs. → "fs."). 이름을 바꾸세요.

## 입고현황 거래처별: 품목·단가 (15.98)
- 분류는 품목 등록 때 정해지므로 거래처별 표에서 분류 칸을 없앴습니다. 거래처 → 품목 줄(품목명·코드·규격·수량·단위·단가(발주 단가)·금액(확정+미확정)), 거래처마다 「거래처 계」 줄(month-sum, rs-vendor-sum)에 미확정 금액·줄 보기·전표 입력. 같은 품목이라도 규격·단위·단가가 다르면 줄을 나눕니다.
- 위 분류 탭이 거름: 탭을 누르면 그 분류 입고가 있는 거래처·품목만. 표는 클라이언트에서 data.lines(최대 3000줄)로 묶으며, 넘치면 안내를 띄웁니다.
- 이 표는 data-no-sort data-keep-cols(빈 규격·단위 칸이 숨으면 계 줄 colspan이 어긋남).

## 검증 수정 (15.99)
- 휴대폰(≤820px, 하단 탭 있음): 아래 고정 저장 줄은 하단 탭 위(bottom 59px + safe area)에 붙습니다.
- F8·F3: 키를 누르고 있어 생기는 반복(event.repeat)은 무시(발주 입력처럼 중복 방지가 없는 폼에서 여러 건 저장되던 문제). 조회 줄(.list-filters·data-read-only) 칸에서 F8은 입력 폼을 저장하지 않습니다.
- 머리글 정렬: 본문에 합계·총계·소계·계 줄(첫 칸 글자 또는 sum/total 클래스)이 있는 표는 정렬하지 않습니다(예: 커팅·세탁 기간 합계).
- 입고현황 거래처별: 거래처 목록·「계」·합계는 서버 집계(data.vendors, 이름 키로 묶음, 3000줄 제한과 무관)에서, 품목 줄만 받아 온 입고 줄에서 만듭니다. 단가 없음 표시는 전표 안 잡은 줄에만, 계 줄 수량은 단위가 하나일 때만.
- 세금계산서 만들기 「건별/월별」 묶음은 role=group(탭 역할 없는 tablist 경고). 안내 문장 속 .btn.small은 높이 32px.

## 삭제·합계 점검 (15.100)
- 품목 완전 삭제 사용처(BOM_USES)에 수주(sales_order_lines)·출하지시(ship_instructions).
- 수주 잔량 = 수주 − 유효 전표 수량(ORDER_BILLED) − 출하됐지만 지금 그 출하를 담은 유효 전표가 없는 지시 수량(ORDER_SHIPPED_OPEN). 합을 ORDER_TAKEN으로 open-lines·전표 검사·목록 상태에 씁니다(출하 처리한 전표를 취소해도 나간 물건이 잔량으로 돌아와 이중 출하되지 않게). 같은 출하를 「전표 없는 출하」로 다시 잡으면 INSERT…SELECT가 ship_instructions.shipment_id로 order_line_id를 이어 줍니다(출하가 없어졌으면 RC_GUARD).
- 출하 삭제: 전표 확인을 batch 안 가드로 다시, 출하지시로 나간 출하면 그 지시를 cancelled·shipment_id NULL로(잔량 복귀). 기타입고 삭제·생산일정 삭제도 같은 저장 안에서 다시 확인.
- 거래처 삭제: 수주·매출/매입전표·세금계산서·발주·출하에 쓰였으면 409(코드·사업자 정보·운송비 조건이 사라지지 않게).
- 합계: unitTotals(행, 수량, 단위) = 단위별 합 문자열, sumLine([[이름, 값]]) = 표 아래 .list-sum 줄. 발주 목록(건수·수량·발주 금액·단가 없음), 입고목록, 기타입고, 출하 목록(단위별로 고침), 출하지시, 입고현황 줄, 수주 상세(진행·전표), 구매의뢰 목록(매입·판매), 세금계산서 관리(합계 금액), 원장 수량(단위별), 매출전표 보기 「총액」.
- 전체가 빈 칸 숨김(col-empty)은 colspan 칸이 있는 표에서는 하지 않습니다(원장에서 입금이 없을 때 기초잔액·합계 줄이 한 칸 밀리던 문제).

## 기능 검증 수정 (15.102)
- 거래처 이름 변경 따라가기에 입금(sales_payments) 추가. 이름 변경은 구매·영업·관리자만(문서의 거래처 이름이 함께 바뀌므로), 등록·연락처 수정은 누구나 그대로.
- 출하지시로 나간 출하(지시 shipped)는 전표를 취소한 뒤에도 거래처·품목·수량·날짜를 못 바꿈(LOT·메모만, 전표 줄 LOT도 같이). 바꾸려면 출하를 지워 지시를 되돌린 뒤 다시 출하 처리. 출하 줄로 전표를 잡을 때 그 출하가 지시 출하면 전표 거래처가 수주 거래처와 같아야 하고 수주가 취소가 아니어야 함(INSERT…SELECT 조건 + RC_GUARD).
- 수주 취소: 지시가 대기·출하 중이면 막음. 취소한 수주는 다시 못 엶(마감만 다시 열림).
- GET /api/sales-orders: 상태(state) 거름을 SQL(서브쿼리 CASE)에서. 예전에는 200줄 읽은 뒤 걸러 오래된 진행 수주가 빠졌다. amount는 줄마다 원 미만 절사(상세와 같게).
- 과세 구분: open-lines가 수주 tax_type을 주고, 전표와 다르면 409. 화면은 수주 줄을 고르면 과세 구분을 맞추고 안내.
- 출하 처리 출고일: 전표 달 1일 이전이면 400, 매출 마감된 달이면 막음.
- 매입 마감 force_current는 관리자만.

## 사용성 점검 수정 (15.103)
- 입력 표 안에서 Enter는 저장이 아니라 다음 칸(enterMovesInTable: 같은 줄 다음 입력칸 → 다음 줄 첫 칸). 수주 입력·매출전표 입력(세 표)·매입전표 입력에 붙임. 저장은 F8·버튼.
- 거래처 찾기 창: ↑↓로 줄 강조(.ip-active), Enter는 결과가 있고 검색어가 그대로면 선택(하나면 바로), 아니면 조회. 고른 뒤 초점은 폼의 다음 칸(조회 줄이면 거래처 칸). 빈 거래처 칸에서 ↓·Enter → 찾기 창(조회 줄 제외). 테스트용 가짜 DOM에 $$·queueMicrotask·classList이 없으므로 querySelectorAll?.·Promise.resolve·?.로 씀.
- datalist 라벨은 「담당자 · 연락처 · 코드」 순.
- 매입전표: 입고 남은 수량을 넘는 이번 수량은 보내기 전에 막고 그 칸으로. 전표 없는 출하 단가: 마지막 판 단가 → 없으면 열린 수주 단가(SHIP_SOURCE order_price).
- 발주 목록 「미전표」는 전표 수량이 있을 때만. 품목 찾기 emptyText 옵션(수주는 직접 입력 없음 안내). 전표·수주 상세 창 onClose → 저장 뒤 거래처 칸·품목 추가로 초점. 거래처코드 규칙 안내·pattern, 「빈 코드 자동 채우기」는 등록 카드 안.

## 남은 항목 정리 (15.104, 마이그레이션 0039)
- 출하지시 보류: status CHECK는 그대로 두고 held/hold_note/held_by/held_at 칸 추가(0039). 대기(pending) 지시만 보류·해제(POST /api/ship-instructions/:id/hold, 물류·영업). 보류면 status=pending 목록·출하 처리·배지에서 빠지고(held=0 조건), 전표·수주 잔량은 그대로. GET ?status=held. 수주 상세 ship_status는 'held'로 보임.
- 창고 삭제(DELETE /api/warehouses/:id, 물류팀장·관리자): po_receipt_lots·other_receipts에 그 창고 이름이 없을 때만. 있으면 409(사용 중지 안내). 창고 관리 창에 삭제 버튼.
- 댓글 삭제(DELETE /api/comments/:entity/:id/:commentId): 작성자는 10분 안, 관리자는 언제나. 줄은 남기고 content를 「(삭제됨)」으로(이력 순서 유지). 화면 버튼도 같은 조건으로만 보임(ME 없는 테스트 DOM 대비 typeof 가드).
- 거래처코드 변경 → 열린(open) 수주의 customer_code만 따라감(마감·취소는 당시 코드).
- 거래처 입력 두 방식: datalist(이름 자동완성)와 찾기 창(코드·담당자 검색) 역할 분담. placeholder·돋보기 title로 안내, datalist 라벨은 코드 먼저.
- 발주 목록 칸 순서: 구매의뢰번호·품목명·수량·입고·전표·잔량·입고상태·거래처·납기일·분류·COA·비고(숫자가 먼저). 휴대폰(≤820px) dense-grid는 첫 칸 sticky. 입고현황 입고 줄은 details.rs-lines-fold(휴대폰에서 접힘).
- 발주 입력의 품목 선택은 이미 공용 bindItemPick(찾기 버튼·Enter·↓·자동 연결) 하나라 그대로 둠. 아래 고정 저장 줄과 마지막 입력 줄 사이 여유만 더함.

## 권한 칩·제품등록 무결성 (15.105–15.106)
- ROLE_SHORT(권한 칩 글자)에 sales가 없어 「undefined」로 보였다. 권한을 더하면 ROLE_LABEL·ROLE_SHORT·worker ROLES 세 곳을 함께 고친다. 영업 설명은 「영업(수주·매출전표·입금)」.
- 제품코드: 빈 코드가 아니면 대소문자 무시하고 하나만(bomCodeClash, 409). DB UNIQUE 색인은 기존 데이터에 중복이 있을 수 있어 넣지 않았다. 임시 품목을 정식으로 바꿀 때 코드 필수.
- 코드를 바꾸면 그 코드로 저장된 기록(CODE_TABLES: 발주·출하·반제품 기록·구매의뢰·생산의뢰·매입/매출전표 줄·수주 줄·출하지시)이 따라간다. 이름을 바꾸면 다른 제품의 구성자재 이름, 코드로 이어진 발주·출하 품목명, bom_id로 이어진 기타입고 품목명, (같은 이름의 다른 품목이 없을 때) 재고 조정 품목명이 따라간다(재고는 품목명으로 묶이므로).
- 자기 자신·순환 구성자재 막기(bomCycleCheck, 사용 중 품목의 구성자재 이름 그래프).
- 「다른 제품의 구성자재」 사용처 판단은 띄어쓰기·대소문자 무시(트리 화면 partnerKey와 같게).
- 휴대폰 제품등록 창: 구성자재 표가 카드로 바뀌면 min-width를 풀어 창 밖으로 잘리지 않게. 임가공 탭에서 분류 관리를 열면 원자재로(임가공은 세부 분류 없음).

## 규격은 품목코드에서, 발주 줄 단가 (15.107, 마이그레이션 0040)
- boms.spec(0040). 제품등록 창에 규격 칸. 줄의 규격은 서버 catalogSpec(bom, 입력값): 코드 규격이 있으면 그것(입력 무시), 분류에 사이즈 묶음이 있으면 줄마다 고른 사이즈, 둘 다 없으면 입력값. 수주 줄·발주/출하/기타입고 묶음 등록·입고 입력 기타입고 줄에 적용.
- 화면: 코드 규격이 있으면 규격은 글자로만(수주 입력 표·입고 입력), 발주·출하·기타입고 카드 폼은 규격 칸을 숨기고 품목 요약에 「규격」 표시. 코드에 규격이 없으면 예전처럼 입력칸.
- 발주 여러 품목 폼(/api/batches/purchase_order) 줄마다 단가(unit_price) 칸·저장. 예전에는 단일 발주 폼에만 있어 실제 쓰는 화면에서는 단가를 넣을 수 없었다.

## 발주·출하·기타입고 표 입력 (15.108)
- public/line-table.js installLineTable(legacy, entity): 수주 입력과 같은 표(한 줄 = 한 품목). enhanceMultiForms가 purchase_order·shipment·other_receipt(LT_ENTITIES)는 이것으로, 세탁·생산계획·의뢰는 예전 카드 폼(installMultiItems). 저장은 그대로 POST /api/batches/:entity(서버 변경 없음).
- 줄: 품목(찾기·바꾸기 / 직접 입력은 발주·출하만, 임시 코드) · 규격(코드 규격이면 글자, 없으면 입력) · 수량 · 단위 · [발주: 단가·금액·납기(공통 납기 따라감, 줄에서 고치면 그 줄만)·분류(직접 입력 줄만 선택)·COA] · LOT · 비고. 사이즈 묶음 품목은 사이즈마다 줄을 펼치고 수량이 빈 사이즈 줄은 저장하지 않음.
- lineTableItems(lines, entity)는 순수 함수(test/line-table.test.mjs). 줄 값이 공통 값을 덮으므로 빈 비고·빈 납기는 보내지 않는다.
- 공통 사진은 저장한 모든 줄에 붙임(예전과 같은 순서·재시도). 초안은 bindEntryDraft(lines 배열). 표 안 Enter는 다음 칸(enterMovesInTable), F8 저장.
- 테스트 스크립트 주의: 등록된 거래처를 칠 때 브라우저 제안 목록이 열려 다음 클릭을 삼킨다. Escape 말고 Tab으로 칸을 나간다.

## 입금 → 구매 › 입금확인 (15.109)
- 메뉴: 영업 › 매출전표의 「입금」을 빼고 구매 그룹에 「입금확인」(#/purchase/payments). 예전 주소 #/sales/payments는 새 주소로 location.replace(즐겨찾기·자주 쓰는 화면 대비). 화면은 같은 pageSalesPayments, 제목만 「입금확인」.
- 서버 /api/sales-payments(GET·POST·취소)는 requirePayments: 영업 또는 구매. 원장(기간별 거래보고)·매출 마감은 영업 그대로이며 입금 기록은 잔액에 그대로 반영.
- 메뉴 열람 권한(routeMenu)은 주소 앞부분으로 정해지므로 입금확인은 이제 「구매」 묶음 권한을 따른다.

## 지급확인·매입처 원장 (15.110, 마이그레이션 0041)
- purchase_payments(지급 payment / 기초 미지급 opening, 취소, request_id 재전송 안전) — sales_payments와 같은 모양, vendor. purchase_closings.payment_total.
- /api/purchase-payments(GET·POST·취소, requirePurchase, 매입 마감된 달은 막음), /api/purchase-ledger(매입처 없으면 매입처별 요약, 있으면 전표 단위 줄 + 지급 줄, 잔액 = 기초 미지급 + 매입전표 합계 − 지급). 매입 마감 목록·마감 기록에 그 달 지급 합계.
- 화면: 구매 › 대금(입금확인 #/purchase/payments, 지급확인 #/purchase/disbursements, 매입처 원장 #/purchase/ledger). 입금확인·지급확인은 같은 pagePayments(main, side) — PAY_SIDE 설정(거래처 칸 이름 customer/vendor, 구분 글자, API). 매입처 원장은 전표 단위(매입전표에 운송비·명세서 합계가 전표에 있으므로). 인쇄·엑셀.
- 거래처 이름 변경 따라가기에 purchase_payments 추가. 백업 표 목록에 purchase_payments.

## 거래처별 단가표 (15.111, 마이그레이션 0042)
- item_prices: side(purchase/sales)·거래처(vendor, vendor_key)·bom_id·unit_price·valid_from 한 줄씩. 바꾸면 새 적용일로 한 줄 더함(=이력). 같은 날 다시 넣으면 그 줄을 고침(UPDATE 후 changes()=0이면 INSERT). 빼기는 active=0(이력에 「뺌」).
- 쓰는 단가 = 그 날짜 이전 가장 늦은 적용일(CURRENT_PRICE). API: GET /api/item-prices(현재 단가·이전 단가·이력 수, 적용 예정 단가), /history, /lookup?side&vendor&date → {bom_id: 단가}, POST(여러 줄), POST /:id/remove. 고치기 권한: 매입=구매, 매출=영업, 관리자.
- 자동 채움: 발주 입력 표(거래처·품목 고르면 매입 단가, 직접 고친 단가(priceTouched)는 그대로, 단가표와 다르면 칸 아래 「단가표 N」), 수주 입력(매출 단가), 매출전표 전표 없는 출하(SHIP_SOURCE table_price → last_price → order_price). 클라이언트 tablePrices()는 구분·거래처·날짜별 캐시(저장 뒤 PRICE_CACHE.clear()).
- 화면: 관리 › 단가표(#/purchase/prices, 메뉴 권한 master). 품목 사용처·거래처 이름 변경 따라가기·백업에 item_prices.

## 거래처용 거래명세서 (15.112)
- 매출전표 보기(확정)의 「거래명세서」 = 전표 1장, 매출전표 목록의 「거래명세서 (기간 합산)」 = 거래처+조회 기간 확정 전표 최대 60장을 한 장으로(statementSheet, sales-bills.js).
- 공급자 = 우리 회사 정보(GET /api/tax-company), 공급받는자 = 거래처 사업자 정보. 합계는 한글 금액(koreanWon: 십·백·천 앞 「일」 생략, 「일만」「일억」은 남김).
- 잔액 줄: 잔액 = /api/sales-ledger(같은 기간) totals.balance, 금회 = 이 명세서 합계, 입금 = 기간 입금, 전잔액 = 잔액 − 금회 + 입금(같은 기간 다른 전표가 있으면 전잔액에 들어감).
- 회사 정보에 입금 계좌(bank, settings company_tax_info 안 → 마이그레이션 없음). 세금계산서 관리 › 우리 회사 정보에서 넣음.

## 엑셀 올리기 (15.113)
- POST /api/import/vendors(구매·영업·관리자), /api/import/items(관리자). body {rows:[{키:값}], dry_run}. 줄마다 검사(이미 있는 이름·코드, 파일 안 겹침, 이메일·사업자번호 형식, 분류) → dry_run이면 결과만, 아니면 오류 0일 때만 db.batch로 한 번에(하나라도 실패하면 아무것도 안 들어감). 500줄까지.
- 품목 올리기는 원자재·부자재·반제품·상품·임가공만(제품은 구성자재 필요 → 화면에서). 1·2·3차 분류는 분류 관리에 있는 이름만(bomPlacement).
- 클라이언트(xlsx.js): readXlsx(.xlsx 첫 시트, zip 저장·deflate는 DecompressionStream), readDelimited(CSV·탭 붙여넣기), importMap(머리글 줄 자동 찾기, 다른 이름 허용 — 이카운트 내보내기 머리글 대응), importDialog(검사 → 넣기). 화면: 거래처 관리·제품등록의 「엑셀 올리기」.

## 안전재고 부족분 발주 · 창고 이동 (15.114, 마이그레이션 0043)
- 재고 현황(품목 합계 보기)에 안전재고 미달이 있으면 「부족분 발주 N」(구매·관리자). POST /api/inventory/reorder-info {items:[{item,unit}]} → bom_id·입고 전 발주(recv_status '' 또는 checking)·마지막 발주 매입처·단가. 기본 수량 = 안전재고 − 현재고 − 입고 전 발주, 단가 = 매입처 단가표 → 마지막 단가. 매입처별로 /api/batches/purchase_order 한 번씩(30품목까지).
- 창고 이동 = LOT 위치 이동(stock_transfers). 품목 전체 재고(STOCK_MOVEMENTS)에는 들어가지 않는다. lotPlaceStock: 위치가 적힌 입고 + 이동 들어옴 − 나감, 출하는 위치가 없어 먼저 들어온 위치(같은 날이면 위치 이름 순)부터 뺀다.
- POST /api/stock-transfers(물류·물류팀장·관리자): 받을 창고는 사용 중, 위치는 그 창고 목록 안, 같은 위치 금지, 보낼 위치 잔량(이동일 기준과 지금 둘 다) 이하. 취소(입력자·물류팀장·관리자)는 받은 위치에 그만큼 남아 있을 때만, status='cancelled'.
- LOT별 재고 창의 「위치 · 이동」에서 위치별 잔량·이동·이동 기록·취소. LOT별 재고 「창고 · 위치」에 이동한 위치도 나옴. 이동 기록이 있는 창고는 삭제 막힘. 백업에 stock_transfers.

## 채권·채무 연령표 · QR 스캔 (15.115)
- GET /api/aging?side=sales|purchase&asof: 기준일까지 확정 전표 + 기초 잔액(opening)을 날짜별 차변, 입금·지급(payment) 합계를 오래된 것부터 갚은 것으로(선입선출) 보고 남은 금액을 0~30·31~60·61~90·91~180·180일 초과로. 잔액 음수면 advance(선수·선급금). 권한: 매출=영업, 매입=구매.
- 화면 #/sales/aging(채권 연령표), #/purchase/aging(채무 연령표). 거래처를 누르면 sessionStorage 'wpa:ledger-pick'으로 원장(기간별 거래보고·매입처 원장)을 그 거래처·가장 오래된 미결 일자부터 연다(ledgerPrefill).
- #/logistics/scan QR 스캔: LOT 라벨 QR(「LOT|코드|수량 단위|입고번호」) 또는 LOT 글자. 카메라는 BarcodeDetector(안드로이드 크롬), 없으면 USB 스캐너(키 입력 + Enter)·직접 입력. 찾은 LOT의 잔량·위치 → 출하 기록(POST /api/shipments, lot·bom_id) · 위치 · 이동(lotMoveWindow). 서버 변경 없음.

## 전표 줄 분류 (15.117, 마이그레이션 0044)
- sales_bill_lines·purchase_bill_lines.item_category: 저장 시점 분류로 고정(lineCategory: 원천 값 → bom_id → 제품코드(대소문자 무시) → 품목명 → ''). 매입 원천은 발주·기타입고의 item_category, 매출은 출하·수주 줄의 품목 분류.
- 읽기는 LINE_CAT(l): 저장값, 비어 있으면(0044 이전 줄) 제품코드로 지금 품목 분류, 그것도 없으면 ''(미분류). 예전 데이터는 바꾸지 않음.
- 목록 /api/sales-bills·/api/purchase-bills: ?category=(분류|미분류) 필터, 행마다 categories(group_concat), by_category(확정 전표 줄 분류별 공급가액). 전표 보기 줄 category, 원장(매출 줄 category, 매입 전표 categories), /api/bill-lines category(엑셀 「분류」 칸).
- 화면: catChip/catChips/catSummary(app.js) — 입력 후보 줄·전표 보기·목록 거래처 칸·원장·엑셀.

## 생산계획표 (15.118)
- 완제품·반제품 생산일정의 주간·월간 기본 보기 = 계획표(scheduleGrid, app.js): 행 = 제품(+규격, 일간 일정 기준), 열 = 날짜(주간 월~일 7열, 일요일 늘) 또는 주차(월간 기본 「주차 합계」, 「일별」로 바꿈). 칸 = 계획 합 / 실적 합, 색: 달성(초록)·일부(노랑)·지난 날 미달(빨강)·미입력(회색).
- 주간·월간 계획은 위쪽 띠(기간 전체, 실적·달성률). 행 끝 제품 합계·달성률, 아래 줄 열 합계. 칸 클릭 → 그 칸 일정 카드 창(실적 입력·코멘트·완료·삭제 그대로, bindItems), 날짜 빈 칸 → 그 제품으로 일간 일정 추가. 「엑셀」 = 제품별 계획/실적 두 줄.
- 「달력」 보기는 칸마다 「N건 · 수량」 요약 → 누르면 그날 일정 창. 일간 보기는 기존 카드 목록. 보기 방식·월간 열은 화면별로 기억(uxWrite calendar). 서버 변경 없음.

## 인쇄 정리 (15.119)
- rcPrint는 맨 위(가장 나중에 연) .lr-cert-wrap만 인쇄(나머지 print-skip). 매출전표 위에 거래명세서를 열고 인쇄해도 거래명세서만 나감.
- 전표 표(.po-items) 머리글·숫자 칸 nowrap, 인쇄 글자 11.5px. 거래명세서 공급자/공급받는자 표는 table-layout fixed + colgroup(17/43/13/27%), 두 칸 grid minmax(0,1fr).

## 부서별 리포트 (15.120)
- 리포트·통계 화면: 필터 아래 「공통」(매출·매입 금액, 완제품 달성률, 안전재고 미달, 금액·건수 추이, 부서별 처리 대기) → 「부서별」 탭(영업·구매·생산·품질·개발·물류, 기본 = 내 역할의 부서, 마지막 선택 기억) → 기존 「수량 상세」. 모든 직원이 금액 포함 전부 본다(사용자 결정).
- GET /api/reports/dept?section&from&to&grain → {kpis[4], charts, tables}(DEPT 객체, worker.mjs). 화면 렌더러 deptHtml(reports.js) · 차트는 reportChart. 카드·표 줄은 해당 화면 링크.
- 기준값 settings report_thresholds(REPORT_THRESHOLDS: ar_overdue_days 90, old_lot_days 90, due_grace_days 0, plan_late_days 0, dev_long_days 30). GET /api/report-settings 누구나, PUT 관리자(0~3650 정수). 화면 「기준값 설정」.
- 재사용: agingData(side, asof)(연령표, 줄마다 aged[{age,left}] — /api/aging 응답에서는 뺌), lotStockReport(query)(LOT별 재고).
- 개발·VOC·분석 처리 기간은 등록일 → 마지막 변경일(updated_at) 기준(완료 시각을 따로 저장하지 않음).

## 제품등록 규격 고정 (15.121)
- 규칙: 제품등록에 규격(boms.spec)이 있으면 그 값으로 고정(입력값 무시) · 사이즈가 등록된 품목은 등록 사이즈 중 하나만 · 둘 다 없으면 입력값(줄마다 사이즈를 적는 품목).
- 서버: catalogSpec(bom, typed, keep)(발주·출하·기타입고·완제품 생산계획 묶음 저장, 수주, 입고, 기록 고치기 PUT /api/items/:entity/:id — 지금 값은 그대로 둘 수 있음), lockedSpec(생산의뢰·구매의뢰: 고치는 의뢰의 기존 줄 값은 유지).
- 화면: 줄 표(발주·출하·기타입고)·입고·수주는 .spec-fixed 표시(입력칸 없음), 카드(생산계획 포함)는 규격 칸 숨기고 「규격(고정)」 요약, 생산의뢰·구매의뢰 줄(itemLockApply)은 읽기 전용.

## 품목 찾기 창 (15.122)
- .ip-modal: 창은 고정 높이(flex column, overflow hidden), 품목 표(.ip-wrap)만 스크롤 → 이중 스크롤 없음. 표 모서리 0(첫 칸이 잘리지 않게), 머리글 sticky.
- openItemPicker 옵션 lots(기본 true): false면 LOT 수 칸·LOT 자동 번호 숨김(단가표).

## 각진 스타일 · 조회 줄 정렬 (15.123)
- style.css 끝: 모든 요소 border-radius 0(!important). 원이어야 하는 것만 예외(.flow 번호, .thumb 삭제, 로딩, .org-rank, .st-dot, 라디오). 새 스타일에 둥근 모서리를 넣어도 이 규칙이 이김.
- .toolbar align-items flex-end + 큰 버튼 min-height 44px(입력칸과 같은 높이) → 라벨 달린 입력칸 옆 「조회」 버튼이 같은 줄에 맞음.
- 부족분 발주 창 lr-modal(넓게) · 품목 칸 최소 폭.

## 거래명세표 종이 양식 (15.124)
- statementSheet(sales-bills.js)를 기존 종이 양식(2장 1조)으로: .stmt2 두 장 — 위 공급받는자용(파랑) · 아래 공급자용(빨강). 전표NO·년월일, ○○ 귀하·☎·「아래와 같이 계산합니다」, 공급자(상호·등록번호·성명(인)·주소), 품명·규격·수량·단가·금액 줄무늬 표, 합계금액·부가세·계 / 비고(거래기간·입금 계좌)·인수자(인) / 이전미수·당일매출·입금·최종잔액.
- 10줄 이하면 A4 한 장에 두 장(각 136mm, 빈 줄 채움), 넘으면 장마다 한 쪽(줄 수만큼). 여러 날짜면 품명 앞에 월/일.
- 감사 v124가 대신함(v112·v119의 거래명세서 확인은 예전 양식 기준이라 더 쓰지 않음).
- 15.125 비고: 표에 「비고」 칸(줄 비고 l.note), 아래 비고 칸 맨 앞에 전표 비고(bill.note, 여러 전표면 겹치지 않게) → 거래기간 → 입금 계좌.

## 고객 PO로 수주 찾기 (15.126)
- poOf(customer_po, note)(app.js): 고객 발주번호 칸, 비면 비고의 10자리 숫자(삼성 PO). parseCustomerNote: 「0C0827-27 (P1DD) OLED Asan mj1938,seon 2008315425」 → 요청·라인·사업장·담당자·PO(형식이 다르면 null).
- 수주 입력: 비고에 붙여넣으면 읽은 내용 표시 + 고객 발주번호가 비었으면 PO 자동(초록 표시).
- 매출전표 입력의 수주 잔량 = 두 칸(.so-pick): 왼쪽 수주 목록(수주번호·PO·비고·고른 줄 수, 검색은 PO·비고·수주번호·품목·코드, 단어 여러 개 AND, 강조), 오른쪽 고른 수주의 품목 표(기존 data-order-* 처리 그대로, 「검색된 수주 전체 줄 보기」). /api/sales-orders/open-lines에 order_note.
- PO 표시·검색: 전표 보기(수주번호 옆), 거래명세표 줄 비고 앞 「PO …」, 매출전표 목록 검색(수주 PO·비고·수주번호), 출하지시 검색(o.customer_po·o.note·o.order_no). salesBillDetail 줄에 customer_po·order_note.

## 세금계산서 매출·매입 · 분류 (15.127, 마이그레이션 0045)
- 세금계산서 화면 위 탭: 매출(#/sales/tax, 발행) | 매입(#/purchase/tax, 받음). 메뉴 구매 › 매입전표 › 매입 세금계산서.
- 매입 세금계산서(purchase_tax_invoices + purchase_tax_invoice_bills): 매입처에게 받은 계산서를 확정 매입전표와 묶어 기록(승인번호·작성일자·비고). 금액 = 담은 전표 합(운송비 포함). 한 전표는 유효한 계산서 하나에만(부분 유니크 인덱스 + RC_GUARD). 취소는 status='cancelled' + 묶음 active=0(전표 다시 담기 가능). 승인번호는 숫자·-만, 받음 상태끼리 겹치면 409.
- API: GET /api/purchase-tax-invoices/candidates?vendor&from&to, POST /api/purchase-tax-invoices, GET 목록(?from&to&vendor&status&q&category), GET /:id, POST /:id/cancel. 권한 구매.
- 분류 필터(매출·매입 목록 ?category): 원자재·부자재·반제품·제품·상품·임가공·운송비(매입전표 운송비)·미분류. 계산서마다 cats 「분류:공급가액|…」, by_category = 분류별 공급가액(취소 제외). 줄 분류는 LINE_CAT(15.117).
- 등록 창: 「받은 계산서 합계」를 넣으면 전표 합계와 같은지/차이를 바로 표시(다르면 확인 후 등록).
- 15.128 수주 목록에 「비고」 칸(전체 문구, 줄바꿈) · 수주번호 아래 PO는 poOf(칸 또는 비고 10자리).

## 세금계산서 발행 · 수취 체크 (15.129)
- GET /api/tax-check?side=sales|purchase&period=YYYY-MM: 그 달(전표 일자) 확정 전표를 거래처별로 — 매출: 전표 합계·발행 완료(issued/sent)·담음·발행 전(draft/queued/failed)·안 담음, 매입: 받음(등록)·안 받음. 화면 #/sales/tax-check · #/purchase/tax-check(탭 「발행 · 수취 체크」), 「남은 일만」·전달/다음 달·엑셀, 빨강=미발행/미수취, 노랑=발행 전.
- 직접 발행 기록: POST /api/tax-invoices/:id/mark-issued {approval_no, issued_date}(발행 전·실패만, 승인번호 필수·중복 409) → issued + status_message 「직접 발행 기록 · 이름」. POST /:id/unmark-issued로 발행 전으로(직접 기록한 것만). 관리 화면 버튼 「직접 발행 기록」(한 장)·「직접 발행 되돌리기」, 직접 기록한 행도 체크 가능(발행·담기 취소는 발행 전 것만 보냄).

- 15.130 일부 출고된 수주 고치기: PUT /api/sales-orders/:id는 줄 id로 기존 줄 유지(삭제·재삽입 안 함). 수량 ≥ 잡은 수량(ORDER_TAKEN), 전표·출하가 있던 줄(ORDER_LINE_USED)은 품목·규격 고정·삭제 불가, 그런 수주는 거래처 변경 불가. 새 줄 추가 자유. 상세 응답 줄에 used.

- 15.131 전표 목록 체크 → 세금계산서 일괄 담기: 매출전표 목록(체크 → 건별 kind single / 거래처별 합산 kind merge, merge는 monthly 형식으로 저장·기간=전표 일자 처음~끝·전표마다 linkBill), 매입전표 목록(세금계산서 열 + 한 매입처씩 체크 → POST /api/purchase-tax-invoices). 이미 담긴·취소 전표는 체크칸 잠금, 서버는 UNINVOICED 확인 + 활성 고유 인덱스로 중복 거절(409). GET /api/purchase-bills 줄에 invoice(번호|승인번호|id). 마이그레이션 없음.

- 15.132 출고지시서(묶음): 마이그레이션 0046(ship_batches 표 + ship_instructions.batch_id). 출하지시 화면에서 체크 → 「출고지시서 묶기」(물류·영업, 1~50줄, 진행 중인 묶음 하나에만) → DO-YYMMDD-NN 지시서(거래처별 피킹표·LOT·확인·서명칸, 인쇄) → 남은 줄 한 번에 출하 처리(기존 /api/ship-instructions/ship). 줄 빼기·묶음 풀기(cancelled, 대기 줄만 놓아 줌). 상태(출고 대기·일부·완료)는 지시 상태로 계산. API: POST/GET /api/ship-batches, GET /:id, POST /:id/remove, POST /:id/cancel. 출하지시 목록에 batch_no, ?batch=none.

- 15.133~15.136 LOT 추적(테스트 피드백 시트 반영, 마이그레이션 0047: po_receipt_lots·other_receipts.sub_lot, production_actuals.lot, production_lot_inputs 표).
  - 15.133 LOT 체계: 자동 LOT = [식별문자][입고일]_[NNN], 식별문자는 품목 분류(원자재 R·제품/반제품 P·상품 G·부자재 S·소모품 C, 그 밖 M; 입력 칸에 적으면 그 글자). 자동 번호는 품목마다 LOT 1개, 같은 LOT 여러 줄(포장)은 저장 때 서브 LOT 001~(그 LOT에 이미 쓴 번호 다음부터). LOT 나누기는 같은 LOT 유지. 라벨에 서브/수량, QR 끝에 서브 LOT(스캔 호환). /api/lots/next?category=. LOT별 재고는 LOT 단위(서브 합산).
  - 15.134 입고목록 › 기타입고: 같은 입고번호의 여러 줄을 머리줄(입고번호·품목·하위 N줄·LOT·합계)로 접고 누르면 하위 자재가 펼쳐짐, 「입고증」 버튼. /api/other-receipts에 receipt_no.
  - 15.135 생산실적: BOM 자재마다 필요량(생산량×비율)을 먼저 들어온 LOT부터 채워 제안(LOT·수량 수정·+LOT), 저장 시 LOT 잔량 검사(초과 400). 완제품 LOT 자동 P/G+생산일_NNN(직접 입력 가능). LOT별 재고에 생산 LOT 입고·투입 LOT 출고 반영(취소된 실적 제외). 총량 재고 계산은 기존 BOM 차감 그대로. API: GET /api/schedules/:id/lot-materials, GET /api/lots/available?item=, POST actuals에 inputs·lot.
  - 15.136 출하 LOT 연결: 출하 입력(여러 품목 표·단일 양식)·출하지시·출고지시서의 LOT 칸에서 그 품목 재고 LOT(남은 수량·위치) 고르기, 재고에 없는 LOT·잔량 초과는 빨간 안내 + 저장 전 확인.
  - 예전 감사 v72/v75/v79는 「줄마다 다른 M LOT」을 기대하므로 새 규칙(품목당 LOT 1개·서브)과 다름(의도된 변경).

- 15.137 (1) 세금계산서 만들기 기본 기간 = 지난 달 1일~오늘(예전엔 지난 달만이라 이번 달 전표가 「조회 안 됨」), 관리 화면 기본 = 지난 달~이번 달 말. 매출전표 목록·전표 보기의 계산서 번호 → 계산서 창. (2) 수주목록 PO 칸에 비고에서 읽은 주문번호·주문자·라인/사이트(soPoInfo). (3) 거래처별 장부 #/sales/book·#/purchase/book, GET /api/partner-book?side&from&to&party: 전표별 공급가액·부가세·합계·세금계산서(번호·상태·승인번호)·입금/지급·잔액(같은 날은 전표 → 입금 순), 비우면 거래처별 요약(계산서 발행/미발행 금액), 엑셀. (4) 표 정렬: 모든 .grid 표(체크칸·월 소계·창 안 포함) 머리글 → 오름/내림/원래 순서, 정렬 중 소계 줄 숨김·마지막 합계 줄 유지. 입력 표·rowspan·묶음 표·data-no-sort는 제외. 전표 목록의 data-no-sort 제거. (5) 품목 찾기 체크 여러 개: 수주·출하/발주 여러 품목 표·의뢰 줄(새 줄일 때, 「바꾸기」는 한 개), 줄을 두 번 누르면 바로 선택.

- 15.138 세금계산서 문서상태(기존 ERP 참고, 마이그레이션 0048: tax_invoices.issue_type·recv_status·recv_at·recv_by, vendors.tax_reverse, purchase_tax_invoices.issue_type). 발행구분 정발행/역발행: 거래처 사업자 정보에서 「역발행 거래처」(예: 삼성)를 켜면 담을 때 역발행, 역발행은 트러스빌 발행에서 빠지고 「역발행 승인 기록」(승인번호)으로 발행 완료. 상대방 수신(미확인·확인·거부)·국세청 전송/미전송은 POST /api/tax-invoices/state {ids, action: recv_confirm|recv_reject|recv_reset|nts_sent|nts_unsent|reverse|normal}로 손으로 표시(연동 뒤 자동 예정). 목록 필터 issue_type·doc(tax/free)·state(unconfirmed|confirmed|rejected|nts_pending|nts_sent), 응답 summary(매출 합계·수신자 미확인·수신 확인·국세청 전송·미전송·역발행·발행 전 건수·공급가액·세액) → 화면 아래 요약표. 문서상태 칸 = 역발행 표시 + 발행 상태 + 수신 상태. 매입 계산서 등록에 발행구분(정발행 받음/역발행).

- 15.139 거래명세표 아래 비고 칸에 수주 비고(고객 비고 원문, 줄의 order_note 중복 없이)를 전표 비고 다음에 넣음. 예전에는 줄 비고 칸에 PO만 나오고 수주 비고 원문은 어디에도 안 나와 「비고가 안 보인다」였음.

- 15.140 반입(매출 반품 RI-)·반출(매입 반품 RO-), 마이그레이션 0049(stock_returns·stock_return_lines). 처리구분 재고+금액/금액만/재고만/처리 안 함, 금액 처리 미수(미지급) 삭감/현금 환불. 재고 처리 → STOCK_MOVEMENTS에 return_in(+)·return_out(−) 원천(원천 수 9→10, inventory 테스트 갱신)·LOT별 재고 반영. 금액 처리 → 음수 매출전표(manual 줄)·음수 매입전표(source_type other, 겹치지 않는 음수 source_id)를 bill_id로 만들어 장부·미수/미지급·마감·세금계산서(수정 계산서)에 그대로 반영, 현금 환불은 같은 금액의 음수 입금/지급(method 현금환불)을 payment_id로 남겨 잔액 그대로. 원래 전표 줄에서 고르면 남은 수량(원래 − 확정 반품)까지만. 금액 전표는 일반 전표 취소에서 막고 반품 전표 취소로만(전표·환불 함께 취소, 계산서에 담겼으면 거절). API: GET /api/returns/sources?side=in|out&party&months, POST /api/returns, GET /api/returns(?side…), GET /:id, POST /:id/cancel. 화면 #/sales/returns(/new)·#/purchase/returns(/new): 납품/매입목록(F5)·전체 품목(F6, 체크 여러 개)·반품유형·LOT·인쇄.

- 15.141 점검 수정: (1) 채권·채무 연령표에서 반입·반출(음수 전표)을 입금·지급처럼 크레딧으로 보고 오래된 전표부터 갚음(예전엔 늦은 날짜 반품이 새 전표에 붙거나 같은 날 전표와 상계되어 연령 칸이 틀어짐). (2) 반품의 현금 환불 입금·지급은 입금확인·지급확인에서 따로 취소 못 하게(반품 전표에서 취소). (3) 금액 0 이하 계산서 발행 안내 문구.

- 15.142 세금계산서 보기 창을 국세청 표준 양식 모양으로(taxFormHtml: 매출 빨강·매입 파랑, 책번호·일련번호, 공급자/공급받는자, 작성 날짜·공란수·공급가액/세액 자리 칸, 품목 4줄 이상, 합계금액·현금·수표·어음·외상미수금·영수/청구). 발행 전·실패면 창에서 바로 고침: 작성일자(바꾸면 품목 월일도 같이), 공급받는자 등록번호·상호·성명·주소·업태·종목, 품목 줄 월일·품목·규격·비고(금액은 전표 그대로, 월일은 작성일자와 같은 달), 영수/청구, 이메일, 비고. PUT /api/tax-invoices/:id에 buyer·items 추가, items 없이 작성일자만 바뀌면 서버가 품목 월일을 맞춤. 매입 계산서 GET에 company·supplier 포함.
- 15.143 계산서(면세) 발행: 마이그레이션 0050(tax_invoices·purchase_tax_invoices.doc_type tax|free). 담을 때 세액 0이면 계산서, 창에서 세금계산서(영세율)↔계산서 전환(세액 있으면 계산서 불가). 계산서 양식은 제목 「계 산 서」·세액 칸 없이 공급가액·비고. 목록 「계산서」 표시·문서 필터 doc_type 기준, 매입 등록에 문서 선택(자동/세금계산서/계산서).

- 15.144 반입·반출 처리구분을 기존 ERP 이름으로(반입: 재납품+금액삭감 / 금액삭감만 / 처리안함, 반출: 재입고+금액삭감 / 금액삭감만 / 미처리 — 값은 stock_amount·amount·none, 예전 「재고만」 전표는 보기에서만). 입력 화면을 칸이 나뉜 격자(erp-grid)로: 머리(일자·처리구분·입력자·거래처·부가세·비고) + 금액 처리 방법 칸(총액·현금환불·미수/미지급삭감 금액), 품목 표 No·줄무늬·빈 줄 6칸·아래 공급가액/부가세/합계금액 줄. 휴대폰은 머리를 이름/값 두 칸으로.

- 15.145 거래처별 장부에서 바로 입금(매출)·지급(매입): 거래처를 고르면 장부 위에 입력 줄(날짜·구분 입금/기초 미수(지급/기초 미지급)·금액·계좌·방법·비고) → 기존 POST /api/sales-payments·purchase-payments(입금확인·지급확인과 같은 기록), 장부의 입금·지급 줄에 「취소」(사유 → /cancel, 반품 환불은 서버가 막음). 조회 기간 밖 날짜면 안내.

- 15.146 거래처 칸: 브라우저 자동완성(datalist) 대신 「거래처 찾기」 창(bindPartnerPicker 전 화면 공통). 칸에 이름·코드 일부를 치고 Enter·↓·F2·더블클릭 → 그 글자로 조회된 찾기 창, 등록된 이름·코드면 Enter는 그대로(조회 줄은 조회). 코드를 치면 이름으로 바뀜(그대로). 찾기 버튼을 돋보기+「거래처 찾기」 글자로. pickPartner({type, query}). 반입·반출 처리구분에 「교환(재고만·금액 그대로)」(process=stock) 추가 — 다른 사이즈로 바꿔 줄 때 금액삭감 대신 이것 + 새 출하는 0원.

- 15.147 전표 고치기·이력: 마이그레이션 0051(doc_changes). PUT /api/returns/:id(같은 번호로 일자·처리구분·금액처리·부가세·비고·줄 수정, 원래 전표 남은 수량은 자기 전표 제외(returnLinesFrom excludeId), 연결 음수 전표는 고쳐 쓰거나(금액→금액) 취소(금액→재고만)·새로 만듦, 환불도 고침·취소·새로; 계산서에 담겼거나 마감 달이면 막음). PUT /api/sales-bills/:id·/api/purchase-bills/:id(일자·줄 단가·줄 비고·비고, 매입은 명세서 번호·합계·운송비; 수량·줄 구성은 그대로; 계산서·마감·반품으로 생긴 전표는 막음). 고친 내용은 doc_changes 한 줄 → 전표 창 아래 「고친 이력」. 매출·매입·반품 목록 상태 기본 「확정」(전체(취소 포함)·취소만 선택). 반품으로 생긴 전표 목록에 「반입/반출 RI-…」 칩·전표 창에 안내(수정·취소 버튼 숨김). 반입 전표만 담긴 명세표 제목 「반 품 명 세 표」.

- 15.148 이월: 매출·매입전표 「수정」에서 일자를 다음 달 말일까지 옮길 수 있음(carryLimit). 출하·입고 기록과 재고는 그대로, 전표·세금계산서·마감·장부 달만 바뀌고 이력에 「(이월)」. 출하지시 출하 처리는 전표 달의 앞 달부터 허용(이월된 전표를 이번 달에 출고).

- 15.149 입고현황에 ERP식 보기: 「분류·거래처 요약(기존) / 일자별 / 품목별 / 거래처별」. 왼쪽 목록(공급가액·세액·합계금액) → 오른쪽 위 품목별 내역(품목별 보기면 거래처별 내역) → 아래 일자별 내역(입고일·발주번호·LOT·단위·수량·단가·금액·전표 확정/미확정), 줄을 누르거나 Enter로 선택. 분류 탭(원자재·부자재·제품·상품·임가공)으로 따로 보기. 세액: 전표 잡은 금액은 그 전표 과세 여부대로(영세면 0, billed_vat), 미확정은 10% 예상. 보기 선택은 이 기기에 기억.

- 15.150 LOT 추적 피드백: (1·5) 생산 투입·출하에 쓰인 LOT은 그 입고의 품목·수량 수정·삭제·LOT 바꾸기·발주입고 수량 줄이기/취소 승인을 막음(lotUsage, 쓴 실적·출하를 먼저 취소), 안 쓰인 LOT도 LOT 번호 변경은 관리자만. (2) 품질 › 수입검사 현황 #/quality/incoming: 대기·진행 중·완료(합격·불합격) 카드와 목록(입고일·구분·거래처·품목·LOT·수량·상태·판정·경과일, 3일 넘은 대기 노랑). (3) LOT별 재고를 품목+LOT으로 합침(투입 단위 M·입고 단위 m처럼 달라도 같은 LOT에서 빠짐), 투입은 LOT의 단위로 저장. (4) 생산실적 이력 표: 생산일·양품 수량·완제품 LOT·투입 자재(자재·LOT·수량 작은 표)·입력자·메모. (6) 재고현황 줄마다 「LOT ▾」: LOT별 입고·사용·남은 수량·위치·날짜와 현재고 차이. (7) 출하(출하 입력·여러 품목·출하지시·출고지시서·출하 LOT 수정)에서 다른 품목의 LOT·이 품목에 없는 LOT은 서버가 거절(LOT 기록이 아예 없는 품목은 자유, checkShipLot).

- 15.151 입고현황 UI 개편(화면만, API·DB·금액 계산 그대로): 기본 보기 「거래처별」 = 거래처 → 입고일자별(최신순) → 입고 내역 3단 아코디언. 거래처 여러 곳 동시에 펼침, Enter/Space로 펼치고 접음, 조회·구분·검색으로 사라진 거래처·일자의 펼침 기록은 지움. 내역 칸 입고일·발주번호·품목·규격·LOT·단위·수량·단가·공급가액·세액·합계금액·전표상태(확정/일부 확정/수량 수정/미확정 배지), 빈 값은 -, 일자 소계. 조회 조건 한 줄(입고일+빠른 선택·구분·거래처·통합 검색(거래처명·품목명·품목코드·발주번호·LOT, 받아 온 줄을 화면에서 거름)·조회·엑셀), 구분 카드 전체·원자재·부자재·상품(+금액 있는 다른 분류) = 구분 선택과 같은 상태. 일자별·품목별 세 칸·요약 보기는 그대로(녹색 머리 → 회청색). 보기 저장 키 wpa:rs-view(예전 wpa:rs-mode는 안 씀 → 모두 거래처별로 시작). 이 화면만 모서리 6~8px·main 최대 폭 1760px. 엑셀은 지금 구분+검색 기준. 수입검사 현황 메뉴(15.150) 없앰: 수입·출하 검사 이력의 필터로 봄, 예전 주소 #/quality/incoming은 이력으로 넘김.

- 15.152 입고현황 품목별 보기도 아코디언: 품목(품목코드·규격·단위로 구분, 이름순) → 입고일자별(최신순) → 입고 내역(입고일·거래처·발주번호·LOT·단위·수량·단가·공급가액·세액·합계금액·전표상태). 1단계에 수량 칸. 펼침 기록은 보기마다 따로. 버그 수정: 거래처명에 |가 있으면 입고일 묶음을 접어도 다시 펼쳐지던 것(키를 마지막 | 기준으로 나눔). 일자별 보기는 세 칸 그대로.

- 15.153 입고현황 일자별 보기도 아코디언: 입고일(최신순) → 거래처별(금액 큰 순) → 입고 내역. 이제 거래처별·품목별·일자별 모두 아코디언, 「분류·거래처 요약」만 예전 표. 15.149 세 칸 드릴 코드(keyOf·groupBy·pick1/2·pickRow) 삭제. 2단계 묶음 키 구분자를 U+241F로 바꿈(거래처명에 |가 있어도 섞이지 않게).

- 15.154 출고지시서 수량 나눠 묶기: 묶기 창에 줄마다 「묶을 수량」(기본 전부). 적게 넣으면 POST /api/ship-batches의 qtys[id]로 보내고, 서버가 같은 batch(트랜잭션)에서 매출전표 줄을 묶을 수량·남는 수량 두 줄로 나눔(공급가액·세액은 비율 반올림, 나머지를 남는 줄에 → 전표 합계 그대로), 출하지시도 둘로(남는 쪽은 출하 대기·보류 상태 그대로), doc_changes에 「줄 나눔」 기록. 막는 경우: 수량 0 이하·지시 수량 초과, 전표 취소·전표 수량과 지시 수량 불일치, 매출 마감된 달. 같은 request_id 재시도는 다시 나누지 않음. 출하 대기 목록: 출고지시서에 묶인 줄은 파란 띠·「묶음」 배지·지시서 번호·출고 예정일, 합계 줄에 묶임/안 묶임 건수(ship-instructions 응답에 batch_plan_date 추가). 묶기 창에서 잘못 넣은 수량을 고치면 오류 안내를 바로 지워 첫 클릭이 버튼을 빗나가지 않게 함.

- 15.155 목록 조회 칸 정리(form.list-filters.lf-oneline): 출하지시 — 기간 빠른 선택(◀ 기간 선택 ▶) 뺌, 지시일은 한 칸(시작~끝), 「묶음 안 된 것만」은 가로 체크 칩, 조회까지 한 줄(1366에서도). 목록 조회 칸의 거래처 찾기 안내 문구를 「이름·코드 입력」으로 짧게(잘리던 것). 출하 처리 줄의 「출고일」 글자 줄바꿈 막음. 재고 현황 — 조회 조건(기준일·품목 검색·분류·1차·2차·재고 상태·조회) 한 줄, 결과 위 도구 줄에 건수 · 보기(품목 합계/규격·사이즈별 버튼, 바꾸면 바로 조회, localStorage wpa:stock-group로 기억) · 오른쪽에 LOT별 재고·CSV 저장·기초재고/조정·부족분 발주. 보기 라디오는 form="stockFilters"로 폼 밖에 있어도 조회 값에 들어감.

- 15.156 부서별 메뉴 접기: 사이드바 부서 머리글(.nav-title)을 버튼으로, 누르면 .nav-group.shut(링크는 .nav-body 안). 접은 부서는 localStorage wpa:nav-shut에 기억, 지금 화면이 든 부서는 늘 펼침.
- 15.157 납품현황(#/sales/delivery-status, 영업 › 매출전표): 입고현황의 매출 쪽. GET /api/sales-delivery-status(영업 권한) — 출고일 기준 출하 줄, 매출전표에 잡힌 출하는 전표 공급가액·세액(확정), 안 잡힌 출하는 수주 단가(출하지시) → 단가표(출고일 기준) → 최근 매출 단가 × 수량(미확정, 세액 10%), 없으면 단가 없음. 분류·거래처 집계는 입고현황과 같은 rsSummary(lines)로 묶음(매입 쪽 동작 그대로). 화면은 pageReceiptStatus(main, "sales")로 같은 코드를 쓰고 글자만 바꿈(입고→출하, 입고일→출고일, 매입전표→매출전표, 발주번호→수주번호; MutationObserver로 .rs-page 안 글자·placeholder·aria-label). 보기·분류 기억 키는 wpa:ds-view·wpa:ds-cat.
- 15.158 표 엑셀식 필터: 정렬되는 목록 표(table.grid, sortableTable 조건)의 머리글마다 깔때기 버튼(.xf-btn). 창: 오름/내림차순, 값 검색, (모두 선택), 값 목록(건수), 이 칸 필터 지우기·취소·확인. 여러 칸 AND, 값 목록은 다른 칸 필터를 통과한 줄에서. 필터 중에는 소계·합계(auxRow) 줄 숨김, 표 위 .xf-bar에 「필터 n개 · x/y행 · 필터 모두 지우기」. 머리글이 두 줄이거나 칸을 합친 표, data-no-filter 표는 뺌. 표를 다시 그리면(조회) 필터는 풀림.

- 15.159 메뉴 위치 고르기(사용자 설정, 화면 모드처럼): 머리줄 「좌측 메뉴 / 상단 메뉴」 버튼(theme.js, localStorage wpa:nav-layout, <html data-nav="top">). 상단 메뉴는 821px 이상에서만: .side를 머리줄 아래 가로 줄로, 부서 머리글을 누르면 하위 메뉴가 여러 칸으로 펼침(열린 채로 옆 부서에 올리면 바뀜, 바깥·Esc·메뉴 클릭 시 닫힘, 현재 부서 밑줄), 본문 최대 폭 1440. 휴대폰은 늘 ☰ 서랍. 메뉴 버튼은 .theme-toggle 글자 갱신에서 뺌(.nav-layout-toggle).

- 15.160 넓은 화면 여백: main 최대 폭(1280) 없앰 → 표·목록은 화면 끝까지(상단 메뉴 1440·입고현황 1760 상한도 없앰). 입력 칸 묶음(.form-grid)은 1240px, 목록 검색칸·입고현황 통합 검색은 560px까지만.
- 15.161 매입 세금계산서: 품목 칸이 「매입전표 PB-…」로 나오던 것 → 담긴 매입전표의 품목 줄(품목·규격+단위·수량·단가·공급가액·세액, 운송비는 따로 한 줄, 세액은 splitVat로 전표 세액을 나눔). 줄이 16개를 넘으면 전표마다 「첫 품목 외 n건」. 창에서 「수정」: 작성일자·승인번호·비고·품목 줄(빈 줄 2개 추가, 품목명 비우면 빠짐, 수량·단가 바꾸면 공급가액·세액 다시 계산). PUT /api/purchase-tax-invoices/:id — 품목 공급가액·세액 합 = 담긴 전표 합계여야 저장, 월일은 작성일자와 같은 달, 마감된 달 막음, 승인번호 중복 막음, doc_changes(doc_type purchase_tax) 이력. 마이그레이션 0052_purchase_tax_items(purchase_tax_invoices.items, 비면 자동). 발주 목록 칸: 구매의뢰번호 · 거래처 · 품목명 순(거래처를 품목 앞으로). 메뉴 맨 위 「★ 마이메뉴」(삼성 N-SRM My Menu 참고): 제목 옆 ☆ 또는 메뉴 줄 ☆(올리면 보임, 추가된 건 늘 ★)로 추가·빼기, 서버 내 설정 ME.ui.favorites. 좌측은 맨 위 그룹(접기 가능, 비면 안내), 상단은 맨 앞 파란 버튼 → 안내 카드 + 메뉴 칸.

- 15.162 전체 스타일(삼성 DS N-SRM 참고): 남색 머리줄(로고 흰색), 기본 메뉴 위치 = 상단(좌측을 고른 사람은 그대로), 상단 메뉴는 글자 메뉴 + 현재·열린 부서 파란 알약, 펼침은 화면 너비 패널(굵은 소제목·밑줄, • 하위 메뉴). 연 화면 탭(HOME + 화면, × 닫기·다른 탭 모두 닫기, localStorage wpa:tabs:<사용자>, 최대 10)과 위치 표시(⌂ › 부서 › 하위 › 화면, NAV에서 찾음). 조회 박스 연회청·조회 버튼 남색, 결과 표 머리 연회색·굵은 진한 글씨, 보조 버튼 테두리형, 모서리 4~8px(15.x 「모서리 0」 전역 규칙 위에 해당 요소만 예외). 매출 세금계산서도 수량·단가·공급가액·세액 고치기(taxItemEditor 공통, 매입과 같음): PUT /api/tax-invoices/:id items에 qty·unit_price·supply·vat, 줄 보태기/빼기(최대 max(16, 원래 줄 수)), 줄 금액 합 = 계산서 합계. 계산서 품목 표 입력칸이 칸 안에 맞게(table-layout fixed).

- 15.163 견적서(영업 › 견적 › 견적서 작성/목록, #/sales/quotes/new · #/sales/quotes): ENTEGRIS 필터 견적서 양식 그대로(견적서·수신·Quote #·참조·견적일·유효기간 / 공급자: 회사 정보 상호·대표자·등록번호·주소·전화·팩스 + 문서번호 SS 견적일·담당자·전화 / 인사말 / 견적금액(V.A.T 별도) / NO·ITEM NO·품명·단위·수량·단가·공급가액·비고 / 합계 / 기타). 수신은 거래처 찾기(거래처코드), 품목은 품목 찾기(품목코드, 여러 개), 단가 입력(그 거래처 단가표가 있으면 미리 채움). 통화 원화(원 미만 절사)·달러(센트 반올림). 견적번호 SST-연도-월일-순번. 수정(doc_changes quote 이력)·복사해 새 견적·취소. API /api/quotes(GET·POST)·/:id(GET·PUT)·/:id/cancel, 영업 권한. 마이그레이션 0053_quotes(quotes·quote_lines 새 표). 회사 정보(세금계산서 설정)에 팩스 칸 추가(설정 JSON, 스키마 변경 없음).

- 15.164 세금계산서 목록(매출 관리·매입): 「보기」 버튼 없앰 → 줄을 누르면(또는 Enter) 계산서 창(체크칸·버튼·링크는 제외). 경리 메뉴(NAV 「경리」, data-dept accounting): 세금계산서(매출 만들기·관리·발행 체크, 매입 세금계산서·발행 체크) · 거래처별 장부(매출·매입) · 대금(입금확인·지급확인·매입처 원장·채권/채무 연령표)을 영업·구매에서 옮겨 모음. 기간별 거래보고·매출 마감은 영업 › 매출전표, 매입 마감은 구매 › 매입전표에 그대로. 화면 주소는 그대로라 권한(영업/구매 메뉴)도 그대로, 경리 묶음은 볼 수 있는 화면만 보이고 없으면 묶음이 안 보임. 역발행: 매출 계산서 고치기 창에서 발행구분(정/역)을 고를 수 있고(발행 전), 역발행은 발행 기록(issued/sent) 뒤에도 품목·수량·단가·금액·작성일자·승인번호·비고를 고침(PUT /api/tax-invoices/:id 조건 status draft/failed 또는 issue_type reverse·취소 아님, 승인번호 중복 막음). 역발행은 받는 이메일 없어도 저장.

- 15.165 어음 관리(경리 › 대금, #/purchase/notes, 입금확인과 같은 권한): 받을어음·지급어음. 칸 발행일자·어음번호·거래처·발행금액·만기일자·발행은행·처리구분(미처리/만기회수)·처리일자·비고. 등록(창, 거래처 찾기·은행 목록), 줄 눌러 고치기(이력 doc_changes note), 만기회수(처리일자)·미처리로 되돌리기·삭제(status cancelled, 기록 남김). 같은 구분에서 살아 있는 어음번호 중복 막음, 만기일자 ≥ 발행일자. 미처리 어음 만기 7일 안 노랑(D-n)·지나면 빨강. 합계 줄(발행금액·미처리·만기회수). 조회: 날짜 기준(발행일자·만기일자·처리일자, API basis=issue|due|processed) + 기간, 처리·미처리·전체 단추(status=collected|open|빈 값), 바꾸면 바로 조회. API /api/notes(GET·POST)·/:id(PUT)·/:id/collect|reopen|cancel·/:id/history. 마이그레이션 0054_bill_notes(새 표 1개).

- 15.166 매출 달력(영업 › 매출전표, #/sales/calendar): ERP 납품전표 관리처럼 왼쪽 위 달력(◀ 연·월 ▶·오늘, 날짜마다 확정 매출전표 건수, 일요일 빨강·토요일 파랑, 오늘 테두리, 고른 날 파랑), 왼쪽 아래 일별 납품현황(일자·건수·매출·세액·합계금액 + 월 합계), 오른쪽 위 고른 날 납품전표 목록(No·전표번호·거래처·매출·세액·합계금액 + 합계), 오른쪽 아래 고른 전표 세부품목(제품코드·제품명·규격·단위·수량·단가·금액 + 납품가액·부가세·합계금액, 「전표 열기」). 거래처로 거르기. 보던 달·날은 sessionStorage wpa:sales-cal로 기억. API GET /api/sales-calendar?month=YYYY-MM&customer= (영업 권한, 확정 전표 일자별 건수·공급가액·세액·합계).

- 15.167 팝업 키보드: 팝업(modal)이 떠 있으면 뒤 화면(#app)과 아래 팝업은 inert(포커스·클릭·Enter 안 감), 맨 위 팝업만 동작. 열릴 때 포커스 → [autofocus] → 첫 입력칸 → 확인 단추([data-yes]) → 팝업 자체(tabindex -1). 닫으면 아래 팝업 또는 원래 누른 곳으로 포커스. syncModalInert()를 열기·닫기와 body MutationObserver에서 불러, 팝업이 다른 경로로 사라져도 뒤 화면이 잠긴 채 남지 않음. 감사 스크립트에서 page.evaluate로 confirmBox를 부르면 약속을 기다리므로 void로 부를 것.

- 15.168 입력칸 대비: 입력 칸 묶음(.form-grid, 화면·팝업)과 조회 조건 바탕은 연회청(--form-panel #eef1f6), 입력칸은 흰 바탕(--field-bg) + 진한 테두리(--field-line #b8c1cf), 마우스 올리면 더 진하게(--field-hover), 누르면 파란 테두리·옅은 파란 링. 읽기 전용·잠긴 칸은 회색(--field-off). 표 안 입력칸도 같은 테두리. 다크 모드 값 따로.

- 15.169 데이터 유실·무결성 점검 결과 고침: (1) 저장 안 한 입력 지키기 — #main 입력 폼(조회 조건·읽기 전용·팝업·자동 보관 폼 제외)에 입력·단추 변경이 있으면 data-dirty, 다른 메뉴·탭·주소로 가면 hashchange에서 주소를 되돌리고 confirmBox(「취소」면 그대로), submit하면 표시 지움, 새로 고침·창 닫기 beforeunload 경고. 「다른 탭 모두 닫기」는 화면을 다시 그리지 않음. (2) 매출 세금계산서 PUT: version(updated_at) 확인 + UPDATE WHERE status·updated_at 그대로일 때만(동시 수정·발행 기록 뒤 덮어쓰기 막음), issue_type은 발행 전·바뀐 경우만, 발행 뒤 역발행 고치기는 매출 마감 확인·doc_changes(tax_invoice) 이력, 줄 수가 바뀌면 옛 줄 값 안 물려받음. (3) 어음 등록·수정: 같은 구분 살아 있는 어음번호를 INSERT … WHERE NOT EXISTS / UPDATE … AND NOT EXISTS 한 문장으로(동시 등록 경합 막음). (4) 견적서: PUT version(updated_at||created_at) 확인, 취소 RC_GUARD(이력 한 줄), 거래처가 목록에 없으면 기존 거래처코드 유지, 공급가액은 반올림한 수량 × 단가, 달러 반올림 toFixed+e2 방식(1.005 → 1.01, 화면도 같은 식). 참고: 백업은 내려받기만 있고 앱 안 복원 기능은 없음(새 표 quotes·quote_lines·bill_notes와 purchase_tax_invoices.items는 백업에 포함).

- 15.170 메뉴 통합: 「매출전표 입력」+「매출전표 목록」 → 「매출전표 관리」(#/sales/bills), 「매출 세금계산서 만들기」+「관리」 → 「매출 세금계산서 관리」(#/sales/tax). 화면 제목 아래 전환 단추(목록 | 입력·만들기, .manage-tabs). 입력 주소(#/sales/bills/new, #/sales/tax/new)는 그대로 동작하고 ROUTE_ALIAS/navRoute로 메뉴 강조·화면 탭·위치 표시는 관리 하나로 묶음. 전환도 저장 안 한 입력 지키기(15.169)를 거침. DB·API 변경 없음.

- 15.171 가독성: 메뉴 77개 화면 측정(단추 높이·글자 크기·대비·단추 간격) 결과로 style.css 끝에 한 기준 추가. 단추 보통 42px·14px, 작은 단추 32px·13px, 조회 줄 단추는 입력칸과 같은 44px(◀ 기간 ▶·거래처 찾기 포함). 표 글자 14px·제목 13.5px 진하게·줄 패딩 10px·구분선 보이게·숫자 tabular-nums·줄 마우스 강조. 설명·선택 표시 최소 13px, 칩 12.5px. 표 칸 안 나란한 단추 6px 간격. 화면 탭 글자 진하게·닫기(×) 26px, 활성 탭 남색, 밝은 테마 --muted #566070. 측정: 12.5px 미만 글자 365→40, 대비 4.5 미만 167→12. DB·API 변경 없음.

- 15.172 매출전표 관리(목록): 「거래명세서 (기간 합산)」 단추를 조회 줄에서 결과 영역(체크 묶음 줄 오른쪽, #billBulk .bulk-end)으로 옮김 → 조회 줄 한 줄. 동작(조회 조건의 거래처·기간 사용)은 그대로.

- 15.173 표 열 너비·순서(엑셀처럼): labelGridTables에서 빈 열 숨긴 뒤 gridLayout(table). 머리글 오른쪽 경계(.gr-rz)를 끌면 너비 조절(처음 조절 때 보이는 열 너비를 고정, table-layout fixed, 넘치면 가로 스크롤), 경계 두 번 누르면 그 열 원래 너비. 머리글을 끌어 다른 머리글에 놓으면 열 순서 바꿈(본문·합계 줄 칸도 함께, 필터 칸 번호 다시 맞춤, 필터는 풀림). 순서 바꾸기는 입력칸·합친 칸·rowspan·두 줄 머리글·합계 줄 있는 표와 data-no-reorder 표(매입 마감 거래처 표: nth-child로 읽음) 제외. 저장: localStorage wpa:grid:<사용자>:<화면>:<머리글 이름 정렬>, 「열 배치 초기화」 단추로 지움. 휴대폰 카드 모양에서는 손잡이·초기화 숨김. 너비 조절 직후 click은 정렬로 가지 않음(grNoClick).

- 15.174 분석의뢰 ↔ 검사규격 연결 고침: (1) 원인 — 의뢰 등록 때만, 품명이 규격 품명·별칭과 정확히 같고 품목 카테고리까지 같을 때만 연결(카테고리를 안 고르면 ''라 절대 연결 안 됨), 규격을 나중에 등록하면 영영 연결 안 됨. (2) inspectionSpecMatch(kind, category, title, code): 공백·하이픈·괄호·점·대소문자 무시 비교, 카테고리 비면 모든 카테고리, exact(같음)·partial(3자 이상 서로 포함). 등록 때 exact 1개면 연결. GET /api/requests/:id/inspection: 규격이 없고 exact 1개면 그때 연결(완료 의뢰 제외), 아니면 suggest{exact,partial} 반환. GET /api/inspection-specs/match. (3) 규격 없음 창: 추천(이름 일치·비슷한 이름) 맨 위 미리 선택 + 나머지 규격 라디오 목록, 「<품명> 규격 새로 등록」(품명·제품코드 채운 등록 창, 저장 뒤 다시 열면 자동 연결), 품질팀원에게는 후보·요청 안내. (4) 분석의뢰 작성: 수입·출하검사 고르면 샘플명 아래 연결될 규격 미리 보기·비슷한 규격 누르면 샘플명 바꿈·규격 이름 목록(datalist). (5) 측정값 입력 Enter → 다음 칸. DB 변경 없음.

- 15.175 회원 관리 분리(관리 › 회원 관리 #/admin/users, 탭 3개 — MANAGE/ROUTE_ALIAS): 회원 정보(가입 승인·반려·사용자 추가·부서·직급·비밀번호 초기화·삭제, 권한/메뉴는 요약 링크만) / 사용 권한(#/admin/users/roles: 사람 × 역할 표, 관리자 포함, 체크 즉시 저장, 책임자는 승인된 사람만) / 메뉴 보기(#/admin/users/menus: 사람 × 메뉴 묶음 표, 방식 부서 기본·전체·직접 지정, 직접 지정일 때만 체크, 사용 권한 때문에 보이는 묶음은 「권한」 표시). 관리자 설정(#/admin)은 백업·사진 저장소·초대코드 + 회원 관리 안내(승인 대기 수)만. 서버: GET /api/admin/users에 menus_base(메뉴 설정만)·menus_effective(실제 보임) 추가, baseMenus() 분리. 코드는 public/org.js 끝(pageMembers). 권한·메뉴 저장 API·규칙은 그대로(역할이 있는 업무는 메뉴를 꺼도 보임). DB 변경 없음.

- 15.176 매입 달력(구매 › 매입전표 › 매입 달력 #/purchase/calendar, GET /api/purchase-calendar?month&vendor — 확정 매입전표 날짜별). 매출 달력과 한 함수 pageBillCalendar(main, side). 달력 공통: 전표 목록 머리에 「+ 전표 추가」(고른 날짜를 sessionStorage wpa:bill-date, 거래처 조건이 있으면 wpa:sbill-customer/wpa:bill-vendor로 넘겨 매출·매입전표 입력을 엶 — 입력 화면이 읽어 전표 일자·거래처 채움), 세부품목 아래 「수정」(billEditWindow: 일자·단가·비고, 저장 뒤 바뀐 날짜로 달력 갱신), 전표 줄 두 번 누르면 전표 열기. 마감·세금계산서 담긴 전표는 안내 문구. 매출 달력 거래처 칸 이름(customer) 그대로. DB 변경 없음.

- 15.177 중복·불일치 정리(사용자 관점 점검): 메뉴 — 매입전표 입력+목록 → 매입전표 관리(MANAGE 탭), 반입·반출 입력+목록 → 반입(반품) 관리·반출(반품) 관리(화면 안 기존 탭 그대로, ROUTE_ALIAS로 입력 주소도 관리 강조), 매입처 원장·기간별 거래보고(거래처별 장부와 겹침) 메뉴에서 빼고 매출·매입 거래처별 장부의 「품목 줄별 원장」 탭으로(주소 그대로). 같은 이름 메뉴(샘플의뢰·샘플리스트·생산계획 입력·작업 입력/기록) → 상품/제품·완제품/반제품·커팅/융착/세탁을 붙여 구분(화면 탭·마이메뉴에서 헷갈림). 표 — ITEM_HEADS(품목·품목명·제품명…) 최소 너비 9.5em, 코드·번호·일자 칸 한 줄(NOWRAP_HEADS 추가), 줄 끝 단추 3개 이상이면 두 줄 허용(표가 화면 밖으로 밀리던 발주 목록 등). 조회 줄 — 「~」만 있는 끝 날짜 라벨을 시작 날짜 옆 lf-pair로(pairDateRanges, 이름·이벤트 그대로), 매입전표 목록 거래처 찾기, LOT 식별문자·기준일 칸 넓힘. DB 변경 없음.

- 15.178 입력·목록 메뉴 마저 통합: 견적서 관리(#/sales/quotes), 수주 관리(#/sales/orders, 고치기 #/sales/orders/edit도 수주 관리 강조), 생산의뢰 관리(#/sales/mr), 구매의뢰 관리(#/sales/pr), 발주 관리(#/purchase/po — VIEW_SPLIT 화면은 관리 화면이면 applyView가 제목·전환 단추를 건드리지 않음). managedTabs: 고치는 중(제목에 수정·고치기)이면 「관리 · 견적서 수정」처럼 표시 유지, 볼 수 없는 탭(canSeeRoute)은 숨김, 화면 안 예전 전환 단추(.view-switch, 수주 목록의 「수주 입력」, 견적서 목록의 「+ 견적서 작성」)는 숨기거나 뺌. 입고목록 「확인중」 → 「확인중으로 표시」 단추(테두리). DB 변경 없음.

- 15.179 오류·사용성 검증 결과 고침: (1) 15.175에서 관리자 설정의 초대코드 저장(#invForm onsubmit)이 함께 지워져 「변경」이 GET 제출(코드가 주소에 노출, 저장 안 됨) — 되살림. (2) 사용 권한이 필요한 화면(ROUTE_ROLE: 영업 — 견적·수주·매출전표·달력·반입·납품현황·마감·매출 계산서·장부·채권, 구매 — 매입전표·달력·반출·입고현황·마감·매입 계산서·장부·채무, 영업 또는 구매 — 입금·지급·어음)은 메뉴 보기가 켜져 있어도 권한이 없으면 메뉴에서 빼고(canSeeRoute = 메뉴 && canUseRoute, 모든 묶음에 seeItems) 주소로 오면 「사용 권한이 없습니다」 안내(API 403 빈 화면 대신). (3) GET /api/admin/users 부서 표 한 번만 읽기(baseMenus/effectiveMenus에 departments 넘김). (4) 수주 고치기도 관리 화면(「수주 관리 · 수주 고치기」 + 전환). (5) 달력 품목 늦은 응답 버림·「수정」은 고른 전표 번호 확인·잠긴 전표는 「수정」 숨김. (6) 휴대폰 달력 가로 넘침. DB 변경 없음.

- 15.180 N-SRM 레퍼런스 맞춤: (1) 화면 밀도 촘촘(기본)·보통 — theme.js density-toggle(wpa:density, html data-density), 촘촘 CSS는 :root[data-density=compact] body:not(.operator-mode)(입력칸 32·단추 32/26·표 줄 약 35px·글자 13~13.5). (2) 결과 줄 한 줄 — 매출·매입전표 목록 .result-bar(왼쪽 resultCount 「결과 n건 · 확정 합계」+분류별, 오른쪽 담기·거래명세서·엑셀), 위 합계 문장 중복 제거. (3) ⚙ 열 설정 — 표 오른쪽 위 .gr-gear(gridLayout 표 전부) → 보일 열 체크(grHide, 저장 st.hidden)·모두 보이기·열 배치 초기화(예전 gr-bar 단추 대체). (4) 매출·매입전표·수주 목록 줄마다 「보기」 단추 없앰(번호 링크), 분류·반입 칩은 거래처 옆 한 줄(.cell-chips), billMonthBody tail 3. (5) 조회 조건 — filterTools(): 폼 아래 가운데 「–」 접기(wpa:lf-fold:<화면> 기억), 초기화 단추 없는 폼은 ↺ 추가, ↺·조회를 .lf-actions로 오른쪽 끝. (6) 긴 목록(본문 15줄 넘음) .tw-fill — 표 안 스크롤·머리글/합계 줄 고정. (7) 세금계산서·거래처별 장부: 관리 탭(.manage-tabs.sub)을 매출/매입 탭 아래 둘째 줄로. (8) 도움말 — 위치 표시 아래 오른쪽 「도움말」 단추(펼치면 떠 있는 설명). (9) 위치 표시 끝 화면 코드 [SALES-BILLS]. (10) 일자·상태·구분·분류 칸 가운데(CENTER_HEADS). (11) 표 안 상태 칩은 글자색만. DB 변경 없음.

- 15.181 거래처 찾기·품목 고르기 창: 키보드로 고른 줄(ip-active, Enter로 선택·↑↓ 이동) 표시가 칸(td)마다 outline으로 그려져 칸이 상자처럼 보이던 것 → 줄 전체 옅은 파랑 + 첫 칸 왼쪽 파란 막대(box-shadow inset). DB 변경 없음.

- 15.181 보완: (1) 표마다 미세 가로 스크롤바 — 마지막 머리글의 열 너비 손잡이(.gr-rz right:-4px)가 표 밖으로 나가 table-wrap이 3~4px 넘치던 것(전 화면 32곳 → 0), 마지막 열 손잡이 right:0. ⚙ 자리용 마지막 머리글 오른쪽 여백(30px)도 빼고 ⚙는 표에 마우스를 올릴 때만 또렷하게. (2) 열을 줄이면 표 오른쪽이 하얗게 비던 것 — gr-fixed 표 min-width 100%, 늘어나는 열 하나(비고·메모 → 품목 → 마지막 이름 칸, 끄는 열 제외 — .gr-flex width auto)가 남는 폭을 채움. (3) 거래처 찾기 칸이 옆 입력칸보다 4px 위에 떠 있던 것(label > .partner-picker margin-top 4px)·단추 테두리 색을 입력칸과 같게·겹선 없앰. (4) 거래처 찾기·품목 고르기 창의 키보드로 고른 줄 표시를 칸마다 상자 → 줄 강조 + 왼쪽 막대. DB 변경 없음.

- 15.182 IMK mall식 표·조회(레퍼런스): 표 — 머리글 위 진한 남색 선(2px)·회청 머리글·옅은 세로 칸선·짝수 줄 옅은 배경·체크한 줄 옅은 파랑·표 안 링크 밑줄. 칸 커서 — 표 칸을 누르면 파란 테두리(.cell-on), 방향키로 칸 이동·Esc 해제(입력칸·팝업 안에서는 동작 안 함). 앞 열 고정 — 가로로 넘치는 표(gridFreeze: table-wrap scrollWidth > clientWidth)는 체크 칸+첫 열(또는 첫 열) sticky, 고정 경계 파란 선, 칸 합친 합계·묶음 줄(fz-skip)은 고정 안 함. 빈 화면 — 문서·돋보기 아이콘 + 안내. 조회 줄(촘촘·넓은 화면) — 이름을 칸 왼쪽 한 줄로. 관리 전환 단추는 늘 한 줄 차지(수주 상태 탭과 분리). DB 변경 없음.

- 15.183 샘플의뢰 이동: 제품·상품 샘플의뢰 작성은 영업 › 샘플의뢰(#/sales/sample/product, #/sales/sample/goods — 예전 #/prod/request, #/purchase/sample/request는 새 주소로), 리스트는 생산(제품)·구매(상품)에 그대로. 승인은 각 부서 리스트 위 「접수대기 · 승인 필요」(loadWorkPending, REQ.approve)에서 — 홈 할 일·메뉴 숫자·알림 링크도 승인하는 리스트로. 팝업 안 표: 머리글 줄바꿈 허용(짧은 말은 쪼개지 않고 5자 이상만 th-long), 칸 여백 좁게 → 구매의뢰 상세 팝업 표 29px 넘침 → 0. DB 변경 없음.

- 15.184 구매의뢰 품목 입력을 아이마켓식 표로: 한 품목 = 한 줄(tbody[data-items] > tr.pr-item), 칸 안 입력(PR_COLS: 품목명·제품코드·규격·단위·수량·매입단가·판매단가·금액·공급선·사용고객사·납품예정수량·입고요청일·현재고·월사용량), data-k·계산·품목 찾기 고정(itemLockApply, 칸마다 label.pr-cell)·운송비·초안 그대로. 칸마다 붙던 (선택)·*는 숨기고 머리글 *·빈 필수 칸 노란 바탕으로. 표는 안에서만 가로 스크롤.
- 15.185 결재선: (1) 결재자 고르기 목록을 조직도 순서로 — 내 부서 → 상위 부서(parent_id 따라) → 그 밖 부서, 부서 안은 직급 순(prPeopleGroups). (2) 관리 › 결재선 설정(#/admin/approval, GET/PUT /api/approval-rules, settings approval_rules — 마이그레이션 없음): 문서(구매의뢰)별 「작성자 직급 → 결재·합의·참조 단계」, 단계는 직급(작성자 부서→상위 부서에서 그 직급인 사람) 또는 특정 사람. 새 구매의뢰는 규칙(직급 일치 → 없으면 「모든 직급」)으로 결재선 자동 채움·찾지 못한 단계 안내·「기본값 다시 불러오기」. 상신 검사는 그대로. (3) 숨긴 .field-error의 「!」가 보이던 것. DB 변경 없음.

- 15.186 발주 입력(표, line-table.js): 품목을 고르거나 직접 입력 품목명을 쓰면 GET /api/po/history?code&item&vendor(제품코드 우선, 없으면 품목명 공백·대소문자 무시, 최근 10건 + last·last_vendor)로 최근 발주 내역을 읽어, 단가 칸 아래 「최근 n · 이력 m」(같은 거래처 우선, 아니면 「타 거래처」), 첫 발주면 「첫 발주」. 단가가 비어 있고 단가표 단가도 없으면 최근 단가를 넣고 「최근 단가 적용」 표시(직접 고친 단가는 그대로). 「이력」을 누르면 발주일·구매의뢰번호·거래처·규격·수량·단가·입고 창, 단가 누르면 그 줄 단가로. 거래처를 바꾸면 그 거래처 기준으로 다시 계산. DB 변경 없음.

- 15.187 발주 단가 기준을 확정 매입전표로: GET /api/po/history가 purchase_bill_lines(active=1) + purchase_bills(status=confirmed)의 줄 단가를 전표 일자 최근 순 10건(basis bill), 매입전표가 없는 품목은 발주서 단가(basis po). 단가 칸 아래 「최근 매입 n」/「최근 발주 n」·「첫 매입」. 넣은 단가가 기준 단가와 10% 넘게 다르면 빨간 경고(⚠ +n%)를 바로 보이고, 저장할 때 품목·단가·기준 단가·차이를 모아 한 번 더 확인(취소하면 저장 안 함). 이력 창은 「확정 매입」 전표 일자·전표번호·거래처·규격·수량·단가. DB 변경 없음.

- 15.188 구매의뢰 작성: 판매단가 칸 아래 최근 판매가 — GET /api/sales/price-history?code&item&customer(영업·구매 담당·관리자만, 확정 매출전표 줄 단가·반입 감액 줄 제외, 최근 10건 + last·last_customer). 품목을 고르거나 품목명·사용고객사를 바꾸면 「최근 판매 n · 이력 m」(사용고객사 단가 먼저, 없으면 「타 고객사」), 판매단가가 비어 있으면 넣고 「(적용)」(직접 고친 값은 그대로), 「이력」 창에서 단가 눌러 적용, 판매 기록이 없으면 「판매 기록 없음」. DB 변경 없음.

- 15.189 전 화면 점검(1366·1920·390, 메뉴 + 입력 주소 89화면 × 3, 팝업 8종 × 2, 권한 7종) 결과 고침: 조회 줄(이름 왼쪽)에서 글·검색 칸이 라벨보다 넓어져 옆 칸에 겹치던 것(검사 이력·불량 목록·세탁 기록), 한 줄 도구(일간·주간·월간 | ◀ ▶ 오늘 | 계획표·달력 | 엑셀)의 단추 높이 26/34 → 32로 맞춤(라벨 없는 도구 줄만 가운데 정렬), 넓은 화면 결과·도구 줄 단추 글자 꺾지 않음, 휴대폰 작은 표·달력 표 여백 줄여 넘침 없앰, 구매의뢰 상세 팝업 품목 표(14칸)가 넘치던 것 → 그 팝업만 화면 폭까지 넓히고 짧은 머리글은 꺾지 않음. 결과: 1366·1920 문제 0, 390은 달력 표 1px(휴대폰 스크롤바 안 보임)·출하지시 단추 두 줄만, 스크립트 오류 0. DB 변경 없음.

- 15.190 사용자 요청 5건 + 분석의뢰 선택 UI: (1) LOT 형식 — 입고 LOT 순번 4자리(R261113_0049·G261110_0046, /api/lots/next padStart 4, 예전 3자리 LOT도 숫자로 이어 셈), 서브 LOT은 화면·라벨·QR에서 -로 붙임(R261113_0049-001, lotFull·multi-items·lotLabels; QR 첫 칸 = LOT-서브). 생산 완제품 포장 LOT = P+생산일-순번 3자리(P261113-001, nextProductionLot head를 _ → -). QR 스캔(parseLotScan)은 「…_숫자-3자리」면 서브를 떼고 LOT로 찾음(재고는 LOT 단위 그대로). 저장 구조(lot·sub_lot 따로)는 그대로. (2·3) 제품등록 업체 정보: 마이그레이션 0055_bom_vendor_info(boms.vendor_info TEXT 기본 빈 값, 열 1개만 추가 + 저널). POST/PUT /api/boms가 vendor_info(500자) 저장(PUT은 보냈을 때만). 새 제품 등록·수정 창에 업체 정보·비고(여러 줄) 칸, 목록에 「업체 정보」「비고」 칸(품목명 옆 비고 대신 규격). (4) 창고 위치 여러 개: 창고·위치 관리에서 위치를 칩으로(Enter·쉼표·추가 단추로 더하고 ×로 빼기, 엑셀 세로 복사 붙여넣기도 나눔), 새 창고도 같은 칸. 서버 형식(쉼표 목록, 200개)은 그대로. (5) BOM 구성자재: 제품등록의 원자재·부자재·반제품·상품(제품 제외, 자기 자신 제외)을 자재명 목록 제안(datalist)·「찾기」(품목 고르기 창)로 고르고, 고르거나 같은 이름을 쓰면 분류·단위를 맞춤. 「+ 자재 추가」는 줄을 넣고 찾기 창을 바로 연다. (6) 의뢰 양식(분석·개발·샘플): 하나만 고르는 칸은 붙은 버튼(세그먼트, 고른 칸 파란색), 여러 개 고르는 의뢰 항목은 같은 폭 격자(고르면 테두리·바탕 강조), 기타·LOT 번호 입력은 버튼 줄 옆. 감사 v190 27/27, v136·v72 기대값을 새 LOT 형식으로, m189 전 화면 1366·1920 0건(390은 기존 2건 그대로).

- 15.191 세탁·커팅/융착 작업 입력: 「제품코드·품명 검색」 칸과 「품목(모델)」 선택이 따로 있던 것을 「제품코드 · 품명」 한 칸으로(semiCodePick). 코드나 품명을 치면 등록된 반제품 목록(datalist)이 뜨고, 코드·품명이 정확히 같거나(입력 중) 하나만 맞으면(칸을 벗어날 때) 그 품목으로 정하고 단위도 맞춤. 여러 개 맞거나 없는 품목이면 칸에 안내(setCustomValidity)하고 저장을 막음. 실제 값은 숨긴 bom_id 선택(syncSpec는 row.dataset.semiOne이면 그 선택을 숨기고 required를 끔). 초안 복원·줄 복사도 그대로 됨. 세탁 진행시각 라벨의 「* … (선택)」 모순을 「진행시각 (선택 · 비우면 저장할 때 현재 시각)」으로. 도움말 단추가 제목 줄 오른쪽 단추(「작업 기록 보기 →」 등)와 겹치면 그 왼쪽으로 비킴(helpDodge). 감사 v191 9/9, m191 도움말 68곳 겹침 0.

- 15.192 제품등록 「등록 안 했는데 코드가 이미 쓰인다」: 원인은 삭제(사용 중지)된 품목이 그 제품코드를 그대로 쥐고 있고, 목록의 「사용」 보기에서는 안 보이던 것. bomCodeClash가 상대 품목이 사용 중지면 「사용 중지된 품목 「…」에서 쓰고 있습니다. 「미사용」에서 다시 사용하거나 코드를 바꾸거나 「완전 삭제」한 뒤 등록하세요」, 임시 품목이면 「임시 품목」을 붙여 안내. 목록에서 「사용」만 보는 중 검색어로 0건이면 「조건에 맞는 제품이 없습니다」 + 「사용 중지된 품목에 n건 있습니다: 코드 품명」·「미사용에서 보기」 단추. 감사 v192 5/5.

- 15.193 제품등록(새 제품·수정) 창: 맨 윗줄 순서를 품목코드 → 분류 → 품목명으로(품목코드와 품목명 자리 바꿈). 감사 v193, v190·v192 회귀 통과.

- 15.194 품목 CSV 일괄 등록: 제품등록 「CSV·엑셀 일괄 등록」(기존 엑셀 올리기). 꼭 필요한 칸 = 품목코드·품목명·분류(머리글이 있으면 이름으로, 없으면 이 순서로). 단위를 비우면 EA. 분류는 원자재·부자재·반제품·제품·상품·임가공 — 제품도 구성자재 없이 먼저 등록(나중에 수정에서 BOM). 분류 누락·잘못된 분류(예: 완제품)는 줄 오류. CSV 파일은 UTF-8이 아니면 EUC-KR(한글 엑셀 CSV 저장)로 읽음(decodeCsv). 「CSV 양식」(품목코드,품목명,분류 + 예시, UTF-8 BOM) 단추, 「양식 내려받기」→「엑셀 양식」. 결과 표에는 값이 있는 칸만. 파일 고르기 단추 안에 브라우저 기본 파일 칸이 보이던 것 숨김. 감사 v194 12/12, v113 14/14(제품 거절 기대값을 새 동작으로).

- 15.195 품목 CSV 일괄 수정: 올리기 창에 「이미 있는 품목코드는 고치기」(update_existing). 켜면 같은 품목코드(대소문자 무시) 품목의 품목명·분류를 고치고, 단위·규격·세부 분류·비고는 파일에 값이 있을 때만 바꿈(빈 칸은 그대로). 분류를 바꾸면서 세부 분류를 안 주면 세부 분류를 비움. 품목명을 바꾸면 bomFollowRename으로 다른 BOM 구성자재·발주·출하·기타입고의 품목명도 따라감. 검사 결과 줄에 「고침 품목명 A → B · 분류 X → Y」/「변경 없음」/「새로 등록」, 넣기 알림 「새로 등록 n · 고침 m · 변경 없음 k」. 끈 상태에서 이미 있는 코드는 오류(「고치기」를 켜라는 안내). 다른 품목이 쓰는 품목명으로는 못 바꿈. 단추 「CSV·엑셀 일괄 등록·수정」. 제품 수정 창은 새 제품 등록과 같은 양식이라 15.193 순서(품목코드 → 분류 → 품목명) 그대로. 감사 v195 8/8, v194 12/12, v113 14/14.

- 15.196 순서 통일 + BOM 소요량 페이지. (1) 품목코드 → 품목명 → 분류: 제품 등록·수정 창(15.193의 코드→분류→품명을 다시 코드→품명→분류로), 품목 찾기 창(코드·품목명·분류·단위·현재고), 재고 현황(품목코드·품목명·분류). (2) 관리 › BOM 소요량(#/admin/bom-sheet, 관리자; pageBomSheet는 bom-tree.js): 제품·반제품마다 품목코드·품목명·분류·기준 수량 + 자재코드·자재명·자재 분류·소요량·단위를 한 표(제품 칸은 rowspan). 검색(제품·자재 코드/이름)·분류·「구성자재 없는 것만」·생산 수량(필요량 = 소요량 ÷ 기준 수량 × 생산 수량)·제품별/자재별(역전개, 단위가 같으면 필요량 합계)·엑셀. 「수정」은 그 제품 자리에서 기준 수량·자재 추가(등록 자재 찾기·목록 제안, 고르면 분류·단위)·삭제·소요량·단위를 고쳐 POST /api/boms/:id/bom 한 번에 저장(읽은 updated_at 다르면 409, 같은 자재 두 번·자기 자신·순환·제품 빈 BOM 막음, 진행 코멘트 「[BOM] 기준 수량 a → b · 자재 x → y · + 추가 · − 삭제」). 제품등록 화면에 「BOM 소요량」 단추. 감사 v196 18/18, v195·v190 회귀, 단위 테스트 307.

- 15.197 BOM 소요량 하이라키: 제품별·자재별 모두 BOM 트리 모양(부모 줄 ▾/▸ 펼치기·접기, 자식 줄 └ 들여쓰기, 전체 펼치기·접기). 열 = 품목코드·품목명·품목분류·제품분류(1·2차 분류)·제품구분(완제품/반제품/생산 종류)·단위·소요량(소수 2자리)·(필요량)·비고(비고·포장 환산)·사용여부(✓)·수정. 부모 줄 소요량 = 기준 수량, 자식 줄 = 자재 소요량. 구성자재 없는 제품은 부모 줄에 「구성자재 없음」 칩 + 자식 자리 안내. 자재별은 자재(부모) 아래 쓰는 제품(자식), 자식의 「수정」은 제품별 보기의 그 제품 편집으로 이동. 감사 v196 21/21.

- 15.198 세금계산서 담기·입력 개선: (1) 매출전표 창 「세금계산서 담기」·목록 체크 담기(1장)는 담자마자 세금계산서 양식 창(발행 전, 칸 바로 고치기·저장)을 연다. 여러 장이면 알림. (2) 건별 담기에서 전표 품목이 여러 줄이면 「첫 품목 외 n종」 한 줄(공급가액·세액 = 줄 합)로 자동 입력, 한 줄이면 그대로(월별·합산은 전표마다 한 줄 그대로). (3) 매입전표 창에 「세금계산서 입력」(구매): 이 전표로 받은 세금계산서를 등록(작성일자 = 전표 일자)하고 매입 계산서 양식을 고치는 상태로 열어 승인번호·품목·일자 입력. 담긴 전표는 계산서 번호를 눌러 연다. (4) 세금계산서 목록 수신·국세청 칸에 「발행 전」(state=draft → status draft·failed). (5) 매출·매입전표 관리 목록: 전표번호가 아닌 줄 어디를 눌러도 전표 창(체크칸·단추·링크·글 선택 중은 제외). 감사 v198 14/14, v131·v138·v143·v161·v164·v170·v179·v180·m189b 회귀, 단위 테스트 308.

- 15.199 입고·제품·생산 7건. (1) 입고 입력 머리 한 줄(입고일 · 거래처 찾기 · 비고), 발주입고/기타입고는 색이 다른 탭 패널(발주 파랑·기타 초록), 입고 상세에 「구분」 칸(발주/기타 칩·줄 왼쪽 색). (2) LOT NO: 줄(포장)마다 다른 번호 R+입고일_0001, _0002 …(서브 미리보기 「n/m」 없음). 발주 담기·기타입고 품목 추가·LOT 나누기·붙여넣기로 표 끝에 더한 줄은 자동으로 LOT NO. 입고일을 바꾸면 자동 번호를 다시 매기고, 직접 고친 LOT는 자동에서 빠짐. 저장 때 서버는 LOT마다 서브 001을 그대로 붙임(라벨·QR R…_0001-001, 같은 LOT를 직접 두 줄에 넣으면 002…). (3) 「LOT 자동 번호」 단추·「LOT 식별문자」 칸·품목 찾기 창의 「LOT 자동 번호」 체크(openItemPicker autoLotBox:false)·LOT 나누기의 자동 번호 체크 삭제(식별문자는 품목 분류로). (4) 일괄적용: 팝업 대신 「입고창고: [선택] Location: [선택] [일괄적용] [창고 위치관리]」 줄 → 체크한 줄(없으면 모든 줄)에 입고창고·창고위치. 화면을 열 때마다 창고 목록을 새로 읽음. (5) 입고 상세 열 이름 입고창고·창고위치, 「업체 정보(비고2)」 칸 추가 — 마이그레이션 0056_receipt_note2(po_receipt_lots.note2, other_receipts.note2, 열만 추가), POST /api/receipts lines[].note2, 입고 상세 조회에 note2. (6) 제품등록 목록·BOM 소요량(제품별·자재별)에 코드 오른쪽 「NO」(자식 줄은 1-1, 1-2). (7) 생산 › 완제품 메뉴 2개: 「완제품 계획생산 접수·관리」(#/prod/finished/plan, 월 계획표: 제품분류(rowspan)·제품구분·품목코드·품목명·품목분류·계획수량 + 1~말일, 칸을 눌러 그날 수량 넣기·고치기·지우기, 「추가」, 계획여부 등록/미등록/전체, 대기 분홍·확정 초록, 줄 체크 → 「확정」/「확정취소」(체크 없으면 보이는 줄 전체)) · 「완제품 실적 입력」(#/prod/finished, 생산일의 확정 계획 + 지난 2주 미완료, 계획수량·실적 누계·잔량·양품수량·비고 → 저장/입력한 줄 모두 저장, 완제품 LOT 자동, 투입 자재 LOT는 먼저 들어온 것부터 자동(모자라면 물어 봄), 「상세」는 기존 실적 창, 위에 실적 수정 승인 대기). 마이그레이션 0057_schedule_confirm(schedules.confirmed_at·confirmed_by, 기존 계획은 확정 「(기존 계획)」으로 표시만). POST /api/schedules/confirm {ids, confirm}(생산·관리자, 실적 있는 계획은 확정취소 불가). 확정된 계획은 수량·날짜 수정·삭제 막음(기존 계획 표시는 예외). 예전 일정·카드 화면은 #/prod/finished/schedule로 남김, #/prod/finished/new는 계획 화면으로. 감사 v199a 16/16, v199b 24/24, v196·v195·v192·v190 회귀, m189(1366·1920 0건)·m179 통과, 단위 테스트 309. v72·v136·v75·v79는 예전 LOT·서브 방식 기대값이라 v199a로 대체.

- 15.200 매입전표 목록 체크 → 「받은 세금계산서 등록」: 승인번호·작성일자·비고 작은 입력 창 없이 바로 등록(작성일자 = 체크한 전표 중 마지막 일자)하고 매입 세금계산서 양식을 고치는 상태로 연다(승인번호·작성일자·품목·비고를 양식에서 넣고 「저장」). 매입전표 창의 「세금계산서 입력」(15.198)과 같은 흐름. 감사 v200 5/5, v198·v161 회귀.
