-- Corrections and cancellations of recorded production actuals need a production team lead's approval.
CREATE TABLE production_actual_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actual_id INTEGER NOT NULL REFERENCES production_actuals(id) ON DELETE RESTRICT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('edit','void')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  request_id TEXT UNIQUE,
  old_date TEXT NOT NULL, old_qty REAL NOT NULL, old_note TEXT NOT NULL DEFAULT '',
  new_date TEXT, new_qty REAL CHECK(new_qty IS NULL OR new_qty>=0), new_note TEXT,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  requested_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  reviewed_by TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX actual_changes_one_pending ON production_actual_changes(actual_id) WHERE status='pending';
CREATE INDEX actual_changes_status ON production_actual_changes(status,id);
CREATE INDEX actual_changes_schedule ON production_actual_changes(schedule_id,id);
ALTER TABLE production_actuals ADD COLUMN corrected_at TEXT;
ALTER TABLE production_actuals ADD COLUMN corrected_by TEXT;
