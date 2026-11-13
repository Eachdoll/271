CREATE TABLE progress_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('purchase_order','request','other_receipt','shipment','schedule','laundry','bom')),
  entity_id INTEGER NOT NULL,
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX progress_comments_entity ON progress_comments(entity_type,entity_id,id);
