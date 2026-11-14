-- Quality-defined specifications and request-time snapshots. Existing records are unchanged.
ALTER TABLE requests ADD COLUMN inspection_snapshot TEXT NOT NULL DEFAULT '';
CREATE TABLE inspection_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('수입검사','출하검사')),
  item_category TEXT NOT NULL,
  definition TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE inspection_spec_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spec_id INTEGER NOT NULL REFERENCES inspection_specs(id),
  kind TEXT NOT NULL,
  item_category TEXT NOT NULL,
  name_key TEXT NOT NULL,
  UNIQUE(kind,item_category,name_key)
);
CREATE TABLE inspection_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id),
  values_json TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('pending','pass','fail')),
  revision INTEGER NOT NULL DEFAULT 1,
  save_token TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE inspection_measurement_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  revision INTEGER NOT NULL,
  values_json TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  saved_by TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  UNIQUE(request_id,revision)
);
CREATE INDEX inspection_history_request ON inspection_measurement_history(request_id,id);
