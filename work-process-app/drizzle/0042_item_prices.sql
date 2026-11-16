-- 15.111 거래처별 단가표: 구분(매입 purchase / 매출 sales) · 거래처 · 품목(bom) · 적용일마다 한 줄.
-- 단가를 바꾸면 새 적용일로 한 줄을 더하므로(덮어쓰지 않음) 줄들이 곧 단가 이력이다. 전표 날짜에 쓰는 단가 = 그 날짜 이전 가장 늦은 적용일의 단가.
CREATE TABLE item_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL CHECK(side IN ('purchase','sales')),
  vendor TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  bom_id INTEGER NOT NULL,
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  valid_from TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  removed_by TEXT,
  removed_at TEXT
);
CREATE INDEX item_prices_lookup ON item_prices(side, vendor_key, bom_id, valid_from);
CREATE UNIQUE INDEX item_prices_one_per_day ON item_prices(side, vendor_key, bom_id, valid_from) WHERE active=1;
