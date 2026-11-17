-- 15.165 어음 관리(경리 › 대금): 받을어음·지급어음. 발행일자·어음번호·거래처·발행금액·만기일자·발행은행·처리구분(미처리/만기회수). 새 표 1개만.
CREATE TABLE bill_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'receivable' CHECK(kind IN ('receivable','payable')),
  issue_date TEXT NOT NULL,
  note_no TEXT NOT NULL,
  partner TEXT NOT NULL,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  bank TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','collected','cancelled')),
  processed_date TEXT,
  memo TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT,
  updated_at TEXT
);
CREATE INDEX bill_notes_due ON bill_notes(kind, status, due_date);
CREATE INDEX bill_notes_issue ON bill_notes(kind, issue_date, id);
