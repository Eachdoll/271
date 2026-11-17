-- 15.140 반입(매출 반품: 거래처 → 우리)·반출(매입 반품: 우리 → 매입처). 새 표 2개만 추가.
-- process: stock_amount(재고+금액) / amount(금액만) / stock(재고만) / none(처리 안 함·기록만)
-- settle: offset(미수·미지급에서 깎음) / refund(현금 환불: 금액 전표와 같은 금액의 환불 입금·지급을 함께 남겨 잔액은 그대로)
-- 금액을 처리하면 음수 매출전표(반입)·매입전표(반출)를 bill_id로 만들어 장부·미수/미지급·마감·세금계산서에 그대로 반영된다.
CREATE TABLE stock_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT NOT NULL UNIQUE,
  side TEXT NOT NULL CHECK(side IN ('in','out')),
  return_date TEXT NOT NULL,
  party TEXT NOT NULL,
  process TEXT NOT NULL CHECK(process IN ('stock_amount','amount','stock','none')),
  settle TEXT NOT NULL DEFAULT 'offset' CHECK(settle IN ('offset','refund')),
  tax_type TEXT NOT NULL DEFAULT 'taxable' CHECK(tax_type IN ('taxable','zero')),
  supply_total REAL NOT NULL DEFAULT 0,
  vat_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  bill_id INTEGER,
  payment_id INTEGER,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  request_id TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX stock_returns_date ON stock_returns(side, return_date, id);
CREATE TABLE stock_return_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  bom_id INTEGER,
  product_code TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  item_category TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL CHECK(qty>0),
  unit_price REAL NOT NULL DEFAULT 0,
  supply REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('sales_line','purchase_line','manual')),
  source_id INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX stock_return_lines_return ON stock_return_lines(return_id);
CREATE INDEX stock_return_lines_source ON stock_return_lines(source_type, source_id);
