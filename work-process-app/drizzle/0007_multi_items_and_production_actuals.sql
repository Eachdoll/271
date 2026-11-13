ALTER TABLE purchase_orders ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN spec TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN lot TEXT NOT NULL DEFAULT '';
ALTER TABLE other_receipts ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE other_receipts ADD COLUMN spec TEXT NOT NULL DEFAULT '';
ALTER TABLE other_receipts ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE other_receipts ADD COLUMN lot TEXT NOT NULL DEFAULT '';
ALTER TABLE shipments ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE shipments ADD COLUMN spec TEXT NOT NULL DEFAULT '';
ALTER TABLE shipments ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN spec TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN lot TEXT NOT NULL DEFAULT '';
ALTER TABLE laundry ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE laundry ADD COLUMN spec TEXT NOT NULL DEFAULT '';
ALTER TABLE laundry ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE laundry ADD COLUMN lot TEXT NOT NULL DEFAULT '';
ALTER TABLE schedules ADD COLUMN batch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE schedules ADD COLUMN spec TEXT NOT NULL DEFAULT '';
ALTER TABLE schedules ADD COLUMN unit TEXT NOT NULL DEFAULT '';
ALTER TABLE schedules ADD COLUMN lot TEXT NOT NULL DEFAULT '';
ALTER TABLE laundry ADD COLUMN item TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN qty REAL;
CREATE TABLE item_batches (
  batch_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, payload_hash TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, author_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE production_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE RESTRICT, request_id TEXT UNIQUE,
  production_date TEXT NOT NULL, qty REAL NOT NULL CHECK(qty>=0), note TEXT NOT NULL DEFAULT '',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, author_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  voided_at TEXT, voided_by TEXT, void_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX actuals_schedule ON production_actuals(schedule_id,production_date,id);
CREATE INDEX purchase_orders_batch ON purchase_orders(batch_id);
CREATE INDEX other_receipts_batch ON other_receipts(batch_id);
CREATE INDEX shipments_batch ON shipments(batch_id);
CREATE INDEX requests_batch ON requests(batch_id);
CREATE INDEX laundry_batch ON laundry(batch_id);
CREATE INDEX schedules_batch ON schedules(batch_id);
