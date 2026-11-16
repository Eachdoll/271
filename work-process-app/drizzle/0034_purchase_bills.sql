-- 매입전표·매입 마감(15.80). 새 표 3개만 추가한다. 기존 데이터는 바꾸지 않는다.
-- purchase_bills: 공급사 거래명세서 한 장 = 매입전표 한 건(PB-YYMMDD-NN). 금액은 저장 당시 계산값(원 미만 절사).
CREATE TABLE purchase_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT NOT NULL UNIQUE,
  bill_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  statement_no TEXT NOT NULL DEFAULT '',
  statement_total REAL,
  tax_type TEXT NOT NULL DEFAULT 'taxable' CHECK(tax_type IN ('taxable','zero')),
  freight REAL NOT NULL DEFAULT 0,
  supply_total REAL NOT NULL DEFAULT 0,
  vat_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX purchase_bills_date ON purchase_bills(bill_date, id);
-- purchase_bill_lines: 전표 줄 = 입고 한 줄(발주입고 LOT 줄 po_lot / 예전 발주입고 po / 기타입고 other). 같은 입고 줄은 유효한 전표 하나에만.
CREATE TABLE purchase_bill_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('po_lot','po','other')),
  source_id INTEGER NOT NULL,
  po_id INTEGER,
  req_no TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  received_date TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  supply REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX purchase_bill_lines_bill ON purchase_bill_lines(bill_id);
CREATE INDEX purchase_bill_lines_po ON purchase_bill_lines(po_id);
CREATE UNIQUE INDEX purchase_bill_lines_source ON purchase_bill_lines(source_type, source_id) WHERE active=1;
-- purchase_closings: 거래처·월(YYYY-MM)별 매입 마감. 마감한 달·거래처의 전표는 만들거나 취소할 수 없다. 마감 취소는 관리자.
CREATE TABLE purchase_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  vendor TEXT NOT NULL,
  bill_count INTEGER NOT NULL DEFAULT 0,
  supply_total REAL NOT NULL DEFAULT 0,
  vat_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'closed' CHECK(status IN ('closed','reopened')),
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  reopened_by TEXT,
  reopened_at TEXT
);
CREATE UNIQUE INDEX purchase_closings_open ON purchase_closings(period, vendor_key) WHERE status='closed';
