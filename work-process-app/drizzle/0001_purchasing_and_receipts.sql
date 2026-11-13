ALTER TABLE purchase_orders ADD COLUMN item_category TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN coa_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN lot TEXT NOT NULL DEFAULT '';

CREATE TABLE other_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_date TEXT NOT NULL,
  item TEXT NOT NULL,
  item_category TEXT NOT NULL CHECK(item_category IN ('제품','상품','원자재','부자재')),
  qty REAL NOT NULL CHECK(qty >= 0),
  vendor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX other_receipts_date ON other_receipts(received_date);
