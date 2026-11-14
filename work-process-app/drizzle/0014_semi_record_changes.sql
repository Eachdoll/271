-- Changing or deleting a recorded semi-finished work entry needs a production team lead's approval.
CREATE TABLE semi_record_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  process TEXT NOT NULL CHECK(process IN ('cut','wash')),
  action TEXT NOT NULL CHECK(action IN ('edit','delete')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  request_id TEXT UNIQUE,
  old_data TEXT NOT NULL,
  new_data TEXT,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  requested_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  reviewed_by TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX semi_changes_one_pending ON semi_record_changes(record_id) WHERE status='pending';
CREATE INDEX semi_changes_status ON semi_record_changes(status, process, id);
