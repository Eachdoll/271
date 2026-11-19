-- 15.256 특채: 수입검사 불합격 LOT을 품질책임자가 특채 처리하면 자재 투입·상품 출고를 허용. 취소는 voided_at으로(지우지 않음).
CREATE TABLE lot_concessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  lot TEXT NOT NULL,
  req_no TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX lot_concessions_active ON lot_concessions(item, lot) WHERE voided_at IS NULL;
