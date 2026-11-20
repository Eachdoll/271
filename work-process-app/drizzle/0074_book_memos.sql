-- 15.271 거래처 장부 메모: 장부에 금액 없이 남기는 메모(매출/매입 장부별·거래처별·날짜). 지우면 status만 바꿈.
CREATE TABLE book_memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL CHECK(side IN ('sales','purchase')),
  party TEXT NOT NULL,
  party_key TEXT NOT NULL,
  memo_date TEXT NOT NULL,
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleted')),
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  deleted_at TEXT,
  deleted_by TEXT
);
--> statement-breakpoint
CREATE INDEX book_memos_party ON book_memos(side, party_key, memo_date);
