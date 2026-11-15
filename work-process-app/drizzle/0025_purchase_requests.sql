-- 영업 구매의뢰(전자결재). 기존 표와 데이터는 바꾸지 않고 사용자 직급·부서 칸과 새 표만 추가한다.
-- 직급·부서는 결재선 이름 옆 표시와 의뢰서 부서명 기본값에 쓴다. 기존 사용자는 빈 값으로 둔다.
ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT '';
-- 의뢰서 머리. status: pending(결재 중) / approved(최종 승인) / rejected(반려, 작성자가 고쳐 다시 올림).
-- current_step은 지금 차례인 결재·합의 순번(purchase_request_lines.step)이다. revision은 동시 처리 충돌 방지용.
CREATE TABLE purchase_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL UNIQUE,
  doc_date TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  current_step INTEGER NOT NULL DEFAULT 1,
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_position TEXT NOT NULL DEFAULT '',
  reject_reason TEXT NOT NULL DEFAULT '',
  -- 첨부 사진 파일 이름(JSON 배열). 공통 attachments 표는 대상 종류가 CHECK로 고정돼 있어 따로 둔다.
  photos TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT UNIQUE,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX purchase_requests_author ON purchase_requests(author_id, id);
CREATE INDEX purchase_requests_status ON purchase_requests(status, id);
-- 의뢰 품목. 금액(수량×단가)은 저장하지 않고 조회 때 계산한다. 납품예정수량·입고요청일·월사용량은 「전량」「ASAP」 같은 글도 받는다.
-- po_id는 「발주 생성」으로 만든 발주목록 행이다.
CREATE TABLE purchase_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  bom_id INTEGER,
  product_code TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL CHECK(qty > 0),
  purchase_price REAL CHECK(purchase_price IS NULL OR purchase_price >= 0),
  sale_price REAL CHECK(sale_price IS NULL OR sale_price >= 0),
  vendor TEXT NOT NULL DEFAULT '',
  delivery_qty TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  stock_qty TEXT NOT NULL DEFAULT '',
  due_text TEXT NOT NULL DEFAULT '',
  manager TEXT NOT NULL DEFAULT '',
  monthly_usage TEXT NOT NULL DEFAULT '',
  po_id INTEGER
);
CREATE INDEX purchase_request_items_request ON purchase_request_items(request_id, line_no);
-- 결재선. kind: approve(결재, 순서대로) / agree(합의, 결재 뒤 순서대로) / cc(참조, step 0, 열람 시 read_at).
-- 이름·직급은 상신 당시 값을 남긴다.
CREATE TABLE purchase_request_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('approve','agree','cc')),
  step INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  user_position TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT '' CHECK(decision IN ('','approved','rejected')),
  decided_at TEXT,
  comment TEXT NOT NULL DEFAULT '',
  read_at TEXT
);
CREATE INDEX purchase_request_lines_request ON purchase_request_lines(request_id, step);
CREATE INDEX purchase_request_lines_user ON purchase_request_lines(user_id, request_id);
