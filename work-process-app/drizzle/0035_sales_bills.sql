-- 매출전표·입금·매출 마감(15.81). 새 표 4개만 추가한다. 기존 데이터는 바꾸지 않는다.
-- sales_bills: 고객사에 판 한 건 = 매출전표(SB-YYMMDD-NN). 금액은 저장 당시 계산값(원 미만 절사).
CREATE TABLE sales_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no TEXT NOT NULL UNIQUE,
  bill_date TEXT NOT NULL,
  customer TEXT NOT NULL,
  tax_type TEXT NOT NULL DEFAULT 'taxable' CHECK(tax_type IN ('taxable','zero')),
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
CREATE INDEX sales_bills_date ON sales_bills(bill_date, id);
-- sales_bill_lines: 출하 한 줄(ship) 또는 직접 입력 줄(manual). 같은 출하 줄은 유효한 전표 하나에만.
CREATE TABLE sales_bill_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('ship','manual')),
  source_id INTEGER,
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  ship_date TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  supply REAL NOT NULL,
  vat REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX sales_bill_lines_bill ON sales_bill_lines(bill_id);
CREATE UNIQUE INDEX sales_bill_lines_source ON sales_bill_lines(source_type, source_id) WHERE active=1 AND source_id IS NOT NULL;
-- sales_payments: 입금(payment, 잔액에서 뺌)과 기초 미수금(opening, 잔액에 더함).
CREATE TABLE sales_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_date TEXT NOT NULL,
  customer TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment' CHECK(kind IN ('payment','opening')),
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT '',
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
CREATE INDEX sales_payments_date ON sales_payments(pay_date, id);
-- sales_closings: 고객사·월(YYYY-MM)별 매출 마감. 마감한 달의 전표·입금은 만들거나 취소할 수 없다. 마감 취소는 관리자.
CREATE TABLE sales_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  customer TEXT NOT NULL,
  bill_count INTEGER NOT NULL DEFAULT 0,
  supply_total REAL NOT NULL DEFAULT 0,
  vat_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'closed' CHECK(status IN ('closed','reopened')),
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  reopened_by TEXT,
  reopened_at TEXT
);
CREATE UNIQUE INDEX sales_closings_open ON sales_closings(period, customer_key) WHERE status='closed';
