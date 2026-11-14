-- Vendor directory (anyone may maintain it) and product codes on free-text item rows.
-- Existing rows keep an empty product_code; nothing is guessed or back-filled.
CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT,
  updated_at TEXT
);
ALTER TABLE boms ADD COLUMN is_temp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN product_code TEXT NOT NULL DEFAULT '';
ALTER TABLE shipments ADD COLUMN product_code TEXT NOT NULL DEFAULT '';
CREATE INDEX purchase_orders_code ON purchase_orders(product_code);
CREATE INDEX shipments_code ON shipments(product_code);
