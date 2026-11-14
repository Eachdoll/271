-- Inventory is computed from receipts, production actuals and shipments.
-- Only opening stock / stock-count corrections and minimum levels are stored.
CREATE TABLE stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adj_date TEXT NOT NULL,
  item TEXT NOT NULL, spec TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('opening','count','adjust')),
  counted_qty REAL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  request_id TEXT UNIQUE,
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX stock_adjustments_item ON stock_adjustments(item,unit,adj_date);
CREATE TABLE stock_levels (
  item TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
  min_qty REAL NOT NULL CHECK(min_qty>=0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  PRIMARY KEY(item,unit)
);
