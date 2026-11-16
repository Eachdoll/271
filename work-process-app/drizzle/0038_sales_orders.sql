-- 수주·출하지시·거래처코드(15.92). 칸 추가와 새 표만. 기존 데이터는 바꾸지 않는다(기존 거래처 코드는 빈 값).
ALTER TABLE vendors ADD COLUMN code TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX vendors_code ON vendors(code) WHERE code<>'';
-- sales_orders: 고객 주문 한 건(SO-YYMMDD-NN). 진행(잔량)은 줄의 매출전표 수량으로 계산한다.
CREATE TABLE sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  order_date TEXT NOT NULL,
  customer TEXT NOT NULL,
  customer_code TEXT NOT NULL DEFAULT '',
  customer_po TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  tax_type TEXT NOT NULL DEFAULT 'taxable' CHECK(tax_type IN ('taxable','zero')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','cancelled')),
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT,
  updated_at TEXT,
  closed_at TEXT,
  closed_by TEXT,
  close_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sales_orders_date ON sales_orders(order_date, id);
CREATE TABLE sales_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  bom_id INTEGER,
  product_code TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  unit_price REAL,
  due_date TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sales_order_lines_order ON sales_order_lines(order_id);
-- 매출전표 줄이 어느 수주 줄에서 나왔는지(분할 매출·잔량)
ALTER TABLE sales_bill_lines ADD COLUMN order_line_id INTEGER;
CREATE INDEX sales_bill_lines_order ON sales_bill_lines(order_line_id);
-- ship_instructions: 수주에서 잡은 매출전표 줄마다 물류에 내려가는 출하지시. 물류가 처리하면 출하(shipments)가 생기고 전표 줄이 그 출하로 연결된다.
CREATE TABLE ship_instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  bill_line_id INTEGER NOT NULL UNIQUE,
  order_line_id INTEGER,
  customer TEXT NOT NULL,
  bom_id INTEGER,
  product_code TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  ship_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','shipped','cancelled')),
  shipment_id INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  processed_by TEXT,
  processed_at TEXT
);
CREATE INDEX ship_instructions_status ON ship_instructions(status, ship_date);
