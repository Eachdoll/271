-- Three optional category levels on catalog items, production lines / washers, and semi-finished work records.
ALTER TABLE boms ADD COLUMN cat1 TEXT NOT NULL DEFAULT '';
ALTER TABLE boms ADD COLUMN cat2 TEXT NOT NULL DEFAULT '';
ALTER TABLE boms ADD COLUMN cat3 TEXT NOT NULL DEFAULT '';
CREATE TABLE production_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('line','washer')),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT,
  updated_at TEXT,
  UNIQUE(kind, name_key)
);
CREATE TABLE semi_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process TEXT NOT NULL CHECK(process IN ('cut','wash')),
  work_date TEXT NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES production_units(id),
  unit_name TEXT NOT NULL,
  product_group TEXT NOT NULL CHECK(product_group IN ('wiper','seamless')),
  product_type TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL CHECK(qty>=0),
  unit TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT UNIQUE,
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT,
  updated_at TEXT
);
CREATE INDEX semi_records_date ON semi_records(process, work_date, unit_id);
