-- Once a purchase receipt quantity is recorded, changing it or reverting the receipt needs a logistics lead's approval.
CREATE TABLE receipt_qty_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('qty','revert')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  request_id TEXT UNIQUE,
  old_status TEXT NOT NULL, old_recv_qty REAL,
  new_recv_qty REAL CHECK(new_recv_qty IS NULL OR new_recv_qty>=0),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  requested_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  reviewed_by TEXT, reviewed_at TEXT, review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX receipt_changes_one_pending ON receipt_qty_changes(po_id) WHERE status='pending';
CREATE INDEX receipt_changes_status ON receipt_qty_changes(status,id);
CREATE INDEX receipt_changes_po ON receipt_qty_changes(po_id,id);
