-- 15.110 매입 지급확인: 매입처에 준 돈(payment)과 프로그램을 쓰기 전 남아 있던 줄 돈(opening, 기초 미지급).
-- 매입처 원장 잔액 = 기초 미지급 + 매입전표 합계 − 지급. 매입 마감에 그 달 지급 합계를 함께 남긴다.
CREATE TABLE purchase_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment' CHECK(kind IN ('payment','opening')),
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX purchase_payments_date ON purchase_payments(pay_date, id);
ALTER TABLE purchase_closings ADD COLUMN payment_total REAL NOT NULL DEFAULT 0;
