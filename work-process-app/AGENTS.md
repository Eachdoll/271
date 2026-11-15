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
