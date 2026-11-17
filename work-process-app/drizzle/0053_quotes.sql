-- 15.163 견적서(영업): 머리(수신·참조·견적일·유효기간·통화·담당자·기타)와 품목 줄(ITEM NO·품명·규격·단위·수량·단가·공급가액·비고). 새 표 2개만.
CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,
  quote_date TEXT NOT NULL,
  customer TEXT NOT NULL,
  customer_code TEXT NOT NULL DEFAULT '',
  attn TEXT NOT NULL DEFAULT '',
  valid_text TEXT NOT NULL DEFAULT '견적일로부터 1개월',
  currency TEXT NOT NULL DEFAULT 'KRW' CHECK(currency IN ('KRW','USD')),
  manager TEXT NOT NULL DEFAULT '',
  manager_phone TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  supply_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT,
  updated_at TEXT,
  cancelled_by TEXT,
  cancelled_at TEXT
);
CREATE INDEX quotes_date ON quotes(quote_date, id);
CREATE TABLE quote_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  bom_id INTEGER,
  product_code TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  supply REAL NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX quote_lines_quote ON quote_lines(quote_id, line_no);
