-- 15.147 전표 고친 이력(누가·언제·무엇을). 반입·반출·매출전표·매입전표 수정 때 한 줄씩. 새 표 1개만.
CREATE TABLE doc_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type TEXT NOT NULL,
  doc_id INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX doc_changes_doc ON doc_changes(doc_type, doc_id);
