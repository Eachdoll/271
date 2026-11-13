CREATE TABLE boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  product_code TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('finished','semi')),
  base_qty REAL NOT NULL CHECK(base_qty > 0),
  unit TEXT NOT NULL,
  materials TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
ALTER TABLE schedules ADD COLUMN bom_id INTEGER REFERENCES boms(id);
ALTER TABLE schedules ADD COLUMN bom_snapshot TEXT NOT NULL DEFAULT '{}';

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('request','purchase_order','other_receipt','shipment')),
  entity_id INTEGER NOT NULL,
  photos TEXT NOT NULL DEFAULT '[]',
  inspection_status TEXT NOT NULL DEFAULT 'unchecked' CHECK(inspection_status IN ('unchecked','normal','abnormal')),
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  UNIQUE(entity_type,entity_id)
);
